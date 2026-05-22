"""Model training — LightGBM + isotonic calibration, walk-forward OOF."""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ta_pipeline.model import ModelConfig
from ta_pipeline.model.train import oof_predictions
from ta_pipeline.model.walkforward import make_folds


def _synthetic_matrix(n_tickers=4, n_dates=900, n_features=6, seed=0):
    """A build_dataset-shaped frame: ticker / date + numeric features + both
    labels. Labels depend weakly on feat_0 so the model has real signal."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2018-01-02", periods=n_dates)
    parts = []
    for t in range(n_tickers):
        df = pd.DataFrame({"ticker": f"T{t}", "date": dates})
        for f in range(n_features):
            df[f"feat_{f}"] = rng.normal(size=n_dates)
        p = 1.0 / (1.0 + np.exp(-df["feat_0"]))
        df["label_long"] = (rng.random(n_dates) < p).astype(float)
        df["label_short"] = (rng.random(n_dates) < (1.0 - p)).astype(float)
        parts.append(df)
    return pd.concat(parts, ignore_index=True)


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    """Run the walk-forward training once; the tests inspect the result."""
    matrix = _synthetic_matrix()
    cfg = ModelConfig(n_folds=3, model_dir=tmp_path_factory.mktemp("models"))
    preds = oof_predictions(matrix, cfg)
    return matrix, cfg, preds


def test_oof_predictions_structure(trained):
    _, _, preds = trained
    assert list(preds.columns) == [
        "ticker", "date", "fold", "is_oos",
        "label_long", "label_short", "p_long", "p_short",
    ]
    for col in ("p_long", "p_short"):
        assert preds[col].notna().all()
        assert preds[col].between(0.0, 1.0).all()


def test_predictions_cover_cv_folds_and_oos(trained):
    _, _, preds = trained
    assert set(preds["fold"]) == {"cv1", "cv2", "cv3", "oos"}
    assert preds.loc[preds["fold"] == "oos", "is_oos"].all()
    assert not preds.loc[preds["fold"] != "oos", "is_oos"].any()


def test_prediction_dates_lie_in_their_fold_test_window(trained):
    matrix, cfg, preds = trained
    for fold in make_folds(matrix, cfg):
        block = preds[preds["fold"] == fold.name]
        assert block["date"].min() >= fold.test_start
        assert block["date"].max() <= fold.test_end


def test_oos_models_are_saved(trained):
    _, cfg, _ = trained
    assert (Path(cfg.model_dir) / "ta_only_long.joblib").exists()
    assert (Path(cfg.model_dir) / "ta_only_short.joblib").exists()
