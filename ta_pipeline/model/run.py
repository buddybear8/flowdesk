"""Orchestrator + CLI for the TA-only baseline model.

Materializes the feature matrix, trains the walk-forward models, builds the
predictions table and the evaluation report, and writes the artifacts to
``cfg.model_dir``.

CLI:  python -m ta_pipeline.model.run
"""

from __future__ import annotations

import logging
from pathlib import Path

from ..config import PipelineConfig
from .config import ModelConfig
from .dataset import materialize_matrix
from .evaluate import evaluate
from .predictions import build_predictions_table
from .train import oof_predictions

logger = logging.getLogger(__name__)


def run_ta_baseline(
    model_cfg: ModelConfig = None,
    pipeline_cfg: PipelineConfig = None,
    *,
    force_matrix: bool = False,
):
    """Run the full TA-only baseline.

    matrix -> walk-forward training -> predictions table -> evaluation. Writes
    ``predictions.parquet`` / ``.csv``, ``evaluation.csv`` and the OOS models
    to ``model_dir``. Returns ``(predictions_table, evaluation_report)``.
    """
    model_cfg = model_cfg or ModelConfig()
    pipeline_cfg = pipeline_cfg or PipelineConfig()

    matrix = materialize_matrix(model_cfg, pipeline_cfg, force=force_matrix)
    predictions = oof_predictions(matrix, model_cfg)
    table = build_predictions_table(predictions, matrix, pipeline_cfg)
    report = evaluate(predictions)

    out = Path(model_cfg.model_dir)
    out.mkdir(parents=True, exist_ok=True)
    table.to_parquet(out / "predictions.parquet", index=False)
    table.to_csv(out / "predictions.csv", index=False)
    report.to_csv(out / "evaluation.csv", index=False)
    logger.info("wrote predictions + evaluation to %s", out)
    return table, report


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run the TA-only baseline model.")
    parser.add_argument(
        "--force-matrix", action="store_true",
        help="rebuild the feature matrix instead of using the cache",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    table, report = run_ta_baseline(force_matrix=args.force_matrix)
    print("\n=== TA-only baseline — evaluation ===")
    print(report.to_string(index=False))
    print(f"\npredictions table: {len(table):,} rows")


if __name__ == "__main__":
    main()
