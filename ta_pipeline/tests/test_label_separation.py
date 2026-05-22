"""§7 label-feature separation test.

Features read only bars <= t; the label outcome reads only bars in
(t, t+horizon]. The two windows never overlap.
"""

import pandas as pd

import ta_pipeline as tp

_RECLAIM_BREAKOUT = [
    "swing_reclaim", "reclaim_penetration_atr", "bars_since_reclaim",
    "reclaim_level_dist_atr", "trend_aligned_reclaim", "range_breakout",
    "squeeze_intensity", "squeeze_duration", "breakout_strength_atr",
    "bars_since_breakout",
]


def test_reclaim_breakout_windows_do_not_reach_the_future(aaa_bars, aaa_untrimmed, cfg):
    """The reclaim N+2 window and the breakout K window are strictly backward,
    so they cannot overlap the label's forward horizon."""
    trunc = tp.build_dataset(aaa_bars.iloc[:700].copy(), cfg, trim=False)
    for col in _RECLAIM_BREAKOUT:
        pd.testing.assert_series_equal(
            aaa_untrimmed[col].iloc[:700].reset_index(drop=True),
            trunc[col].reset_index(drop=True),
            check_names=False,
            obj=col,
        )


def test_label_never_reads_beyond_its_horizon(aaa_bars, aaa_untrimmed, cfg):
    """A bar whose full forward horizon fits inside a cut keeps its label when
    every later bar is deleted -- the label looks no further than t+horizon."""
    cut = 700
    trunc = tp.build_dataset(aaa_bars.iloc[:cut].copy(), cfg, trim=False)
    last = cut - 1 - cfg.label_horizon
    for col in ("label_long", "label_short"):
        pd.testing.assert_series_equal(
            aaa_untrimmed[col].iloc[: last + 1].reset_index(drop=True),
            trunc[col].iloc[: last + 1].reset_index(drop=True),
            check_names=False, obj=col,
        )
