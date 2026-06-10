"""Wedge / triangle breakout detector — pattern family ``wedge_triangle``.

Fits converging trendlines through recent CONFIRMED swing highs and swing
lows (>= 2 touches per line, >= 4 total) and fires a directional event on the
first close that breaks a line:

  * rising wedge   (both lines rising, resistance flatter)  break DOWN -> short
  * falling wedge  (both lines falling, support flatter)    break UP   -> long
  * ascending triangle  (flat resistance, rising support)   break either way,
  * descending triangle (falling resistance, flat support)  event follows the
  * symmetric triangle  (falling resistance, rising support) break direction

Causality / no-lookahead
------------------------
A swing pivot at bar ``p`` (half-width ``m``) is consumed only from its
confirmation bar ``p + m`` onward (same convention as :mod:`ta_pipeline.swings`,
which provides the pivot detection). Trendlines are refit only when a new
pivot confirms, using pivots already confirmed at that bar; the break test at
bar ``t`` extrapolates those lines to ``t`` and compares against ``close[t]``.
Every quantity at ``t`` therefore depends on bars ``<= t`` only — enforced by
the truncation test in ``tests/test_pattern_wedge_triangle.py``.

Strength
--------
``strength = touch_count * convergence`` where ``convergence`` is the width
contraction ``1 - width_now / width_start`` (0..1, higher = tighter apex).

Higher-timeframe (weekly) trend
-------------------------------
:func:`weekly_trend_state` derives a -1/0/+1 weekly trend from the same daily
candles (W-FRI resample; weekly close vs weekly SMA10/SMA20 stack). Days
inside week ``w`` receive the state of the PRIOR completed week, so the value
at day ``t`` never reads past ``t``.

Pre-registered parameterizations
--------------------------------
``PARAM_SETS`` holds exactly three parameterizations (base / strict / loose),
fixed before any evaluation was run. The event study reports all three —
no post-hoc tuning.

Operates on a single ticker's daily OHLCV frame (columns: date, open, high,
low, close, ...; unique index). ``detect_universe`` applies it per ticker.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import List, Optional

import numpy as np
import pandas as pd

from ..indicators import atr as wilder_atr
from ..swings import detect_pivots

# Pattern kinds and the break directions they accept (+1 long / -1 short).
_BREAK_RULES = {
    "rising_wedge": (-1,),
    "falling_wedge": (1,),
    "ascending_triangle": (1, -1),
    "descending_triangle": (1, -1),
    "symmetric_triangle": (1, -1),
}

OUTPUT_COLUMNS = (
    "event_long", "event_short", "strength",
    "pattern_type", "touch_count", "convergence",
)


@dataclass(frozen=True)
class WedgeParams:
    """One pre-registered parameterization of the detector."""

    name: str = "p1_base"
    swing_m: int = 3                # pivot confirmation half-width
    lookback: int = 60              # pivot bar must lie within this many bars of t
    min_touches_per_line: int = 2   # >= 2 highs and >= 2 lows (>= 4 total)
    max_touches_per_line: int = 4   # fit on at most this many recent pivots/line
    flat_eps_atr: float = 0.03      # |slope| / ATR per bar below this = "flat"
    conv_min_atr: float = 0.02      # (sup_slope - res_slope) / ATR must exceed
    fit_tol_atr: float = 0.40       # max mean |touch residual| in ATR units
    min_contraction: float = 0.25   # 1 - width_now / width_start at formation
    break_margin_atr: float = 0.05  # close must clear the line by this many ATR
    max_pattern_age: int = 15       # bars after the last refit before stale
    atr_period: int = 14


# The ONLY parameterizations evaluated — registered before the event study.
PARAM_SETS = (
    WedgeParams(name="p1_base"),
    WedgeParams(
        name="p2_strict", lookback=50, max_touches_per_line=5,
        flat_eps_atr=0.025, conv_min_atr=0.03, fit_tol_atr=0.28,
        min_contraction=0.40, break_margin_atr=0.10, max_pattern_age=12,
    ),
    WedgeParams(
        name="p3_loose", swing_m=2, lookback=45, flat_eps_atr=0.04,
        conv_min_atr=0.015, fit_tol_atr=0.55, min_contraction=0.15,
        break_margin_atr=0.0, max_pattern_age=20,
    ),
)


@dataclass
class _Pattern:
    """A formed (still unbroken) converging pattern, in positional coords."""

    kind: str
    res_slope: float
    res_intercept: float
    sup_slope: float
    sup_intercept: float
    touch_count: int
    width_start: float
    formed_at: int

    def res_at(self, x: int) -> float:
        return self.res_intercept + self.res_slope * x

    def sup_at(self, x: int) -> float:
        return self.sup_intercept + self.sup_slope * x


def _fit_line(xs: np.ndarray, ys: np.ndarray):
    """Least-squares line through the touch points -> (slope, intercept, mae)."""
    slope, intercept = np.polyfit(xs, ys, 1)
    mae = float(np.mean(np.abs(ys - (intercept + slope * xs))))
    return float(slope), float(intercept), mae


def _classify(rs: float, ss: float, flat: float) -> Optional[str]:
    """Pattern kind from the ATR-normalized resistance / support slopes."""
    if rs > flat and ss > flat:
        return "rising_wedge"          # convergence => support rises faster
    if rs < -flat and ss < -flat:
        return "falling_wedge"         # convergence => resistance falls faster
    if abs(rs) <= flat and ss > flat:
        return "ascending_triangle"
    if rs < -flat and abs(ss) <= flat:
        return "descending_triangle"
    if rs < -flat and ss > flat:
        return "symmetric_triangle"
    return None                        # e.g. both lines ~flat: no real pattern


def _try_fit(
    t: int,
    high_pivots: List[int],
    low_pivots: List[int],
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    atr_arr: np.ndarray,
    p: WedgeParams,
) -> Optional[_Pattern]:
    """Attempt to form a converging pattern as of bar ``t`` (inputs <= t)."""
    a = atr_arr[t]
    if not np.isfinite(a) or a <= 0:
        return None
    lo_bound = t - p.lookback
    sel_h = [x for x in high_pivots[-12:] if x >= lo_bound][-p.max_touches_per_line:]
    sel_l = [x for x in low_pivots[-12:] if x >= lo_bound][-p.max_touches_per_line:]
    if len(sel_h) < p.min_touches_per_line or len(sel_l) < p.min_touches_per_line:
        return None

    xs_h = np.asarray(sel_h, dtype=float)
    xs_l = np.asarray(sel_l, dtype=float)
    res_slope, res_b, res_mae = _fit_line(xs_h, high[sel_h])
    sup_slope, sup_b, sup_mae = _fit_line(xs_l, low[sel_l])
    if res_mae > p.fit_tol_atr * a or sup_mae > p.fit_tol_atr * a:
        return None                    # touches don't sit on a clean line

    rs, ss = res_slope / a, sup_slope / a
    if ss - rs < p.conv_min_atr:
        return None                    # lines not converging
    kind = _classify(rs, ss, p.flat_eps_atr)
    if kind is None:
        return None

    x0 = float(min(sel_h[0], sel_l[0]))
    width_start = (res_b + res_slope * x0) - (sup_b + sup_slope * x0)
    width_now = (res_b + res_slope * t) - (sup_b + sup_slope * t)
    if width_start <= 0 or width_now <= 0:
        return None                    # crossed lines / apex already passed
    if 1.0 - width_now / width_start < p.min_contraction:
        return None                    # not tight enough yet

    # Price must still be inside the pattern at formation.
    margin = p.break_margin_atr * a
    if not ((sup_b + sup_slope * t) - margin <= close[t] <= (res_b + res_slope * t) + margin):
        return None

    return _Pattern(
        kind=kind,
        res_slope=res_slope, res_intercept=res_b,
        sup_slope=sup_slope, sup_intercept=sup_b,
        touch_count=len(sel_h) + len(sel_l),
        width_start=width_start,
        formed_at=t,
    )


def detect(df: pd.DataFrame, params: WedgeParams = None) -> pd.DataFrame:
    """Detect wedge / triangle breakouts on one ticker's daily OHLCV frame.

    Returns a same-index DataFrame with ``event_long`` / ``event_short``
    (bool), ``strength`` (float), and meta columns ``pattern_type``,
    ``touch_count``, ``convergence``. Events are sparse: one event per formed
    pattern, fired on the first close beyond a trendline; the pattern is then
    consumed.
    """
    p = params or PARAM_SETS[0]
    s = df.sort_values("date")
    n = len(s)

    high = s["high"].to_numpy(dtype=float)
    low = s["low"].to_numpy(dtype=float)
    close = s["close"].to_numpy(dtype=float)
    atr_arr = wilder_atr(s["high"], s["low"], s["close"], p.atr_period).to_numpy(dtype=float)

    event_long = np.zeros(n, dtype=bool)
    event_short = np.zeros(n, dtype=bool)
    strength = np.zeros(n, dtype=float)
    pattern_type = np.full(n, "", dtype=object)
    touch_count = np.zeros(n, dtype=float)
    convergence = np.zeros(n, dtype=float)

    if n > 2 * p.swing_m:
        is_h, is_l = detect_pivots(s["high"], s["low"], p.swing_m)
        h_piv = np.flatnonzero(is_h.to_numpy())
        l_piv = np.flatnonzero(is_l.to_numpy())

        hi_ptr = lo_ptr = 0
        conf_h: List[int] = []         # pivots confirmed (p + m <= t)
        conf_l: List[int] = []
        pattern: Optional[_Pattern] = None

        for t in range(n):
            new_pivot = False
            while hi_ptr < len(h_piv) and h_piv[hi_ptr] + p.swing_m <= t:
                conf_h.append(int(h_piv[hi_ptr]))
                hi_ptr += 1
                new_pivot = True
            while lo_ptr < len(l_piv) and l_piv[lo_ptr] + p.swing_m <= t:
                conf_l.append(int(l_piv[lo_ptr]))
                lo_ptr += 1
                new_pivot = True

            if new_pivot:              # structure changed -> refit (or drop)
                pattern = _try_fit(t, conf_h, conf_l, high, low, close, atr_arr, p)

            if pattern is None:
                continue
            if t - pattern.formed_at > p.max_pattern_age:
                pattern = None
                continue
            res_t, sup_t = pattern.res_at(t), pattern.sup_at(t)
            width_now = res_t - sup_t
            a = atr_arr[t]
            if width_now <= 0 or not np.isfinite(a) or a <= 0:
                pattern = None         # apex passed
                continue

            margin = p.break_margin_atr * a
            broke_up = close[t] > res_t + margin
            broke_dn = close[t] < sup_t - margin
            if not (broke_up or broke_dn):
                continue

            direction = 1 if broke_up else -1
            if direction in _BREAK_RULES[pattern.kind]:
                conv = min(max(1.0 - width_now / pattern.width_start, 0.0), 1.0)
                if direction > 0:
                    event_long[t] = True
                else:
                    event_short[t] = True
                strength[t] = pattern.touch_count * conv
                pattern_type[t] = pattern.kind
                touch_count[t] = pattern.touch_count
                convergence[t] = conv
            pattern = None             # broken either way -> consumed

    out = pd.DataFrame(
        {
            "event_long": event_long,
            "event_short": event_short,
            "strength": strength,
            "pattern_type": pattern_type,
            "touch_count": touch_count,
            "convergence": convergence,
        },
        index=s.index,
    )
    return out.reindex(df.index)


def detect_universe(df: pd.DataFrame, params: WedgeParams = None) -> pd.DataFrame:
    """Apply :func:`detect` per ticker; returns ticker/date + event columns."""
    parts = []
    for _, g in df.groupby("ticker", sort=False):
        res = detect(g, params)
        res.insert(0, "ticker", g["ticker"].to_numpy())
        res.insert(1, "date", g["date"].to_numpy())
        parts.append(res)
    return pd.concat(parts, ignore_index=True)


def weekly_trend_state(df: pd.DataFrame, sma_fast: int = 10, sma_slow: int = 20) -> pd.Series:
    """-1/0/+1 weekly-trend state per daily bar, from the PRIOR completed week.

    Weekly bars are W-FRI resampled closes of the same daily candles. Week w
    is an uptrend (+1) when its close > SMA{fast} > SMA{slow} (downtrend -1
    mirrored, else 0). Days inside week w receive week w-1's state, so the
    state at day t uses only weeks fully completed before t — no lookahead.
    """
    s = df.sort_values("date")
    wk_close = (
        s.set_index("date")["close"].resample("W-FRI").last().dropna()
    )
    fast = wk_close.rolling(sma_fast, min_periods=sma_fast).mean()
    slow = wk_close.rolling(sma_slow, min_periods=sma_slow).mean()
    state = pd.Series(
        np.where(
            (wk_close > fast) & (fast > slow), 1.0,
            np.where((wk_close < fast) & (fast < slow), -1.0, 0.0),
        ),
        index=wk_close.index,
    )
    prior = state.shift(1)             # only completed prior weeks are usable

    week_end = s["date"].dt.to_period("W-FRI").dt.end_time.dt.normalize()
    daily = pd.Series(
        prior.reindex(week_end.to_numpy()).to_numpy(),
        index=s.index,
    ).fillna(0.0)
    return daily.reindex(df.index)


def params_dict(p: WedgeParams) -> dict:
    """Flat dict of a parameterization — for report provenance."""
    return asdict(p)
