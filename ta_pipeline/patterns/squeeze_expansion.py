"""Volatility squeeze -> directional expansion pattern detector.

A *squeeze* is a multi-bar volatility contraction: Bollinger-band width sitting
at a trailing-percentile low (reusing the §4.2 bandwidth-percentile concept),
optionally pinned by an NR7-style narrowest-range bar. The *event* fires on the
FIRST directional expansion bar out of the squeeze: the close clears the prior
K-bar range with a genuinely expanded true range, while the squeeze was still
in force on the prior bar (and the prior bar had NOT already broken its own
prior range — that is what makes the bar the first one out).

Direction = expansion direction: ``event_long`` on an upside break,
``event_short`` on a downside break. The detector also emits ``htf_trend`` — a
weekly (W-FRI) trend state computed from the same daily candles — so the
evaluation can condition on higher-timeframe alignment. Week *w*'s state is
only usable AFTER week *w*'s Friday close, so every day inside a week reads the
PRIOR completed week's state (a plain ``shift(1)`` on the weekly grid).

Leakage discipline (mirrors the §4 feature blocks):

* every rolling window is trailing with full ``min_periods`` — half-formed
  windows yield NaN, and NaN comparisons are False, so no event can fire
  during warmup;
* the prior K-bar range and the squeeze state are both evaluated as of bar
  ``t-1`` (``shift(1)``), the expansion bar's own close/true-range are at ``t``;
* the weekly state for a day in week *w* uses only weeks ``< w``, which are
  complete relative to any day of week *w*.

Truncation invariance — ``detect(df.iloc[:t])`` equals ``detect(df).iloc[:t]``
— is enforced by ``tests/test_pattern_squeeze_expansion.py``.

Three parameterizations are PRE-REGISTERED in ``VARIANTS`` (no post-hoc
tuning); the evaluation reports all three:

* ``bb_squeeze``   — baseline: bandwidth pctile <= 0.15 held >= 5 bars,
  20-bar range break, true range >= 1.0 ATR.
* ``nr7_squeeze``  — classic narrow-range setup: prior bar is the narrowest of
  its last 7 AND bandwidth pctile <= 0.30; break of the prior 7-bar range.
* ``deep_squeeze`` — strict: bandwidth pctile <= 0.10 held >= 10 bars,
  20-bar range break, true range >= 1.25 ATR.

Operates on a single ticker's daily OHLCV frame.
"""

from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd

from ..indicators import atr as wilder_atr
from ..indicators import bollinger, true_range
from ..features.common import trailing_pctile_rank

# ---------------------------------------------------------------------------
# Pre-registered parameterizations. Do not tune; report all three.
# ---------------------------------------------------------------------------
VARIANTS: Dict[str, dict] = {
    "bb_squeeze": {
        "squeeze_pctile": 0.15,     # bandwidth pctile at t-1 must be <= this
        "min_squeeze_bars": 5,      # squeeze must have persisted this long
        "range_k": 20,              # prior K-bar range to break
        "tr_expansion_min": 1.0,    # event bar true range >= this many ATR
        "require_nr7": False,
    },
    "nr7_squeeze": {
        "squeeze_pctile": 0.30,
        "min_squeeze_bars": 1,
        "range_k": 7,
        "tr_expansion_min": 1.0,
        "require_nr7": True,        # bar t-1 is the narrowest of its last 7
    },
    "deep_squeeze": {
        "squeeze_pctile": 0.10,
        "min_squeeze_bars": 10,
        "range_k": 20,
        "tr_expansion_min": 1.25,
        "require_nr7": False,
    },
}

# Fixed, convention-grounded internals (match PipelineConfig defaults).
_ATR_PERIOD = 14
_BB_PERIOD = 20
_BB_STD = 2.0
_BW_PCTILE_WINDOW = 126
_WEEKLY_SMA_FAST = 10
_WEEKLY_SMA_SLOW = 20


def _run_length(flag: pd.Series) -> pd.Series:
    """Length of the consecutive run of True ending at each bar (0 where False).

    Backward-looking: the value at t depends only on bars <= t.
    """
    f = flag.fillna(False).astype(int)
    groups = (f != f.shift()).cumsum()
    return f * (f.groupby(groups).cumcount() + 1)


def weekly_trend_state(dates: pd.Series, close: pd.Series) -> pd.Series:
    """Higher-timeframe (weekly) trend state for each daily bar; no lookahead.

    Daily closes are resampled to W-FRI weekly closes; a week is an uptrend
    (+1) when ``weekly close > SMA10 > SMA20`` of weekly closes, a downtrend
    (-1) on the mirrored stack, else 0. Each daily bar receives the PRIOR
    completed week's state (``shift(1)`` on the weekly grid), so a day inside
    week *w* never reads week *w*'s own (still-forming) bar. NaN (warmup,
    < SMA20 weeks of history) is mapped to 0 = "no signal".
    """
    s = pd.Series(close.to_numpy(), index=pd.DatetimeIndex(dates))
    wclose = s.resample("W-FRI").last()
    fast = wclose.rolling(_WEEKLY_SMA_FAST, min_periods=_WEEKLY_SMA_FAST).mean()
    slow = wclose.rolling(_WEEKLY_SMA_SLOW, min_periods=_WEEKLY_SMA_SLOW).mean()
    up = (wclose > fast) & (fast > slow)
    down = (wclose < fast) & (fast < slow)
    state = up.astype(float) - down.astype(float)
    state = state.where(slow.notna())            # NaN until the stack is formed
    prior = state.shift(1)                        # prior COMPLETED week only

    # Map each daily date to its W-FRI bucket label (the Friday) and read the
    # prior week's state.
    week_end = pd.DatetimeIndex(dates).to_period("W-FRI").to_timestamp(how="end")
    week_end = week_end.normalize()
    daily = prior.reindex(week_end).to_numpy()
    return pd.Series(daily, index=close.index).fillna(0.0)


def detect(
    df: pd.DataFrame,
    params: Optional[dict] = None,
    variant: str = "bb_squeeze",
) -> pd.DataFrame:
    """Detect squeeze -> expansion events on one ticker's daily OHLCV frame.

    ``df`` needs ``date / open / high / low / close / volume`` sorted by date
    (one ticker). Returns a same-index DataFrame with:

    * ``event_long`` / ``event_short`` (bool) — first directional expansion bar
      out of a squeeze, direction = expansion direction;
    * ``strength`` (float) — breakout distance beyond the range edge in ATR
      units times the prior squeeze intensity (0 on non-event bars);
    * meta: ``htf_trend`` (-1/0/+1 prior-week weekly trend),
      ``squeeze_pctile_prev`` (bandwidth pctile at t-1),
      ``squeeze_run_prev`` (squeeze persistence as of t-1),
      ``expansion_tr_atr`` (event-bar true range in ATR).
    """
    p = dict(VARIANTS[variant])
    if params:
        p.update(params)

    high, low, close = df["high"], df["low"], df["close"]

    atr = wilder_atr(high, low, close, _ATR_PERIOD)
    tr = true_range(high, low, close)
    upper, middle, lower = bollinger(close, _BB_PERIOD, _BB_STD)
    bandwidth = (upper - lower) / middle
    bw_pctile = trailing_pctile_rank(bandwidth, _BW_PCTILE_WINDOW)

    # --- squeeze state, evaluated as of the PRIOR bar -------------------
    squeeze = bw_pctile <= p["squeeze_pctile"]
    squeeze_run = _run_length(squeeze)
    squeeze_prev = squeeze.shift(1, fill_value=False)
    run_prev = squeeze_run.shift(1).fillna(0.0)
    in_squeeze_prev = squeeze_prev & (run_prev >= p["min_squeeze_bars"])

    if p["require_nr7"]:
        rng = high - low
        nr7 = rng <= rng.rolling(7, min_periods=7).min()
        in_squeeze_prev = in_squeeze_prev & nr7.shift(1, fill_value=False)

    # --- prior K-bar range (excludes the current bar) --------------------
    k = p["range_k"]
    range_high = high.rolling(k, min_periods=k).max().shift(1)
    range_low = low.rolling(k, min_periods=k).min().shift(1)

    broke_up = close > range_high          # NaN compare -> False
    broke_down = close < range_low

    # FIRST bar out: the prior bar must NOT already have broken ITS prior
    # range (the same break test shifted one bar back).
    prev_broke = (broke_up | broke_down).shift(1, fill_value=False)
    first_out = in_squeeze_prev & ~prev_broke

    # --- expansion confirmation on the event bar -------------------------
    tr_in_atr = tr / atr
    expanding = tr_in_atr >= p["tr_expansion_min"]

    event_long = (first_out & broke_up & expanding).fillna(False).astype(bool)
    event_short = (first_out & broke_down & expanding).fillna(False).astype(bool)

    # --- strength: break distance (ATR) x prior squeeze intensity --------
    intensity_prev = (1.0 - bw_pctile.shift(1)).clip(lower=0.0)
    dist = pd.Series(0.0, index=df.index)
    dist[event_long] = ((close - range_high) / atr)[event_long]
    dist[event_short] = ((range_low - close) / atr)[event_short]
    strength = (dist * intensity_prev).fillna(0.0)
    strength[~(event_long | event_short)] = 0.0

    out = pd.DataFrame(index=df.index)
    out["event_long"] = event_long
    out["event_short"] = event_short
    out["strength"] = strength
    out["htf_trend"] = weekly_trend_state(df["date"], close)
    out["squeeze_pctile_prev"] = bw_pctile.shift(1)
    out["squeeze_run_prev"] = run_prev
    out["expansion_tr_atr"] = tr_in_atr
    return out


def detect_universe(
    bars: pd.DataFrame,
    params: Optional[dict] = None,
    variant: str = "bb_squeeze",
) -> pd.DataFrame:
    """Run :func:`detect` per ticker on a multi-ticker frame.

    Returns a frame with ``ticker`` / ``date`` plus the detector columns —
    one row per input bar, tickers never crossing.
    """
    parts = []
    for ticker, g in bars.groupby("ticker", sort=False):
        g = g.sort_values("date").reset_index(drop=True)
        ev = detect(g, params=params, variant=variant)
        ev.insert(0, "ticker", ticker)
        ev.insert(1, "date", g["date"].to_numpy())
        parts.append(ev)
    if not parts:
        return pd.DataFrame()
    return pd.concat(parts, ignore_index=True)
