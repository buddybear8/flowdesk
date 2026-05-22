"""Model evaluation — PR-AUC / precision-recall metrics."""

import numpy as np
import pandas as pd

from ta_pipeline.model.evaluate import evaluate


def _preds(n=4000, seed=0):
    """Synthetic OOF predictions: p_long carries real signal, p_short is noise."""
    rng = np.random.default_rng(seed)
    is_oos = np.arange(n) >= n // 2
    score = rng.random(n)
    return pd.DataFrame({
        "fold": np.where(is_oos, "oos", "cv1"),
        "is_oos": is_oos,
        "label_long": (rng.random(n) < score).astype(float),   # P(win) = score
        "p_long": score,
        "label_short": (rng.random(n) < 0.4).astype(float),     # base ~0.4
        "p_short": rng.random(n),                               # independent noise
    })


def test_evaluate_report_shape():
    report = evaluate(_preds())
    assert set(report["side"]) == {"long", "short"}
    assert set(report["segment"]) == {"cv", "oos"}
    assert len(report) == 4
    for col in ("n", "base_rate", "pr_auc", "roc_auc", "brier",
                "top_decile_precision", "top_decile_recall"):
        assert col in report.columns


def test_skilled_side_beats_base_rate_noise_side_does_not():
    report = evaluate(_preds()).set_index(["side", "segment"])
    # p_long is informative -> PR-AUC above the base rate (lift > 1).
    assert report.loc[("long", "oos"), "pr_auc"] > report.loc[("long", "oos"), "base_rate"]
    assert report.loc[("long", "oos"), "pr_auc_lift"] > 1.0
    # p_short is pure noise -> ROC-AUC ~ 0.5.
    assert abs(report.loc[("short", "oos"), "roc_auc"] - 0.5) < 0.06
