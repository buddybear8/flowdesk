"""§4.5 MA-zone + trend-pullback features.

A ±0.5 ATR zone is drawn around the 50- and 200-day SMAs using the single
consistent ATR(14) -- equal physical width for both. The signed ``touch``
features are trend-filtered by ``trend_stack_state``, so this block must run
after :func:`add_trend_features`.

The brief's §4.5 ``dist_to_50_atr`` / ``dist_to_200_atr`` are identical to
§4.4's ``dist_to_sma50_atr`` / ``dist_to_sma200_atr``; they are emitted once,
by the trend block, rather than shipped as perfectly-collinear duplicates.

Operates on a single ticker.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import PipelineConfig
from .common import bars_since, require_columns

# The brief fixes the zone test to the 50- and 200-day SMAs.
_ZONE_PERIODS = (50, 200)


def _zone_bounds(sma: pd.Series, atr: pd.Series, half_width_atr: float):
    """(upper, lower) bounds of a ±(half_width_atr · ATR) zone around an SMA."""
    pad = half_width_atr * atr
    return sma + pad, sma - pad


def add_zone_features(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add §4.5 MA-zone / pullback features. Assumes :func:`add_trend_features`
    has already run (``trend_stack_state`` must be present)."""
    atr_col = f"atr_{cfg.atr_period}"
    require_columns(
        df,
        [f"sma_{p}" for p in _ZONE_PERIODS]
        + [atr_col, "high", "low", "trend_stack_state"],
        "add_zone_features",
    )
    out = df.copy()
    atr = out[atr_col]
    high, low = out["high"], out["low"]
    state = out["trend_stack_state"]

    for p in _ZONE_PERIODS:
        upper, lower = _zone_bounds(out[f"sma_{p}"], atr, cfg.ma_zone_width_atr)
        out[f"zone_{p}_upper"] = upper
        out[f"zone_{p}_lower"] = lower

        # Bar range overlaps the zone -> captures wicks / pierces.
        in_zone = (low <= upper) & (high >= lower)
        out[f"in_zone_{p}"] = in_zone

        # Trend-filtered: +1 bullish pullback into support within an uptrend,
        # -1 bearish rally into resistance, 0 if in-zone but the trend is
        # tangled (or simply not in the zone).
        touch = pd.Series(
            np.select(
                [in_zone & (state >= 1.0), in_zone & (state <= -1.0)],
                [1.0, -1.0],
                default=0.0,
            ),
            index=out.index,
        )
        out[f"touch_{p}"] = touch
        out[f"bars_since_touch_{p}"] = bars_since(touch != 0)

    return out
