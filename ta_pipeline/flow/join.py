"""Join the flow + dark-pool features onto the TA feature matrix.

Left-joins the sparse per-(ticker, date) aggregates from F2 onto the
leakage-controlled TA matrix on ``(ticker, date)`` -- every TA row and its
order are preserved. Activity-free ticker-days are 0-filled (counts /
premiums / sizes) or left NaN (averages / fractions, which have no honest 0);
``has_flow`` / ``has_dp`` flag the rows that actually had activity. The dense
derived dark-pool features are attached last, once the series is gap-free.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from .config import FlowConfig
from .darkpool_features import (
    DARKPOOL_RAW_COLUMNS,
    add_darkpool_derived,
    aggregate_darkpool,
)
from .extract import load_dark_pool, load_flow_alerts
from .flow_features import FLOW_FEATURE_COLUMNS, aggregate_flow

logger = logging.getLogger(__name__)

# Average / fraction aggregates: a no-activity ticker-day has no honest 0, so
# these are left NaN (LightGBM splits on NaN natively). Everything else --
# counts, premiums, sizes -- 0-fills to "none that day".
_NAN_FILL = ("flow_avg_dte", "flow_opening_frac")


def join_flow_features(
    matrix: pd.DataFrame,
    flow_agg: pd.DataFrame,
    dp_agg: pd.DataFrame,
    cfg: FlowConfig = None,
) -> pd.DataFrame:
    """Left-join the sparse flow + dark-pool aggregates onto the TA matrix.

    ``matrix`` must carry ``ticker`` / ``date`` (the join key) and ``close`` /
    ``volume`` (needed by the derived dark-pool features). ``flow_agg`` /
    ``dp_agg`` are the sparse F2 aggregates. The returned frame is ``matrix``
    with the dark-pool and flow feature columns appended.
    """
    cfg = cfg or FlowConfig()
    out = matrix.merge(
        dp_agg, on=["ticker", "date"], how="left", validate="one_to_one"
    )
    out = out.merge(
        flow_agg, on=["ticker", "date"], how="left", validate="one_to_one"
    )

    # Presence indicators -- read before the 0-fill, while misses are still NaN.
    out["has_dp"] = out["dp_print_count"].notna().astype("int8")
    out["has_flow"] = out["flow_alert_count"].notna().astype("int8")

    # Cast to plain float64 first (the merge can leave nullable / object
    # columns), then apply the fill policy: 0 for counts/premiums/sizes,
    # NaN kept for averages/fractions.
    for col in (*DARKPOOL_RAW_COLUMNS, *FLOW_FEATURE_COLUMNS):
        out[col] = out[col].astype("float64")
        if col not in _NAN_FILL:
            out[col] = out[col].fillna(0.0)

    return add_darkpool_derived(out, cfg)


def build_joined_matrix(
    matrix: pd.DataFrame,
    cfg: FlowConfig = None,
    *,
    cache: bool = False,
    force: bool = False,
) -> pd.DataFrame:
    """Build the TA + flow + dark-pool matrix from the parquet caches.

    Sessionizes (Rule A) against ``matrix``'s own trading dates, aggregates
    both sources and joins them on. With ``cache=True`` the result is written
    to / read from ``cfg.joined_matrix_path`` (``force=True`` rebuilds).
    """
    cfg = cfg or FlowConfig()
    if cache and not force and Path(cfg.joined_matrix_path).exists():
        return pd.read_parquet(cfg.joined_matrix_path)

    trading_days = matrix["date"].unique()
    flow_agg = aggregate_flow(load_flow_alerts(cfg), trading_days)
    dp_agg = aggregate_darkpool(load_dark_pool(cfg), trading_days)
    joined = join_flow_features(matrix, flow_agg, dp_agg, cfg)
    logger.info(
        "joined matrix: %d rows, has_dp=%d (%.1f%%), has_flow=%d (%.1f%%)",
        len(joined),
        int(joined["has_dp"].sum()), 100 * joined["has_dp"].mean(),
        int(joined["has_flow"].sum()), 100 * joined["has_flow"].mean(),
    )

    if cache:
        Path(cfg.joined_matrix_path).parent.mkdir(parents=True, exist_ok=True)
        joined.to_parquet(cfg.joined_matrix_path, index=False)
    return joined
