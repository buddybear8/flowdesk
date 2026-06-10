"""Options-flow features -- per-(ticker, date) aggregates of UW flow alerts.

``aggregate_flow`` reduces the raw ``flow_alerts`` rows to one row per
(ticker, feature_date). It is **sparse**: only ticker-days with at least one
alert appear; the join (F3) 0-fills the rest.

Raw aggregates only -- the flow corpus is ~13 trading days, far too short for
the trailing-percentile normalization the dark-pool features use. Dollar-
volume normalization is likewise deferred to flow-model time (F5+), when the
corpus is long enough for the flow ablation to be meaningful.
"""

from __future__ import annotations

import pandas as pd

from .sessionize import add_feature_date

# Columns produced by ``aggregate_flow`` (sparse, raw aggregates).
FLOW_FEATURE_COLUMNS = [
    "flow_alert_count", "flow_total_premium",
    "flow_call_premium", "flow_put_premium", "flow_net_call_premium",
    "flow_bullish_premium", "flow_bearish_premium", "flow_net_sentiment_premium",
    "flow_sweep_count", "flow_sweep_premium",
    "flow_total_size", "flow_avg_dte",
    "flow_high_conf_count", "flow_opening_frac",
]


def aggregate_flow(flow_df: pd.DataFrame, trading_days) -> pd.DataFrame:
    """Sparse per-(ticker, date) options-flow aggregates.

    ``flow_df`` is the cached ``flow_alerts`` table; ``trading_days`` is the
    trading-day calendar used to sessionize ``time`` (Rule A). Returns one row
    per ticker-day with at least one alert, carrying ``FLOW_FEATURE_COLUMNS``.
    """
    sess = add_feature_date(flow_df, "time", trading_days)
    sess = sess[sess["feature_date"].notna()].copy()
    if sess.empty:
        return pd.DataFrame(columns=["ticker", "date", *FLOW_FEATURE_COLUMNS])

    premium = sess["premium"]
    sess["_call_prem"] = premium.where(sess["type"] == "CALL", 0.0)
    sess["_put_prem"] = premium.where(sess["type"] == "PUT", 0.0)
    sess["_bull_prem"] = premium.where(sess["sentiment"] == "BULLISH", 0.0)
    sess["_bear_prem"] = premium.where(sess["sentiment"] == "BEARISH", 0.0)
    sess["_is_sweep"] = sess["exec"] == "SWEEP"
    sess["_sweep_prem"] = premium.where(sess["_is_sweep"], 0.0)
    sess["_is_high_conf"] = sess["confidence"] == "HIGH"
    sess["_dte"] = (sess["expiry"] - sess["feature_date"]).dt.days

    agg = (
        sess.groupby(["ticker", "feature_date"], sort=False)
        .agg(
            flow_alert_count=("time", "size"),
            flow_total_premium=("premium", "sum"),
            flow_call_premium=("_call_prem", "sum"),
            flow_put_premium=("_put_prem", "sum"),
            flow_bullish_premium=("_bull_prem", "sum"),
            flow_bearish_premium=("_bear_prem", "sum"),
            flow_sweep_count=("_is_sweep", "sum"),
            flow_sweep_premium=("_sweep_prem", "sum"),
            flow_total_size=("size", "sum"),
            flow_avg_dte=("_dte", "mean"),
            flow_high_conf_count=("_is_high_conf", "sum"),
            flow_opening_frac=("all_opening", "mean"),  # NA-skipping mean
        )
        .reset_index()
        .rename(columns={"feature_date": "date"})
    )
    agg["flow_net_call_premium"] = (
        agg["flow_call_premium"] - agg["flow_put_premium"]
    )
    agg["flow_net_sentiment_premium"] = (
        agg["flow_bullish_premium"] - agg["flow_bearish_premium"]
    )

    ordered = ["ticker", "date", *FLOW_FEATURE_COLUMNS]
    return agg[ordered].sort_values(["ticker", "date"]).reset_index(drop=True)
