"""``load_candles`` — the read interface for the downstream feature pipeline.

Reads the managed parquet store. The same store serves the 10-year TA-only
baseline (no date slice) and the recent flow-overlap combined model (a recent
``start`` / ``end`` slice) -- one source of truth, two views.

Column names and ``date`` semantics match what the feature pipeline expects:
feed the result straight into ``ta_pipeline.build_dataset``.
"""

from __future__ import annotations

import pandas as pd

from .config import IngestionConfig
from .fetch import CANDLE_COLUMNS
from .store import read_candles


def _slice_dates(df: pd.DataFrame, start, end) -> pd.DataFrame:
    if df.empty:
        return df
    if start is not None:
        df = df[df["date"] >= pd.Timestamp(start)]
    if end is not None:
        df = df[df["date"] <= pd.Timestamp(end)]
    return df.reset_index(drop=True)


def load_candles(ticker: str, start=None, end=None, cfg: IngestionConfig = None):
    """Load one ticker's daily OHLCV from the store, optionally date-sliced.

    Parameters
    ----------
    ticker : str
    start, end : str | datetime-like, optional
        Inclusive date bounds; omit either for an open end.
    cfg : IngestionConfig, optional
        Defaults to ``IngestionConfig()`` (the default store location).
    """
    cfg = cfg or IngestionConfig()
    return _slice_dates(read_candles(cfg, ticker.upper()), start, end)


def load_candles_universe(
    tickers=None, start=None, end=None, cfg: IngestionConfig = None
) -> pd.DataFrame:
    """Load many tickers into one long-format frame, ready for ``build_dataset``.

    ``tickers`` defaults to ``cfg.resolve_universe()``; pass an explicit list to
    load a subset. Tickers absent from the store are skipped.
    """
    cfg = cfg or IngestionConfig()
    if tickers is None:
        tickers = cfg.resolve_universe()
    frames = [
        df for df in (load_candles(t, start, end, cfg) for t in tickers)
        if not df.empty
    ]
    if not frames:
        return pd.DataFrame(columns=CANDLE_COLUMNS)
    return (
        pd.concat(frames, ignore_index=True)
        .sort_values(["ticker", "date"])
        .reset_index(drop=True)
    )
