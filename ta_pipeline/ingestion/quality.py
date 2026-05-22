"""Per-ticker data-quality checks for the candle backfill.

The brief is explicit: log quality issues, never silently drop. Every check
returns an advisory flag string; an empty list means the series looks clean.
The flags land in the manifest's ``qc_flags`` column.
"""

from __future__ import annotations

import pandas as pd

# Tunable thresholds.
_SHORT_HISTORY_DAYS = 30      # first bar later than start + this -> IPO'd late
_STALE_DAYS = 10             # last bar earlier than end - this -> possibly delisted
_GAP_TOLERANCE = 0.95        # rows below this * expected trading days -> gaps
_TRADING_DAYS_PER_CAL_DAY = 252.0 / 365.0


def quality_flags(df: pd.DataFrame, requested_start, requested_end) -> list:
    """Return a list of data-quality flags for one ticker's candle frame.

    Flags
    -----
    ``empty``            Polygon returned no bars.
    ``short_history``    First bar well after the requested start -- IPO'd late
                         (expected; the actual start is still recorded).
    ``stale``            Last bar well before the requested end -- possible
                         delisting or ticker-symbol change.
    ``gaps``             Fewer trading days than expected for the date span.
    ``zero_volume_rows`` One or more bars with volume <= 0 (or missing).
    ``zero_price_rows``  One or more bars with an OHLC value <= 0 (or missing).
    """
    if df is None or df.empty:
        return ["empty"]

    flags = []
    start = pd.Timestamp(requested_start)
    end = pd.Timestamp(requested_end)
    first = pd.Timestamp(df["date"].min())
    last = pd.Timestamp(df["date"].max())

    if first > start + pd.Timedelta(days=_SHORT_HISTORY_DAYS):
        flags.append("short_history")
    if last < end - pd.Timedelta(days=_STALE_DAYS):
        flags.append("stale")

    span_days = max((last - first).days, 1)
    expected_rows = span_days * _TRADING_DAYS_PER_CAL_DAY
    if len(df) < _GAP_TOLERANCE * expected_rows:
        flags.append("gaps")

    if (df["volume"].fillna(0) <= 0).any():
        flags.append("zero_volume_rows")
    if (df[["open", "high", "low", "close"]].fillna(0) <= 0).to_numpy().any():
        flags.append("zero_price_rows")

    return flags
