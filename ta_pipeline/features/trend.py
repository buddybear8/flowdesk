"""§4.4 Moving-average trend-structure features.

Operates on a single ticker (the master builder groups by ticker).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import PipelineConfig
from .common import bars_since, normalized_slope, require_columns


def _trend_stack_state(
    sma_lo: pd.Series, sma_mid: pd.Series, sma_hi: pd.Series
) -> pd.Series:
    """Ordinal -2..+2 trend stack over the (low, mid, high)-period SMAs.

    +2  perfect bull stack -- all 3 pairwise bullish conditions hold
    +1  net-bullish        -- exactly 2 of 3 hold
     0  tangled / interleaved / equal
    -1  net-bearish        -- exactly 2 of 3 pairwise bearish conditions hold
    -2  perfect bear stack -- all 3 hold

    (50>100 and 100>200 together force 50>200, so a count of exactly 2 is a
    genuine partial stack.) NaN until all three SMAs are formed. Ordered /
    ordinal -- never one-hot.
    """
    bull = (
        (sma_lo > sma_mid).astype(int)
        + (sma_mid > sma_hi).astype(int)
        + (sma_lo > sma_hi).astype(int)
    )
    bear = (
        (sma_lo < sma_mid).astype(int)
        + (sma_mid < sma_hi).astype(int)
        + (sma_lo < sma_hi).astype(int)
    )
    state = pd.Series(
        np.select(
            [bull == 3, bull == 2, bear == 3, bear == 2],
            [2.0, 1.0, -2.0, -1.0],
            default=0.0,
        ),
        index=sma_lo.index,
    )
    formed = sma_lo.notna() & sma_mid.notna() & sma_hi.notna()
    return state.where(formed)


def _bars_since_stack_change(state: pd.Series) -> pd.Series:
    """Bars since ``trend_stack_state`` last changed value (trend freshness).

    Counts from the first formed bar; NaN while ``state`` itself is NaN.
    """
    changed = state.ne(state.shift(1)) & state.notna()
    return bars_since(changed).where(state.notna())


def add_trend_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add §4.4 trend-structure features to one ticker's frame.

    Assumes ``sma_<p>`` for every ``cfg.sma_periods`` and ``atr_<period>`` from
    the indicator layer. The ordinal ``trend_stack_state`` uses only
    ``cfg.sma_stack_periods`` (50/100/200) -- 20 is too fast and makes it jumpy.
    Distance and slope features use all four SMAs.
    """
    atr_col = f"atr_{cfg.atr_period}"
    sma_cols = [f"sma_{p}" for p in cfg.sma_periods]
    require_columns(df, sma_cols + [atr_col, "close"], "add_trend_features")
    out = df.copy()
    close, atr = out["close"], out[atr_col]

    lo, mid, hi = sorted(cfg.sma_stack_periods)
    state = _trend_stack_state(out[f"sma_{lo}"], out[f"sma_{mid}"], out[f"sma_{hi}"])
    out["trend_stack_state"] = state
    out["bars_since_stack_change"] = _bars_since_stack_change(state)
    # Degree of separation the ordinal alone misses (50 vs 200).
    out["ma_spread"] = (out[f"sma_{lo}"] - out[f"sma_{hi}"]) / close

    for p in cfg.sma_periods:
        sma_p = out[f"sma_{p}"]
        out[f"dist_to_sma{p}_atr"] = (close - sma_p) / atr
        out[f"slope_sma{p}"] = normalized_slope(sma_p, cfg.ma_slope_lookback, close)

    return out
