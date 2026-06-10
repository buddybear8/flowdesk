"""Dark-pool ablation -- TA-only vs dark-pool vs combined, on the 2023+ window.

Builds the TA + flow + dark-pool joined matrix, restricts it to the window
where dark-pool data exists (>= ``FlowConfig.dp_history_start``), and runs the
walk-forward model three times on that one matrix -- ``ta``, ``dp`` and
``ta+dp``. ``make_folds`` is deterministic, so all three share identical CV
folds and the same reserved 12-month OOS slice: the comparison is
apples-to-apples on identical rows.

The headline is the OOS ROC-AUC / PR-AUC of ``ta+dp`` against ``ta`` -- the
honest answer to "do the dark-pool features beat the TA-only baseline" --
measured on the 2023+ rows (distinct from the full-history baseline in
``evaluation.csv``). Flow columns ride along in the matrix but are not used
here; the flow ablation is gated until the flow corpus is long enough (F5).

CLI:  python -m ta_pipeline.model.run_ablation
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from ..config import PipelineConfig
from ..flow import FlowConfig, build_joined_matrix
from ..flow.guard import FlowCorpusTooSmall, check_flow_modelable
from .config import ModelConfig
from .dataset import feature_groups, materialize_matrix
from .evaluate import evaluate
from .predictions import build_predictions_table
from .train import oof_predictions

logger = logging.getLogger(__name__)

# Feature sets compared by the ablation, in report order.
_FEATURE_SETS = ("ta", "dp", "ta+dp")


def _windowed_matrix(model_cfg, pipeline_cfg, flow_cfg) -> pd.DataFrame:
    """The TA + dark-pool joined matrix, restricted to the dark-pool era."""
    ta_matrix = materialize_matrix(model_cfg, pipeline_cfg)
    joined = build_joined_matrix(ta_matrix, flow_cfg)
    window = joined[
        joined["date"] >= pd.Timestamp(flow_cfg.dp_history_start)
    ].reset_index(drop=True)
    logger.info(
        "dark-pool window: %d rows, %s..%s, %d tickers (full matrix: %d rows)",
        len(window), window["date"].min().date(), window["date"].max().date(),
        window["ticker"].nunique(), len(joined),
    )
    return window


def run_darkpool_ablation(
    model_cfg: ModelConfig = None,
    pipeline_cfg: PipelineConfig = None,
    flow_cfg: FlowConfig = None,
):
    """Run the ta / dp / ta+dp ablation; write the report + predictions.

    Returns ``(evaluation_report, predictions_table)``. The report carries a
    ``feature_set`` column; the predictions table is the ``ta+dp`` spot-check
    table. Artifacts land in ``model_cfg.model_dir``:
    ``evaluation_darkpool.csv``, ``predictions_darkpool.{parquet,csv}`` and
    the ``ta_dp_{long,short}.joblib`` OOS models.
    """
    model_cfg = model_cfg or ModelConfig()
    pipeline_cfg = pipeline_cfg or PipelineConfig()
    flow_cfg = flow_cfg or FlowConfig()

    window = _windowed_matrix(model_cfg, pipeline_cfg, flow_cfg)
    groups = feature_groups(window)
    feature_sets = {
        "ta": groups["ta"],
        "dp": groups["dp"],
        "ta+dp": groups["ta"] + groups["dp"],
    }
    logger.info(
        "feature sets: ta=%d, dp=%d, ta+dp=%d",
        len(feature_sets["ta"]), len(feature_sets["dp"]),
        len(feature_sets["ta+dp"]),
    )

    reports = []
    combined_predictions = None
    for name in _FEATURE_SETS:
        logger.info(
            "--- ablation: %s (%d features) ---", name, len(feature_sets[name])
        )
        predictions = oof_predictions(
            window, model_cfg,
            features=feature_sets[name],
            model_prefix="ta_dp" if name == "ta+dp" else name,
            save_models=(name == "ta+dp"),
        )
        report = evaluate(predictions)
        report.insert(0, "feature_set", name)
        reports.append(report)
        if name == "ta+dp":
            combined_predictions = predictions

    evaluation = pd.concat(reports, ignore_index=True)
    table = build_predictions_table(combined_predictions, window, pipeline_cfg)

    out = Path(model_cfg.model_dir)
    out.mkdir(parents=True, exist_ok=True)
    evaluation.to_csv(out / "evaluation_darkpool.csv", index=False)
    table.to_parquet(out / "predictions_darkpool.parquet", index=False)
    table.to_csv(out / "predictions_darkpool.csv", index=False)
    logger.info("wrote dark-pool ablation report + predictions to %s", out)
    return evaluation, table


def run_flow_ablation(
    model_cfg: ModelConfig = None,
    pipeline_cfg: PipelineConfig = None,
    flow_cfg: FlowConfig = None,
):
    """Run the flow ablation (flow / ta+flow / ta+flow+dp) -- guard-gated.

    Restricts the joined matrix to the flow-overlap window, then checks the
    flow-corpus guard: while the corpus is below ``FlowConfig.min_flow_dates``
    / ``min_labelable_flow_rows`` this raises :class:`FlowCorpusTooSmall` -- it
    does today, because UW's API serves only a rolling ~30-trading-day window.
    Once the live worker has accumulated enough history the same call runs the
    ablation and writes ``evaluation_flow.csv`` + ``predictions_flow.*``.
    """
    model_cfg = model_cfg or ModelConfig()
    pipeline_cfg = pipeline_cfg or PipelineConfig()
    flow_cfg = flow_cfg or FlowConfig()

    ta_matrix = materialize_matrix(model_cfg, pipeline_cfg)
    joined = build_joined_matrix(ta_matrix, flow_cfg)
    flow_dates = joined.loc[joined["has_flow"] == 1, "date"]
    window = joined[joined["date"] >= flow_dates.min()].reset_index(drop=True)
    logger.info(
        "flow window: %d rows, %s..%s",
        len(window),
        window["date"].min().date() if len(window) else None,
        window["date"].max().date() if len(window) else None,
    )

    check_flow_modelable(window, flow_cfg)   # raises FlowCorpusTooSmall if short

    groups = feature_groups(window)
    feature_sets = {
        "flow": groups["flow"],
        "ta+flow": groups["ta"] + groups["flow"],
        "ta+flow+dp": groups["ta"] + groups["flow"] + groups["dp"],
    }
    logger.info(
        "feature sets: flow=%d, ta+flow=%d, ta+flow+dp=%d",
        len(feature_sets["flow"]), len(feature_sets["ta+flow"]),
        len(feature_sets["ta+flow+dp"]),
    )

    reports = []
    combined_predictions = None
    for name, features in feature_sets.items():
        logger.info(
            "--- flow ablation: %s (%d features) ---", name, len(features)
        )
        predictions = oof_predictions(
            window, model_cfg,
            features=features,
            model_prefix=name.replace("+", "_"),
            save_models=(name == "ta+flow+dp"),
        )
        report = evaluate(predictions)
        report.insert(0, "feature_set", name)
        reports.append(report)
        if name == "ta+flow+dp":
            combined_predictions = predictions

    evaluation = pd.concat(reports, ignore_index=True)
    table = build_predictions_table(combined_predictions, window, pipeline_cfg)

    out = Path(model_cfg.model_dir)
    out.mkdir(parents=True, exist_ok=True)
    evaluation.to_csv(out / "evaluation_flow.csv", index=False)
    table.to_parquet(out / "predictions_flow.parquet", index=False)
    table.to_csv(out / "predictions_flow.csv", index=False)
    logger.info("wrote flow ablation report + predictions to %s", out)
    return evaluation, table


def _print_comparison(evaluation: pd.DataFrame) -> None:
    """Print the OOS headline: ta vs dp vs ta+dp, and the ta+dp - ta delta."""
    oos = evaluation[evaluation["segment"] == "oos"]
    print("\n=== Dark-pool ablation — OOS (reserved 12-month slice) ===")
    for side in ("long", "short"):
        s = oos[oos["side"] == side].set_index("feature_set")
        print(f"\n  {side}:")
        for fs in _FEATURE_SETS:
            r = s.loc[fs]
            print(
                f"    {fs:6s}  ROC-AUC {r['roc_auc']:.4f}   "
                f"PR-AUC {r['pr_auc']:.4f} (lift {r['pr_auc_lift']:.3f})"
            )
        d_roc = s.loc["ta+dp", "roc_auc"] - s.loc["ta", "roc_auc"]
        d_pr = s.loc["ta+dp", "pr_auc"] - s.loc["ta", "pr_auc"]
        print(
            f"    delta (ta+dp − ta)  ROC-AUC {d_roc:+.4f}   PR-AUC {d_pr:+.4f}"
        )


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Run the dark-pool ablation, or the (gated) flow ablation."
    )
    parser.add_argument(
        "--flow", action="store_true",
        help="run the flow ablation instead -- gated until the flow corpus "
             "is large enough (FlowCorpusTooSmall otherwise)",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    if args.flow:
        try:
            evaluation, table = run_flow_ablation()
        except FlowCorpusTooSmall as exc:
            print(f"\nflow ablation skipped — {exc}")
            return
        print("\n=== evaluation_flow.csv ===")
        print(evaluation.to_string(index=False))
        print(f"\npredictions table (ta+flow+dp): {len(table):,} rows")
        return

    evaluation, table = run_darkpool_ablation()
    print("\n=== evaluation_darkpool.csv ===")
    print(evaluation.to_string(index=False))
    _print_comparison(evaluation)
    print(f"\npredictions table (ta+dp): {len(table):,} rows")


if __name__ == "__main__":
    main()
