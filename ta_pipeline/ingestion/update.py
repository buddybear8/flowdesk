"""Incremental daily update of the candle store.

Reads each ticker's last stored date from the manifest, fetches only the bars
after it, appends to the per-ticker parquet (deduped on date) and refreshes the
manifest. A ~200-row append -- light enough to ride on an existing post-market
cron; no new infrastructure.

Tickers new to the universe are full-backfilled. Split events shift historical
adjusted prices: this updater does not re-adjust history -- re-run the full
backfill periodically (e.g. monthly) to keep adjustments current (brief §4).

CLI:  python -m ta_pipeline.ingestion.update --universe-file tickers.txt
"""

from __future__ import annotations

import logging
from datetime import timedelta

import pandas as pd

from .config import IngestionConfig, add_cli_arguments, config_from_cli_args
from .fetch import fetch_daily_bars, get_client
from .quality import quality_flags
from .store import append_candles, manifest_row, read_candles, read_manifest, write_manifest

logger = logging.getLogger(__name__)


def _update_one(cfg, ticker, last_date, full_start, end, client):
    """Fetch + append new bars for one ticker. Returns (manifest_row, n_new)."""
    if last_date is None or pd.isna(last_date):
        fetch_start = full_start                        # new ticker -> full pull
    else:
        fetch_start = (
            pd.Timestamp(last_date) + timedelta(days=1)
        ).date().isoformat()

    if fetch_start > end:
        merged, n_new = read_candles(cfg, ticker), 0    # already current
    else:
        new_bars = fetch_daily_bars(
            ticker, fetch_start, end,
            adjusted=cfg.adjusted, max_retries=cfg.max_retries,
            backoff_seconds=cfg.retry_backoff_seconds, client=client,
        )
        n_new = len(new_bars)
        merged = (
            append_candles(cfg, ticker, new_bars)
            if n_new else read_candles(cfg, ticker)
        )

    flags = quality_flags(merged, full_start, end)
    return manifest_row(ticker, merged, flags), n_new


def run_update(cfg: IngestionConfig, *, client=None) -> pd.DataFrame:
    """Incrementally update every ticker in ``cfg``'s universe.

    Returns the refreshed manifest. Per-ticker failures are logged; the ticker
    keeps its previous manifest row.
    """
    universe = cfg.resolve_universe()
    if not universe:
        raise ValueError(
            "empty ticker universe -- set cfg.tickers or cfg.universe_file"
        )
    full_start, end = cfg.resolve_dates()
    manifest = read_manifest(cfg)
    last_dates = (
        dict(zip(manifest["ticker"], manifest["last_date"]))
        if not manifest.empty else {}
    )
    client = get_client(client)
    logger.info("update: %d tickers, through %s", len(universe), end)

    rows, total_new = [], 0
    for ticker in universe:
        t = ticker.upper()
        try:
            row, n_new = _update_one(cfg, t, last_dates.get(t), full_start, end, client)
            rows.append(row)
            total_new += n_new
            logger.info(
                "updated %-7s +%-4d bars last=%s flags=%s",
                t, n_new, row["last_date"], row["qc_flags"] or "-",
            )
        except Exception as exc:  # noqa: BLE001 - isolate per-ticker failures
            logger.error("FAILED %s: %s", t, exc)
            prior = manifest[manifest["ticker"] == t]
            if not prior.empty:
                rows.append(prior.iloc[0].to_dict())

    written = write_manifest(cfg, rows)
    logger.info(
        "update complete: +%d new bars across %d tickers", total_new, len(written)
    )
    return written


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Incremental Polygon.io daily-candle update."
    )
    add_cli_arguments(parser)
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    run_update(config_from_cli_args(args))


if __name__ == "__main__":
    main()
