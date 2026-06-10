"""Leakage + correctness tests for the ``ema_cloud_mtf`` pattern family.

Mirrors test_pattern_false_break.py: an event dated bar t must be byte-identical
when bars > t are deleted, the weekly HTF state must come from the PRIOR
completed week, and the synthetic geometry of a cloud reclaim / curl flip must
fire (and non-events must not).
"""

import numpy as np
import pandas as pd

from ta_pipeline.patterns.ema_cloud_mtf import (
    PARAM_SETS,
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
    """EMAs / ATR still forming during warmup must never fire an event."""
    bars = make_ohlcv("AAA", seed=5, n=400)
    for name in VARIANTS:
        res = detect(bars, name)
        # the param-set key is the variant minus its trailing mode suffix
        key = next(k for k in PARAM_SETS if name.startswith(k + "_"))
        warm = PARAM_SETS[key].warmup
        assert not res["event_long"].iloc[:warm].any(), name
        assert not res["event_short"].iloc[:warm].any(), name


def test_events_are_sparse(make_ohlcv):
    """On a random walk the detector fires on a small minority of bars."""
    bars = make_ohlcv("AAA", seed=3, n=900)
    for name in VARIANTS:
        res = detect(bars, name)
        rate = float((res["event_long"] | res["event_short"]).mean())
        assert rate < 0.10, f"{name}: {rate:.3f} not sparse"


# ---------------------------------------------------------------------------
# synthetic geometry — the pattern fires where constructed
# ---------------------------------------------------------------------------

def _ramp_then_reclaim(n=200):
    """An uptrend (so the slow cloud is bullish/above), then a 1-bar dip
    below the fast cloud and a reclaim close back above it."""
    close = 100.0 * np.exp(np.cumsum(np.full(n, 0.004)))   # steady uptrend
    return pd.DataFrame({
        "ticker": "SYN",
        "date": pd.bdate_range("2021-01-04", periods=n),
        "open": close,
        "high": close * 1.004,
        "low": close * 0.996,
        "close": close,
        "volume": np.full(n, 2e6),
        "vwap": close,
    })


def test_reclaim_fires_long_in_bullish_slow_cloud():
    """In a sustained uptrend, dipping the close below the fast cloud then
    closing back above it on the next bar fires a long reclaim event."""
    bars = _ramp_then_reclaim(220)
    res_full = detect(bars, "classic_reclaim")
    # An uptrend with no dip should still occasionally reclaim, but we force a
    # clean dip-and-reclaim and assert an event lands on the reclaim bar.
    t = 180
    bars2 = bars.copy()
    # push the prior bar's close down (below its fast cloud) ...
    bars2.loc[t - 1, "close"] = bars2.loc[t - 1, "close"] * 0.93
    bars2.loc[t - 1, "low"] = bars2.loc[t - 1, "close"] * 0.99
    # ... then the reclaim bar closes back up in the trend
    res = detect(bars2, "classic_reclaim")
    assert bool(res["event_long"].iloc[t])
    assert res["strength"].iloc[t] > 0.0
    assert not bool(res["event_short"].iloc[t])
    # sanity: detection ran and produced a frame aligned to the input
    assert len(res_full) == len(bars)


def test_reclaim_requires_bullish_slow_cloud():
    """A fast-cloud reclaim in a DOWNtrend (slow cloud bearish / price below
    it) must NOT fire a long event — multi-cloud alignment is required."""
    n = 220
    close = 100.0 * np.exp(np.cumsum(np.full(n, -0.004)))   # steady downtrend
    bars = pd.DataFrame({
        "ticker": "SYN",
        "date": pd.bdate_range("2021-01-04", periods=n),
        "open": close, "high": close * 1.004, "low": close * 0.996,
        "close": close, "volume": np.full(n, 2e6), "vwap": close,
    })
    t = 180
    bars.loc[t - 1, "close"] = bars.loc[t - 1, "close"] * 0.95
    res = detect(bars, "classic_reclaim")
    # price is below the slow cloud throughout the downtrend -> no long
    assert not bool(res["event_long"].iloc[t])


def test_curl_flip_matches_its_contract_exactly():
    """The curl_flip event must equal, bar for bar, the conjunction of
    (slow-midline slope flips up: prev <= 0 < now) AND (close > slow-cloud top)
    -- recomputed independently here -- so the detector encodes exactly that
    multi-cloud rule and nothing looser. Same for the short mirror.

    A long, noisy series is used so both the flip and the price-above
    conditions actually co-occur on some bars (and fail to on others)."""
    from ta_pipeline.patterns.ema_cloud_mtf import _ema

    rng = np.random.default_rng(19)
    n = 1500
    close = 100.0 * np.exp(np.cumsum(rng.normal(0.0003, 0.02, n)))
    bars = pd.DataFrame({
        "ticker": "SYN",
        "date": pd.bdate_range("2018-01-02", periods=n),
        "open": close, "high": close * 1.01, "low": close * 0.99,
        "close": close, "volume": np.full(n, 2e6), "vwap": close,
    })
    res = detect(bars, "classic_curl_flip")

    p = PARAM_SETS["classic"]
    c = bars["close"].astype(float)
    sc, sd = _ema(c, p.slow_c), _ema(c, p.slow_d)
    mid = (sc + sd) / 2.0
    slope = mid.diff()
    slow_top = pd.concat([sc, sd], axis=1).max(axis=1)
    slow_bot = pd.concat([sc, sd], axis=1).min(axis=1)

    warm = pd.Series(True, index=bars.index)
    warm.iloc[: p.warmup] = False
    exp_long = ((slope.shift(1) <= 0) & (slope > 0) & (c > slow_top) & warm).fillna(False)
    exp_short = ((slope.shift(1) >= 0) & (slope < 0) & (c < slow_bot) & warm).fillna(False)

    # the construction is only meaningful if both sides actually fire somewhere
    assert exp_long.any() and exp_short.any()
    pd.testing.assert_series_equal(
        res["event_long"], exp_long.astype(bool), check_names=False
    )
    pd.testing.assert_series_equal(
        res["event_short"], exp_short.astype(bool), check_names=False
    )


# ---------------------------------------------------------------------------
# HTF weekly state — prior-completed-week semantics
# ---------------------------------------------------------------------------

def test_weekly_state_warmup_is_nan_and_trends_up():
    n = 320
    close = np.linspace(100.0, 250.0, n)
    bars = pd.DataFrame({
        "ticker": "UP",
        "date": pd.bdate_range("2021-01-04", periods=n),
        "open": close, "high": close + 0.5, "low": close - 0.5,
        "close": close, "volume": np.full(n, 1e6), "vwap": close,
    })
    state = weekly_trend_state(bars)
    assert state.iloc[:90].isna().all()       # weekly EMA warmup + prior shift
    assert (state.iloc[-50:] == 1.0).all()    # steady rise -> weekly uptrend


def test_weekly_state_uses_prior_completed_week():
    """A crash INSIDE the current week must not flip that week's state."""
    n = 320
    close = np.linspace(100.0, 250.0, n)
    dates = pd.bdate_range("2021-01-04", periods=n)
    bars = pd.DataFrame({
        "ticker": "UP",
        "date": dates, "open": close, "high": close + 0.5,
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
