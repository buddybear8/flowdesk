"""Flow / dark-pool join tests.

Covers the leakage-controlled join of the F2 aggregates onto the TA matrix:
row preservation, the 0-fill / NaN-fill policy, the presence indicators, the
truncation (no-lookahead) guarantee -- including the trailing percentile --
and cross-ticker isolation.
"""

import numpy as np
import pandas as pd
import pytest

from ta_pipeline.flow.config import FlowConfig
from ta_pipeline.flow.darkpool_features import aggregate_darkpool
from ta_pipeline.flow.flow_features import aggregate_flow
from ta_pipeline.flow.join import join_flow_features

_START = "2024-01-02"
_N = 150

_DP_COLUMNS = ["executed_at", "ticker", "premium", "size"]
_FLOW_COLUMNS = [
    "time", "ticker", "premium", "type", "sentiment", "exec", "confidence",
    "size", "expiry", "all_opening",
]


# --- synthetic data builders --------------------------------------------
def _matrix(tickers=("AAA",), n=_N):
    """A minimal TA matrix: ticker / date / close / volume."""
    dates = pd.bdate_range(_START, periods=n)
    frames = [
        pd.DataFrame({
            "ticker": t,
            "date": dates,
            "close": 100.0 + np.arange(n, dtype=float),
            "volume": 3_000_000.0,
        })
        for t in tickers
    ]
    return pd.concat(frames, ignore_index=True)


def _dp_event(ticker, date, *, hour_utc=18, premium=1e7, size=100_000):
    """One dark-pool print at ``hour_utc`` UTC on ``date``."""
    ts = pd.Timestamp(date, tz="UTC") + pd.Timedelta(hours=hour_utc)
    return dict(executed_at=ts, ticker=ticker, premium=premium, size=size)


def _flow_event(ticker, date, *, hour_utc=18, premium=5e5, dte=14):
    """One options-flow alert at ``hour_utc`` UTC on ``date``."""
    ts = pd.Timestamp(date, tz="UTC") + pd.Timedelta(hours=hour_utc)
    return dict(
        time=ts, ticker=ticker, premium=premium, type="CALL",
        sentiment="BULLISH", exec="SWEEP", confidence="HIGH", size=500,
        expiry=pd.Timestamp(date) + pd.Timedelta(days=dte), all_opening=True,
    )


def _dp_frame(events):
    df = pd.DataFrame(events, columns=_DP_COLUMNS)
    if not df.empty:
        df["executed_at"] = pd.to_datetime(df["executed_at"], utc=True)
    return df


def _flow_frame(events):
    df = pd.DataFrame(events, columns=_FLOW_COLUMNS)
    if not df.empty:
        df["time"] = pd.to_datetime(df["time"], utc=True)
        df["expiry"] = pd.to_datetime(df["expiry"])
        df["all_opening"] = df["all_opening"].astype("boolean")
    return df


def _join(matrix, dp_events, flow_events, cfg=None):
    """Aggregate the synthetic events and join them onto ``matrix``."""
    td = matrix["date"].unique()
    return join_flow_features(
        matrix,
        aggregate_flow(_flow_frame(flow_events), td),
        aggregate_darkpool(_dp_frame(dp_events), td),
        cfg,
    )


# --- tests --------------------------------------------------------------
def test_join_preserves_rows_and_order():
    m = _matrix(("AAA",))
    joined = _join(m, [_dp_event("AAA", "2024-01-10")],
                   [_flow_event("AAA", "2024-01-10")])
    assert len(joined) == len(m)
    pd.testing.assert_series_equal(joined["date"], m["date"])
    pd.testing.assert_series_equal(joined["ticker"], m["ticker"])


def test_no_activity_zero_filled():
    m = _matrix(("AAA",))
    joined = _join(m, [_dp_event("AAA", "2024-01-10")],
                   [_flow_event("AAA", "2024-01-10")])
    quiet = joined[joined["date"] == pd.Timestamp("2024-01-11")].iloc[0]
    assert quiet["has_dp"] == 0 and quiet["has_flow"] == 0
    assert quiet["dp_print_count"] == 0 and quiet["dp_total_premium"] == 0
    assert quiet["flow_alert_count"] == 0 and quiet["flow_total_premium"] == 0


def test_activity_row_populated():
    m = _matrix(("AAA",))
    joined = _join(
        m,
        [_dp_event("AAA", "2024-01-10", premium=2e7, size=50_000),
         _dp_event("AAA", "2024-01-10", premium=1e7, size=20_000)],
        [_flow_event("AAA", "2024-01-10")],
    )
    hot = joined[joined["date"] == pd.Timestamp("2024-01-10")].iloc[0]
    assert hot["has_dp"] == 1 and hot["dp_print_count"] == 2
    assert hot["dp_total_premium"] == pytest.approx(3e7)
    assert hot["dp_max_premium"] == pytest.approx(2e7)
    assert hot["dp_total_size"] == 70_000
    assert hot["has_flow"] == 1 and hot["flow_alert_count"] == 1


def test_average_columns_nan_when_no_flow():
    m = _matrix(("AAA",))
    joined = _join(m, [], [_flow_event("AAA", "2024-01-10", dte=14)])
    quiet = joined[joined["date"] == pd.Timestamp("2024-01-11")].iloc[0]
    assert pd.isna(quiet["flow_avg_dte"])
    assert pd.isna(quiet["flow_opening_frac"])
    hot = joined[joined["date"] == pd.Timestamp("2024-01-10")].iloc[0]
    assert hot["flow_avg_dte"] == pytest.approx(14.0)
    assert hot["flow_opening_frac"] == pytest.approx(1.0)


def test_after_hours_print_rolls_forward():
    m = _matrix(("AAA",))
    # 22:00 UTC = 17:00 EST on Wed 2024-01-10 -> after close -> next day.
    joined = _join(m, [_dp_event("AAA", "2024-01-10", hour_utc=22)], [])
    same_day = joined[joined["date"] == pd.Timestamp("2024-01-10")].iloc[0]
    next_day = joined[joined["date"] == pd.Timestamp("2024-01-11")].iloc[0]
    assert same_day["has_dp"] == 0
    assert next_day["has_dp"] == 1 and next_day["dp_print_count"] == 1


def test_truncation_invariant_including_trailing_percentile():
    """Deleting dark-pool events after date t leaves rows <= t unchanged --
    raw aggregates and the trailing percentile alike."""
    cfg = FlowConfig(dp_pctile_window=20)   # short window: percentile online fast
    m = _matrix(("AAA",))
    spec = [("2024-01-10", 1e7), ("2024-01-25", 5e7), ("2024-02-15", 2e7),
            ("2024-03-15", 8e7), ("2024-04-10", 3e7)]
    events = [_dp_event("AAA", d, premium=p) for d, p in spec]
    cutoff = pd.Timestamp("2024-02-29")
    early = [e for e in events
             if e["executed_at"] < pd.Timestamp("2024-03-01", tz="UTC")]

    full = _join(m, events, [], cfg)
    trunc = _join(m, early, [], cfg)

    cols = ["dp_print_count", "dp_total_premium", "dp_max_premium",
            "dp_premium_to_dollar_vol", "dp_premium_pctile"]
    for c in cols:
        pd.testing.assert_series_equal(
            full.loc[full["date"] <= cutoff, c].reset_index(drop=True),
            trunc.loc[trunc["date"] <= cutoff, c].reset_index(drop=True),
            check_names=False, obj=c,
        )
    # the percentile is genuinely populated over the compared region
    assert full.loc[full["date"] <= cutoff, "dp_premium_pctile"].notna().any()


def test_cross_ticker_isolation():
    """A ticker's joined flow / dark-pool features are identical computed
    alone vs. alongside another ticker."""
    cfg = FlowConfig(dp_pctile_window=20)
    dp_events = [_dp_event("AAA", "2024-01-10"),
                 _dp_event("BBB", "2024-01-10", premium=9e7),
                 _dp_event("AAA", "2024-01-22", premium=4e7)]
    flow_events = [_flow_event("AAA", "2024-01-15"),
                   _flow_event("BBB", "2024-01-16")]

    def _aaa(tickers):
        joined = _join(_matrix(tickers), dp_events, flow_events, cfg)
        return joined[joined["ticker"] == "AAA"].reset_index(drop=True)

    alone = _aaa(("AAA",))
    in_universe = _aaa(("AAA", "BBB"))
    feat = [c for c in alone.columns
            if c.startswith(("dp_", "flow_", "has_"))]
    pd.testing.assert_frame_equal(alone[feat], in_universe[feat])
