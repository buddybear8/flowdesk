"""Extract ``flow_alerts`` + ``dark_pool_prints`` into a local parquet cache.

This is the one DB-touching step of the flow / dark-pool join. Everything
downstream -- feature engineering, the join, the models -- reads the parquet
caches offline, so the model pipeline stays reproducible without DB access
(the same design as the candle store).

Timestamps are normalized to UTC on the way in; the F2 sessionizer converts
to US/Eastern to apply the close-aligned (Rule A) join.

CLI:
  export FLOWDESK_DATABASE_URL="$(railway variables --service Postgres --kv \\
      | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)"
  python -m ta_pipeline.flow.extract
"""

from __future__ import annotations

import logging

import pandas as pd

from .config import FlowConfig

logger = logging.getLogger(__name__)

# --- queries --------------------------------------------------------------
# Whole tables -- both are small (flow ~140k rows, dark pool ~40k). "exec" and
# "rank" are quoted defensively (they collide with SQL keywords).
_FLOW_QUERY = """
    SELECT id, time, captured_at, ticker, type, side, sentiment, "exec",
           multi_leg, strike, expiry, size, oi, premium, spot, confidence,
           all_opening
    FROM flow_alerts
    ORDER BY time
"""
_DARK_POOL_QUERY = """
    SELECT id, uw_id, executed_at, ticker, price, size, premium, volume,
           is_etf, is_extended, is_intraday, "rank", percentile
    FROM dark_pool_prints
    ORDER BY executed_at
"""

# --- per-table type coercion ---------------------------------------------
_FLOW_TYPES = dict(
    utc=("time", "captured_at"),
    dates=("expiry",),
    floats=("strike", "premium", "spot"),
    ints=("size", "oi"),
    bools=("multi_leg", "all_opening"),
)
_DARK_POOL_TYPES = dict(
    utc=("executed_at",),
    floats=("price", "premium", "percentile"),
    ints=("id", "size", "volume", "rank"),
    bools=("is_etf", "is_extended", "is_intraday"),
)


def _coerce(df: pd.DataFrame, *, utc=(), dates=(), floats=(), ints=(), bools=()):
    """Coerce raw DB columns to stable pandas dtypes.

    Decimal/None DB values become float64; nullable integers use the pandas
    ``Int64`` type; timestamps land tz-aware in UTC.
    """
    for col in utc:
        df[col] = pd.to_datetime(df[col], utc=True)
    for col in dates:
        df[col] = pd.to_datetime(df[col])
    for col in floats:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
    for col in ints:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
    for col in bools:
        df[col] = df[col].astype("boolean")
    return df


def _fetch(conn, sql: str) -> pd.DataFrame:
    """Run ``sql`` and return the result as a DataFrame (column names from the
    cursor description)."""
    with conn.cursor() as cur:
        cur.execute(sql)
        columns = [desc.name for desc in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=columns)


def _log_summary(name: str, df: pd.DataFrame, ts_col: str) -> None:
    if df.empty:
        logger.warning("%s: 0 rows", name)
        return
    lo, hi = df[ts_col].min(), df[ts_col].max()
    logger.info(
        "%s: %d rows, %s..%s, %d tickers",
        name, len(df), lo.date(), hi.date(), df["ticker"].nunique(),
    )


def extract_flow_alerts(conn) -> pd.DataFrame:
    """Pull and type-coerce the whole ``flow_alerts`` table."""
    return _coerce(_fetch(conn, _FLOW_QUERY), **_FLOW_TYPES)


def extract_dark_pool(conn) -> pd.DataFrame:
    """Pull and type-coerce the whole ``dark_pool_prints`` table."""
    return _coerce(_fetch(conn, _DARK_POOL_QUERY), **_DARK_POOL_TYPES)


def run_extract(cfg: FlowConfig = None) -> dict:
    """Extract both tables to the parquet cache; return a summary dict.

    Re-running overwrites the cache -- the tables are small and the snapshot
    is meant to be refreshed wholesale.
    """
    import psycopg2

    cfg = cfg or FlowConfig()
    cfg.flow_dir.mkdir(parents=True, exist_ok=True)

    logger.info("connecting to Postgres (%s)", cfg.db_url_env)
    conn = psycopg2.connect(cfg.resolve_db_url())
    try:
        flow = extract_flow_alerts(conn)
        dark = extract_dark_pool(conn)
    finally:
        conn.close()

    flow.to_parquet(cfg.flow_alerts_path, index=False)
    dark.to_parquet(cfg.dark_pool_path, index=False)
    _log_summary("flow_alerts", flow, "time")
    _log_summary("dark_pool_prints", dark, "executed_at")
    logger.info("cache written to %s", cfg.flow_dir)

    return {
        "flow_alerts": {"rows": len(flow), "path": str(cfg.flow_alerts_path)},
        "dark_pool_prints": {"rows": len(dark), "path": str(cfg.dark_pool_path)},
    }


def load_flow_alerts(cfg: FlowConfig = None) -> pd.DataFrame:
    """Read the cached ``flow_alerts`` snapshot; raises if not yet extracted."""
    cfg = cfg or FlowConfig()
    if not cfg.flow_alerts_path.exists():
        raise FileNotFoundError(
            f"{cfg.flow_alerts_path} not found -- run `python -m "
            f"ta_pipeline.flow.extract` first"
        )
    return pd.read_parquet(cfg.flow_alerts_path)


def load_dark_pool(cfg: FlowConfig = None) -> pd.DataFrame:
    """Read the cached ``dark_pool_prints`` snapshot; raises if not extracted."""
    cfg = cfg or FlowConfig()
    if not cfg.dark_pool_path.exists():
        raise FileNotFoundError(
            f"{cfg.dark_pool_path} not found -- run `python -m "
            f"ta_pipeline.flow.extract` first"
        )
    return pd.read_parquet(cfg.dark_pool_path)


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract flow_alerts + dark_pool_prints to a parquet cache."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    summary = run_extract()
    print("\n=== flow / dark-pool extract ===")
    for table, info in summary.items():
        print(f"  {table:18s} {info['rows']:>8,d} rows -> {info['path']}")


if __name__ == "__main__":
    main()
