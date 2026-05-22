"""§4.1 RSI / momentum features.

``rsi_2`` / ``rsi_7`` / ``rsi_14`` from the indicator layer ARE the raw §4.1
features — continuous, never binned into oversold/overbought. This block adds
the derived self-calibrating percentile and the swing-based divergence signal.

Operates on a single ticker (the master builder groups by ticker).
"""

from __future__ import annotations

import pandas as pd

from ..config import PipelineConfig
from .common import require_columns, trailing_pctile_rank


def _divergence_signal(
    pivot_price: pd.Series,
    pivot_indicator: pd.Series,
    price_dir: int,
    indicator_dir: int,
    sign: float,
) -> pd.Series:
    """One-sided divergence between swing pivot prices and an indicator.

    ``pivot_price`` / ``pivot_indicator`` are sparse Series carrying the pivot's
    price and the indicator's value at that pivot, both placed at the pivot's
    CONFIRMATION bar (NaN elsewhere). At each confirmed swing the change vs the
    *previous* confirmed swing is measured: when price moved in ``price_dir``
    and the indicator moved in ``indicator_dir``, ``sign`` is emitted at that
    confirmation bar. Leakage-safe — only confirmed swings, only past values.
    """
    events = pivot_price.dropna()
    indicator = pivot_indicator.reindex(events.index)
    d_price = events.diff()
    d_indicator = indicator.diff()
    # Comparisons against NaN (the first event) evaluate False -> no signal.
    hit = (d_price * price_dir > 0) & (d_indicator * indicator_dir > 0)
    out = pd.Series(0.0, index=pivot_price.index)
    out.loc[events.index[hit.to_numpy()]] = sign
    return out


def _rsi_divergence(df: pd.DataFrame, cfg: PipelineConfig) -> pd.Series:
    """Signed -1/0/+1 RSI divergence, fired at the second swing's confirmation.

    +1 bullish: price makes a lower low while RSI makes a higher low.
    -1 bearish: price makes a higher high while RSI makes a lower high.
    """
    m = cfg.swing_m
    rsi = df[f"rsi_{cfg.rsi_pctile_period}"]
    is_high = df[f"swing_high_m{m}"].notna()
    is_low = df[f"swing_low_m{m}"].notna()

    # Pivot price and RSI-at-pivot, both shifted to the confirmation bar (p + m).
    high_price = df[f"swing_high_m{m}_conf"]
    low_price = df[f"swing_low_m{m}_conf"]
    high_rsi = rsi.where(is_high).shift(m)
    low_rsi = rsi.where(is_low).shift(m)

    bearish = _divergence_signal(high_price, high_rsi, +1, -1, -1.0)
    bullish = _divergence_signal(low_price, low_rsi, -1, +1, +1.0)
    return (bearish + bullish).clip(-1.0, 1.0)


def add_momentum_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add §4.1 momentum features to one ticker's frame.

    Adds ``rsi_<p>_pctile`` (252-bar trailing percentile of RSI — self-
    calibrating extremeness) and ``rsi_divergence`` (-1/0/+1, confirmed swings
    only). Assumes the indicator and swing layers have already run.
    """
    m = cfg.swing_m
    rsi_col = f"rsi_{cfg.rsi_pctile_period}"
    require_columns(
        df,
        [rsi_col, f"swing_high_m{m}", f"swing_low_m{m}",
         f"swing_high_m{m}_conf", f"swing_low_m{m}_conf"],
        "add_momentum_features",
    )
    out = df.copy()
    out[f"{rsi_col}_pctile"] = trailing_pctile_rank(out[rsi_col], cfg.pctile_window_long)
    out["rsi_divergence"] = _rsi_divergence(out, cfg)
    return out
