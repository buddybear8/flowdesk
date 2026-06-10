"""Leakage + correctness tests for the flag/pennant pattern detector.

Mirrors the §7 test discipline: truncation invariance (no forward
dependence), a deterministic synthetic pattern that must fire, negative
controls, sparsity, and the weekly HTF state's prior-completed-week rule.
"""

import numpy as np
import pandas as pd
import pytest

from ta_pipeline.patterns import flag_pennant as fp


# ---------------------------------------------------------------------------
# synthetic pattern construction
# ---------------------------------------------------------------------------

def _bars(close, spread, volume):
    n = len(close)
    close = np.asarray(close, dtype=float)
    spread = np.asarray(spread, dtype=float)
    return pd.DataFrame({
        "ticker": "FLAG",
        "date": pd.bdate_range("2022-01-03", periods=n),
        "open": close,
        "high": close + spread,
        "low": close - spread,
        "close": close,
        "volume": np.asarray(volume, dtype=float),
    })


def make_flag_pattern(with_pole=True):
    """50 flat bars, a 5-bar pole (+2/bar), a 5-bar tight down-drift flag,
    then a breakout close above the flag high at bar 60."""
    close, spread, volume = [], [], []
    # flat base
    close += [100.0] * 50
    spread += [0.3] * 50
    volume += [3e6] * 50
    # pole: bars 50-54
    pole = [102.0, 104.0, 106.0, 108.0, 110.0] if with_pole else [100.0] * 5
    close += pole
    spread += [0.3] * 5
    volume += [6e6] * 5
    # flag: bars 55-59, drift against the pole, tight, low volume
    top = close[-1]
    close += [top - 0.15 * (i + 1) for i in range(5)]
    spread += [0.2] * 5
    volume += [2e6] * 5
    # breakout bar 60 + two quiet bars
    close += [top + 0.5, top + 0.6, top + 0.7]
    spread += [0.4, 0.3, 0.3]
    volume += [7e6, 3e6, 3e6]
    return _bars(close, spread, volume)


def mirror(df):
    """Price-mirrored frame: up-pole flag becomes a down-pole flag."""
    out = df.copy()
    pivot = 220.0
    out["close"] = pivot - df["close"]
    out["open"] = pivot - df["open"]
    out["high"] = pivot - df["low"]
    out["low"] = pivot - df["high"]
    return out


BREAKOUT_BAR = 60


# ---------------------------------------------------------------------------
# correctness on the deterministic pattern
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["base", "strict"])
def test_long_flag_breakout_fires(name):
    df = make_flag_pattern()
    ev = fp.detect(df, fp.preset(name))
    assert bool(ev["event_long"].iloc[BREAKOUT_BAR])
    # nothing fires before the breakout bar, and never on the short side
    assert not ev["event_long"].iloc[:BREAKOUT_BAR].any()
    assert not ev["event_short"].any()
    assert ev["strength"].iloc[BREAKOUT_BAR] > 0
    assert ev["pole_move_atr"].iloc[BREAKOUT_BAR] > 0
    assert 3 <= ev["flag_len"].iloc[BREAKOUT_BAR] <= 10


@pytest.mark.parametrize("name", ["base", "strict"])
def test_short_flag_breakdown_fires(name):
    df = mirror(make_flag_pattern())
    ev = fp.detect(df, fp.preset(name))
    assert bool(ev["event_short"].iloc[BREAKOUT_BAR])
    assert not ev["event_short"].iloc[:BREAKOUT_BAR].any()
    assert not ev["event_long"].any()
    assert ev["pole_move_atr"].iloc[BREAKOUT_BAR] < 0


def test_no_event_without_pole():
    """The same consolidation + breakout WITHOUT a prior pole must not fire."""
    df = make_flag_pattern(with_pole=False)
    ev = fp.detect(df, fp.preset("base"))
    assert not ev["event_long"].any()
    assert not ev["event_short"].any()


def test_strength_zero_off_event():
    df = make_flag_pattern()
    ev = fp.detect(df, fp.preset("base"))
    off = ~(ev["event_long"] | ev["event_short"])
    assert (ev.loc[off, "strength"] == 0.0).all()
    assert ev.loc[off, "flag_len"].isna().all()


# ---------------------------------------------------------------------------
# leakage: truncation invariance
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["base", "strict", "momentum_decile"])
def test_events_are_truncation_invariant(make_ohlcv, name):
    """Events computed on history[:cut] are identical to events computed on
    the full history then sliced -- no forward dependence."""
    df = make_ohlcv("AAA", seed=7, n=600)
    full = fp.detect(df, fp.preset(name))
    for cut in (300, 450, 590):
        trunc = fp.detect(df.iloc[:cut].copy(), fp.preset(name))
        for col in ("event_long", "event_short", "strength"):
            pd.testing.assert_series_equal(
                full[col].iloc[:cut].reset_index(drop=True),
                trunc[col].reset_index(drop=True),
                check_names=False,
                obj=f"{col} @ cut={cut}",
            )


def test_weekly_state_is_truncation_invariant(make_ohlcv):
    df = make_ohlcv("AAA", seed=11, n=600)
    full = fp.weekly_trend_state(df)
    for cut in (300, 450, 590):
        trunc = fp.weekly_trend_state(df.iloc[:cut].copy())
        pd.testing.assert_series_equal(
            full.iloc[:cut].reset_index(drop=True),
            trunc.reset_index(drop=True),
            check_names=False,
            obj=f"weekly_trend_state @ cut={cut}",
        )


# ---------------------------------------------------------------------------
# weekly HTF state semantics
# ---------------------------------------------------------------------------

def test_weekly_state_constant_within_a_week(make_ohlcv):
    """Day t uses the prior COMPLETED week's state, so the daily-mapped state
    can only change at week boundaries -- never inside a week."""
    df = make_ohlcv("AAA", seed=3, n=600)
    state = fp.weekly_trend_state(df).fillna(99.0)
    iso = pd.DatetimeIndex(df["date"]).isocalendar()
    week_key = iso["year"].astype(str) + "-" + iso["week"].astype(str)
    per_week = state.groupby(week_key.to_numpy()).nunique()
    assert (per_week <= 1).all()


def test_weekly_state_tracks_trend(make_ohlcv):
    up = make_ohlcv("UP", seed=5, n=600, drift=0.008)
    down = make_ohlcv("DN", seed=5, n=600, drift=-0.008)
    s_up = fp.weekly_trend_state(up)
    s_dn = fp.weekly_trend_state(down)
    assert (s_up.iloc[-60:] == 1.0).mean() > 0.9
    assert (s_dn.iloc[-60:] == -1.0).mean() > 0.9
    # warmup: no state before 20 completed weeks
    assert s_up.iloc[:90].isna().all()


# ---------------------------------------------------------------------------
# sparsity -- a genuinely selective setup, not an everyday signal
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["base", "strict", "momentum_decile"])
def test_events_are_sparse_on_random_walk(make_ohlcv, name):
    rates = []
    for seed in (1, 2, 3):
        df = make_ohlcv("AAA", seed=seed, n=900)
        ev = fp.detect(df, fp.preset(name))
        rates.append((ev["event_long"] | ev["event_short"]).mean())
    assert float(np.mean(rates)) < 0.02
