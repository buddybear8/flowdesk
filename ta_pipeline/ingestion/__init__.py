"""Candlestick ingestion layer.

Polygon.io daily-bar backfill, incremental update, a managed per-ticker parquet
store with a CSV manifest, and the ``load_candles`` read interface for the
feature pipeline.
"""

from .backfill import run_backfill
from .config import IngestionConfig
from .fetch import CANDLE_COLUMNS, aggs_to_frame, fetch_daily_bars
from .loader import load_candles, load_candles_universe
from .quality import quality_flags
from .repair import (
    deprecate_ticker,
    split_at_largest_gap,
    stitch_predecessor,
    trim_reused_ticker,
)
from .store import (
    append_candles,
    candle_path,
    manifest_row,
    read_candles,
    read_manifest,
    upsert_manifest_row,
    write_candles,
    write_manifest,
)
from .update import run_update

__all__ = [
    "IngestionConfig",
    "CANDLE_COLUMNS",
    "fetch_daily_bars",
    "aggs_to_frame",
    "quality_flags",
    "load_candles",
    "load_candles_universe",
    "read_candles",
    "write_candles",
    "append_candles",
    "candle_path",
    "read_manifest",
    "write_manifest",
    "manifest_row",
    "upsert_manifest_row",
    "run_backfill",
    "run_update",
    "split_at_largest_gap",
    "trim_reused_ticker",
    "stitch_predecessor",
    "deprecate_ticker",
]
