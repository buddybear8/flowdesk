"""One-time full backfill of the daily-candle store.

Pulls the full multi-year history for every ticker in the universe -- one
Polygon request per ticker, split-adjusted -- runs data-quality checks, and
writes the per-ticker parquet store and the CSV manifest. Concurrency is capped
(<= 10 workers). Safe to re-run: each ticker's file is overwritten with a fresh
pull, which is also the simplest way to refresh split adjustments (brief §4).

CLI:  python -m ta_pipeline.ingestion.backfill --universe-file tickers.txt
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

from .config import IngestionConfig, add_cli_arguments, config_from_cli_args
from .fetch import CANDLE_COLUMNS, fetch_daily_bars, get_client
from .quality import quality_flags
from .store import manifest_row, write_candles, write_manifest

logger = logging.getLogger(__name__)


def _backfill_one(cfg, ticker, start, end, client):
    """Fetch, quality-check and store one ticker; return its manifest row."""
    df = fetch_daily_bars(
        ticker, start, end,
        adjusted=cfg.adjusted, max_retries=cfg.max_retries,
        backoff_seconds=cfg.retry_backoff_seconds, client=client,
    )
    flags = quality_flags(df, start, end)
    if not df.empty:
        write_candles(cfg, ticker, df)
    row = manifest_row(ticker, df, flags)
    logger.info(
        "backfilled %-7s rows=%-5d span=%s..%s flags=%s",
        ticker, row["rows"], row["first_date"], row["last_date"],
        row["qc_flags"] or "-",
    )
    return row


def run_backfill(cfg: IngestionConfig, *, client=None) -> pd.DataFrame:
    """Back-fill every ticker in ``cfg``'s universe; return the written manifest.

    Per-ticker failures are logged and recorded as an ``error:*`` manifest row
    -- one bad symbol never aborts the run.
    """
    universe = cfg.resolve_universe()
    if not universe:
        raise ValueError(
            "empty ticker universe -- set cfg.tickers or cfg.universe_file"
        )
    start, end = cfg.resolve_dates()
    client = get_client(client)
    logger.info(
        "backfill: %d tickers, %s..%s, %d workers",
        len(universe), start, end, cfg.max_workers,
    )

    rows = []
    with ThreadPoolExecutor(max_workers=cfg.max_workers) as pool:
        futures = {
            pool.submit(_backfill_one, cfg, t, start, end, client): t
            for t in universe
        }
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                rows.append(future.result())
            except Exception as exc:  # noqa: BLE001 - isolate per-ticker failures
                logger.error("FAILED %s: %s", ticker, exc)
                rows.append(manifest_row(
                    ticker, pd.DataFrame(columns=CANDLE_COLUMNS),
                    [f"error:{type(exc).__name__}"],
                ))

    manifest = write_manifest(cfg, rows)
    flagged = int((manifest["qc_flags"].fillna("") != "").sum())
    logger.info(
        "backfill complete: %d tickers (%d flagged) -> %s",
        len(manifest), flagged, cfg.manifest_path,
    )
    return manifest


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="One-time Polygon.io daily-candle backfill."
    )
    add_cli_arguments(parser)
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    run_backfill(config_from_cli_args(args))


if __name__ == "__main__":
    main()
