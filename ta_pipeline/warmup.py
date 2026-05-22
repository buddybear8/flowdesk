"""Warmup masking — drop the leading region where features are half-formed and
the trailing region that has no full label horizon.

Features are not valid until the longest lookback is satisfied (~252-bar
percentiles on top of a 200-day SMA -> ``cfg.warmup_bars``). Labels are not
valid for the final bars that lack a full forward horizon. Both regions must
be cut before the matrix is fed to a model.

Operates on a single ticker.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import PipelineConfig

_FLAG_COLUMNS = ["is_warmup", "is_labelable", "is_valid"]


def add_validity_flags(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add ``is_warmup`` / ``is_labelable`` / ``is_valid`` flags to one ticker.

    ``is_warmup``    -- among the first ``cfg.warmup_bars`` bars of the ticker.
    ``is_labelable`` -- both ``label_long`` and ``label_short`` are non-NaN (a
                        full forward window existed, or a barrier was touched).
                        True everywhere if no label columns are present yet.
    ``is_valid``     -- not warmup AND labelable -> safe to feed a model.
    """
    out = df.copy()
    position = np.arange(len(out))
    out["is_warmup"] = position < cfg.warmup_bars
    label_cols = [c for c in ("label_long", "label_short") if c in out.columns]
    if label_cols:
        out["is_labelable"] = out[label_cols].notna().all(axis=1)
    else:
        out["is_labelable"] = True
    out["is_valid"] = (~out["is_warmup"]) & out["is_labelable"]
    return out


def trim_to_valid(df: pd.DataFrame) -> pd.DataFrame:
    """Drop warmup + unlabelable rows and the now-constant flag columns.

    Returns the model-ready matrix. :func:`add_validity_flags` must have run.
    """
    if "is_valid" not in df.columns:
        raise KeyError("trim_to_valid: run add_validity_flags() first")
    keep = df[df["is_valid"]].drop(columns=_FLAG_COLUMNS)
    return keep.reset_index(drop=True)
