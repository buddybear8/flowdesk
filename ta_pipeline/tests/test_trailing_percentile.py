"""§7 trailing-percentile test.

Every ``*_pctile`` feature ranks the current bar within its trailing window
only -- never the full sample, never a partial window.
"""

import numpy as np
import pandas as pd
import pytest

import ta_pipeline as tp
from ta_pipeline.features.common import trailing_pctile_rank

# pctile feature -> the config attribute holding its window length.
_PCTILE_WINDOWS = {
    "rsi_14_pctile": "pctile_window_long",
    "atr_pctile": "pctile_window_long",
    "bb_bandwidth_pctile": "bb_bandwidth_pctile_window",
}


def test_monotone_series_property():
    """A strictly rising series always ranks 1.0 (current bar is the window
    max); a strictly falling one ranks 1/window (always the window min)."""
    rising = pd.Series(np.arange(500, dtype=float))
    assert (trailing_pctile_rank(rising, 60).dropna() == 1.0).all()
    falling = pd.Series(np.arange(500, 0, -1, dtype=float))
    assert np.allclose(trailing_pctile_rank(falling, 60).dropna(), 1.0 / 60)


def test_value_uses_only_the_trailing_window():
    """The rank at t equals the rank recomputed from just bars [t-w+1, t]."""
    s = pd.Series(np.random.default_rng(0).normal(size=500))
    w = 100
    full = trailing_pctile_rank(s, w)
    for t in (150, 300, 480):
        window_only = trailing_pctile_rank(s.iloc[t - w + 1 : t + 1], w)
        assert full.iloc[t] == pytest.approx(window_only.iloc[-1])


def test_no_partial_windows(aaa_untrimmed, cfg):
    """A pctile is NaN until its window is fully populated, then never again."""
    for col, attr in _PCTILE_WINDOWS.items():
        window = getattr(cfg, attr)
        first = aaa_untrimmed[col].first_valid_index()
        assert first is not None and first >= window - 1
        assert aaa_untrimmed[col].iloc[first:].notna().all()


def test_pctile_truncation_invariant(aaa_bars, aaa_untrimmed, cfg):
    """Deleting future bars leaves every past percentile unchanged."""
    trunc = tp.build_dataset(aaa_bars.iloc[:600].copy(), cfg, trim=False)
    for col in _PCTILE_WINDOWS:
        pd.testing.assert_series_equal(
            aaa_untrimmed[col].iloc[:600].reset_index(drop=True),
            trunc[col].reset_index(drop=True),
            check_names=False,
            obj=col,
        )
