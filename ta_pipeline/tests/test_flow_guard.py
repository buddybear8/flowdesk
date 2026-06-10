"""Flow-corpus modelability guard tests.

The flow ablation must refuse to run while the corpus is too short to model
honestly, and clear the guard once it is large enough.
"""

import pandas as pd
import pytest

from ta_pipeline.flow.config import FlowConfig
from ta_pipeline.flow.guard import (
    FlowCorpusTooSmall,
    check_flow_modelable,
    flow_corpus_stats,
)


def _matrix(n_dates: int, flow_rows_per_date: int) -> pd.DataFrame:
    """A joined-style matrix with a controllable number of has_flow rows."""
    dates = pd.bdate_range("2026-01-02", periods=n_dates)
    rows = [
        {"date": d, "has_flow": 1}
        for d in dates for _ in range(flow_rows_per_date)
    ]
    rows += [{"date": d, "has_flow": 0} for d in dates]   # no-flow rows
    return pd.DataFrame(rows)


def test_stats_count_only_labelable_flow_rows():
    stats = flow_corpus_stats(_matrix(5, 10))
    assert stats == {"flow_rows": 50, "flow_dates": 5}


def test_guard_passes_when_corpus_large_enough():
    # 70 dates x 300 rows = 21000 rows -- clears the defaults (60 / 10000).
    assert check_flow_modelable(_matrix(70, 300), FlowConfig()) is True


def test_guard_raises_when_corpus_too_small():
    # Today's situation: a handful of dates, far below threshold.
    with pytest.raises(FlowCorpusTooSmall, match="flow corpus too small"):
        check_flow_modelable(_matrix(10, 50))


def test_guard_non_raising_mode_returns_false():
    assert check_flow_modelable(_matrix(10, 50), raises=False) is False


def test_guard_needs_both_rows_and_dates():
    # Enough rows but too few dates -> still fails.
    cfg = FlowConfig()
    dense_few_dates = _matrix(20, 1000)          # 20000 rows, only 20 dates
    assert check_flow_modelable(dense_few_dates, cfg, raises=False) is False
