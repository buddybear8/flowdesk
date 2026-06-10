"""Modelability guard for the options-flow ablation.

The flow corpus is only ~13 trading days dense -- UW's API serves a rolling
~30-trading-day window (see flow/README.md). With the 10-day triple-barrier
label that leaves far too few labelable flow rows to train or honestly
evaluate a walk-forward flow model.

This guard refuses the flow ablation until the corpus is large enough. Once
the live worker has accumulated enough history, the same ``run_flow_ablation``
call clears the guard and runs -- no code change needed.
"""

from __future__ import annotations

from .config import FlowConfig


class FlowCorpusTooSmall(RuntimeError):
    """Raised when the flow corpus is too short to model honestly."""


def flow_corpus_stats(matrix) -> dict:
    """Labelable-flow coverage of a joined matrix.

    Returns ``{"flow_rows": int, "flow_dates": int}`` -- the count of
    labelable rows carrying flow (``has_flow == 1``) and the number of
    distinct dates among them.
    """
    flow_rows = matrix[matrix["has_flow"] == 1]
    return {
        "flow_rows": int(len(flow_rows)),
        "flow_dates": int(flow_rows["date"].nunique()),
    }


def check_flow_modelable(
    matrix, cfg: FlowConfig = None, *, raises: bool = True
) -> bool:
    """Whether a joined matrix has enough labelable flow data to model.

    Checks the labelable ``has_flow`` row count and the distinct flow-date
    count against ``cfg.min_labelable_flow_rows`` / ``cfg.min_flow_dates``.
    With ``raises=True`` (default) a shortfall raises :class:`FlowCorpusTooSmall`
    with a message explaining the gap; with ``raises=False`` it returns False.
    """
    cfg = cfg or FlowConfig()
    stats = flow_corpus_stats(matrix)
    ok = (
        stats["flow_rows"] >= cfg.min_labelable_flow_rows
        and stats["flow_dates"] >= cfg.min_flow_dates
    )
    if not ok and raises:
        raise FlowCorpusTooSmall(
            f"flow corpus too small to model: {stats['flow_rows']} labelable "
            f"flow rows on {stats['flow_dates']} dates "
            f"(need >= {cfg.min_labelable_flow_rows} rows on "
            f">= {cfg.min_flow_dates} dates). UW's API serves only a rolling "
            f"~30-trading-day window -- let the live worker accumulate, then "
            f"re-run the flow ablation. See flow/README.md."
        )
    return ok
