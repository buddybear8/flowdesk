"""Flow / dark-pool feature-join layer.

Extracts the Unusual Whales options-flow alerts and the Polygon dark-pool
prints from the Railway Postgres, engineers per-(ticker, date) features under
the close-aligned Rule A join, and joins them onto the leakage-controlled TA
feature matrix.

The extract step is the only DB-touching code; everything downstream reads a
local parquet cache offline, mirroring the candle store.
"""

from .config import FlowConfig
from .darkpool_features import (
    add_darkpool_derived,
    aggregate_darkpool,
)
from .extract import (
    extract_dark_pool,
    extract_flow_alerts,
    load_dark_pool,
    load_flow_alerts,
    run_extract,
)
from .flow_features import aggregate_flow
from .guard import FlowCorpusTooSmall, check_flow_modelable, flow_corpus_stats
from .join import build_joined_matrix, join_flow_features
from .sessionize import add_feature_date

__all__ = [
    "FlowConfig",
    "run_extract",
    "extract_flow_alerts",
    "extract_dark_pool",
    "load_flow_alerts",
    "load_dark_pool",
    "add_feature_date",
    "aggregate_darkpool",
    "add_darkpool_derived",
    "aggregate_flow",
    "join_flow_features",
    "build_joined_matrix",
    "check_flow_modelable",
    "flow_corpus_stats",
    "FlowCorpusTooSmall",
]
