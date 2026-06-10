"""Model layer — the TA-only baseline classifier.

The full module: feature-matrix materialization, the walk-forward CV splitter,
LightGBM training with isotonic calibration, evaluation, and the predictions
table. ``run_ta_baseline`` (and ``python -m ta_pipeline.model.run``) ties it
together.
"""

from .config import ModelConfig
from .dataset import (
    LABEL_COLUMNS,
    feature_columns,
    feature_groups,
    load_matrix,
    materialize_matrix,
)
from .evaluate import evaluate
from .predictions import build_predictions_table, top_entries
from .run import run_ta_baseline
from .run_ablation import run_darkpool_ablation, run_flow_ablation
from .train import CalibratedModel, oof_predictions
from .walkforward import Fold, fold_masks, make_folds

__all__ = [
    "ModelConfig",
    "LABEL_COLUMNS",
    "feature_columns",
    "feature_groups",
    "materialize_matrix",
    "load_matrix",
    "Fold",
    "make_folds",
    "fold_masks",
    "CalibratedModel",
    "oof_predictions",
    "evaluate",
    "build_predictions_table",
    "top_entries",
    "run_ta_baseline",
    "run_darkpool_ablation",
    "run_flow_ablation",
]
