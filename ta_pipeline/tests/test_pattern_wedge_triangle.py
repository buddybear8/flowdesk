"""Leakage / contract / detection tests for the wedge_triangle pattern family.

Mirrors the house lookahead-test pattern (test_leakage_alignment.py): every
detector output at bar t must be byte-identical when bars > t are deleted.
"""

import numpy as np
import pandas as pd
import pytest

from ta_pipeline.patterns.wedge_triangle import (
    PARAM_SETS,
    OUTPUT_COLUMNS,
    detect,
    weekly_trend_state,
)


def _bars_from_closes(closes, spread=0.5, start="2021-01-04"):
    closes = np.asarray(closes, dtype=float)
    n = len(closes)
    return pd.DataFrame({
        "ticker": "SYN",
        "date": pd.bdate_range(start, periods=n),
        "open": closes,
        "high": closes + spread,
        "low": closes - spread,
        "close": closes,
        "volume": np.full(n, 2e6),
        "vwap": closes,
    })


def _zigzag(anchors):
    """Piecewise-linear closes through (n_bars, target) anchor segments."""
    closes = [anchors[0]]
    for n_bars, target in anchors[1:]:
        closes.extend(np.linspace(closes[-1], target, n_bars + 1)[1:])
    return np.asarray(closes, dtype=float)


def _ascending_triangle_closes():
    """Warmup oscillation, then an ascending triangle into an upside break.

    Four flat tops at 110, rising troughs 100 -> 106, then a measured climb
    through the resistance line. Deterministic, pivot-friendly for
    swing_m <= 3 (5-bar legs => every apex/trough is a strict local extreme
    over +/-3 bars).
    """
    anchors = [100.0]
    for _ in range(4):                       # warmup zigzag for ATR formation
        anchors += [(5, 103.0), (5, 98.0)]
    for trough in (100.0, 102.0, 104.0, 106.0):   # 4 flat peaks, rising lows
        anchors += [(5, 110.0), (5, trough)]
    anchors += [(3, 110.0), (6, 122.0)]      # the break through 110
    return _zigzag(anchors)


@pytest.fixture(scope="module")
def random_bars(make_ohlcv):
    return make_ohlcv("AAA", seed=7, n=700)


# ---------------------------------------------------------------- contract --

def test_output_contract(random_bars):
    out = detect(random_bars, PARAM_SETS[0])
    assert list(out.columns) == list(OUTPUT_COLUMNS)
    assert out.index.equals(random_bars.index)
    assert out["event_long"].dtype == bool
    assert out["event_short"].dtype == bool
    assert out["strength"].dtype == float
    # strength is positive exactly on event bars
    fired = out["event_long"] | out["event_short"]
    assert (out.loc[fired, "strength"] > 0).all()
    assert (out.loc[~fired, "strength"] == 0).all()
    # never long and short on the same bar
    assert not (out["event_long"] & out["event_short"]).any()


def test_events_are_sparse(random_bars):
    for params in PARAM_SETS:
        out = detect(random_bars, params)
        rate = (out["event_long"] | out["event_short"]).mean()
        assert rate < 0.05, f"{params.name}: event rate {rate:.3f} not sparse"


# ---------------------------------------------------------------- leakage ---

def test_detector_truncation_invariant(random_bars):
    """Events at bars <= cut are identical when bars > cut are deleted."""
    for params in PARAM_SETS:
        full = detect(random_bars, params)
        for cut in (300, 450, 600):
            trunc = detect(random_bars.iloc[:cut].copy(), params)
            for col in OUTPUT_COLUMNS:
                pd.testing.assert_series_equal(
                    full[col].iloc[:cut].reset_index(drop=True),
                    trunc[col].reset_index(drop=True),
                    check_names=False,
                    obj=f"{params.name}.{col} @ cut={cut}",
                )


def test_htf_truncation_invariant(random_bars):
    full = weekly_trend_state(random_bars)
    for cut in (300, 451, 603):
        trunc = weekly_trend_state(random_bars.iloc[:cut].copy())
        pd.testing.assert_series_equal(
            full.iloc[:cut].reset_index(drop=True),
            trunc.reset_index(drop=True),
            check_names=False,
            obj=f"htf @ cut={cut}",
        )


def test_htf_uses_prior_completed_week(random_bars):
    """The state is constant within a calendar week — it can only change when
    a new week begins (i.e. it derives from completed prior weeks)."""
    state = weekly_trend_state(random_bars)
    week = random_bars["date"].dt.to_period("W-FRI")
    changes = state.diff().fillna(0.0) != 0
    assert (week[changes] != week.shift(1)[changes]).all()


def test_htf_direction_signs():
    n = 400
    dates = pd.bdate_range("2021-01-04", periods=n)
    up = pd.DataFrame({
        "ticker": "UP", "date": dates,
        "open": 0.0, "high": 0.0, "low": 0.0,
        "close": 100.0 * 1.002 ** np.arange(n),
        "volume": 1e6, "vwap": 0.0,
    })
    dn = up.copy()
    dn["close"] = 100.0 * 0.998 ** np.arange(n)
    assert weekly_trend_state(up).iloc[-1] == 1.0
    assert weekly_trend_state(dn).iloc[-1] == -1.0
    # warmup (< sma_slow completed weeks) is neutral
    assert (weekly_trend_state(up).iloc[:50] == 0.0).all()


# -------------------------------------------------------------- detection ---

def test_detects_ascending_triangle_break_up():
    bars = _bars_from_closes(_ascending_triangle_closes())
    out = detect(bars, PARAM_SETS[0])
    tail = out.iloc[-12:]
    assert tail["event_long"].any(), "expected a long break of the triangle"
    assert not out["event_short"].any()
    ev = tail[tail["event_long"]].iloc[0]
    assert ev["pattern_type"] in ("ascending_triangle", "symmetric_triangle",
                                  "rising_wedge")
    assert ev["touch_count"] >= 4
    assert 0.0 < ev["convergence"] <= 1.0
    assert ev["strength"] == ev["touch_count"] * ev["convergence"]


def test_detects_mirrored_break_down():
    """The price-mirrored series (descending triangle) breaks short."""
    closes = _ascending_triangle_closes()
    mirrored = 210.0 - closes
    bars = _bars_from_closes(mirrored)
    out = detect(bars, PARAM_SETS[0])
    assert out.iloc[-12:]["event_short"].any()
    assert not out["event_long"].any()


def test_rising_wedge_breaks_short_only():
    """A rising wedge whose support gives way fires short; the same pattern
    never fires long even though both lines rise."""
    anchors = [100.0]
    for _ in range(4):                       # warmup zigzag for ATR formation
        anchors += [(5, 103.0), (5, 98.0)]
    # rising wedge: peaks 105 -> 109.5 (slope .15/bar), troughs 100 -> 106.5
    # (slope ~.33/bar, faster => converging), then the support gives way.
    anchors += [(5, 105.0), (5, 100.0), (5, 106.5), (5, 103.5),
                (5, 108.0), (5, 106.5), (5, 109.5), (6, 95.0)]
    bars = _bars_from_closes(_zigzag(anchors))
    out = detect(bars, PARAM_SETS[0])
    fired = out[out["event_short"]]
    assert len(fired) > 0, "expected a short break of the rising wedge"
    assert (fired["pattern_type"] == "rising_wedge").all()
    assert not out["event_long"].iloc[-15:].any()


def test_no_events_on_flat_series():
    closes = np.full(300, 100.0)
    bars = _bars_from_closes(closes, spread=0.2)
    out = detect(bars, PARAM_SETS[0])
    assert not out["event_long"].any() and not out["event_short"].any()
