"""Walk-forward splitter — temporal ordering, embargo, the reserved OOS slice."""

import numpy as np
import pandas as pd

from ta_pipeline.model import ModelConfig
from ta_pipeline.model.walkforward import fold_masks, make_folds

_LABEL_HORIZON = 10   # PipelineConfig.label_horizon — the embargo must cover it


def _date_frame(n=1500, start="2018-01-02"):
    """A minimal matrix-like frame — make_folds only needs a `date` column."""
    return pd.DataFrame({"date": pd.bdate_range(start, periods=n), "x": 0.0})


def test_fold_count_and_temporal_ordering():
    cfg = ModelConfig()
    folds = make_folds(_date_frame(), cfg)
    assert len(folds) == cfg.n_folds + 1
    assert [f.is_oos for f in folds] == [False] * cfg.n_folds + [True]
    prev_test_end = None
    for f in folds:
        assert f.train_start <= f.train_end < f.test_start <= f.test_end
        if prev_test_end is not None:
            assert f.test_start > prev_test_end      # test blocks march forward
        prev_test_end = f.test_end


def test_embargo_prevents_label_leakage():
    """The last train row's label window (train_end + horizon) must end before
    the test block starts — otherwise a train label peeks into test."""
    cfg = ModelConfig()                              # embargo_bars = 10
    df = _date_frame()
    dates = [pd.Timestamp(d) for d in np.sort(df["date"].unique())]
    pos = {d: i for i, d in enumerate(dates)}
    for f in make_folds(df, cfg):
        assert pos[f.train_end] + _LABEL_HORIZON < pos[f.test_start]


def test_oos_is_the_reserved_final_slice():
    cfg = ModelConfig()
    df = _date_frame()
    oos = make_folds(df, cfg)[-1]
    assert oos.is_oos and oos.name == "oos"
    assert oos.test_end == pd.Timestamp(df["date"].max())
    span_days = (oos.test_end - oos.test_start).days
    assert 320 <= span_days <= 400                   # ~12 months reserved


def test_fold_masks_are_disjoint_and_bounded():
    cfg = ModelConfig()
    df = _date_frame()
    for f in make_folds(df, cfg):
        train, test = fold_masks(df, f)
        assert not (train & test).any()              # train and test disjoint
        assert df.loc[train, "date"].max() <= f.train_end
        assert df.loc[test, "date"].min() >= f.test_start
        assert train.sum() > 0 and test.sum() > 0


def test_runs_on_a_real_built_matrix(aaa_untrimmed):
    folds = make_folds(aaa_untrimmed, ModelConfig(n_folds=3))
    assert len(folds) == 4
    for f in folds:
        train, test = fold_masks(aaa_untrimmed, f)
        assert train.sum() > 0 and test.sum() > 0
