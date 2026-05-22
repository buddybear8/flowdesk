"""The predictions table — the spot-checkable long/short entry list.

Joins the model's out-of-fold predictions back to the matrix so every
(ticker, date) row carries a concrete trade — entry, target, stop for each
side — alongside the model's calibrated score and **what actually happened**
(barrier hit, realized return, days to outcome). Because it is built on
historical data, each prediction sits next to its true outcome.
"""

from __future__ import annotations

import pandas as pd

from ..config import PipelineConfig


def build_predictions_table(
    predictions: pd.DataFrame,
    matrix: pd.DataFrame,
    pipeline_cfg: PipelineConfig = None,
) -> pd.DataFrame:
    """Assemble the spot-check table from OOF predictions + the feature matrix.

    The ATR-scaled barriers use the same multipliers the labeler used, so
    ``long_target`` / ``long_stop`` (and the short mirror) are the exact trade
    levels each row's label scored.
    """
    pcfg = pipeline_cfg or PipelineConfig()
    atr_col = f"atr_{pcfg.atr_period}"
    carried = [
        "ticker", "date", "close", atr_col,
        "label_long_barrier", "label_long_outcome_return", "label_long_bars_to_outcome",
        "label_short_barrier", "label_short_outcome_return", "label_short_bars_to_outcome",
    ]
    table = predictions.merge(
        matrix[carried], on=["ticker", "date"], how="left", validate="one_to_one"
    )

    entry, atr = table["close"], table[atr_col]
    table["entry"] = entry
    table["long_target"] = entry + pcfg.label_profit_atr * atr
    table["long_stop"] = entry - pcfg.label_stop_atr * atr
    table["short_target"] = entry - pcfg.label_profit_atr * atr
    table["short_stop"] = entry + pcfg.label_stop_atr * atr

    ordered = [
        "ticker", "date", "fold", "is_oos", "entry",
        "p_long", "long_target", "long_stop", "label_long",
        "label_long_barrier", "label_long_outcome_return", "label_long_bars_to_outcome",
        "p_short", "short_target", "short_stop", "label_short",
        "label_short_barrier", "label_short_outcome_return", "label_short_bars_to_outcome",
    ]
    return table[ordered].sort_values(["date", "ticker"]).reset_index(drop=True)


def top_entries(
    table: pd.DataFrame, side: str, n: int = 20, *, oos_only: bool = True
) -> pd.DataFrame:
    """The ``n`` highest-conviction entries for a side (``long`` / ``short``).

    Defaults to the out-of-sample slice — the honest, never-trained-on rows.
    """
    rows = table[table["is_oos"]] if oos_only else table
    return rows.sort_values(f"p_{side}", ascending=False).head(n).reset_index(drop=True)
