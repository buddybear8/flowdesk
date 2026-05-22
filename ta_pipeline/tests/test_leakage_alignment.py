"""§7 alignment / leakage test.

A feature at bar t must not depend on any bar > t, and one ticker must never
leak into another.
"""

import pandas as pd

import ta_pipeline as tp
from helpers import feature_columns


def test_features_are_truncation_invariant(aaa_bars, aaa_untrimmed, cfg):
    """Every feature at bars <= cut is byte-identical when bars > cut are
    deleted -- proof of no forward dependence."""
    cols = feature_columns(aaa_untrimmed)
    for cut in (400, 600, 760):
        trunc = tp.build_dataset(aaa_bars.iloc[:cut].copy(), cfg, trim=False)
        for col in cols:
            pd.testing.assert_series_equal(
                aaa_untrimmed[col].iloc[:cut].reset_index(drop=True),
                trunc[col].reset_index(drop=True),
                check_names=False,
                obj=f"{col} @ cut={cut}",
            )


def test_raw_swing_pivots_depend_on_future_bars(aaa_bars, cfg):
    """The raw (centered) swing markers DO depend on future bars -- which is
    exactly why they are inspection-only and excluded from the feature set."""
    m = cfg.swing_m
    raw = f"swing_high_m{m}"
    full = tp.add_swings(tp.compute_indicators(aaa_bars, cfg), cfg)
    pivots = full.index[full[raw].notna()]
    assert len(pivots) > 0
    # Ending the series ON a pivot bar removes the m future bars it needs, so
    # the pivot can no longer be detected.
    p = int(pivots[len(pivots) // 2])
    trunc = tp.add_swings(
        tp.compute_indicators(aaa_bars.iloc[: p + 1].copy(), cfg), cfg
    )
    assert pd.isna(trunc[raw].iloc[p])


def test_no_cross_ticker_leakage(make_ohlcv, cfg):
    """A ticker's features are identical computed alone vs. alongside another."""
    aaa = make_ohlcv("AAA", seed=1, n=600)
    bbb = make_ohlcv("BBB", seed=2, n=600)
    solo = tp.build_dataset(aaa, cfg, trim=False)
    combined = tp.build_dataset(
        pd.concat([aaa, bbb], ignore_index=True), cfg, trim=False
    )
    combined_aaa = combined[combined["ticker"] == "AAA"].reset_index(drop=True)
    for col in feature_columns(solo, include_raw_swing=True):
        pd.testing.assert_series_equal(
            solo[col], combined_aaa[col], check_names=False, obj=col
        )
