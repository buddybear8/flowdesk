"""Walk-forward cross-validation splits for the model layer.

Temporal only — never shuffled. The final ``oos_months`` of the matrix are
reserved as an untouched out-of-sample slice (looked at once, in evaluation).
The development period before it is divided into expanding-window CV folds:
fold k trains on everything before test segment k and tests on segment k.

Between every train block and its test block an embargo of ``embargo_bars``
trading days is purged from the train tail — a training row's label looks
``label_horizon`` days forward, so without the gap the last train rows'
outcomes would fall inside the test period. Keep ``embargo_bars`` at least the
label horizon (the default 10 matches ``PipelineConfig.label_horizon``).

Splits are over the matrix's distinct trading dates, so all tickers' rows for a
given date always move to the same side of a split together.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import ModelConfig


@dataclass(frozen=True)
class Fold:
    """One walk-forward split.

    Date bounds are inclusive; the embargo is already purged from
    ``train_end`` (so ``train_end`` < ``test_start`` with a gap between them).
    """

    name: str
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    is_oos: bool


def make_folds(matrix: pd.DataFrame, cfg: ModelConfig = None) -> list:
    """Build the expanding-window CV folds followed by the reserved OOS fold.

    Returns ``cfg.n_folds`` CV folds (``cv1`` … ``cvN``) then one ``oos`` fold.
    """
    cfg = cfg or ModelConfig()
    dates = np.sort(matrix["date"].unique())
    if len(dates) < cfg.n_folds + 2:
        raise ValueError(
            f"only {len(dates)} distinct dates -- too few for {cfg.n_folds} folds"
        )

    last = pd.Timestamp(dates[-1])
    oos_start = np.datetime64(last - pd.DateOffset(months=cfg.oos_months))
    oos_idx = int(np.searchsorted(dates, oos_start, side="left"))
    if oos_idx <= cfg.n_folds:
        raise ValueError("development period too short for the requested folds")

    folds = []
    # Expanding window: split the dev dates into n_folds+1 equal segments; fold
    # k tests on segment k and trains on segments 0..k-1, minus the embargo.
    bounds = np.linspace(0, oos_idx, cfg.n_folds + 2, dtype=int)
    for k in range(1, cfg.n_folds + 1):
        test_lo, test_hi = int(bounds[k]), int(bounds[k + 1])
        train_end_idx = test_lo - 1 - cfg.embargo_bars
        if train_end_idx < 0:
            raise ValueError(f"embargo leaves CV fold {k} with no training data")
        folds.append(Fold(
            name=f"cv{k}",
            train_start=pd.Timestamp(dates[0]),
            train_end=pd.Timestamp(dates[train_end_idx]),
            test_start=pd.Timestamp(dates[test_lo]),
            test_end=pd.Timestamp(dates[test_hi - 1]),
            is_oos=False,
        ))

    # OOS fold: train on all development data (minus the embargo), test on OOS.
    oos_train_end_idx = oos_idx - 1 - cfg.embargo_bars
    if oos_train_end_idx < 0:
        raise ValueError("embargo leaves the OOS fold with no training data")
    folds.append(Fold(
        name="oos",
        train_start=pd.Timestamp(dates[0]),
        train_end=pd.Timestamp(dates[oos_train_end_idx]),
        test_start=pd.Timestamp(dates[oos_idx]),
        test_end=pd.Timestamp(dates[-1]),
        is_oos=True,
    ))
    return folds


def fold_masks(matrix: pd.DataFrame, fold: Fold):
    """``(train_mask, test_mask)`` boolean Series selecting a fold's rows."""
    d = matrix["date"]
    train = (d >= fold.train_start) & (d <= fold.train_end)
    test = (d >= fold.test_start) & (d <= fold.test_end)
    return train, test
