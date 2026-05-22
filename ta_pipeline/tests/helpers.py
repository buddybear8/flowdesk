"""Shared helpers for the test suite."""

_BASE_COLUMNS = {
    "ticker", "date", "open", "high", "low", "close", "volume", "vwap",
    "transactions",
}
_NON_FEATURE_PREFIXES = ("label", "terminal_return", "is_")


def feature_columns(df, include_raw_swing: bool = False):
    """Model-facing feature columns of a built dataset.

    Excludes raw OHLCV, the label / diagnostic columns and the validity flags.
    The raw (centered) swing-marker columns are excluded by default: they are
    documented inspection-only and are intentionally future-peeking. Pass
    ``include_raw_swing=True`` to include them (e.g. for the cross-ticker
    isolation test, which they must still pass).
    """
    cols = []
    for c in df.columns:
        if c in _BASE_COLUMNS or c.startswith(_NON_FEATURE_PREFIXES):
            continue
        is_raw_swing = c.startswith("swing_") and not c.endswith("_conf")
        if is_raw_swing and not include_raw_swing:
            continue
        cols.append(c)
    return cols
