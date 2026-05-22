"""Shared, leakage-critical primitives for the feature blocks (§4)."""

from __future__ import annotations

import numpy as np
import pandas as pd


def trailing_pctile_rank(series: pd.Series, window: int) -> pd.Series:
    """Trailing percentile rank of the current bar within its own window.

    At bar t the value is ranked against the trailing window
    ``[t-window+1, t]`` (inclusive of t) and normalized to ``[0, 1]``. This is
    the foundation of every ``*_pctile`` feature and the basis of the §7
    trailing-percentile leakage test.

    ``min_periods=window`` — a partial / half-formed window yields NaN rather
    than a misleading percentile. Strictly trailing: never the full sample,
    never future bars.
    """
    return series.rolling(window, min_periods=window).rank(pct=True)


def normalized_slope(series: pd.Series, lookback: int, denom) -> pd.Series:
    """Signed change in ``series`` over ``lookback`` bars, divided by ``denom``.

    ``denom`` (a scalar or an aligned Series) makes the slope cross-ticker
    comparable. Strictly trailing — the value at t uses ``series[t]`` and
    ``series[t-lookback]`` only.
    """
    return (series - series.shift(lookback)) / denom


def bars_since(events: pd.Series) -> pd.Series:
    """Bars elapsed since ``events`` (a boolean Series) was last True.

    0 on an event bar, incrementing thereafter, NaN until the first event.
    Strictly backward-looking — depends only on bars <= t.
    """
    position = pd.Series(np.arange(len(events), dtype=float), index=events.index)
    return position - position.where(events).ffill()


def require_columns(df: pd.DataFrame, columns, block: str) -> None:
    """Raise a clear error if a feature block's prerequisite columns are absent."""
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise KeyError(
            f"{block}: missing required columns {missing}. "
            "Run compute_indicators() and add_swings() before the feature blocks."
        )
