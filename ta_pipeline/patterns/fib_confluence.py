"""Fibonacci-confluence reclaim detector — pattern family ``fib_confluence``.

efficientenzyme's signature element (fib retracement appears on ~59% of his
charts) and the one structural idea NOT covered by the prior 22-detector round.
The hypothesis: a pullback that stalls and RECLAIMS at a Fibonacci retracement
level *that coincides with prior structure* carries more information than the
plain swing-reclaim already measured (and refuted at chance) by
``features/reclaim.py`` / ``patterns/false_break.py``.

Construction (per ticker, daily OHLCV, no lookahead)
----------------------------------------------------
1. **Swings.** Confirmed pivots come from :func:`ta_pipeline.swings.detect_pivots`
   (centered half-width ``m``). A pivot at bar ``p`` is consumed only from its
   confirmation bar ``p + m`` onward — identical to the wedge/false_break
   convention. The last ``m`` bars can never be pivots.

2. **Impulse leg A -> B.** The two most-recently-confirmed pivots of OPPOSITE
   type form a leg: a confirmed low (A) then a confirmed high (B) = up-impulse
   (we look for long reclaims of its pullback); a confirmed high then low =
   down-impulse (short reclaims). The leg must span at least
   ``min_impulse_atr`` ATR (|B - A| / ATR).

3. **Fib retracement levels.** For an up-impulse from low ``A`` to high ``B``,
   level ``r`` sits at ``B - r * (B - A)`` (a pullback of fraction ``r``).
   Mirror for a down-impulse. Only the registered ``fib_levels`` are used.

4. **Pullback into a fib zone + confluence.** While the leg is live, price
   pulls back and a bar's low (up-impulse) reaches a fib level — i.e. the bar's
   low <= fib price <= bar's high (the zone was touched). CONFLUENCE requires a
   prior *structural* level — another confirmed swing point (not A or B) — whose
   price sits within ``confluence_atr * ATR`` of that fib price. The number of
   distinct confluent factors (fib levels touched in-zone + structural pivots
   within band) drives strength.

5. **Reclaim.** After the zone is touched (this bar or an earlier pullback bar
   of the same leg), the FIRST bar that closes back in the impulse direction
   beyond the zone high (up) / zone low (down) fires the event:
   ``event_long`` for an up-impulse pullback reclaim, ``event_short`` mirror.
   The leg is then consumed (one event per leg).

``strength = confluent_factor_count * reclaim_cleanliness`` where
``reclaim_cleanliness = (close - zone_top) / ATR`` (up) is how decisively the
reclaim bar closed back above the zone.

ADDITIVITY CONTROL (critical)
-----------------------------
:data:`PARAM_SETS` registers three fib-confluence parameterizations. The eval
ALSO reports, for the same swing structure and the same reclaim mechanic, the
plain swing-reclaim WITHOUT the fib / confluence gate (``require_fib=False``,
``require_confluence=False``) — so we can see whether the fib-confluence filter
is ADDITIVE over the bare swing-reclaim that the prior round already refuted.

Higher-timeframe (weekly) trend
-------------------------------
:func:`weekly_trend_state` derives a -1/0/+1 weekly trend (W-FRI close vs weekly
SMA10/SMA20 stack); every daily bar reads the PRIOR completed week, so the
state at day ``t`` never reads past ``t``.

Operates on a single ticker; ``detect_universe`` applies it per ticker.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd

from ..indicators import atr as wilder_atr
from ..swings import detect_pivots

OUTPUT_COLUMNS = (
    "event_long", "event_short", "strength",
    "confluence_count", "fib_level", "reclaim_cleanliness",
)


@dataclass(frozen=True)
class FibParams:
    """One pre-registered parameterization of the fib-confluence reclaim."""

    name: str = "f1_base"
    swing_m: int = 3                       # pivot confirmation half-width
    fib_levels: Tuple[float, ...] = (0.382, 0.5, 0.618, 0.786)
    confluence_atr: float = 0.3            # structural level within this ATR band
    min_impulse_atr: float = 2.0           # |B - A| / ATR floor for a leg
    max_leg_age: int = 40                  # bars after B-confirm before the leg is stale
    atr_period: int = 14
    require_fib: bool = True               # gate on touching a fib level
    require_confluence: bool = True        # gate on a confluent structural level

    def to_dict(self) -> dict:
        return asdict(self)


# The ONLY parameterizations evaluated — fixed before any outcome was inspected.
# Axes swept per the brief: {fib levels}, {confluence ATR band}, {min impulse ATR}.
PARAM_SETS = (
    FibParams(name="f1_base"),
    FibParams(
        name="f2_tight",
        fib_levels=(0.5, 0.618),           # the "golden pocket" only
        confluence_atr=0.2,
        min_impulse_atr=3.0,
    ),
    FibParams(
        name="f3_loose",
        fib_levels=(0.382, 0.5, 0.618, 0.786),
        confluence_atr=0.5,
        min_impulse_atr=1.5,
    ),
)


@dataclass
class _Leg:
    """A live impulse leg whose pullback we are watching for a reclaim."""

    direction: int          # +1 up-impulse (long reclaim) / -1 down-impulse
    a_price: float          # the leg origin (low for up, high for down)
    b_price: float          # the leg extreme (high for up, low for down)
    b_idx: int              # bar index of the extreme pivot
    fib_prices: List[float]
    touched: bool           # has the pullback reached a fib/zone yet
    zone_top: float         # the relevant reclaim boundary (set when touched)
    zone_bot: float
    best_confluence: int    # confluent factor count at the touch


def _confluent_count(
    fib_price: float,
    struct_prices: np.ndarray,
    band: float,
) -> int:
    """Distinct structural pivots within ``band`` (price units) of ``fib_price``."""
    if struct_prices.size == 0:
        return 0
    return int(np.count_nonzero(np.abs(struct_prices - fib_price) <= band))


def detect(df: pd.DataFrame, params: FibParams = None) -> pd.DataFrame:
    """Detect fib-confluence reclaims on one ticker's daily OHLCV frame.

    Returns a same-index DataFrame with ``event_long`` / ``event_short``
    (bool), ``strength`` (float), and meta columns ``confluence_count``,
    ``fib_level``, ``reclaim_cleanliness``. One event per impulse leg, fired on
    the first close that reclaims the pullback zone in the impulse direction.
    """
    p = params or PARAM_SETS[0]
    s = df.sort_values("date")
    n = len(s)

    high = s["high"].to_numpy(dtype=float)
    low = s["low"].to_numpy(dtype=float)
    close = s["close"].to_numpy(dtype=float)
    atr_arr = wilder_atr(
        s["high"], s["low"], s["close"], p.atr_period
    ).to_numpy(dtype=float)

    event_long = np.zeros(n, dtype=bool)
    event_short = np.zeros(n, dtype=bool)
    strength = np.zeros(n, dtype=float)
    confluence_count = np.zeros(n, dtype=float)
    fib_level = np.full(n, np.nan, dtype=float)
    reclaim_clean = np.zeros(n, dtype=float)

    if n > 2 * p.swing_m:
        is_h, is_l = detect_pivots(s["high"], s["low"], p.swing_m)
        h_piv = np.flatnonzero(is_h.to_numpy())
        l_piv = np.flatnonzero(is_l.to_numpy())

        hi_ptr = lo_ptr = 0
        # Confirmed pivots as (idx, price, kind) with kind +1 high / -1 low,
        # in confirmation order. Structural prices for confluence draw from
        # ALL confirmed pivots EXCEPT the current leg's A and B.
        conf: List[Tuple[int, float, int]] = []
        leg: Optional[_Leg] = None

        for t in range(n):
            new_pivot = False
            while hi_ptr < len(h_piv) and h_piv[hi_ptr] + p.swing_m <= t:
                conf.append((int(h_piv[hi_ptr]), float(high[h_piv[hi_ptr]]), +1))
                hi_ptr += 1
                new_pivot = True
            while lo_ptr < len(l_piv) and l_piv[lo_ptr] + p.swing_m <= t:
                conf.append((int(l_piv[lo_ptr]), float(low[l_piv[lo_ptr]]), -1))
                lo_ptr += 1
                new_pivot = True
            # Keep confirmation order stable (ties resolved by index).
            if new_pivot:
                conf.sort(key=lambda r: (r[0],))

            a = atr_arr[t]
            if not np.isfinite(a) or a <= 0:
                continue

            # --- (re)form a leg from the two most recent OPPOSITE pivots ---
            if new_pivot and len(conf) >= 2:
                b_idx, b_price, b_kind = conf[-1]
                a_idx, a_price, a_kind = conf[-2]
                if a_kind != b_kind and abs(b_price - a_price) >= p.min_impulse_atr * a:
                    direction = +1 if b_kind == +1 else -1  # low->high = up
                    span = b_price - a_price                # signed (>0 up, <0 down)
                    fibs = []
                    for r in p.fib_levels:
                        # retracement of fraction r from the extreme back toward A
                        fibs.append(b_price - r * span)
                    leg = _Leg(
                        direction=direction,
                        a_price=a_price, b_price=b_price, b_idx=b_idx,
                        fib_prices=fibs, touched=False,
                        zone_top=np.nan, zone_bot=np.nan, best_confluence=0,
                    )

            if leg is None:
                continue
            if t - leg.b_idx > p.max_leg_age:
                leg = None
                continue

            # Structural prices = confirmed pivots excluding this leg's A and B.
            struct = np.array(
                [pr for (_, pr, _) in conf
                 if abs(pr - leg.a_price) > 1e-9 and abs(pr - leg.b_price) > 1e-9],
                dtype=float,
            )
            band = p.confluence_atr * a

            if leg.direction == +1:
                # ---- up-impulse: watch a pullback DOWN into a fib zone ----
                if not leg.touched:
                    # the deepest fib the bar's range reached this bar
                    hit_level = None
                    hit_conf = 0
                    for r, fp in zip(p.fib_levels, leg.fib_prices):
                        in_zone = (low[t] <= fp) and (high[t] >= fp)
                        # without the fib gate, ANY pullback bar below B counts
                        gate = in_zone if p.require_fib else (low[t] < leg.b_price)
                        if not gate:
                            continue
                        c = _confluent_count(fp, struct, band)
                        if p.require_confluence and c == 0:
                            continue
                        # +1 for the fib level itself as a factor
                        factors = (1 if p.require_fib else 0) + c
                        if hit_level is None or factors > hit_conf:
                            hit_level, hit_conf = r, factors
                    if hit_level is not None:
                        leg.touched = True
                        leg.best_confluence = hit_conf
                        # reclaim boundary = the zone high of THIS pullback bar
                        leg.zone_top = high[t]
                        leg.zone_bot = low[t]
                        leg._fib = hit_level  # type: ignore[attr-defined]
                    continue
                # already touched -> watch for the reclaim close
                if close[t] > leg.zone_top:
                    event_long[t] = True
                    clean = (close[t] - leg.zone_top) / a
                    confluence_count[t] = leg.best_confluence
                    reclaim_clean[t] = clean
                    fib_level[t] = getattr(leg, "_fib", np.nan)
                    strength[t] = leg.best_confluence * max(clean, 0.0)
                    leg = None
                elif low[t] < leg.a_price:
                    leg = None  # pullback broke the leg origin -> invalidated
            else:
                # ---- down-impulse: watch a pullback UP into a fib zone ----
                if not leg.touched:
                    hit_level = None
                    hit_conf = 0
                    for r, fp in zip(p.fib_levels, leg.fib_prices):
                        in_zone = (low[t] <= fp) and (high[t] >= fp)
                        gate = in_zone if p.require_fib else (high[t] > leg.b_price)
                        if not gate:
                            continue
                        c = _confluent_count(fp, struct, band)
                        if p.require_confluence and c == 0:
                            continue
                        factors = (1 if p.require_fib else 0) + c
                        if hit_level is None or factors > hit_conf:
                            hit_level, hit_conf = r, factors
                    if hit_level is not None:
                        leg.touched = True
                        leg.best_confluence = hit_conf
                        leg.zone_top = high[t]
                        leg.zone_bot = low[t]
                        leg._fib = hit_level  # type: ignore[attr-defined]
                    continue
                if close[t] < leg.zone_bot:
                    event_short[t] = True
                    clean = (leg.zone_bot - close[t]) / a
                    confluence_count[t] = leg.best_confluence
                    reclaim_clean[t] = clean
                    fib_level[t] = getattr(leg, "_fib", np.nan)
                    strength[t] = leg.best_confluence * max(clean, 0.0)
                    leg = None
                elif high[t] > leg.a_price:
                    leg = None

    out = pd.DataFrame(
        {
            "event_long": event_long,
            "event_short": event_short,
            "strength": strength,
            "confluence_count": confluence_count,
            "fib_level": fib_level,
            "reclaim_cleanliness": reclaim_clean,
        },
        index=s.index,
    )
    return out.reindex(df.index)


def detect_universe(df: pd.DataFrame, params: FibParams = None) -> pd.DataFrame:
    """Apply :func:`detect` per ticker; returns ticker/date + event columns."""
    parts = []
    for _, g in df.groupby("ticker", sort=False):
        res = detect(g, params)
        res.insert(0, "ticker", g["ticker"].to_numpy())
        res.insert(1, "date", g["date"].to_numpy())
        parts.append(res)
    return pd.concat(parts, ignore_index=True)


def weekly_trend_state(
    df: pd.DataFrame, sma_fast: int = 10, sma_slow: int = 20
) -> pd.Series:
    """-1/0/+1 weekly-trend state per daily bar, from the PRIOR completed week.

    Weekly bars are W-FRI resampled closes of the same daily candles. Week w is
    an uptrend (+1) when its close > SMA{fast} > SMA{slow} (downtrend -1
    mirrored, else 0). Days inside week w receive week w-1's state, so the state
    at day t uses only weeks fully completed before t — no lookahead.
    """
    s = df.sort_values("date")
    wk_close = s.set_index("date")["close"].resample("W-FRI").last().dropna()
    fast = wk_close.rolling(sma_fast, min_periods=sma_fast).mean()
    slow = wk_close.rolling(sma_slow, min_periods=sma_slow).mean()
    state = pd.Series(
        np.where(
            (wk_close > fast) & (fast > slow), 1.0,
            np.where((wk_close < fast) & (fast < slow), -1.0, 0.0),
        ),
        index=wk_close.index,
    )
    prior = state.shift(1)                  # only completed prior weeks usable

    week_end = s["date"].dt.to_period("W-FRI").dt.end_time.dt.normalize()
    daily = pd.Series(
        prior.reindex(week_end.to_numpy()).to_numpy(),
        index=s.index,
    ).fillna(0.0)
    return daily.reindex(df.index)


def params_dict(p: FibParams) -> dict:
    """Flat dict of a parameterization — for report provenance."""
    return asdict(p)
