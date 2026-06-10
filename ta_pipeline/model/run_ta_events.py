"""Event-row training experiment -- TA only on rows where a pattern fires.

The full-matrix model is ~ chance because "predict every ticker on every day"
is the wrong question. This script restricts training to rows where a TA
pattern actually fired -- swing reclaim, range breakout, MA-zone touch -- and
re-runs walk-forward TA-only on each subset. The hypothesis is that the
conditional "given this pattern just fired, what happens next" is genuinely
predictable even where the unconditional question is not.

Five event sets are compared against each other on identical CV / OOS folds
(``make_folds`` is deterministic given the matrix):

  all              full matrix (the existing TA-only baseline -- sanity check)
  breakout_only    rows with ``range_breakout != 0``
  reclaim_only     rows with ``swing_reclaim != 0``
  strict           breakout OR reclaim
  broad            strict OR ``touch_50 != 0`` OR ``touch_200 != 0``

Writes a comparison report to ``data/models/evaluation_ta_events.csv``.

CLI:  python -m ta_pipeline.model.run_ta_events
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from ..config import PipelineConfig
from .config import ModelConfig
from .dataset import feature_columns, materialize_matrix
from .evaluate import evaluate
from .train import oof_predictions

logger = logging.getLogger(__name__)

_EVENT_SETS = ("all", "breakout_only", "reclaim_only", "strict", "broad")


def _event_mask(matrix: pd.DataFrame, name: str) -> pd.Series:
    """Boolean mask selecting the rows that belong to event set ``name``."""
    if name == "all":
        return pd.Series(True, index=matrix.index)
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


def run_ta_events_experiment(
    model_cfg: ModelConfig = None,
    pipeline_cfg: PipelineConfig = None,
):
    """Run TA-only walk-forward on each event-row subset; return sizes + report.

    Returns ``(sizes, evaluation)`` where ``sizes`` lists rows / dates / base
    rates per event set and ``evaluation`` is the concatenated per-side /
    per-segment metrics with an ``event_set`` column.
    """
    model_cfg = model_cfg or ModelConfig()
    pipeline_cfg = pipeline_cfg or PipelineConfig()
    matrix = materialize_matrix(model_cfg, pipeline_cfg)
    features = feature_columns(matrix)
    logger.info("matrix: %d rows; features: %d", len(matrix), len(features))

    sizes = []
    reports = []
    for name in _EVENT_SETS:
        sub = matrix.loc[_event_mask(matrix, name)].reset_index(drop=True)
        sizes.append({
            "event_set": name,
            "rows": len(sub),
            "dates": int(sub["date"].nunique()),
            "tickers": int(sub["ticker"].nunique()),
            "base_long": round(float(sub["label_long"].mean()), 4),
            "base_short": round(float(sub["label_short"].mean()), 4),
        })
        logger.info(
            "--- %s: %d rows / %d dates / %d tickers ---",
            name, len(sub), sub["date"].nunique(), sub["ticker"].nunique(),
        )
        predictions = oof_predictions(
            sub, model_cfg,
            features=features,
            model_prefix=f"ta_events_{name}",
            save_models=False,
        )
        report = evaluate(predictions)
        report.insert(0, "event_set", name)
        reports.append(report)

    sizes_df = pd.DataFrame(sizes)
    evaluation = pd.concat(reports, ignore_index=True)

    out = Path(model_cfg.model_dir)
    out.mkdir(parents=True, exist_ok=True)
    evaluation.to_csv(out / "evaluation_ta_events.csv", index=False)
    logger.info("wrote ta-events evaluation to %s", out)
    return sizes_df, evaluation


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="TA event-row training experiment."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    sizes, evaluation = run_ta_events_experiment()
    print("\n=== event-set sizes ===")
    print(sizes.to_string(index=False))
    print("\n=== OOS metrics ===")
    oos = evaluation[evaluation["segment"] == "oos"].copy()
    cols = ["event_set", "side", "n", "base_rate", "roc_auc",
            "pr_auc", "pr_auc_lift", "top_decile_precision"]
    print(oos[cols].to_string(index=False))


if __name__ == "__main__":
    main()
