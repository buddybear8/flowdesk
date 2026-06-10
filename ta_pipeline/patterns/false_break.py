"""False-break / liquidity-sweep detectors over N-day range extremes.

Pattern family ``false_break``. The pipeline already owns the swing-level
variant of this family — §4.6 ``swing_reclaim`` (features/reclaim.py: a
CONFIRMED swing level breached intrabar, then reclaimed by two consecutive
closes). This module EXTENDS the family along the three axes the brief lists,
without duplicating the existing detector:

  * **range extremes** — the breached level is the prior N-day range extreme
    (rolling min low / max high), not a confirmed pivot;
  * **multi-bar sweeps** — price may CLOSE beyond the level for 1-2 bars
    before closing back inside (vs. reclaim's intrabar-breach-only);
  * **overshoot magnitude** — the deepest excursion beyond the level in ATR
    units is the event ``strength`` and is band-filtered.

Failed breakdown (sweep below a low, close back above) = ``event_long``;
failed breakout (sweep above a high, close back below) = ``event_short``.

PRE-REGISTERED parameterizations (all reported, none tuned post hoc):

  ``k20_1bar``  prior 20-day extreme, intraday sweep, same-bar close back
                inside (the classic 1-bar liquidity sweep / stop run).
  ``k20_2bar``  prior 20-day extreme, 1-2 consecutive CLOSES beyond the
                level, then a close back inside (multi-bar failed break).
  ``k55_1bar``  the 1-bar sweep at a longer, rarer 55-day extreme.

The overshoot band [0.25, 1.5] ATR follows the §4.6 reclaim convention
(``breach_penetration_min/max_atr``) with a raised floor: at the reclaim
module's 0.1 floor the 1-bar range sweep fires on ~8% of real trading days
(the 20-day low is brushed constantly) — not a selective setup. 0.25 ATR
brings all three variants to ~3-4% of days. This floor was fixed from event
RATES alone, before any label/outcome was inspected, and is part of the
pre-registration; deep, genuine breakdowns (> 1.5 ATR) stay excluded.

No lookahead, by construction:

  * the level is a rolling extreme over bars that END BEFORE the sweep window
    (``shift(1)`` for the 1-bar mode; ``shift(3)`` for the multi-bar mode, so
    the breach bars can never lower/raise their own level);
  * ATR is the trailing Wilder ATR(14) — the same ATR the labeler uses;
  * rolling windows use full ``min_periods`` — NaN levels during warmup make
    every comparison False, so no event can fire on a half-formed window;
  * :func:`weekly_trend_state` maps each day to the PRIOR completed W-FRI
    week, so a week's own (possibly partial) bar never feeds its days.

Operates on a single ticker; compute per ticker, never across.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from ..indicators import atr as wilder_atr


@dataclass(frozen=True)
class FalseBreakParams:
    """One pre-registered parameterization of the range-extreme sweep."""

    range_k: int = 20            # the breached level = prior range_k-day extreme
    max_breach_closes: int = 0   # 0 = intraday sweep, same-bar recovery;
                                 # 2 = up to two closes beyond, then close back inside
    overshoot_min_atr: float = 0.25
    overshoot_max_atr: float = 1.5
    atr_period: int = 14

    def to_dict(self) -> dict:
        return asdict(self)


#: The three pre-registered detector variants (see module docstring).
VARIANTS = {
    "k20_1bar": FalseBreakParams(range_k=20, max_breach_closes=0),
    "k20_2bar": FalseBreakParams(range_k=20, max_breach_closes=2),
    "k55_1bar": FalseBreakParams(range_k=55, max_breach_closes=0),
}


def _require_sorted(df: pd.DataFrame) -> None:
    if "date" in df.columns and not df["date"].is_monotonic_increasing:
        raise ValueError("bars must be sorted by date (single ticker)")


def detect(df: pd.DataFrame, variant="k20_1bar") -> pd.DataFrame:
    """Detect false breaks of the prior N-day range extreme for one ticker.

    Parameters
    ----------
    df : DataFrame
        One ticker's daily OHLCV bars, date-sorted (``high``/``low``/``close``
        required; ``date`` checked for order when present).
    variant : str | FalseBreakParams
        A key of :data:`VARIANTS` or an explicit parameter set.

    Returns
    -------
    DataFrame (same index as ``df``) with:

    * ``event_long`` / ``event_short`` — bool; failed breakdown / breakout.
    * ``strength`` — deepest overshoot beyond the level, in ATR units
      (0.0 on non-event bars).
    * ``overshoot_atr`` — alias of ``strength`` (meta, explicit name).
    * ``level`` — the breached level on event bars, NaN elsewhere (meta).
    """
    params = VARIANTS[variant] if isinstance(variant, str) else variant
    _require_sorted(df)
    high, low, close = df["high"], df["low"], df["close"]
    a = wilder_atr(high, low, close, params.atr_period)
    k = params.range_k
    omin, omax = params.overshoot_min_atr, params.overshoot_max_atr

    if params.max_breach_closes == 0:
        # --- 1-bar sweep: intraday breach of the prior k-day extreme, ----
        # --- close back inside the SAME bar. Level excludes the bar. -----
        lvl_lo = low.rolling(k, min_periods=k).min().shift(1)
        lvl_hi = high.rolling(k, min_periods=k).max().shift(1)
        over_lo = (lvl_lo - low) / a
        over_hi = (high - lvl_hi) / a
        fired_long = (
            (low < lvl_lo) & (close > lvl_lo)
            & (over_lo >= omin) & (over_lo <= omax)
        )
        fired_short = (
            (high > lvl_hi) & (close < lvl_hi)
            & (over_hi >= omin) & (over_hi <= omax)
        )
    else:
        # --- multi-bar sweep: 1-2 consecutive CLOSES beyond the level, ---
        # --- then bar t closes back inside. The level is FROZEN before ---
        # --- the sweep window (shift(3) skips bars t-1, t-2), so the  ----
        # --- breach bars can never move their own level. ------------------
        lvl_lo = low.rolling(k, min_periods=k).min().shift(3)
        lvl_hi = high.rolling(k, min_periods=k).max().shift(3)
        c1, c2, c3 = close.shift(1), close.shift(2), close.shift(3)

        # Exactly 1 or 2 closes beyond, ending at t-1 (the reclaim close at
        # t must immediately follow the last breach close). NaN compares
        # False, so warmup bars can never fire.
        below_run = ((c1 < lvl_lo) & (c2 >= lvl_lo)) | (
            (c1 < lvl_lo) & (c2 < lvl_lo) & (c3 >= lvl_lo)
        )
        above_run = ((c1 > lvl_hi) & (c2 <= lvl_hi)) | (
            (c1 > lvl_hi) & (c2 > lvl_hi) & (c3 <= lvl_hi)
        )

        # Deepest excursion over the sweep window (bars t-2 .. t).
        deep_lo = low.rolling(3, min_periods=3).min()
        deep_hi = high.rolling(3, min_periods=3).max()
        over_lo = (lvl_lo - deep_lo) / a
        over_hi = (deep_hi - lvl_hi) / a

        fired_long = (
            below_run & (close > lvl_lo)
            & (over_lo >= omin) & (over_lo <= omax)
        )
        fired_short = (
            above_run & (close < lvl_hi)
            & (over_hi >= omin) & (over_hi <= omax)
        )

    fired_long = fired_long.fillna(False)
    fired_short = fired_short.fillna(False)

    out = pd.DataFrame(index=df.index)
    out["event_long"] = fired_long.astype(bool)
    out["event_short"] = fired_short.astype(bool)

    strength = pd.Series(0.0, index=df.index)
    strength[out["event_long"]] = over_lo[out["event_long"]]
    strength[out["event_short"]] = over_hi[out["event_short"]]
    out["strength"] = strength
    out["overshoot_atr"] = strength

    level = pd.Series(np.nan, index=df.index)
    level[out["event_long"]] = lvl_lo[out["event_long"]]
    level[out["event_short"]] = lvl_hi[out["event_short"]]
    out["level"] = level
    return out


def weekly_trend_state(
    df: pd.DataFrame, sma_fast: int = 10, sma_slow: int = 20
) -> pd.Series:
    """Higher-timeframe (weekly) trend state for each DAILY bar, no lookahead.

    Daily closes are resampled to W-FRI weekly closes; week w is in an uptrend
    (+1) when ``weekly_close > SMA10 > SMA20`` (all weekly), a downtrend (-1)
    when ``weekly_close < SMA10 < SMA20``, else neutral (0). Every day of week
    w is assigned the state of the PRIOR COMPLETED week (w-1) — a week's own,
    possibly partial, bar never feeds its days, so the mapping is truncation
    invariant.

    Returns a float Series on ``df``'s index: +1 / 0 / -1, NaN while the
    weekly SMAs are still warming up.
    """
    _require_sorted(df)
    dates = pd.to_datetime(df["date"])
    wclose = (
        pd.Series(df["close"].to_numpy(), index=pd.DatetimeIndex(dates))
        .resample("W-FRI")
        .last()
        .dropna()
    )
    fast = wclose.rolling(sma_fast, min_periods=sma_fast).mean()
    slow = wclose.rolling(sma_slow, min_periods=sma_slow).mean()

    state = pd.Series(np.nan, index=wclose.index)
    known = slow.notna() & fast.notna()
    state[known] = 0.0
    state[known & (wclose > fast) & (fast > slow)] = 1.0
    state[known & (wclose < fast) & (fast < slow)] = -1.0

    prior = state.shift(1)  # week w's days see week w-1's completed state
    week_end = dates.dt.to_period("W-FRI").dt.end_time.dt.normalize()
    mapped = week_end.map(prior)
    return pd.Series(
        mapped.to_numpy(dtype=float), index=df.index, name="weekly_trend_state"
    )
