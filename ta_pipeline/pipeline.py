"""Master builder — composes the whole pipeline into a feature + label matrix.

``build_features`` runs the indicator, swing and all §4 feature blocks; the
blocks are ordered so every cross-block dependency is satisfied (trend before
zones and reclaim; Bollinger before breakout). ``build_dataset`` adds the
triple-barrier labels and validity flags, and (by default) trims warmup and
unlabelable rows to the model-ready matrix.

Every stage runs per ticker so no ticker's rolling window, swing sequence or
label horizon can ever cross into another's.
"""

from __future__ import annotations

import pandas as pd

from .config import PipelineConfig
from .features import (
    add_bollinger_features,
    add_breakout_features,
    add_momentum_features,
    add_reclaim_features,
    add_trend_features,
    add_volatility_features,
    add_zone_features,
)
from .indicators import compute_indicators
from .labeler import add_labels
from .swings import add_swings
from .warmup import add_validity_flags, trim_to_valid


def _feature_blocks(g: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Indicator + swing + all §4 feature blocks for one ticker, in dependency
    order."""
    g = compute_indicators(g, cfg)
    g = add_swings(g, cfg)
    g = add_momentum_features(g, cfg)
    g = add_bollinger_features(g, cfg)
    g = add_volatility_features(g, cfg)
    g = add_trend_features(g, cfg)      # before zones + reclaim
    g = add_zone_features(g, cfg)
    g = add_reclaim_features(g, cfg)
    g = add_breakout_features(g, cfg)   # after Bollinger
    return g


def build_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Indicator + swing + all §4 feature blocks, per ticker. No labels.

    ``df`` is long-format OHLCV (``OHLCV_COLUMNS``) for one or many tickers.
    """
    if df.empty:
        return df.copy()
    parts = [_feature_blocks(g, cfg) for _, g in df.groupby("ticker", sort=False)]
    return pd.concat(parts, ignore_index=True)


def build_dataset(
    df: pd.DataFrame, cfg: PipelineConfig, *, trim: bool = True
) -> pd.DataFrame:
    """Full pipeline: features + triple-barrier labels + validity flags.

    Parameters
    ----------
    trim : bool, default True
        If True, drop warmup + unlabelable rows (and the flag columns) to
        return the model-ready matrix. If False, keep every bar with the
        ``is_warmup`` / ``is_labelable`` / ``is_valid`` flags intact (useful
        for inspection and the leakage tests).
    """
    if df.empty:
        return df.copy()

    def _one(g: pd.DataFrame) -> pd.DataFrame:
        g = _feature_blocks(g, cfg)
        g = add_labels(g, cfg)
        g = add_validity_flags(g, cfg)
        return g

    parts = [_one(g) for _, g in df.groupby("ticker", sort=False)]
    full = pd.concat(parts, ignore_index=True)
    return trim_to_valid(full) if trim else full
