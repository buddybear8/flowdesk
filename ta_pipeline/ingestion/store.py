"""Managed parquet candle store + backfill manifest.

One parquet file per ticker under ``<data_dir>/candles/{TICKER}.parquet`` -- a
clean per-ticker daily series spanning the full history, trivially sliceable
(10-year TA baseline vs. recent flow-overlap window) and trivially appendable.

A CSV manifest tracks per-ticker row count, date span, last-update time and any
quality flags, so the backfill can be verified and incremental updates driven.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import pandas as pd

from .config import IngestionConfig
from .fetch import CANDLE_COLUMNS

logger = logging.getLogger(__name__)

MANIFEST_COLUMNS = [
    "ticker", "rows", "first_date", "last_date", "last_updated", "qc_flags",
]


def candle_path(cfg: IngestionConfig, ticker: str):
    """Path to one ticker's parquet file in the store."""
    return cfg.candles_dir / f"{ticker.upper()}.parquet"


def write_candles(cfg: IngestionConfig, ticker: str, df: pd.DataFrame):
    """Overwrite a ticker's parquet file with ``df`` (its canonical series)."""
    path = candle_path(cfg, ticker)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.reset_index(drop=True).to_parquet(path, index=False)
    return path


def read_candles(cfg: IngestionConfig, ticker: str) -> pd.DataFrame:
    """Read a ticker's stored candles, or an empty frame if not yet stored."""
    path = candle_path(cfg, ticker)
    if not path.exists():
        return pd.DataFrame(columns=CANDLE_COLUMNS)
    return pd.read_parquet(path)


def append_candles(
    cfg: IngestionConfig, ticker: str, new_df: pd.DataFrame
) -> pd.DataFrame:
    """Append new bars to a ticker's stored series, deduped on date.

    Returns the merged full series that was written.
    """
    merged = (
        pd.concat([read_candles(cfg, ticker), new_df], ignore_index=True)
        .drop_duplicates(subset=["date"], keep="last")
        .sort_values("date")
        .reset_index(drop=True)
    )
    write_candles(cfg, ticker, merged)
    return merged


def manifest_row(ticker: str, df: pd.DataFrame, qc_flags=()) -> dict:
    """Build one manifest row from a ticker's stored candle frame."""
    if df.empty:
        first = last = None
    else:
        first = pd.Timestamp(df["date"].min()).date().isoformat()
        last = pd.Timestamp(df["date"].max()).date().isoformat()
    return {
        "ticker": ticker.upper(),
        "rows": len(df),
        "first_date": first,
        "last_date": last,
        "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "qc_flags": ";".join(qc_flags),
    }


def read_manifest(cfg: IngestionConfig) -> pd.DataFrame:
    """Read the manifest CSV, or an empty frame if it does not exist yet."""
    if not cfg.manifest_path.exists():
        return pd.DataFrame(columns=MANIFEST_COLUMNS)
    return pd.read_csv(cfg.manifest_path)


def write_manifest(cfg: IngestionConfig, rows) -> pd.DataFrame:
    """Write the manifest CSV from an iterable of manifest-row dicts."""
    cfg.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(list(rows), columns=MANIFEST_COLUMNS)
    df = df.sort_values("ticker").reset_index(drop=True)
    df.to_csv(cfg.manifest_path, index=False)
    return df


def upsert_manifest_row(cfg: IngestionConfig, row: dict) -> pd.DataFrame:
    """Insert or replace a single ticker's manifest row (used by the updater)."""
    manifest = read_manifest(cfg)
    manifest = manifest[manifest["ticker"] != row["ticker"]]
    manifest = pd.concat([manifest, pd.DataFrame([row])], ignore_index=True)
    return write_manifest(cfg, manifest.to_dict("records"))
