"""§4.3 ATR / volatility-magnitude features.

Operates on a single ticker (the master builder groups by ticker).
"""

from __future__ import annotations

import pandas as pd

from ..config import PipelineConfig
from .common import normalized_slope, require_columns, trailing_pctile_rank


def add_volatility_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add §4.3 volatility features to one ticker's frame.

    ``atr_<period>`` and ``true_range`` from the indicator layer are themselves
    raw §4.3 features (passed through unchanged). This block adds the
    cross-ticker comparable derivatives:

    * ``atr_normalized``   — ATR / close (volatility as a fraction of price).
    * ``atr_pctile``       — 252-bar trailing percentile of ATR.
    * ``true_range_in_atr``— current true range ÷ ATR (1.0 = a normal day).
    * ``atr_slope``        — fractional change in ATR over the slope lookback
                             (expanding vs contracting volatility).
    """
    atr_col = f"atr_{cfg.atr_period}"
    require_columns(df, [atr_col, "true_range", "close"], "add_volatility_features")
    out = df.copy()
    atr = out[atr_col]
    out["atr_normalized"] = atr / out["close"]
    out["atr_pctile"] = trailing_pctile_rank(atr, cfg.pctile_window_long)
    out["true_range_in_atr"] = out["true_range"] / atr
    out["atr_slope"] = normalized_slope(
        atr, cfg.atr_slope_lookback, atr.shift(cfg.atr_slope_lookback)
    )
    return out
