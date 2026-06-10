"""Leakage + correctness tests for the ``divergence_gap`` pattern family.

The truncation test mirrors ``test_leakage_alignment.py``: every detector
output at bars <= cut must be byte-identical when bars > cut are deleted —
an event dated t may use only data through t's close. The same invariance
covers the weekly HTF state (days in week w carry week w-1's completed
state, so a mid-week cut changes nothing earlier).
"""

import numpy as np
import pandas as pd

import ta_pipeline as tp
from ta_pipeline.patterns.divergence_gap import (
    detect_gap,
    detect_rsi_divergence,
    make_detectors,
    weekly_trend_state,
)


def test_detectors_truncation_invariant(aaa_bars):
    """Events / strength / htf_state at bars <= cut are unchanged when bars
    > cut are deleted -- proof of no forward dependence."""
    for name, detect in make_detectors().items():
        full = detect(aaa_bars)
        for cut in (397, 600, 763):           # deliberately mid-week cuts too
            trunc = detect(aaa_bars.iloc[:cut].copy())
            for col in full.columns:
                pd.testing.assert_series_equal(
                    full[col].iloc[:cut].reset_index(drop=True),
                    trunc[col].reset_index(drop=True),
                    check_names=False,
                    obj=f"{name}.{col} @ cut={cut}",
                )


def test_divergence_matches_pipeline_feature(aaa_bars, aaa_untrimmed, cfg):
    """At the pipeline's own parameters (m=3, RSI 14) the detector must agree
    with the audited ``rsi_divergence`` feature: matrix +1 == bullish-only
    bars, matrix -1 == bearish-only bars (the matrix sums and clips, so a
    same-bar double fire would read 0 there)."""
    det = detect_rsi_divergence(
        aaa_bars, m=cfg.swing_m, rsi_period=cfg.rsi_pctile_period
    )
    long_only = det["event_long"] & ~det["event_short"]
    short_only = det["event_short"] & ~det["event_long"]
    assert long_only.sum() > 0 and short_only.sum() > 0
    np.testing.assert_array_equal(
        long_only.to_numpy(), (aaa_untrimmed["rsi_divergence"] == 1.0).to_numpy()
    )
    np.testing.assert_array_equal(
        short_only.to_numpy(), (aaa_untrimmed["rsi_divergence"] == -1.0).to_numpy()
    )


def test_extreme_filter_is_a_subset(aaa_bars):
    """The RSI-extremity gate may only remove events, never add them."""
    plain = detect_rsi_divergence(aaa_bars, m=3)
    gated = detect_rsi_divergence(aaa_bars, m=3, extreme_rsi=40.0)
    assert not (gated["event_long"] & ~plain["event_long"]).any()
    assert not (gated["event_short"] & ~plain["event_short"]).any()
    assert gated["event_long"].sum() <= plain["event_long"].sum()


def test_gap_go_and_fade_fire_correctly(make_ohlcv):
    """Engineered >=1-ATR gaps resolve into the right sub-family and side."""
    bars = make_ohlcv("GAP", seed=7, n=300).reset_index(drop=True)
    # ~10% gaps vs an ATR of a few percent -> comfortably >= 1 ATR.
    def inject(i, gap_mult, close_mult):
        prev_close = bars.loc[i - 1, "close"]
        op = prev_close * gap_mult
        cl = op * close_mult
        bars.loc[i, "open"] = op
        bars.loc[i, "close"] = cl
        bars.loc[i, "high"] = max(op, cl) * 1.002
        bars.loc[i, "low"] = min(op, cl) * 0.998

    inject(100, 1.10, 1.02)   # gap up, strong close   -> go long
    inject(150, 1.10, 0.97)   # gap up, weak close     -> fade short
    inject(200, 0.90, 1.02)   # gap down, strong close -> fade long
    inject(250, 0.90, 0.97)   # gap down, weak close   -> go short

    go = detect_gap(bars, mode="go", gap_min_atr=1.0)
    fade = detect_gap(bars, mode="fade", gap_min_atr=1.0)

    assert go.loc[100, "event_long"] and not fade.loc[100, ["event_long", "event_short"]].any()
    assert fade.loc[150, "event_short"] and not go.loc[150, ["event_long", "event_short"]].any()
    assert fade.loc[200, "event_long"] and not go.loc[200, ["event_long", "event_short"]].any()
    assert go.loc[250, "event_short"] and not fade.loc[250, ["event_long", "event_short"]].any()
    # strength carries the gap size in ATR units
    assert go.loc[100, "strength"] >= 1.0
    assert go.loc[100, "strength"] == abs(go.loc[100, "gap_atr"])


def test_events_are_sparse(aaa_bars):
    """Genuinely selective setups: every detector fires on well under 10% of
    bars of a plain random walk, and never long and short on the same bar
    for the gap detectors (go/fade partition gap days)."""
    n = len(aaa_bars)
    for name, detect in make_detectors().items():
        out = detect(aaa_bars)
        fired = out["event_long"] | out["event_short"]
        assert fired.sum() < 0.10 * n, f"{name} fires on {fired.mean():.1%} of bars"
        if name.startswith("gap"):
            assert not (out["event_long"] & out["event_short"]).any()


def test_weekly_trend_state_semantics(make_ohlcv):
    """A persistent uptrend reads +1, a downtrend -1; early bars (before 20
    completed weeks) are NaN; and the state only uses PRIOR completed weeks."""
    up = make_ohlcv("UP", seed=3, n=420, drift=0.004)
    dn = make_ohlcv("DN", seed=4, n=420, drift=-0.004)
    s_up = weekly_trend_state(up)
    s_dn = weekly_trend_state(dn)
    assert s_up.iloc[:60].isna().all()          # < 20 completed weeks + 1 shift
    assert (s_up.iloc[-60:] == 1.0).all()
    assert (s_dn.iloc[-60:] == -1.0).all()

    # Days of the LAST (possibly partial) week must carry the prior week's
    # state: replaying with the final week's bars removed leaves every
    # remaining day's state unchanged.
    last_week = up["date"].dt.to_period("W-FRI").iloc[-1]
    prefix = up[up["date"].dt.to_period("W-FRI") < last_week].reset_index(drop=True)
    pd.testing.assert_series_equal(
        weekly_trend_state(prefix),
        s_up.iloc[: len(prefix)].reset_index(drop=True),
        check_names=False,
    )


def test_detector_requires_sorted_single_ticker(aaa_bars):
    shuffled = aaa_bars.sample(frac=1.0, random_state=0)
    for detect in (detect_rsi_divergence, detect_gap):
        try:
            detect(shuffled)
        except ValueError:
            continue
        raise AssertionError("unsorted input must be rejected")
