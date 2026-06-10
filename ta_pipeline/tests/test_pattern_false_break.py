"""Leakage + correctness tests for the ``false_break`` pattern family.

Mirrors the §7 alignment-test pattern (test_leakage_alignment.py): an event
dated bar t must be byte-identical when bars > t are deleted, the weekly HTF
state must come from the PRIOR completed week, and the synthetic geometry of
a sweep must fire (and non-sweeps must not).
"""

import numpy as np
import pandas as pd

from ta_pipeline.patterns.false_break import (
    VARIANTS,
    detect,
    weekly_trend_state,
)

_EVENT_COLS = ("event_long", "event_short", "strength")


# ---------------------------------------------------------------------------
# no-lookahead / truncation invariance
# ---------------------------------------------------------------------------

def test_detect_truncation_invariant(make_ohlcv):
    """Events at bars <= cut are identical when bars > cut are deleted."""
    bars = make_ohlcv("AAA", seed=7, n=700)
    for name in VARIANTS:
        full = detect(bars, name)
        for cut in (300, 451, 643):
            trunc = detect(bars.iloc[:cut].copy(), name)
            for col in _EVENT_COLS:
                pd.testing.assert_series_equal(
                    full[col].iloc[:cut].reset_index(drop=True),
                    trunc[col].reset_index(drop=True),
                    check_names=False,
                    obj=f"{name}.{col} @ cut={cut}",
                )


def test_weekly_state_truncation_invariant(make_ohlcv):
    """The HTF state at bars <= cut is identical when bars > cut are deleted
    -- including cuts that land mid-week (the partial week must not matter)."""
    bars = make_ohlcv("AAA", seed=11, n=700)
    full = weekly_trend_state(bars)
    for cut in (260, 401, 555, 698):
        trunc = weekly_trend_state(bars.iloc[:cut].copy())
        pd.testing.assert_series_equal(
            full.iloc[:cut].reset_index(drop=True),
            trunc.reset_index(drop=True),
            check_names=False,
            obj=f"weekly_trend_state @ cut={cut}",
        )


def test_no_events_during_warmup(make_ohlcv):
    """NaN levels / ATR during warmup must never fire an event."""
    bars = make_ohlcv("AAA", seed=5, n=300)
    for name, params in VARIANTS.items():
        res = detect(bars, name)
        warm = params.range_k + 3
        assert not res["event_long"].iloc[:warm].any(), name
        assert not res["event_short"].iloc[:warm].any(), name


# ---------------------------------------------------------------------------
# synthetic geometry — the pattern fires exactly where constructed
# ---------------------------------------------------------------------------

def _flat_bars(n=90):
    """A flat, mildly oscillating tape: range [99.5, 100.5], ATR ~ 1."""
    close = np.where(np.arange(n) % 2 == 0, 99.9, 100.1)
    return pd.DataFrame({
        "ticker": "SYN",
        "date": pd.bdate_range("2022-01-03", periods=n),
        "open": close.astype(float),
        "high": np.full(n, 100.5),
        "low": np.full(n, 99.5),
        "close": close.astype(float),
        "volume": np.full(n, 2e6),
        "vwap": close.astype(float),
    })


def test_one_bar_failed_breakdown_fires_long():
    """Intraday sweep ~0.5 ATR below the prior range low, same-bar recovery."""
    bars = _flat_bars(90)
    t = 75
    bars.loc[t, "low"] = 99.0          # prior 20/55-day low = 99.5
    bars.loc[t, "close"] = 100.0       # closes back inside
    for name in ("k20_1bar", "k55_1bar"):
        res = detect(bars, name)
        assert bool(res["event_long"].iloc[t]), name
        assert not bool(res["event_short"].iloc[t]), name
        assert res["strength"].iloc[t] > 0.0, name
        assert res["level"].iloc[t] == 99.5, name
        # the only long event on the tape
        assert int(res["event_long"].sum()) == 1, name
    # no close beyond the level ever happened -> multi-bar variant silent
    assert not detect(bars, "k20_2bar")["event_long"].iloc[t]


def test_one_bar_failed_breakout_fires_short():
    bars = _flat_bars(90)
    t = 75
    bars.loc[t, "high"] = 101.0        # prior high = 100.5
    bars.loc[t, "close"] = 100.0       # closes back inside
    res = detect(bars, "k20_1bar")
    assert bool(res["event_short"].iloc[t])
    assert not bool(res["event_long"].iloc[t])


def test_multibar_sweep_fires_on_reclaim_close():
    """Two closes below the frozen level, then a close back inside."""
    bars = _flat_bars(90)
    t = 75                              # the reclaim bar
    for d, (lo, cl) in zip((t - 2, t - 1), ((99.1, 99.3), (99.0, 99.2))):
        bars.loc[d, "low"] = lo
        bars.loc[d, "close"] = cl       # closes BELOW the 99.5 level
    bars.loc[t, "low"] = 99.4
    bars.loc[t, "close"] = 99.9         # closes back inside
    res = detect(bars, "k20_2bar")
    assert bool(res["event_long"].iloc[t])
    assert not res["event_long"].iloc[:t].any()
    assert res["strength"].iloc[t] > 0.0


def test_multibar_sweep_rejects_three_closes_beyond():
    """Three consecutive closes below = a real breakdown, not a sweep."""
    bars = _flat_bars(90)
    t = 75
    for d in (t - 3, t - 2, t - 1):
        bars.loc[d, "low"] = 99.0
        bars.loc[d, "close"] = 99.2
    bars.loc[t, "close"] = 99.9
    res = detect(bars, "k20_2bar")
    assert not bool(res["event_long"].iloc[t])


def test_overshoot_band_rejects_deep_breakdowns():
    """A 2-ATR flush below the level is a breakdown, not a sweep (omax=1.5)."""
    bars = _flat_bars(90)
    t = 75
    bars.loc[t, "low"] = 97.0          # ~2.5 ATR below 99.5
    bars.loc[t, "close"] = 100.0
    res = detect(bars, "k20_1bar")
    assert not bool(res["event_long"].iloc[t])


def test_events_are_sparse(make_ohlcv):
    """On a random walk the detector fires on a small minority of bars."""
    bars = make_ohlcv("AAA", seed=3, n=900)
    for name in VARIANTS:
        res = detect(bars, name)
        rate = float((res["event_long"] | res["event_short"]).mean())
        assert rate < 0.06, f"{name}: {rate:.3f} not sparse"


# ---------------------------------------------------------------------------
# HTF weekly state — prior-completed-week semantics
# ---------------------------------------------------------------------------

def test_weekly_state_warmup_is_nan():
    n = 300
    close = np.linspace(100.0, 200.0, n)
    bars = pd.DataFrame({
        "ticker": "UP",
        "date": pd.bdate_range("2022-01-03", periods=n),
        "open": close, "high": close + 0.5, "low": close - 0.5,
        "close": close, "volume": np.full(n, 1e6), "vwap": close,
    })
    state = weekly_trend_state(bars)
    assert state.iloc[:90].isna().all()       # ~20 weekly bars + 1 prior shift
    assert (state.iloc[-50:] == 1.0).all()    # steady rise -> weekly uptrend


def test_weekly_state_uses_prior_completed_week():
    """A crash INSIDE the current week must not flip that week's state."""
    n = 300
    close = np.linspace(100.0, 200.0, n)
    dates = pd.bdate_range("2022-01-03", periods=n)
    bars = pd.DataFrame({
        "ticker": "UP",
        "date": dates, "open": close, "high": close + 0.5,
        "low": close - 0.5, "close": close,
        "volume": np.full(n, 1e6), "vwap": close,
    })
    # crash every day belonging to the FINAL week only
    weeks = dates.to_period("W-FRI")
    last_week = weeks == weeks[-1]
    for col in ("open", "high", "low", "close", "vwap"):
        bars.loc[last_week, col] = 20.0
    state = weekly_trend_state(bars)
    # days inside the crash week still read the prior completed week: uptrend
    assert (state[last_week] == 1.0).all()
    # the state is constant within every week (one value per week)
    per_week = state.groupby(weeks).nunique(dropna=False)
    assert (per_week <= 1).all()
