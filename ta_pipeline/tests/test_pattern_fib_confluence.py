"""Leakage + correctness tests for the ``fib_confluence`` pattern family.

Mirrors the false_break / wedge truncation-invariance pattern: an event dated
bar t must be byte-identical when bars > t are deleted; the weekly HTF state
must come from the PRIOR completed week; the synthetic geometry of an impulse
-> fib pullback -> reclaim must fire, and the additivity control (no-fib plain
reclaim) must fire on a superset of bars.
"""

import numpy as np
import pandas as pd

from ta_pipeline.patterns.fib_confluence import (
    PARAM_SETS,
    FibParams,
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
    for p in PARAM_SETS:
        full = detect(bars, p)
        for cut in (300, 451, 643):
            trunc = detect(bars.iloc[:cut].copy(), p)
            for col in _EVENT_COLS:
                pd.testing.assert_series_equal(
                    full[col].iloc[:cut].reset_index(drop=True),
                    trunc[col].reset_index(drop=True),
                    check_names=False,
                    obj=f"{p.name}.{col} @ cut={cut}",
                )


def test_no_fib_variant_truncation_invariant(make_ohlcv):
    """The additivity-control (require_fib=False) detector is also causal."""
    bars = make_ohlcv("BBB", seed=13, n=600)
    plain = FibParams(
        name="plain", require_fib=False, require_confluence=False,
    )
    full = detect(bars, plain)
    for cut in (250, 399, 540):
        trunc = detect(bars.iloc[:cut].copy(), plain)
        for col in _EVENT_COLS:
            pd.testing.assert_series_equal(
                full[col].iloc[:cut].reset_index(drop=True),
                trunc[col].reset_index(drop=True),
                check_names=False,
                obj=f"plain.{col} @ cut={cut}",
            )


def test_weekly_state_truncation_invariant(make_ohlcv):
    """HTF state at bars <= cut is identical when bars > cut are deleted --
    including cuts that land mid-week (the partial week must not matter)."""
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
    """No event can fire before ATR / first leg can possibly exist."""
    bars = make_ohlcv("AAA", seed=5, n=300)
    for p in PARAM_SETS:
        res = detect(bars, p)
        warm = p.atr_period + p.swing_m
        assert not res["event_long"].iloc[:warm].any(), p.name
        assert not res["event_short"].iloc[:warm].any(), p.name


# ---------------------------------------------------------------------------
# events are sparse
# ---------------------------------------------------------------------------

def test_events_are_sparse(make_ohlcv):
    """On a random walk the fib-gated detector fires on a small minority."""
    bars = make_ohlcv("AAA", seed=3, n=900)
    for p in PARAM_SETS:
        res = detect(bars, p)
        rate = float((res["event_long"] | res["event_short"]).mean())
        assert rate < 0.06, f"{p.name}: {rate:.3f} not sparse"


def test_no_fib_is_superset_of_fib(make_ohlcv):
    """The plain reclaim (no fib gate) must fire on >= the fib-gated bars:
    the fib/confluence requirement can only REMOVE events, never add."""
    bars = make_ohlcv("CCC", seed=21, n=900)
    base = PARAM_SETS[0]
    gated = detect(bars, base)
    plain = detect(bars, FibParams(
        name="plain", swing_m=base.swing_m, fib_levels=base.fib_levels,
        confluence_atr=base.confluence_atr, min_impulse_atr=base.min_impulse_atr,
        max_leg_age=base.max_leg_age, require_fib=False, require_confluence=False,
    ))
    n_gated = int((gated["event_long"] | gated["event_short"]).sum())
    n_plain = int((plain["event_long"] | plain["event_short"]).sum())
    assert n_plain >= n_gated, (n_plain, n_gated)


# ---------------------------------------------------------------------------
# synthetic geometry — an up-impulse, fib pullback, then reclaim
# ---------------------------------------------------------------------------

def _impulse_pullback_reclaim():
    """Construct a clean up-impulse, a pullback into the 0.5 fib, a reclaim.

    Phase 0: a confirmed swing HIGH near 110 (prior STRUCTURE for confluence).
    Phase 1: a dip to a confirmed swing low at 100 (leg origin A).
    Phase 2: an impulse up to a confirmed swing high at 120 (leg extreme B).
    Phase 3: a pullback to ~110 (= 0.5 retracement of the 100->120 leg, and
             confluent with the prior 110 swing high), then a reclaim close up.
    """
    m = 3
    # prior structure: a clean swing HIGH peak at 110 (confirmable pivot)
    base = [104.0, 106.0, 108.0, 110.0, 108.0, 106.0, 104.0]   # high pivot at 110
    # dip to make a confirmed swing LOW at 100 (leg origin A)
    dip = [102.0, 101.0, 100.0, 104.0, 108.0]            # low pivot at 100
    # impulse up to a confirmed swing HIGH at 120 (leg extreme B)
    up = [112.0, 116.0, 120.0, 116.0, 113.0]             # high pivot at 120
    # pullback into 0.5 fib = 110, touching it, then reclaim above the zone
    pull = [111.0, 110.0, 113.0]                         # touch 110, reclaim
    tail = [114.0, 115.0, 114.0, 115.0]
    closes = base + dip + up + pull + tail
    n = len(closes)
    close = np.array(closes, dtype=float)
    return pd.DataFrame({
        "ticker": "SYN",
        "date": pd.bdate_range("2022-01-03", periods=n),
        "open": close,
        "high": close + 0.5,
        "low": close - 0.5,
        "close": close,
        "volume": np.full(n, 2e6),
        "vwap": close,
    }), m


def test_up_impulse_fib_reclaim_fires_long():
    """A pullback into the 0.5 fib (confluent with prior 110 base) that
    reclaims fires a long event in the impulse direction."""
    bars, m = _impulse_pullback_reclaim()
    p = FibParams(
        name="syn", swing_m=m, fib_levels=(0.5,), confluence_atr=0.5,
        min_impulse_atr=1.0, max_leg_age=40, atr_period=5,
    )
    res = detect(bars, p)
    assert bool(res["event_long"].any()), "expected a long reclaim event"
    assert not bool(res["event_short"].any())
    fired = res.index[res["event_long"]]
    assert res["strength"].loc[fired[0]] > 0.0


def test_reclaim_requires_close_back_above_zone():
    """With no reclaim close (price stays below the zone), no event fires."""
    bars, m = _impulse_pullback_reclaim()
    # truncate just after the touch, before any reclaim close
    cut = len(bars) - 5
    res = detect(bars.iloc[:cut].copy(), FibParams(
        name="syn", swing_m=m, fib_levels=(0.5,), confluence_atr=0.5,
        min_impulse_atr=1.0, max_leg_age=40, atr_period=5,
    ))
    assert not bool(res["event_long"].any())


# ---------------------------------------------------------------------------
# HTF weekly state — prior-completed-week semantics
# ---------------------------------------------------------------------------

def test_weekly_state_uses_prior_completed_week():
    """A crash INSIDE the current week must not flip that week's state."""
    n = 300
    close = np.linspace(100.0, 200.0, n)
    dates = pd.bdate_range("2022-01-03", periods=n)
    bars = pd.DataFrame({
        "ticker": "UP", "date": dates, "open": close, "high": close + 0.5,
        "low": close - 0.5, "close": close,
        "volume": np.full(n, 1e6), "vwap": close,
    })
    weeks = dates.to_period("W-FRI")
    last_week = weeks == weeks[-1]
    for col in ("open", "high", "low", "close", "vwap"):
        bars.loc[last_week, col] = 20.0
    state = weekly_trend_state(bars)
    assert (state[last_week] == 1.0).all()
    per_week = state.groupby(weeks).nunique(dropna=False)
    assert (per_week <= 1).all()
