"""Dark-pool features -- per-(ticker, date) aggregates of large-block prints.

``aggregate_darkpool`` reduces the raw ``dark_pool_prints`` rows to one row
per (ticker, feature_date) of raw block aggregates. It is **sparse**: only
ticker-days that actually had a print appear.

The join (F3) reindexes these onto the full TA calendar, 0-filling print-free
days, and then calls ``add_darkpool_derived`` to attach the cross-ticker-
comparable, self-calibrating features -- which need the dense daily series.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..features.common import trailing_pctile_rank
from .config import FlowConfig
from .sessionize import add_feature_date

# Raw aggregate columns produced by ``aggregate_darkpool`` (sparse).
#
# The DB's own `rank` / `percentile` columns are deliberately NOT used: they
# are recomputed against the whole evolving corpus on every insert, so a
# print's rank reflects a distribution that includes *future* prints --
# lookahead leakage. ``dp_premium_pctile`` (a strictly trailing window) is the
# leakage-safe replacement.
DARKPOOL_RAW_COLUMNS = [
    "dp_print_count", "dp_total_premium", "dp_total_size", "dp_max_premium",
]
# Derived columns added post-join by ``add_darkpool_derived`` (dense).
# The ``has_dp`` presence indicator is owned by the join, not duplicated here.
DARKPOOL_DERIVED_COLUMNS = [
    "dp_premium_to_dollar_vol", "dp_premium_pctile",
]


def aggregate_darkpool(dp_df: pd.DataFrame, trading_days) -> pd.DataFrame:
    """Sparse per-(ticker, date) dark-pool aggregates.

    ``dp_df`` is the cached ``dark_pool_prints`` table; ``trading_days`` is the
    trading-day calendar used to sessionize ``executed_at`` (Rule A). Returns
    one row per ticker-day that had a print, with ``DARKPOOL_RAW_COLUMNS``.
    """
    sess = add_feature_date(dp_df, "executed_at", trading_days)
    sess = sess[sess["feature_date"].notna()]
    if sess.empty:
        return pd.DataFrame(columns=["ticker", "date", *DARKPOOL_RAW_COLUMNS])

    agg = (
        sess.groupby(["ticker", "feature_date"], sort=False)
        .agg(
            dp_print_count=("executed_at", "size"),
            dp_total_premium=("premium", "sum"),
            dp_total_size=("size", "sum"),
            dp_max_premium=("premium", "max"),
        )
        .reset_index()
        .rename(columns={"feature_date": "date"})
    )
    return agg.sort_values(["ticker", "date"]).reset_index(drop=True)


def add_darkpool_derived(
    matrix: pd.DataFrame, cfg: FlowConfig = None
) -> pd.DataFrame:
    """Attach the derived dark-pool features to a join-and-0-filled matrix.

    Expects the dense matrix (every TA row, ``DARKPOOL_RAW_COLUMNS`` present
    and 0-filled on print-free days) carrying ``close`` / ``volume``. Adds:

    * ``dp_premium_to_dollar_vol`` -- block premium as a fraction of the day's
      dollar volume (close x volume); cross-ticker comparable.
    * ``dp_premium_pctile`` -- the ticker's own trailing-window percentile of
      that ratio; self-calibrating "how unusual is today's block intensity".
    """
    cfg = cfg or FlowConfig()
    out = matrix.copy()

    dollar_vol = (out["close"] * out["volume"]).replace(0, np.nan)
    out["dp_premium_to_dollar_vol"] = (
        out["dp_total_premium"] / dollar_vol
    ).fillna(0.0)
    out["dp_premium_pctile"] = (
        out.groupby("ticker", sort=False)["dp_premium_to_dollar_vol"]
        .transform(lambda s: trailing_pctile_rank(s, cfg.dp_pctile_window))
    )
    return out
