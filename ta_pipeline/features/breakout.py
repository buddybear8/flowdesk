"""§4.7 Consolidation breakout — range squeeze followed by expansion.

Compression is detected over the K bars ending at the PRIOR bar: tight
Bollinger bandwidth and/or a short ATR-normalized channel, AND price 'stayed
inside' -- defined (per project decision) as: the channel set by the EARLY
part of the window is escaped by at most ``consolidation_max_closes_outside``
later closes. A trend escapes its early channel; a range respects it.

``range_breakout`` fires +1/-1 when the current close clears the prior K-bar
range (which excludes the current bar) with volatility expansion. The raw
signal is kept pure -- pair it with ``trend_stack_state`` in the model.

Operates on a single ticker.
"""

from __future__ import annotations

import pandas as pd

from ..config import PipelineConfig
from .common import bars_since, require_columns


def _run_length(flag: pd.Series) -> pd.Series:
    """Length of the consecutive run of True ending at each bar (0 where False).

    Backward-looking: the value at t depends only on the current run, i.e. on
    bars <= t.
    """
    f = flag.astype(int)
    groups = (f != f.shift()).cumsum()
    return f * (f.groupby(groups).cumcount() + 1)


def _escaped_early_channel(
    high: pd.Series, low: pd.Series, close: pd.Series, k: int, anchor_frac: float
) -> pd.Series:
    """Count of late-window closes that escaped the early sub-channel.

    For the K-bar window ending at the prior bar, the first ``h = round(k·frac)``
    bars define a channel ``[min_low, max_high]``; each of the remaining
    ``k - h`` bars is counted when its close finished outside that channel.
    Returns a Series aligned so bar t describes the window ``[t-k, t-1]``; NaN
    until the window is fully formed.
    """
    h = max(1, min(k - 1, int(round(k * anchor_frac))))
    late = k - h
    channel_hi = high.rolling(h, min_periods=h).max().shift(k - h + 1)
    channel_lo = low.rolling(h, min_periods=h).min().shift(k - h + 1)
    escaped = pd.Series(0.0, index=close.index)
    for d in range(1, late + 1):
        c = close.shift(d)
        escaped = escaped + ((c > channel_hi) | (c < channel_lo)).astype(float)
    return escaped.where(channel_hi.notna())


def add_breakout_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add §4.7 consolidation-breakout features to one ticker's frame.

    Assumes the indicator layer and the §4.2 Bollinger features have run.
    """
    k = cfg.consolidation_K
    atr_col = f"atr_{cfg.atr_period}"
    vol_avg_col = f"volume_avg_{cfg.volume_avg_window}"
    require_columns(
        df,
        [atr_col, "high", "low", "close", "volume", vol_avg_col,
         "bb_bandwidth", "bb_bandwidth_pctile"],
        "add_breakout_features",
    )
    out = df.copy()
    high, low, close = out["high"], out["low"], out["close"]
    atr, bandwidth = out[atr_col], out["bb_bandwidth"]
    bw_pctile = out["bb_bandwidth_pctile"]

    # --- prior K-bar range (excludes the current bar) -------------------
    range_high = high.rolling(k, min_periods=k).max().shift(1)
    range_low = low.rolling(k, min_periods=k).min().shift(1)

    # --- compression, evaluated as of the prior bar --------------------
    bw_tight = bw_pctile.shift(1) <= (cfg.bb_squeeze_pctile_q / 100.0)
    chan_tight = ((range_high - range_low) / atr.shift(1)) < cfg.channel_tightness_c
    escaped = _escaped_early_channel(high, low, close, k, cfg.consolidation_anchor_frac)
    stayed_inside = escaped <= cfg.consolidation_max_closes_outside
    window_valid = range_high.notna() & escaped.notna()
    compression = (bw_tight | chan_tight) & stayed_inside & window_valid

    # --- expansion confirmation on the breakout bar --------------------
    expanding = (bandwidth > bandwidth.shift(1)) | (atr > atr.shift(1))
    if cfg.breakout_require_volume:
        expanding = expanding & (
            out["volume"] > cfg.volume_confirm_mult * out[vol_avg_col]
        )

    # --- range_breakout signal -----------------------------------------
    signal = pd.Series(0.0, index=out.index)
    signal[compression & (close > range_high) & expanding] = 1.0
    signal[compression & (close < range_low) & expanding] = -1.0
    out["range_breakout"] = signal

    # --- continuous companions -----------------------------------------
    out["squeeze_intensity"] = 1.0 - bw_pctile            # higher = tighter squeeze
    out["squeeze_duration"] = _run_length(compression).astype(float)

    above, below = close > range_high, close < range_low
    strength = pd.Series(0.0, index=out.index)
    strength[above] = ((close - range_high) / atr)[above]
    strength[below] = ((close - range_low) / atr)[below]
    out["breakout_strength_atr"] = strength

    out["bars_since_breakout"] = bars_since(signal != 0)

    return out
