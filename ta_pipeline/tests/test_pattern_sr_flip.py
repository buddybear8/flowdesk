"""Leakage + correctness tests for the sr_flip pattern detector.

Mirrors the truncation-invariance pattern of ``test_leakage_alignment.py``:
events computed on ``history[:cut]`` must be byte-identical to events computed
on the full history then sliced -- proof that no event at bar t reads any bar
beyond t.
"""

import numpy as np
import pandas as pd

from ta_pipeline.patterns import sr_flip

OUTPUT_COLUMNS = ["event_long", "event_short", "strength", "level_price",
                  "level_touches", "break_age", "htf_state"]


# ---------------------------------------------------------------------------
# constructed scenarios
# ---------------------------------------------------------------------------

def _flip_long_bars():
    """Hand-built path: double-top resistance ~112, upward break, clean retest.

    Bars 20 and 30 print swing highs of 112.0 / 112.2 (confirmed at 23 / 33,
    clustering into one ~112.1 level with 2 touches). Bar 40 closes well above
    it (the break), bars 41-43 hold above, bar 44 dips its low into the level
    zone and closes back above -- the flip retest hold day.
    """
    close = np.array([
        # 0-13: warmup ramp (forms the ATR seed)
        100.0, 100.3, 100.6, 100.9, 101.2, 101.5, 101.8, 102.1,
        102.4, 102.7, 103.0, 103.3, 103.6, 103.9,
        # 14-20: rise into swing high #1 (peak close 111 -> high 112 at bar 20)
        104.5, 105.5, 106.5, 107.5, 108.5, 109.5, 111.0,
        # 21-25: pullback into a trough at bar 25
        109.0, 107.5, 106.5, 105.8, 105.0,
        # 26-30: rise into swing high #2 (high 112.2 at bar 30)
        105.5, 106.5, 107.5, 109.0, 111.2,
        # 31-39: second pullback, base, then launch
        109.5, 108.0, 106.5, 106.0, 105.8, 106.0, 106.5, 107.0, 108.5,
        # 40: breakout close above the 112.1 level
        114.0,
        # 41-43: hold above (distinct closes -- no tied pivot highs)
        114.3, 114.6, 114.4,
        # 44: retest day -- low overridden to pierce to 111.9, close holds
        113.8,
        # 45-59: resume up
        114.5, 114.8, 115.0, 115.25, 115.5, 115.75, 116.0, 116.25,
        116.5, 116.75, 117.0, 117.25, 117.5, 117.75, 118.0,
    ])
    n = len(close)
    high = close + 1.0
    low = close - 1.0
    low[44] = 111.9          # the retest touch of the flipped level
    return pd.DataFrame({
        "ticker": "FLIP",
        "date": pd.bdate_range("2022-01-03", periods=n),
        "open": close,
        "high": high,
        "low": low,
        "close": close,
        "volume": np.full(n, 2e6),
        "vwap": close,
    })


def _mirror(df):
    """Price-mirror a frame around 220 -- longs become shorts exactly."""
    out = df.copy()
    out["close"] = 220.0 - df["close"]
    out["open"] = 220.0 - df["open"]
    out["high"] = 220.0 - df["low"]
    out["low"] = 220.0 - df["high"]
    out["vwap"] = 220.0 - df["vwap"]
    return out


def test_constructed_resistance_flip_fires_long():
    bars = _flip_long_bars()
    res = sr_flip.detect(bars)
    fired = list(np.flatnonzero(res["event_long"].to_numpy()))
    assert fired == [44], f"expected a single long event at bar 44, got {fired}"
    assert not res["event_short"].any()
    assert res.loc[44, "strength"] > 0.0
    assert res.loc[44, "level_touches"] == 2
    # the flipped level is the clustered double top ~112.1
    assert abs(res.loc[44, "level_price"] - 112.1) < 0.2
    assert res.loc[44, "break_age"] == 4


def test_constructed_support_flip_fires_short():
    bars = _mirror(_flip_long_bars())
    res = sr_flip.detect(bars)
    fired = list(np.flatnonzero(res["event_short"].to_numpy()))
    assert fired == [44], f"expected a single short event at bar 44, got {fired}"
    assert not res["event_long"].any()
    assert res.loc[44, "strength"] > 0.0


def test_strict_params_require_three_touches():
    """The double top has only 2 touches -- the strict variant must not fire."""
    bars = _flip_long_bars()
    strict = [p for p in sr_flip.PARAM_SETS if p.name == "strict"][0]
    res = sr_flip.detect(bars, strict)
    assert not res["event_long"].any()
    assert not res["event_short"].any()


# ---------------------------------------------------------------------------
# leakage
# ---------------------------------------------------------------------------

def test_events_are_truncation_invariant(make_ohlcv):
    """detect(history[:cut]) == detect(full)[:cut] -- no forward dependence."""
    bars = make_ohlcv("AAA", seed=1, n=900)
    for params in sr_flip.PARAM_SETS:
        full = sr_flip.detect(bars, params)
        for cut in (300, 500, 750):
            trunc = sr_flip.detect(bars.iloc[:cut].copy(), params)
            pd.testing.assert_frame_equal(
                full.iloc[:cut].reset_index(drop=True),
                trunc.reset_index(drop=True),
                obj=f"sr_flip[{params.name}] @ cut={cut}",
            )


def test_constructed_events_truncation_invariant():
    """The constructed event itself survives truncation right after it fires."""
    bars = _flip_long_bars()
    full = sr_flip.detect(bars)
    trunc = sr_flip.detect(bars.iloc[:45].copy())
    pd.testing.assert_frame_equal(
        full.iloc[:45].reset_index(drop=True), trunc.reset_index(drop=True)
    )
    assert bool(trunc["event_long"].iloc[44])


def test_htf_state_ignores_current_week(make_ohlcv):
    """htf_state at day t uses only PRIOR completed weeks: inflating the last
    week's prices changes nothing for days inside that week."""
    bars = make_ohlcv("AAA", seed=3, n=900)
    base = sr_flip.weekly_trend_state(bars)
    bumped = bars.copy()
    # mutate the final (possibly partial) week's closes violently
    last_week = bumped["date"].dt.to_period("W-FRI").iloc[-1]
    in_last = bumped["date"].dt.to_period("W-FRI") == last_week
    assert in_last.sum() >= 1
    bumped.loc[in_last, "close"] = bumped.loc[in_last, "close"] * 5.0
    after = sr_flip.weekly_trend_state(bumped)
    pd.testing.assert_series_equal(
        base[in_last.to_numpy()], after[in_last.to_numpy()], check_names=False
    )


# ---------------------------------------------------------------------------
# contract
# ---------------------------------------------------------------------------

def test_output_contract(make_ohlcv):
    bars = make_ohlcv("AAA", seed=2, n=900)
    res = sr_flip.detect(bars)
    assert list(res.columns) == OUTPUT_COLUMNS
    assert len(res) == len(bars)
    assert res["event_long"].dtype == bool
    assert res["event_short"].dtype == bool
    assert res["strength"].dtype == float
    # strength is non-zero exactly on event rows
    has_event = res["event_long"] | res["event_short"]
    assert (res.loc[has_event, "strength"] > 0).all()
    assert (res.loc[~has_event, "strength"] == 0).all()
    # htf_state values are in {-1, 0, 1} or NaN (warmup)
    vals = res["htf_state"].dropna().unique()
    assert set(vals).issubset({-1.0, 0.0, 1.0})


def test_events_are_sparse(make_ohlcv):
    """Genuinely selective setups: rare even on pivot-dense random walks.

    The synthetic walks' independent +-1.2% intrabar noise makes them far
    more pivot-cluttered than real candles (~2.6% per side measured on the
    store), so the bound here is a coarse not-every-day guard.
    """
    total_bars, total_events = 0, 0
    for seed in (1, 2, 3, 4, 5):
        bars = make_ohlcv("AAA", seed=seed, n=900)
        res = sr_flip.detect(bars)
        total_bars += len(res)
        total_events += int(res["event_long"].sum() + res["event_short"].sum())
    assert 0 < total_events / total_bars < 0.08


def test_universe_matches_solo(make_ohlcv):
    """No cross-ticker leakage: per-ticker results identical in a universe."""
    aaa = make_ohlcv("AAA", seed=1, n=600)
    bbb = make_ohlcv("BBB", seed=2, n=600)
    solo = sr_flip.detect(aaa)
    combined = sr_flip.detect_universe(pd.concat([aaa, bbb], ignore_index=True))
    got = combined[combined["ticker"] == "AAA"].reset_index(drop=True)
    pd.testing.assert_frame_equal(
        solo.reset_index(drop=True), got[OUTPUT_COLUMNS],
    )
