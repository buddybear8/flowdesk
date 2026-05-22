"""Feature-matrix materialization and the model's feature / label selection.

The model trains on the leakage-controlled matrix produced by ``build_dataset``.
This module materializes that matrix from the candle store (caching it to
parquet) and defines which columns are model features, which are labels, and
which are metadata.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..config import PipelineConfig
from ..ingestion import IngestionConfig, load_candles_universe
from ..pipeline import build_dataset
from .config import ModelConfig

# Columns that are never model features.
_BASE_COLUMNS = {
    "ticker", "date", "open", "high", "low", "close", "volume", "vwap",
    "transactions",
}
_NON_FEATURE_PREFIXES = ("label_", "terminal_return", "is_")

# The two binary targets emitted by the labeler.
LABEL_COLUMNS = ("label_long", "label_short")


def feature_columns(matrix: pd.DataFrame) -> list:
    """Model-facing feature columns of a built matrix.

    Excludes raw OHLCV, every label / diagnostic column, the validity flags,
    and the raw (centered, inspection-only) swing markers — only the
    confirmation-aligned ``*_conf`` swing columns and the §4 features remain.
    """
    cols = []
    for c in matrix.columns:
        if c in _BASE_COLUMNS or c.startswith(_NON_FEATURE_PREFIXES):
            continue
        if c.startswith("swing_") and not c.endswith("_conf"):
            continue
        cols.append(c)
    return cols


def materialize_matrix(
    model_cfg: ModelConfig = None,
    pipeline_cfg: PipelineConfig = None,
    *,
    force: bool = False,
) -> pd.DataFrame:
    """Build (or load from cache) the model-ready feature + label matrix.

    Loads every ticker present in the candle store (or ``model_cfg.universe_file``
    if set), runs ``build_dataset``, and caches the result to
    ``model_cfg.matrix_path``. Pass ``force=True`` to rebuild.
    """
    model_cfg = model_cfg or ModelConfig()
    matrix_path = Path(model_cfg.matrix_path)
    if matrix_path.exists() and not force:
        return pd.read_parquet(matrix_path)

    ingestion_cfg = IngestionConfig(universe_file=model_cfg.universe_file)
    if model_cfg.universe_file:
        tickers = ingestion_cfg.resolve_universe()
    else:
        tickers = sorted(p.stem for p in ingestion_cfg.candles_dir.glob("*.parquet"))

    bars = load_candles_universe(tickers=tickers, cfg=ingestion_cfg)
    matrix = build_dataset(bars, pipeline_cfg or PipelineConfig())

    matrix_path.parent.mkdir(parents=True, exist_ok=True)
    matrix.to_parquet(matrix_path, index=False)
    return matrix


def load_matrix(model_cfg: ModelConfig = None) -> pd.DataFrame:
    """Load the cached feature matrix; raises if it has not been materialized."""
    model_cfg = model_cfg or ModelConfig()
    path = Path(model_cfg.matrix_path)
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found — run materialize_matrix() first"
        )
    return pd.read_parquet(path)
