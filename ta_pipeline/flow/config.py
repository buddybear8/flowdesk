"""Configuration for the flow / dark-pool feature-join layer.

Covers the local parquet cache locations, the database connection and the
dark-pool history floor consumed by the F4 model window.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# The cache lives under the package data dir so the package .gitignore covers it.
_PACKAGE_DIR = Path(__file__).resolve().parents[1]   # ta_pipeline/
_DEFAULT_DATA_DIR = _PACKAGE_DIR / "data"


@dataclass(frozen=True)
class FlowConfig:
    """Parameters for the flow / dark-pool extract, features and join."""

    # ---- storage -------------------------------------------------------
    data_dir: Path = _DEFAULT_DATA_DIR

    # ---- database ------------------------------------------------------
    # The extract reads its connection string from this env var. Use the
    # Railway *public* proxy URL (the Postgres service's DATABASE_PUBLIC_URL),
    # not the internal postgres.railway.internal reference -- the latter only
    # resolves from inside Railway.
    db_url_env: str = "FLOWDESK_DATABASE_URL"

    # ---- dark-pool history floor --------------------------------------
    # dark_pool_prints starts 2023-01-03; the F4 dark-pool model trains on
    # this window only (before it the dp_* features are all-zero).
    dp_history_start: str = "2023-01-01"

    # ---- feature parameters -------------------------------------------
    # Trailing window (trading days) for the self-calibrating dark-pool
    # percentile features. ~6 months -- short enough to come online partway
    # through 2023, long enough to be a stable reference distribution.
    dp_pctile_window: int = 126

    # ---- flow-model gating --------------------------------------------
    # The flow ablation is refused until the corpus clears these thresholds.
    # UW's API serves only a rolling ~30-trading-day window, so today the
    # corpus is far below them; the live worker accumulates ~1 day/day. See
    # flow/README.md.
    min_flow_dates: int = 60                 # ~3 months of distinct flow days
    min_labelable_flow_rows: int = 10000     # labelable has_flow rows

    @property
    def flow_dir(self) -> Path:
        """Directory holding the flow / dark-pool parquet caches."""
        return Path(self.data_dir) / "flow"

    @property
    def flow_alerts_path(self) -> Path:
        """Cached `flow_alerts` table."""
        return self.flow_dir / "flow_alerts.parquet"

    @property
    def dark_pool_path(self) -> Path:
        """Cached `dark_pool_prints` table."""
        return self.flow_dir / "dark_pool_prints.parquet"

    @property
    def sentiment_path(self) -> Path:
        """Cached per-(ticker, date, strike) chain-flow sentiment snapshots."""
        return self.flow_dir / "flow_sentiment.parquet"

    @property
    def joined_matrix_path(self) -> Path:
        """Cached TA + flow + dark-pool joined feature matrix."""
        return self.flow_dir / "joined_matrix.parquet"

    def resolve_db_url(self) -> str:
        """The Postgres connection string, from ``db_url_env``.

        Raises a clear error if the variable is unset -- the extract is the
        only DB-touching step, so this is the single place credentials enter.
        """
        url = os.environ.get(self.db_url_env)
        if not url:
            raise RuntimeError(
                f"{self.db_url_env} is not set -- export the Railway Postgres "
                f"public URL, e.g.\n"
                f"  export {self.db_url_env}=\"$(railway variables "
                f"--service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' "
                f"| cut -d= -f2-)\""
            )
        return url
