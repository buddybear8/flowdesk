"""Leakage + correctness tests for the squeeze -> expansion pattern detector.

The truncation test is the load-bearing one (copies the
``test_leakage_alignment.py`` pattern): events computed on ``history[:t]``
must be identical to events computed on the full history then sliced.
"""

import numpy as np
import pandas as pd
import pytest

from ta_pipeline.patterns.squeeze_expansion import (
    VARIANTS,
    detect,
    detect_universe,
    weekly_trend_state,
)


def _squeeze_then_jump(direction=1, n_pre=220, n_flat=30, seed=7):
    """Deterministic fixture: volatile prelude -> tight flat squeeze -> one
    large expansion bar in ``direction``. Returns (df, jump_index)."""
    rng = np.random.default_rng(seed)
    pre = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.02, n_pre)))
    base = pre[-1]
    flat = np.full(n_flat, base)
    jump = base * (1.0 + 0.06 * direction)
    close = np.concatenate([pre, flat, [jump]])
    n = len(close)
    high = close * (1.0 + np.abs(rng.normal(0, 0.012, n)))
    low = close * (1.0 - np.abs(rng.normal(0, 0.012, n)))
    # Make the squeeze genuinely tight: ranges collapse during the flat block.
    sl = slice(n_pre, n_pre + n_flat)
    high[sl] = flat * 1.001
    low[sl] = flat * 0.999
    # The jump bar's range spans from the old base to the new price.
    if direction > 0:
        high[-1], low[-1] = jump * 1.001, base * 0.999
    else:
        high[-1], low[-1] = base * 1.001, jump * 0.999
    return (
        pd.DataFrame({
            "ticker": "SQZ",
            "date": pd.bdate_range("2019-01-02", periods=n),
            "open": close,
            "high": high,
            "low": low,
            "close": close,
            "volume": np.full(n, 2e6),
            "vwap": close,
        }),
        n - 1,
    )


@pytest.mark.parametrize("variant", sorted(VARIANTS))
def test_events_are_truncation_invariant(aaa_bars, variant):
    """Every detector column at bars <= cut is identical when bars > cut are
    deleted -- proof of no forward dependence (incl. the weekly HTF state)."""
    full = detect(aaa_bars, variant=variant)
    for cut in (400, 600, 760):
        trunc = detect(
            aaa_bars.iloc[:cut].reset_index(drop=True), variant=variant
        )
        for col in full.columns:
            pd.testing.assert_series_equal(
                full[col].iloc[:cut].reset_index(drop=True),
                trunc[col].reset_index(drop=True),
                check_names=False,
                obj=f"{col} @ cut={cut} [{variant}]",
            )


@pytest.mark.parametrize("variant", sorted(VARIANTS))
def test_events_are_sparse(aaa_bars, variant):
    """A random walk should fire rarely -- this is a selective setup."""
    ev = detect(aaa_bars, variant=variant)
    any_event = ev["event_long"] | ev["event_short"]
    assert any_event.mean() < 0.05
    # Never both directions on the same bar.
    assert not (ev["event_long"] & ev["event_short"]).any()


def test_no_event_during_warmup(aaa_bars):
    """The 126-bar bandwidth-percentile window gates every variant: nothing
    can fire while the squeeze measure is still half-formed."""
    for variant in VARIANTS:
        ev = detect(aaa_bars, variant=variant)
        head = ev.iloc[:140]
        assert not head["event_long"].any()
        assert not head["event_short"].any()


def test_synthetic_squeeze_breakout_fires_long():
    df, jump = _squeeze_then_jump(direction=1)
    ev = detect(df, variant="bb_squeeze")
    assert bool(ev["event_long"].iloc[jump])
    assert not bool(ev["event_short"].iloc[jump])
    assert ev["strength"].iloc[jump] > 0
    # Nothing fires inside the flat squeeze itself.
    flat = ev.iloc[jump - 25: jump]
    assert not (flat["event_long"] | flat["event_short"]).any()


def test_synthetic_squeeze_breakdown_fires_short():
    df, jump = _squeeze_then_jump(direction=-1)
    ev = detect(df, variant="bb_squeeze")
    assert bool(ev["event_short"].iloc[jump])
    assert not bool(ev["event_long"].iloc[jump])
    assert ev["strength"].iloc[jump] > 0


def test_event_is_first_expansion_bar_only():
    """Two consecutive up bars out of the squeeze: only the first fires."""
    df, jump = _squeeze_then_jump(direction=1)
    extra = df.iloc[[jump]].copy()
    extra["date"] = df["date"].iloc[jump] + pd.tseries.offsets.BDay(1)
    for col in ("open", "high", "low", "close", "vwap"):
        extra[col] = extra[col] * 1.05
    df2 = pd.concat([df, extra], ignore_index=True)
    ev = detect(df2, variant="bb_squeeze")
    assert bool(ev["event_long"].iloc[jump])
    assert not bool(ev["event_long"].iloc[jump + 1])


def test_htf_trend_constant_within_week_and_warmup_zero(aaa_bars):
    """The weekly state never changes mid-week (it is the PRIOR completed
    week's state) and is 0 until the weekly SMA stack is formed."""
    state = weekly_trend_state(aaa_bars["date"], aaa_bars["close"])
    weeks = aaa_bars["date"].dt.to_period("W-FRI")
    per_week = state.groupby(weeks.to_numpy()).nunique()
    assert (per_week == 1).all()
    # < 20 completed weeks -> no signal yet.
    assert (state.iloc[:95] == 0.0).all()
    assert set(np.unique(state)) <= {-1.0, 0.0, 1.0}


def test_htf_trend_ignores_current_partial_week(aaa_bars):
    """Truncating mid-week leaves every prior day's state unchanged -- a
    day's HTF state never reads its own (still-forming) week."""
    full = weekly_trend_state(aaa_bars["date"], aaa_bars["close"])
    cut = 703  # an arbitrary mid-series cut, generally mid-week
    part = aaa_bars.iloc[:cut]
    trunc = weekly_trend_state(part["date"], part["close"])
    pd.testing.assert_series_equal(
        full.iloc[:cut].reset_index(drop=True),
        trunc.reset_index(drop=True),
        check_names=False,
    )


def test_no_cross_ticker_leakage(make_ohlcv):
    """A ticker's events are identical computed alone vs. in a universe."""
    aaa = make_ohlcv("AAA", seed=1, n=600)
    bbb = make_ohlcv("BBB", seed=2, n=600)
    solo = detect(aaa)
    combined = detect_universe(pd.concat([aaa, bbb], ignore_index=True))
    combined_aaa = combined[combined["ticker"] == "AAA"].reset_index(drop=True)
    for col in solo.columns:
        pd.testing.assert_series_equal(
            solo[col].reset_index(drop=True),
            combined_aaa[col],
            check_names=False,
            obj=col,
        )
