"""Feature blocks (§4) — one module per block.

Each ``add_*_features`` function takes one ticker's frame (indicator + swing
layers already applied) and returns it with that block's columns added. Blocks
that depend on another block's output state the dependency in their docstring
(e.g. zones runs after trend; reclaim after trend; breakout after Bollinger).
The master builder that composes every block, groups by ticker and masks
warmup lands in Phase 6.
"""

from .bollinger import add_bollinger_features
from .breakout import add_breakout_features
from .common import (
    bars_since,
    normalized_slope,
    require_columns,
    trailing_pctile_rank,
)
from .momentum import add_momentum_features
from .reclaim import add_reclaim_features
from .trend import add_trend_features
from .volatility import add_volatility_features
from .zones import add_zone_features

__all__ = [
    # shared primitives
    "trailing_pctile_rank",
    "normalized_slope",
    "bars_since",
    "require_columns",
    # feature blocks
    "add_momentum_features",
    "add_bollinger_features",
    "add_volatility_features",
    "add_trend_features",
    "add_zone_features",
    "add_reclaim_features",
    "add_breakout_features",
]
