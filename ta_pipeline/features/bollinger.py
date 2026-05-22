"""§4.2 Bollinger features.

Operates on a single ticker (the master builder groups by ticker).
"""

from __future__ import annotations

import pandas as pd

from ..config import PipelineConfig
from .common import require_columns, trailing_pctile_rank


def add_bollinger_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add §4.2 Bollinger features to one ticker's frame.

    ``bb_percent_b`` is continuous and signed — it can fall below 0 or above 1,
    and deliberately subsumes any 'price outside the bands' boolean (no
    separate flag is emitted). ``bb_bandwidth`` is the volatility-regime
    measure; ``bb_bandwidth_pctile`` is its 126-bar trailing percentile — the
    'squeeze' measure. Assumes ``bb_upper`` / ``bb_middle`` / ``bb_lower`` from
    the indicator layer.
    """
    require_columns(
        df, ["bb_upper", "bb_middle", "bb_lower", "close"], "add_bollinger_features"
    )
    out = df.copy()
    width = out["bb_upper"] - out["bb_lower"]
    out["bb_percent_b"] = (out["close"] - out["bb_lower"]) / width
    out["bb_bandwidth"] = width / out["bb_middle"]
    out["bb_bandwidth_pctile"] = trailing_pctile_rank(
        out["bb_bandwidth"], cfg.bb_bandwidth_pctile_window
    )
    return out
