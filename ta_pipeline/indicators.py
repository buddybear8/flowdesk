"""Indicator layer — the §3 primitives, computed from daily OHLCV bars.

Thin wrapper: one small function per indicator so the underlying maths is
swappable. The §3 indicators are standard and short, so they are implemented
directly in pandas/numpy rather than via pandas-ta. This buys three things the
brief explicitly asks for:

  * exact, audited Wilder smoothing for ATR / RSI (the brief elevates ATR
    correctness to the system's single most important alignment);
  * a single ``atr_<period>`` column that the triple-barrier labeler reuses
    verbatim — "the SAME ATR everywhere" is then true by construction;
  * no dependency on pandas-ta's numpy-2.0-incompatible release.

Every indicator is strictly trailing: the value at bar t uses only bars <= t.
Compute per ticker — never let one ticker's rolling window cross into another.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import PipelineConfig


def _wilder_rma(series: pd.Series, period: int) -> pd.Series:
    """Wilder's smoothed moving average (RMA).

    Seeds with a simple average of the first ``period`` valid observations,
    then applies the recursive update ``rma_t = (rma_{t-1}*(n-1) + x_t) / n``.
    Strictly trailing — ``rma_t`` depends only on ``x`` at bars <= t.
    """
    arr = series.to_numpy(dtype=float)
    out = np.full(arr.shape, np.nan)
    n = period
    valid = np.flatnonzero(~np.isnan(arr))
    if valid.size < n:
        return pd.Series(out, index=series.index)
    start = int(valid[0])
    seed_end = start + n  # exclusive
    if seed_end > arr.size:
        return pd.Series(out, index=series.index)
    out[seed_end - 1] = np.nanmean(arr[start:seed_end])
    for i in range(seed_end, arr.size):
        prev = out[i - 1]
        out[i] = np.nan if np.isnan(prev) else (prev * (n - 1) + arr[i]) / n
    return pd.Series(out, index=series.index)


def rsi(close: pd.Series, period: int) -> pd.Series:
    """Wilder's RSI over ``period`` bars."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = _wilder_rma(gain, period)
    avg_loss = _wilder_rma(loss, period)
    rs = avg_gain / avg_loss
    out = 100.0 - 100.0 / (1.0 + rs)
    # avg_loss == 0 with gains -> rs = inf -> out already resolves to 100.
    # avg_gain == avg_loss == 0 (a perfectly flat stretch) -> 0/0 = nan -> neutral.
    flat = (avg_gain == 0.0) & (avg_loss == 0.0)
    return out.mask(flat, 50.0)


def sma(close: pd.Series, period: int) -> pd.Series:
    """Simple moving average; no partial windows."""
    return close.rolling(period, min_periods=period).mean()


def bollinger(close: pd.Series, period: int, n_std: float):
    """Bollinger bands. Returns ``(upper, middle, lower)``.

    Uses population standard deviation (ddof=0) — the standard Bollinger
    convention.
    """
    middle = close.rolling(period, min_periods=period).mean()
    sd = close.rolling(period, min_periods=period).std(ddof=0)
    return middle + n_std * sd, middle, middle - n_std * sd


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """Per-bar true range. The first bar (no prior close) falls back to high-low."""
    prev_close = close.shift(1)
    ranges = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    )
    return ranges.max(axis=1)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int) -> pd.Series:
    """Wilder ATR — RMA of true range. The one ATR used by features AND labels."""
    return _wilder_rma(true_range(high, low, close), period)


def compute_indicators(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add the §3 indicator columns to one ticker's OHLCV frame.

    Parameters
    ----------
    df : DataFrame
        A single ticker's bars (``OHLCV_COLUMNS``). Sorted internally by date.
    cfg : PipelineConfig

    Returns
    -------
    DataFrame
        Copy of ``df`` with added columns: ``rsi_<p>`` per RSI period,
        ``bb_upper`` / ``bb_middle`` / ``bb_lower``, ``true_range``,
        ``atr_<period>``, ``sma_<p>`` per SMA period, and
        ``volume_avg_<window>``.
    """
    if df.empty:
        return df.copy()
    out = df.sort_values("date").reset_index(drop=True).copy()
    high, low, close, volume = out["high"], out["low"], out["close"], out["volume"]

    for p in cfg.rsi_periods:
        out[f"rsi_{p}"] = rsi(close, p)

    out["bb_upper"], out["bb_middle"], out["bb_lower"] = bollinger(
        close, cfg.bb_period, cfg.bb_std
    )

    out["true_range"] = true_range(high, low, close)
    out[f"atr_{cfg.atr_period}"] = atr(high, low, close, cfg.atr_period)

    for p in cfg.sma_periods:
        out[f"sma_{p}"] = sma(close, p)

    out[f"volume_avg_{cfg.volume_avg_window}"] = volume.rolling(
        cfg.volume_avg_window, min_periods=cfg.volume_avg_window
    ).mean()

    return out


def compute_indicators_universe(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Apply :func:`compute_indicators` per ticker.

    Each ticker is processed in isolation so no ticker's rolling window can
    cross into another's.
    """
    if df.empty:
        return df.copy()
    parts = [compute_indicators(g, cfg) for _, g in df.groupby("ticker", sort=False)]
    return pd.concat(parts, ignore_index=True)
