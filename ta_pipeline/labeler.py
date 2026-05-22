"""§5 label layer — mirrored ATR-scaled triple-barrier labels.

For every entry bar t the SAME ATR (pinned to the entry bar, the feature-side
``atr_<period>`` column — never recomputed) defines two mirrored barriers:

* LONG  — profit at ``close + label_profit_atr·ATR``, stop at
  ``close - label_stop_atr·ATR``;
* SHORT — the mirror: profit at ``close - label_profit_atr·ATR``, stop at
  ``close + label_stop_atr·ATR``.

Each is scanned over ``t+1 … t+label_horizon``; first touch wins; a bar that
touches both barriers counts as the stop (pessimistic). If neither barrier is
hit within the horizon the label is the sign of the *trade's* return — the
project's binary-classifier choice.

``label_long`` / ``label_short`` are binary {0, 1}. The ``*_outcome_return``
diagnostics are the trade's directional return (positive = the trade worked,
for both sides — short returns are negated relative to price). The last
``label_horizon`` bars per ticker have no full forward window and are left NaN
unless a barrier is touched within the bars that do exist.

Operates on a single ticker.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import PipelineConfig
from .features.common import require_columns


def _triple_barrier(out: pd.DataFrame, cfg: PipelineConfig, atr_col: str, direction: str):
    """Run one direction's triple barrier on a single ticker's frame.

    Returns ``(label, barrier, bars_to_outcome, outcome_return)`` numpy arrays.
    ``direction`` is ``"long"`` or ``"short"``.
    """
    n = len(out)
    horizon = cfg.label_horizon
    long_side = direction == "long"

    close = out["close"].to_numpy(dtype=float)
    atr = out[atr_col].to_numpy(dtype=float)
    if long_side:
        profit_level = close + cfg.label_profit_atr * atr
        stop_level = close - cfg.label_stop_atr * atr
    else:
        profit_level = close - cfg.label_profit_atr * atr
        stop_level = close + cfg.label_stop_atr * atr

    barrier = np.array(["timeout"] * n, dtype=object)
    bars_to = np.full(n, np.nan)
    resolved = np.zeros(n, dtype=bool)

    # First touch wins: scan forward bar by bar, resolving bars not yet hit.
    for d in range(1, horizon + 1):
        fwd_high = out["high"].shift(-d).to_numpy(dtype=float)
        fwd_low = out["low"].shift(-d).to_numpy(dtype=float)
        if long_side:
            stop_hit = (fwd_low <= stop_level) & ~np.isnan(fwd_low)
            profit_hit = (fwd_high >= profit_level) & ~np.isnan(fwd_high)
        else:
            stop_hit = (fwd_high >= stop_level) & ~np.isnan(fwd_high)
            profit_hit = (fwd_low <= profit_level) & ~np.isnan(fwd_low)
        # A bar touching both barriers is pessimistically counted as the stop.
        profit_hit = profit_hit & ~stop_hit
        new_stop = stop_hit & ~resolved
        new_profit = profit_hit & ~resolved
        barrier[new_stop] = "stop"
        barrier[new_profit] = "profit"
        bars_to[new_stop | new_profit] = d
        resolved |= new_stop | new_profit

    position = np.arange(n)
    has_full_horizon = position <= (n - 1 - horizon)
    timeout = (~resolved) & has_full_horizon
    unlabelable = (~resolved) & ~has_full_horizon
    bars_to[timeout] = horizon
    barrier[unlabelable] = None

    # Trade return at the outcome bar (entry + bars_to), gathered by offset.
    outcome_close = np.full(n, np.nan)
    has_outcome = ~np.isnan(bars_to)
    target = position + np.nan_to_num(bars_to, nan=0.0).astype(int)
    outcome_close[has_outcome] = close[target[has_outcome]]
    price_return = outcome_close / close - 1.0
    outcome_return = price_return if long_side else -price_return

    label = np.full(n, np.nan)
    label[barrier == "profit"] = 1.0
    label[barrier == "stop"] = 0.0
    # outcome_return is the trade's directional return, so the timeout win
    # condition is the same expression for both sides.
    label[timeout] = (outcome_return[timeout] > 0.0).astype(float)

    return label, barrier, bars_to, outcome_return


def add_labels(df: pd.DataFrame, cfg: PipelineConfig) -> pd.DataFrame:
    """Add mirrored long/short triple-barrier labels + diagnostics to one
    ticker's frame.

    For each direction ``d`` in {``long``, ``short``} adds ``label_d`` (0/1,
    NaN if unlabelable), ``label_d_barrier`` (profit/stop/timeout/None),
    ``label_d_bars_to_outcome`` and ``label_d_outcome_return`` (the trade's
    directional return). Also ``terminal_return_<h>`` for each
    ``cfg.terminal_return_horizons``.
    """
    atr_col = f"atr_{cfg.atr_period}"
    require_columns(df, [atr_col, "high", "low", "close"], "add_labels")
    out = df.sort_values("date").reset_index(drop=True).copy()

    for direction in ("long", "short"):
        label, barrier, bars_to, outcome_return = _triple_barrier(
            out, cfg, atr_col, direction
        )
        out[f"label_{direction}"] = label
        out[f"label_{direction}_barrier"] = barrier
        out[f"label_{direction}_bars_to_outcome"] = bars_to
        out[f"label_{direction}_outcome_return"] = outcome_return

    close = out["close"]
    for h in cfg.terminal_return_horizons:
        out[f"terminal_return_{h}"] = close.shift(-h) / close - 1.0

    return out
