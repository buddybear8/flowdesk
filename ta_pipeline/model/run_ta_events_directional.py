"""Direction-aligned TA event-row training experiment.

Companion to ``run_ta_events.py``. The first experiment kept the labels
independent of the pattern's own direction and didn't help -- a +1 breakout
and a -1 breakdown were pooled and asked the same generic question. This
script uses the **pattern's own sign** to pick the label side, asking
"given this directional pattern just fired, did the move follow through" as
a single unified binary target.

Per event row, a ``direction`` is derived from the event-set's signed
features. Rows with ``direction == 0`` (conflicting signals) are dropped.
``label_aligned`` = ``label_long`` when direction > 0, else ``label_short``.
One unified model is trained on this label (no long/short split).

Writes ``data/models/evaluation_ta_directional.csv``.

CLI:  python -m ta_pipeline.model.run_ta_events_directional
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import PipelineConfig
from .config import ModelConfig
from .dataset import feature_columns, materialize_matrix
from .train import oof_predictions

logger = logging.getLogger(__name__)

_EVENT_SETS = ("breakout_only", "reclaim_only", "strict", "broad")


def _event_mask(matrix: pd.DataFrame, name: str) -> pd.Series:
    if name == "breakout_only":
        return matrix["range_breakout"] != 0
    if name == "reclaim_only":
        return matrix["swing_reclaim"] != 0
    if name == "strict":
        return (matrix["range_breakout"] != 0) | (matrix["swing_reclaim"] != 0)
    if name == "broad":
        return (
            (matrix["range_breakout"] != 0)
            | (matrix["swing_reclaim"] != 0)
            | (matrix["touch_50"] != 0)
            | (matrix["touch_200"] != 0)
        )
    raise ValueError(f"unknown event set: {name}")


def _direction(matrix: pd.DataFrame, name: str) -> pd.Series:
    """Signed direction (+1 long-side, -1 short-side, 0 = drop) per event set."""
    if name == "breakout_only":
        return np.sign(matrix["range_breakout"])
    if name == "reclaim_only":
        return np.sign(matrix["swing_reclaim"])
    if name == "strict":
        return np.sign(
            np.sign(matrix["range_breakout"]) + np.sign(matrix["swing_reclaim"])
        )
    if name == "broad":
        return np.sign(
            np.sign(matrix["range_breakout"])
            + np.sign(matrix["swing_reclaim"])
            + np.sign(matrix["touch_50"])
            + np.sign(matrix["touch_200"])
        )
    raise ValueError(f"unknown event set: {name}")


def _metrics(predictions: pd.DataFrame) -> pd.DataFrame:
    """CV / OOS metrics for a directional model (one binary target)."""
    from sklearn.metrics import average_precision_score, roc_auc_score

    rows = []
    for seg, mask in {
        "cv": ~predictions["is_oos"].to_numpy(),
        "oos": predictions["is_oos"].to_numpy(),
    }.items():
        sub = predictions[mask]
        if len(sub) == 0:
            continue
        y, p = sub["label_aligned"], sub["p_aligned"]
        base = float(y.mean())
        if y.nunique() < 2:
            roc = ap = top_prec = float("nan")
        else:
            roc = float(roc_auc_score(y, p))
            ap = float(average_precision_score(y, p))
            top = p >= p.quantile(0.9)
            top_prec = float(y[top].mean())
        rows.append({
            "segment": seg,
            "n": int(len(sub)),
            "base_rate": round(base, 4),
            "roc_auc": round(roc, 4) if not np.isnan(roc) else roc,
            "pr_auc": round(ap, 4) if not np.isnan(ap) else ap,
            "pr_auc_lift": round(ap / base, 3) if base > 0 and not np.isnan(ap) else float("nan"),
            "top_decile_precision": round(top_prec, 4) if not np.isnan(top_prec) else top_prec,
        })
    return pd.DataFrame(rows)


def run_directional_experiment(
    model_cfg: ModelConfig = None,
    pipeline_cfg: PipelineConfig = None,
):
    """Run the direction-aligned TA experiment across all event sets."""
    model_cfg = model_cfg or ModelConfig()
    pipeline_cfg = pipeline_cfg or PipelineConfig()
    matrix = materialize_matrix(model_cfg, pipeline_cfg)
    features = feature_columns(matrix)
    logger.info("matrix: %d rows; features: %d", len(matrix), len(features))

    sizes, reports = [], []
    for name in _EVENT_SETS:
        sub = matrix.loc[_event_mask(matrix, name)].copy()
        sub["_dir"] = _direction(sub, name).astype(int)
        dropped = int((sub["_dir"] == 0).sum())
        sub = sub[sub["_dir"] != 0].copy()
        sub["label_aligned"] = np.where(
            sub["_dir"] > 0, sub["label_long"], sub["label_short"]
        ).astype(int)
        long_frac = float((sub["_dir"] > 0).mean())
        sub = sub.drop(columns=["_dir"]).reset_index(drop=True)

        sizes.append({
            "event_set": name,
            "rows": len(sub),
            "dropped_tied_dir": dropped,
            "dates": int(sub["date"].nunique()),
            "long_dir_pct": round(100 * long_frac, 1),
            "base_aligned": round(float(sub["label_aligned"].mean()), 4),
        })
        logger.info(
            "--- %s: %d rows, %d dates, long-dir %.1f%%, base %.3f ---",
            name, len(sub), sub["date"].nunique(),
            100 * long_frac, sub["label_aligned"].mean(),
        )

        predictions = oof_predictions(
            sub, model_cfg,
            features=features,
            label_cols=["label_aligned"],
            model_prefix=f"ta_dir_{name}",
            save_models=False,
        )
        report = _metrics(predictions)
        report.insert(0, "event_set", name)
        reports.append(report)

    sizes_df = pd.DataFrame(sizes)
    evaluation = pd.concat(reports, ignore_index=True)

    out = Path(model_cfg.model_dir)
    out.mkdir(parents=True, exist_ok=True)
    evaluation.to_csv(out / "evaluation_ta_directional.csv", index=False)
    logger.info("wrote ta-directional evaluation to %s", out)
    return sizes_df, evaluation


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Direction-aligned TA event-row training experiment."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    sizes, evaluation = run_directional_experiment()
    print("\n=== event-set sizes (directional) ===")
    print(sizes.to_string(index=False))
    print("\n=== metrics (one unified directional model per event set) ===")
    print(evaluation.to_string(index=False))


if __name__ == "__main__":
    main()
