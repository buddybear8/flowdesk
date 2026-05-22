"""Polygon.io daily-aggregate fetch primitive.

One request per ticker: 10 years of daily bars is ~2,520 rows, far under the
50,000-aggregate per-query cap, so no chunking is needed. Split-adjusted by
default -- unadjusted series have artificial gaps at split dates that corrupt
ATR and create fake breakouts and MA crosses.
"""

from __future__ import annotations

import logging
import os
import time

import pandas as pd

logger = logging.getLogger(__name__)

CANDLE_COLUMNS = [
    "ticker", "date", "open", "high", "low", "close",
    "volume", "vwap", "transactions",
]

# Substrings marking a transient error worth retrying (rate limit / 5xx /
# connection). Polygon's SDK raises varied exception types, so match on text.
_TRANSIENT_MARKERS = (
    "429", "too many requests", "rate limit", "exceeded",
    "500", "502", "503", "504", "internal server error",
    "bad gateway", "service unavailable", "gateway timeout",
    "timed out", "timeout", "connection",
)


def get_client(client=None):
    """Return a Polygon RESTClient; reads ``POLYGON_API_KEY`` from the env.

    The SDK is imported lazily so config-only use needs no network dependency.
    """
    if client is not None:
        return client
    api_key = os.environ.get("POLYGON_API_KEY")
    if not api_key:
        raise RuntimeError(
            "POLYGON_API_KEY is not set. Export your Polygon.io API key:\n"
            "    export POLYGON_API_KEY=your_key_here"
        )
    from polygon import RESTClient

    return RESTClient(api_key)


def _is_transient(exc: Exception) -> bool:
    return any(marker in str(exc).lower() for marker in _TRANSIENT_MARKERS)


def aggs_to_frame(ticker: str, aggs) -> pd.DataFrame:
    """Normalize Polygon Agg objects to a tidy, sorted, deduped candle frame.

    No rows are dropped here -- zero-volume / zero-price bars are kept and
    flagged later by the backfill's quality checks (brief §2.5).
    """
    rows = [
        {
            "ticker": ticker.upper(),
            # Polygon daily-bar timestamps are Unix ms at midnight ET; ET is
            # behind UTC, so normalizing the UTC instant yields the trading date.
            "date": pd.Timestamp(a.timestamp, unit="ms").normalize(),
            "open": a.open,
            "high": a.high,
            "low": a.low,
            "close": a.close,
            "volume": a.volume,
            "vwap": getattr(a, "vwap", None),
            "transactions": getattr(a, "transactions", None),
        }
        for a in aggs
    ]
    df = pd.DataFrame(rows, columns=CANDLE_COLUMNS)
    if df.empty:
        return df
    return (
        df.drop_duplicates(subset=["date"], keep="last")
        .sort_values("date")
        .reset_index(drop=True)
    )


def fetch_daily_bars(
    ticker: str,
    start: str,
    end: str,
    *,
    adjusted: bool = True,
    max_retries: int = 5,
    backoff_seconds: float = 1.0,
    client=None,
) -> pd.DataFrame:
    """Fetch one ticker's daily OHLCV bars for ``[start, end]`` in a single call.

    Transient errors (429 / 5xx / connection) are retried with exponential
    backoff; other errors are raised at once. Returns a tidy frame with
    :data:`CANDLE_COLUMNS`, sorted ascending by date.
    """
    client = get_client(client)
    delay = backoff_seconds
    for attempt in range(1, max_retries + 1):
        try:
            aggs = list(
                client.list_aggs(
                    ticker, 1, "day", start, end,
                    adjusted=adjusted, sort="asc", limit=50000,
                )
            )
            return aggs_to_frame(ticker, aggs)
        except Exception as exc:  # noqa: BLE001 - SDK raises varied exception types
            if attempt == max_retries or not _is_transient(exc):
                raise
            logger.warning(
                "Transient error on %s (attempt %d/%d): %s; retry in %.1fs",
                ticker, attempt, max_retries, exc, delay,
            )
            time.sleep(delay)
            delay *= 2
    return pd.DataFrame(columns=CANDLE_COLUMNS)  # unreachable
