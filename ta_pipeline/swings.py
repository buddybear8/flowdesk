"""Swing / pivot detection layer — confirmed swing highs and lows.

A swing high at bar ``p`` is a bar whose high is the maximum of the centered
window ``[p-m, p+m]`` (mirror for lows). Because the window extends m bars to
the *right*, the pivot is not knowable until bar ``p+m`` — its confirmation
bar. This module is built leakage-aware around exactly that fact:

  * ``swing_high_m{m}`` / ``swing_low_m{m}`` mark the raw pivot price at the
    pivot bar. They are CENTERED and therefore future-peeking — for plotting
    and inspection only; never feed them to a model.
  * ``swing_high_m{m}_conf`` / ``swing_low_m{m}_conf`` mark the same price at
    the confirmation bar (``p + m``). Forward-filling these (see
    :func:`last_confirmed_level`) yields the most recent swing knowable as of
    bar t — leakage-safe to consume as a feature input.

Two sensitivities are produced: ``cfg.swing_m`` (default 3, swept) and
``cfg.swing_m_secondary`` (default 5).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import PipelineConfig


def detect_pivots(high: pd.Series, low: pd.Series, m: int):
    """Flag swing-high and swing-low bars for confirmation half-width ``m``.

    Returns ``(is_swing_high, is_swing_low)`` boolean Series. A bar is flagged
    only if it has m real bars on each side (centered window, full
    ``min_periods``), so every flagged pivot is genuinely confirmable within
    the data — the last m bars can never be pivots.

    Ties (two equal extremes inside one window) flag both bars; this is rare in
    real prices and harmless downstream.
    """
    win = 2 * m + 1
    roll_high = high.rolling(win, center=True, min_periods=win).max()
    roll_low = low.rolling(win, center=True, min_periods=win).min()
    return high.eq(roll_high), low.eq(roll_low)


def add_swings(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add raw and confirmation-aligned swing columns at both sensitivities.

    For each m in ``{cfg.swing_m, cfg.swing_m_secondary}`` four columns are
    added:

    * ``swing_high_m{m}`` / ``swing_low_m{m}`` — raw pivot price at the pivot
      bar (centered; inspection only — do NOT feed to a model).
    * ``swing_high_m{m}_conf`` / ``swing_low_m{m}_conf`` — the same price
      shifted to the confirmation bar ``p + m`` (leakage-safe to consume).
    """
    if df.empty:
        return df.copy()
    out = df.sort_values("date").reset_index(drop=True).copy()
    for m in sorted({cfg.swing_m, cfg.swing_m_secondary}):
        is_high, is_low = detect_pivots(out["high"], out["low"], m)
        swing_high = out["high"].where(is_high)
        swing_low = out["low"].where(is_low)
        out[f"swing_high_m{m}"] = swing_high
        out[f"swing_low_m{m}"] = swing_low
        out[f"swing_high_m{m}_conf"] = swing_high.shift(m)
        out[f"swing_low_m{m}_conf"] = swing_low.shift(m)
    return out


def add_swings_universe(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Apply :func:`add_swings` per ticker, in isolation."""
    if df.empty:
        return df.copy()
    parts = [add_swings(g, cfg) for _, g in df.groupby("ticker", sort=False)]
    return pd.concat(parts, ignore_index=True)


def last_confirmed_level(conf_series: pd.Series) -> pd.Series:
    """Most recent confirmed swing price as of each bar t.

    Forward-fills a ``*_conf`` marker column. Leakage-safe: markers exist only
    at confirmation bars (``pivot + m``), so the fill never exposes a future
    pivot.
    """
    return conf_series.ffill()


def bars_since_confirmed(conf_series: pd.Series) -> pd.Series:
    """Bars elapsed since the most recent confirmed swing marker.

    NaN until the first confirmation. Leakage-safe for the same reason as
    :func:`last_confirmed_level`.
    """
    position = pd.Series(
        np.arange(len(conf_series), dtype=float), index=conf_series.index
    )
    seen_at = position.where(conf_series.notna()).ffill()
    return position - seen_at
