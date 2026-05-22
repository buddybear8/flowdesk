"""Model evaluation — precision-recall metrics for the imbalanced classes.

Metrics are reported per side (long / short) and per segment: ``cv`` (the
pooled out-of-fold CV predictions) and ``oos`` (the reserved out-of-sample
slice — the headline benchmark, looked at once).
"""

from __future__ import annotations

import pandas as pd


def _side_metrics(y: pd.Series, p: pd.Series) -> dict:
    """PR-AUC / ROC-AUC / Brier + a top-decile operating point for one side."""
    from sklearn.metrics import (
        average_precision_score,
        brier_score_loss,
        roc_auc_score,
    )

    base = float(y.mean())
    out = {"n": int(len(y)), "base_rate": round(base, 4)}
    if y.nunique() < 2:
        for key in ("pr_auc", "pr_auc_lift", "roc_auc", "brier",
                    "top_decile_precision", "top_decile_recall"):
            out[key] = float("nan")
        return out

    ap = float(average_precision_score(y, p))
    out["pr_auc"] = round(ap, 4)
    out["pr_auc_lift"] = round(ap / base, 3) if base > 0 else float("nan")
    out["roc_auc"] = round(float(roc_auc_score(y, p)), 4)
    out["brier"] = round(float(brier_score_loss(y, p)), 4)

    # Practical operating point: trade the top-decile-scored rows.
    top = p >= p.quantile(0.9)
    out["top_decile_precision"] = round(float(y[top].mean()), 4)
    out["top_decile_recall"] = (
        round(float(y[top].sum() / y.sum()), 4) if y.sum() > 0 else float("nan")
    )
    return out


def evaluate(predictions: pd.DataFrame) -> pd.DataFrame:
    """Tidy evaluation report from an out-of-fold predictions frame.

    Expects the columns produced by :func:`oof_predictions`. Returns one row
    per (side, segment) — ``segment`` is ``cv`` (pooled CV folds) or ``oos``.
    """
    segments = {
        "cv": ~predictions["is_oos"].to_numpy(),
        "oos": predictions["is_oos"].to_numpy(),
    }
    rows = []
    for side in ("long", "short"):
        for segment, mask in segments.items():
            sub = predictions.loc[mask]
            if len(sub) == 0:
                continue
            metrics = _side_metrics(sub[f"label_{side}"], sub[f"p_{side}"])
            rows.append({"side": side, "segment": segment, **metrics})
    return pd.DataFrame(rows)
