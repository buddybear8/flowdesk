"""ta_pipeline — leakage-controlled technical-analysis feature + label layer.

Produces a per-ticker, per-bar feature matrix plus ATR-scaled triple-barrier
labels for the options-flow trade-idea model.

The pipeline runs end to end: candle ingestion -> §3 indicators -> swing
detection -> all §4 feature blocks -> §5 triple-barrier labels -> warmup
masking. ``build_dataset`` ties the feature/label stages together; the
``ingestion`` subpackage backfills and serves the daily candles.
"""

from .config import SWEEP_PARAM_RANGES, SWEEP_PARAMS, PipelineConfig
from .features import (
    add_bollinger_features,
    add_breakout_features,
    add_momentum_features,
    add_reclaim_features,
    add_trend_features,
    add_volatility_features,
    add_zone_features,
    bars_since,
    normalized_slope,
    trailing_pctile_rank,
)
from .indicators import (
    atr,
    bollinger,
    compute_indicators,
    compute_indicators_universe,
    rsi,
    sma,
    true_range,
)
from .ingestion import (
    CANDLE_COLUMNS,
    IngestionConfig,
    load_candles,
    load_candles_universe,
)
from .labeler import add_labels
from .pipeline import build_dataset, build_features
from .swings import (
    add_swings,
    add_swings_universe,
    bars_since_confirmed,
    detect_pivots,
    last_confirmed_level,
)
from .warmup import add_validity_flags, trim_to_valid

__version__ = "1.1.0"

__all__ = [
    # config
    "PipelineConfig",
    "SWEEP_PARAMS",
    "SWEEP_PARAM_RANGES",
    # candle ingestion
    "IngestionConfig",
    "CANDLE_COLUMNS",
    "load_candles",
    "load_candles_universe",
    # indicators
    "rsi",
    "sma",
    "bollinger",
    "true_range",
    "atr",
    "compute_indicators",
    "compute_indicators_universe",
    # swings
    "detect_pivots",
    "add_swings",
    "add_swings_universe",
    "last_confirmed_level",
    "bars_since_confirmed",
    # feature primitives
    "trailing_pctile_rank",
    "normalized_slope",
    "bars_since",
    # feature blocks (§4.1-4.7)
    "add_momentum_features",
    "add_bollinger_features",
    "add_volatility_features",
    "add_trend_features",
    "add_zone_features",
    "add_reclaim_features",
    "add_breakout_features",
    # labels + warmup
    "add_labels",
    "add_validity_flags",
    "trim_to_valid",
    # master builder
    "build_features",
    "build_dataset",
]
