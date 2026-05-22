"""Predictions table — entry / target / stop assembly and top_entries."""

import numpy as np
import pandas as pd

from ta_pipeline.config import PipelineConfig
from ta_pipeline.model.predictions import build_predictions_table, top_entries


def _matrix_and_preds():
    dates = pd.bdate_range("2022-01-03", periods=20)
    matrix = pd.DataFrame({
        "ticker": "AAA", "date": dates, "close": 100.0, "atr_14": 2.0,
        "label_long_barrier": "profit", "label_long_outcome_return": 0.03,
        "label_long_bars_to_outcome": 4.0,
        "label_short_barrier": "stop", "label_short_outcome_return": -0.02,
        "label_short_bars_to_outcome": 6.0,
    })
    preds = pd.DataFrame({
        "ticker": "AAA", "date": dates, "fold": "oos", "is_oos": True,
        "label_long": 1.0, "p_long": np.linspace(0.1, 0.9, 20),
        "label_short": 0.0, "p_short": 0.3,
    })
    return matrix, preds


def test_entry_target_stop_match_the_label_barriers():
    matrix, preds = _matrix_and_preds()
    cfg = PipelineConfig()                           # profit 1.5 ATR, stop 1.0 ATR
    row = build_predictions_table(preds, matrix, cfg).iloc[0]
    assert row["entry"] == 100.0
    assert row["long_target"] == 100.0 + cfg.label_profit_atr * 2.0     # 103.0
    assert row["long_stop"] == 100.0 - cfg.label_stop_atr * 2.0         # 98.0
    assert row["short_target"] == 100.0 - cfg.label_profit_atr * 2.0    # 97.0
    assert row["short_stop"] == 100.0 + cfg.label_stop_atr * 2.0        # 102.0


def test_top_entries_sorts_by_score():
    matrix, preds = _matrix_and_preds()
    table = build_predictions_table(preds, matrix, PipelineConfig())
    top = top_entries(table, "long", n=5)
    assert len(top) == 5
    assert top["p_long"].is_monotonic_decreasing
    assert top["p_long"].iloc[0] == table["p_long"].max()
