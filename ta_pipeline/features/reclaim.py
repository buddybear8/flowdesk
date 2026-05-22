"""§4.6 False breakdown / false breakout — the 2-close reclaim signal.

A confirmed prior swing level is breached intrabar, then reclaimed by two
consecutive closes back across it. ``swing_reclaim`` fires +1 (false
breakdown, bullish) or -1 (false breakout, bearish) on the SECOND reclaiming
close.

Built on CONFIRMED swing levels only (:func:`last_confirmed_level`), so the
level never leaks a future pivot; every input is at bar <= t. The raw signal
is kept pure -- ``trend_aligned_reclaim`` is the only trend-filtered, derived
column.

Operates on a single ticker.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import PipelineConfig
from ..swings import bars_since_confirmed, last_confirmed_level
from .common import bars_since, require_columns


def add_reclaim_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add §4.6 reclaim features to one ticker's frame.

    Assumes the indicator, swing and trend layers have already run.
    """
    m = cfg.swing_m
    atr_col = f"atr_{cfg.atr_period}"
    require_columns(
        df,
        [atr_col, "high", "low", "close", "trend_stack_state",
         f"swing_low_m{m}_conf", f"swing_high_m{m}_conf"],
        "add_reclaim_features",
    )
    out = df.copy()
    close, atr = out["close"], out[atr_col]
    n, w = cfg.breach_recency_N, cfg.reclaim_lookback_W
    pen_min, pen_max = cfg.breach_penetration_min_atr, cfg.breach_penetration_max_atr

    # --- confirmed swing levels as of bar t, dropped once older than W ----
    # The pivot precedes its confirmation by m bars, so pivot age = bars since
    # confirmation + m.
    low_conf = out[f"swing_low_m{m}_conf"]
    high_conf = out[f"swing_high_m{m}_conf"]
    low_level = last_confirmed_level(low_conf).where(
        bars_since_confirmed(low_conf) + m <= w
    )
    high_level = last_confirmed_level(high_conf).where(
        bars_since_confirmed(high_conf) + m <= w
    )

    # --- deepest intrabar excursion over the last N bars -----------------
    min_low_n = out["low"].rolling(n, min_periods=n).min()
    max_high_n = out["high"].rolling(n, min_periods=n).max()

    # --- false breakdown (+1): breached below L, two closes back above ----
    # close.shift(2) <= L pins this to the SECOND reclaiming close (t-1 was
    # the first). penetration in [min, max] ATR keeps shallow noise and deep
    # real breakdowns out.
    pen_down = (low_level - min_low_n) / atr
    fired_down = (
        (pen_down >= pen_min) & (pen_down <= pen_max)
        & (close > low_level)
        & (close.shift(1) > low_level)
        & (close.shift(2) <= low_level)
        & low_level.notna()
    )

    # --- false breakout (-1): breached above H, two closes back below -----
    pen_up = (max_high_n - high_level) / atr
    fired_up = (
        (pen_up >= pen_min) & (pen_up <= pen_max)
        & (close < high_level)
        & (close.shift(1) < high_level)
        & (close.shift(2) >= high_level)
        & high_level.notna()
    )

    signal = pd.Series(0.0, index=out.index)
    signal[fired_down] = 1.0
    signal[fired_up] = -1.0
    out["swing_reclaim"] = signal

    # --- continuous companions ------------------------------------------
    penetration = pd.Series(0.0, index=out.index)
    penetration[fired_down] = pen_down[fired_down]
    penetration[fired_up] = pen_up[fired_up]
    out["reclaim_penetration_atr"] = penetration

    out["bars_since_reclaim"] = bars_since(signal != 0)

    # Distance of the current close from the most recent reclaim level.
    level_at_event = pd.Series(np.nan, index=out.index)
    level_at_event[fired_down] = low_level[fired_down]
    level_at_event[fired_up] = high_level[fired_up]
    out["reclaim_level_dist_atr"] = (close - level_at_event.ffill()) / atr

    # --- derived trend-aligned interaction (raw signal kept pure above) --
    state = out["trend_stack_state"]
    aligned = pd.Series(0.0, index=out.index)
    aligned[(signal == 1.0) & (state >= 1.0)] = 1.0
    aligned[(signal == -1.0) & (state <= -1.0)] = -1.0
    out["trend_aligned_reclaim"] = aligned

    return out
