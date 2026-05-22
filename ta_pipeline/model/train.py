"""Model training — LightGBM + isotonic calibration, walk-forward.

For each walk-forward fold and each side (long / short) a LightGBM binary
classifier is trained on the fold's train block, its probabilities are
calibrated with isotonic regression on a temporally-held-out tail of that
block, and the calibrated model predicts the fold's test block. The result is
an out-of-fold prediction for every CV test row and every OOS row — each from
a model that never saw it.

The two models from the OOS fold (trained on all development data) are the
shippable artifacts, saved to ``cfg.model_dir``.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .config import ModelConfig
from .dataset import LABEL_COLUMNS, feature_columns
from .walkforward import fold_masks, make_folds

logger = logging.getLogger(__name__)


def _lgbm_params(cfg: ModelConfig) -> dict:
    """Baseline LightGBM hyperparameters — sane defaults, deliberately not
    tuned (the m/N/K/c feature sweep is the tuning pass)."""
    return dict(
        objective="binary",
        n_estimators=400,
        learning_rate=0.03,
        num_leaves=31,
        min_child_samples=200,
        subsample=0.8,
        subsample_freq=1,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        random_state=cfg.random_state,
        n_jobs=-1,
        verbose=-1,
    )


class CalibratedModel:
    """A LightGBM booster paired with an isotonic probability calibrator.

    ``predict_proba`` accepts any frame carrying the feature columns and
    returns a 1-D array of calibrated ``P(label = 1)``.
    """

    def __init__(self, booster, calibrator, features):
        self.booster = booster
        self.calibrator = calibrator
        self.features = list(features)

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        raw = self.booster.predict_proba(
            frame[self.features].astype("float32")
        )[:, 1]
        return self.calibrator.predict(raw)


def _split_fit_calibration(matrix: pd.DataFrame, train_mask: pd.Series, cfg: ModelConfig):
    """Split a fold's train rows into a fit block and a temporally-later
    calibration tail, with the embargo purged between them."""
    train_dates = np.sort(matrix.loc[train_mask, "date"].unique())
    n = len(train_dates)
    n_calib = max(1, int(round(n * cfg.calibration_tail_frac)))
    calib_start_idx = n - n_calib
    fit_end_idx = calib_start_idx - 1 - cfg.embargo_bars
    if fit_end_idx < 0:                      # tiny fold -> drop the inner embargo
        fit_end_idx = calib_start_idx - 1
    d = matrix["date"]
    fit_mask = train_mask & (d <= train_dates[fit_end_idx])
    calib_mask = train_mask & (d >= train_dates[calib_start_idx])
    return fit_mask, calib_mask


def _train_side(X, y, fit_mask, calib_mask, features, cfg) -> CalibratedModel:
    """Fit one side's LightGBM on the fit block, calibrate on the held-out tail."""
    from lightgbm import LGBMClassifier
    from sklearn.isotonic import IsotonicRegression

    booster = LGBMClassifier(**_lgbm_params(cfg))
    booster.fit(X.loc[fit_mask], y.loc[fit_mask].astype(int))

    raw_calib = booster.predict_proba(X.loc[calib_mask])[:, 1]
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(raw_calib, y.loc[calib_mask].astype(int))
    return CalibratedModel(booster, calibrator, features)


def _save_models(models: dict, cfg: ModelConfig) -> None:
    import joblib

    model_dir = Path(cfg.model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    for side, model in models.items():
        path = model_dir / (side.replace("label_", "ta_only_") + ".joblib")
        joblib.dump(model, path)
        logger.info("saved %s model -> %s", side, path)


def oof_predictions(
    matrix: pd.DataFrame, cfg: ModelConfig = None, *, save_models: bool = True
) -> pd.DataFrame:
    """Train walk-forward and return out-of-fold predictions for both sides.

    Expects the trimmed matrix from :func:`materialize_matrix` (both labels
    present on every row). Returns a frame with ``ticker``, ``date``, ``fold``,
    ``is_oos``, the actual ``label_long`` / ``label_short`` and the calibrated
    ``p_long`` / ``p_short``. The OOS-fold models are saved to
    ``cfg.model_dir`` unless ``save_models=False``.
    """
    cfg = cfg or ModelConfig()
    features = feature_columns(matrix)
    X = matrix[features].astype("float32")

    blocks = []
    oos_models = {}
    for fold in make_folds(matrix, cfg):
        train_mask, test_mask = fold_masks(matrix, fold)
        fit_mask, calib_mask = _split_fit_calibration(matrix, train_mask, cfg)

        block = matrix.loc[
            test_mask, ["ticker", "date", "label_long", "label_short"]
        ].copy()
        block.insert(2, "fold", fold.name)
        block.insert(3, "is_oos", fold.is_oos)

        for side in LABEL_COLUMNS:
            model = _train_side(X, matrix[side], fit_mask, calib_mask, features, cfg)
            block[side.replace("label_", "p_")] = model.predict_proba(
                matrix.loc[test_mask]
            )
            if fold.is_oos:
                oos_models[side] = model
        logger.info(
            "fold %s: trained long + short, %d predictions", fold.name, len(block)
        )
        blocks.append(block)

    predictions = pd.concat(blocks, ignore_index=True)
    if save_models and oos_models:
        _save_models(oos_models, cfg)
    return predictions
