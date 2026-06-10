"""Extract ``flow_sentiment_days`` (per-strike chain flow) into a parquet cache.

``flow_sentiment_days`` stores, per (ticker, trading_date), the whole-day
cumulative options chain split by aggressor side, as a ``minutes`` JSON array
of snapshots. The LAST snapshot is the full-session cumulative state (live days
carry a 5-min series; backfilled days carry a single 16:00 snapshot) -- that is
what we featurize, so this extract explodes ``minutes[-1].strikes`` into one
long row per (ticker, date, strike):

    ticker · date · spot · k · cA · cB · pA · pB · cP · pP

where cA/cB are call volume bought-at-ask / sold-at-bid (Buy / Sell), pA/pB the
put equivalents, and cP/pP the strike's net call / put premium.

Because the row is whole-day cumulative through the session close, ``date``
*is* the close-aligned feature date (Rule A) -- no sessionizer needed, unlike
event-timestamped flow_alerts. The forward triple-barrier label starts at that
day's close, so the features are leakage-safe by construction.

CLI:
  export FLOWDESK_DATABASE_URL="$(railway variables --service Postgres --kv \\
      | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)"
  python -m ta_pipeline.flow.sentiment_extract
"""

from __future__ import annotations

import json
import logging

import pandas as pd

from .config import FlowConfig

logger = logging.getLogger(__name__)

_QUERY = """
    SELECT ticker, trading_date, spot, minutes
    FROM flow_sentiment_days
    ORDER BY ticker, trading_date
"""

_STRIKE_FIELDS = ("k", "cA", "cB", "pA", "pB", "cP", "pP")


def _explode_rows(raw_rows) -> list[dict]:
    """Explode DB rows -> one dict per (ticker, date, strike) from the last
    cumulative snapshot of each ticker-day."""
    out: list[dict] = []
    for ticker, trading_date, spot, minutes in raw_rows:
        if minutes is None:
            continue
        mins = json.loads(minutes) if isinstance(minutes, str) else minutes
        if not mins:
            continue
        strikes = mins[-1].get("strikes") or []  # last = whole-day cumulative
        spot_f = float(spot) if spot is not None else float("nan")
        for s in strikes:
            try:
                k = float(s["k"])
            except (KeyError, TypeError, ValueError):
                continue
            out.append({
                "ticker": ticker,
                "date": trading_date,
                "spot": spot_f,
                "k": k,
                "cA": float(s.get("cA", 0) or 0),
                "cB": float(s.get("cB", 0) or 0),
                "pA": float(s.get("pA", 0) or 0),
                "pB": float(s.get("pB", 0) or 0),
                "cP": float(s.get("cP", 0) or 0),
                "pP": float(s.get("pP", 0) or 0),
            })
    return out


def extract_sentiment(conn) -> pd.DataFrame:
    """Pull ``flow_sentiment_days`` and explode to the long per-strike frame."""
    with conn.cursor() as cur:
        cur.execute(_QUERY)
        raw = cur.fetchall()
    df = pd.DataFrame(_explode_rows(raw), columns=["ticker", "date", "spot", *_STRIKE_FIELDS])
    if not df.empty:
        # naive midnight datetime64, matching the TA matrix `date` column
        df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None).dt.normalize()
    return df


def run_extract(cfg: FlowConfig = None) -> dict:
    """Extract the chain-flow snapshots to the parquet cache; return a summary."""
    import psycopg2

    cfg = cfg or FlowConfig()
    cfg.flow_dir.mkdir(parents=True, exist_ok=True)

    logger.info("connecting to Postgres (%s)", cfg.db_url_env)
    conn = psycopg2.connect(cfg.resolve_db_url())
    try:
        df = extract_sentiment(conn)
    finally:
        conn.close()

    df.to_parquet(cfg.sentiment_path, index=False)
    if df.empty:
        logger.warning("flow_sentiment: 0 rows")
    else:
        logger.info(
            "flow_sentiment: %d strike-rows, %s..%s, %d tickers, %d ticker-days",
            len(df), df["date"].min().date(), df["date"].max().date(),
            df["ticker"].nunique(), df.groupby(["ticker", "date"]).ngroups,
        )
    return {"rows": len(df), "path": str(cfg.sentiment_path)}


def load_sentiment(cfg: FlowConfig = None) -> pd.DataFrame:
    """Read the cached chain-flow snapshots; raises if not yet extracted."""
    cfg = cfg or FlowConfig()
    if not cfg.sentiment_path.exists():
        raise FileNotFoundError(
            f"{cfg.sentiment_path} not found -- run `python -m "
            f"ta_pipeline.flow.sentiment_extract` first"
        )
    return pd.read_parquet(cfg.sentiment_path)


def main(argv=None) -> None:
    import argparse

    argparse.ArgumentParser(
        description="Extract flow_sentiment_days (chain flow) to a parquet cache."
    ).parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    summary = run_extract()
    print(f"\n=== chain-flow extract ===\n  {summary['rows']:>8,d} strike-rows -> {summary['path']}")


if __name__ == "__main__":
    main()
