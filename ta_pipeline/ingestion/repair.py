"""Store repair — trim ticker-symbol-reuse history.

Over a 10-year window a ticker symbol is sometimes reused by a different
security. The stored series then holds two unrelated companies separated by a
long gap, and computing trailing TA features across that seam is meaningless.
This trims a series to the contiguous segment that FOLLOWS its largest internal
gap -- the current company -- dropping everything before it.

Apply deliberately, only to tickers confirmed (by the QC ``gaps`` flag plus an
inspection of where the gap falls) to be a start-of-series reuse. It is NOT a
blanket cleanup:

* a long gap can be a genuine same-company trading halt (do not trim);
* the seam can fall at the END of the series -- the symbol was vacated by the
  company you want and reused by another. ``trim_reused_ticker`` refuses that
  case (post-gap segment smaller than pre-gap) rather than destroying history;
  it needs a universe change (swap the ticker), not a row trim.

Note: a future full re-backfill re-fetches the whole Polygon history and so
re-introduces the pre-gap rows -- re-run the trim afterwards.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

import pandas as pd

from .config import IngestionConfig, add_cli_arguments, config_from_cli_args
from .fetch import fetch_daily_bars
from .quality import quality_flags
from .store import (
    candle_path,
    manifest_row,
    read_candles,
    read_manifest,
    upsert_manifest_row,
    write_candles,
    write_manifest,
)

logger = logging.getLogger(__name__)

# A gap far beyond any holiday cluster or ordinary trading halt.
DEFAULT_MIN_GAP_DAYS = 45


def split_at_largest_gap(df: pd.DataFrame, min_gap_days: int = DEFAULT_MIN_GAP_DAYS):
    """Split a candle frame at its largest day-gap.

    Returns ``(pre_gap, post_gap, gap_days)``. If no gap reaches
    ``min_gap_days``, ``pre_gap`` is empty and ``post_gap`` is the whole frame.
    """
    df = df.sort_values("date").reset_index(drop=True)
    if len(df) < 2:
        return df.iloc[0:0], df, 0
    gaps = df["date"].diff().dt.days
    cut = int(gaps.idxmax())
    gap_days = int(gaps.iloc[cut])
    if gap_days < min_gap_days:
        return df.iloc[0:0], df, gap_days
    return (
        df.iloc[:cut].reset_index(drop=True),
        df.iloc[cut:].reset_index(drop=True),
        gap_days,
    )


def trim_reused_ticker(
    cfg: IngestionConfig, ticker: str, *, min_gap_days: int = DEFAULT_MIN_GAP_DAYS
) -> dict:
    """Trim a reused-symbol ticker in the store to its post-gap segment.

    The store file and manifest row are rewritten only when a trim happens.
    Refuses (no write) when the post-gap segment is not larger than the pre-gap
    one -- that signature means the seam is at the END (the symbol was vacated),
    which a universe change must fix, not a trim.

    Returns a result dict describing the action taken.
    """
    before = read_candles(cfg, ticker)
    pre, post, gap_days = split_at_largest_gap(before, min_gap_days)
    result = {
        "ticker": ticker.upper(),
        "rows_before": len(before),
        "rows_after": len(before),
        "gap_days": gap_days,
        "action": "none",
    }

    if len(pre) == 0:
        result["action"] = "no-seam"
        logger.info("%s: no gap >= %d days; left unchanged", ticker, min_gap_days)
        return result

    if len(post) <= len(pre):
        result["action"] = "refused:tail-seam"
        logger.warning(
            "%s: largest gap leaves a SMALLER tail (%d vs %d rows) -- the symbol "
            "looks vacated; refusing to trim (needs a universe fix, not a trim)",
            ticker, len(post), len(pre),
        )
        return result

    write_candles(cfg, ticker, post)
    start, end = cfg.resolve_dates()
    upsert_manifest_row(cfg, manifest_row(ticker, post, quality_flags(post, start, end)))
    result.update(
        action="trimmed",
        rows_after=len(post),
        dropped_rows=len(pre),
        kept_from=str(post["date"].min().date()),
    )
    logger.info(
        "%s: trimmed -- dropped %d pre-gap rows, kept %d from %s",
        ticker, len(pre), len(post), result["kept_from"],
    )
    return result


def _seam_report(predecessor: pd.DataFrame, successor: pd.DataFrame) -> dict:
    """Continuity diagnostics across a stitch seam.

    A clean rename is one trading day apart with an ordinary price move; a
    ratio far from 1.0 means an unadjusted split sits at the seam and the
    stitched series would need a manual rescale.
    """
    last = predecessor.iloc[-1]
    first = successor.iloc[0]
    pred_close = float(last["close"])
    succ_close = float(first["close"])
    ratio = succ_close / pred_close if pred_close else float("nan")
    gap_days = int((pd.Timestamp(first["date"]) - pd.Timestamp(last["date"])).days)
    return {
        "seam": str(pd.Timestamp(last["date"]).date())
        + " -> " + str(pd.Timestamp(first["date"]).date()),
        "seam_close": format(pred_close, ".2f") + " -> " + format(succ_close, ".2f"),
        "seam_ratio": round(ratio, 4),
        "seam_gap_days": gap_days,
        "seam_clean": bool(0.67 <= ratio <= 1.5 and gap_days <= 7),
    }


def stitch_predecessor(
    cfg: IngestionConfig, successor: str, predecessor: str, *, client=None
) -> dict:
    """Prepend a predecessor ticker's history to a renamed successor.

    The successor's stored series is kept as-is; the predecessor is fetched for
    the backfill window up to the day before the successor's first bar, its
    ``ticker`` column relabelled to the successor, and the two concatenated into
    one continuous series stored under the successor symbol. The manifest row is
    refreshed and seam-continuity diagnostics are returned -- inspect
    ``seam_ratio`` / ``seam_clean`` to confirm no unadjusted split sits at the
    rename boundary.
    """
    successor = successor.upper()
    predecessor = predecessor.upper()
    current = read_candles(cfg, successor)
    if current.empty:
        raise ValueError(successor + ": not in the store -- back-fill it first")

    start, end = cfg.resolve_dates()
    cutoff = pd.Timestamp(current["date"].min())
    pred_end = (cutoff - timedelta(days=1)).date().isoformat()

    pred = fetch_daily_bars(
        predecessor, start, pred_end,
        adjusted=cfg.adjusted, max_retries=cfg.max_retries,
        backoff_seconds=cfg.retry_backoff_seconds, client=client,
    )
    if pred.empty:
        logger.warning("%s: predecessor %s returned no data", successor, predecessor)
        return {"successor": successor, "predecessor": predecessor,
                "action": "no-predecessor-data", "rows_after": len(current)}

    pred = pred.copy()
    pred["ticker"] = successor          # relabel the old symbol onto the new one
    stitched = (
        pd.concat([pred, current], ignore_index=True)
        .drop_duplicates(subset=["date"], keep="last")   # successor wins any overlap
        .sort_values("date")
        .reset_index(drop=True)
    )
    write_candles(cfg, successor, stitched)
    upsert_manifest_row(
        cfg, manifest_row(successor, stitched, quality_flags(stitched, start, end))
    )

    result = {
        "successor": successor,
        "predecessor": predecessor,
        "action": "stitched",
        "rows_before": len(current),
        "predecessor_rows": len(pred),
        "rows_after": len(stitched),
        "first_date": str(pd.Timestamp(stitched["date"].min()).date()),
    }
    result.update(_seam_report(pred, current))
    logger.info(
        "%s: stitched %s -- +%d rows, now %d (%s..); seam %s ratio=%.3f clean=%s",
        successor, predecessor, len(pred), len(stitched), result["first_date"],
        result["seam"], result["seam_ratio"], result["seam_clean"],
    )
    return result


def deprecate_ticker(cfg: IngestionConfig, ticker: str) -> dict:
    """Retire a ticker from the store.

    Deletes its parquet file, drops its manifest row, and removes it from the
    universe file (when ``cfg.universe_file`` is set). Use when a symbol leaves
    the universe -- e.g. it was reused by a different security and a cleaner
    proxy is tracked instead. Idempotent.
    """
    ticker = ticker.upper()

    path = candle_path(cfg, ticker)
    parquet_removed = path.exists()
    if parquet_removed:
        path.unlink()

    manifest = read_manifest(cfg)
    manifest_row_removed = ticker in set(manifest["ticker"].astype(str))
    if manifest_row_removed:
        kept = manifest[manifest["ticker"].astype(str) != ticker]
        write_manifest(cfg, kept.to_dict("records"))

    universe_removed = False
    if cfg.universe_file and Path(cfg.universe_file).exists():
        universe = cfg.resolve_universe()
        if ticker in universe:
            remaining = [t for t in universe if t != ticker]
            Path(cfg.universe_file).write_text("\n".join(remaining) + "\n")
            universe_removed = True

    logger.info(
        "deprecated %s -- parquet=%s manifest=%s universe=%s",
        ticker, parquet_removed, manifest_row_removed, universe_removed,
    )
    return {
        "ticker": ticker,
        "parquet_removed": parquet_removed,
        "manifest_row_removed": manifest_row_removed,
        "universe_removed": universe_removed,
    }


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Candle-store repair: trim reuse seams / stitch predecessors."
    )
    add_cli_arguments(parser)
    parser.add_argument(
        "--deprecate", action="append", default=[], metavar="TICKER",
        help="retire a ticker from the store + universe (repeatable)",
    )
    parser.add_argument(
        "--trim", action="append", default=[], metavar="TICKER",
        help="trim a reused-symbol ticker to its post-gap segment (repeatable)",
    )
    parser.add_argument(
        "--stitch", action="append", default=[], metavar="NEW=OLD",
        help="prepend predecessor OLD's history to successor NEW (repeatable)",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    cfg = config_from_cli_args(args)
    for ticker in args.deprecate:
        deprecate_ticker(cfg, ticker)
    for ticker in args.trim:
        trim_reused_ticker(cfg, ticker)
    for spec in args.stitch:
        successor, _, predecessor = spec.partition("=")
        if not predecessor:
            parser.error("--stitch expects NEW=OLD, got: " + spec)
        stitch_predecessor(cfg, successor, predecessor)


if __name__ == "__main__":
    main()
