"""Chain-flow sentiment features -- per-(ticker, date) aggregates of the
whole-day options chain split by aggressor side.

``aggregate_sentiment`` reduces the long per-(ticker, date, strike) frame from
``sentiment_extract`` to one row per ticker-day. It is **sparse**: only
ticker-days with a stored chain appear; the join 0-fills counts/sums and leaves
ratios NaN for the rest.

The features answer "where was the day's options *pressure*, and was it buying
or selling" at three scopes:
  * whole-chain   -- call/put volume, C/P ratio, net directional premium
  * at-the-money  -- buy/sell imbalance within ~2.5% of spot
  * far-OTM       -- share of buying out in the wings (lottos / conviction bets)

All features use only that day's cumulative-through-close chain, so against the
forward triple-barrier label they are leakage-safe (see sentiment_extract).

NOTE (data window): like the flow_alerts features, the chain corpus is short
(UW serves ~the prior month; the live worker + S3 archive grow it ~1 day/day),
so these feed the event study now and the flow ablation once the corpus matures.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# At-the-money / far-OTM band edges, as a fraction of spot.
_ATM_BAND = 0.025
_OTM_BAND = 0.05

# Count/sum features -- a no-chain ticker-day 0-fills to "no flow that day".
SENTIMENT_SUM_COLUMNS = [
    "sent_call_vol", "sent_put_vol",
    "sent_net_call_prem", "sent_net_put_prem", "sent_net_dir_prem",
    "sent_strike_count",
]
# Ratio/fraction features -- no honest 0 on a no-chain day, so left NaN.
SENTIMENT_RATIO_COLUMNS = [
    "sent_cp_ratio",
    "sent_call_buy_frac", "sent_put_buy_frac",
    "sent_dir_prem_score",
    "sent_atm_call_imb", "sent_atm_put_imb",
    "sent_otm_call_buy_frac", "sent_otm_put_buy_frac",
]
SENTIMENT_FEATURE_COLUMNS = SENTIMENT_SUM_COLUMNS + SENTIMENT_RATIO_COLUMNS


def _safe_div(num: pd.Series, den: pd.Series) -> pd.Series:
    """Elementwise divide, NaN where the denominator is 0 (no honest ratio)."""
    return num / den.where(den != 0, np.nan)


def aggregate_sentiment(chain_df: pd.DataFrame) -> pd.DataFrame:
    """Sparse per-(ticker, date) chain-flow features.

    ``chain_df`` is the long per-strike frame from ``sentiment_extract``
    (ticker, date, spot, k, cA, cB, pA, pB, cP, pP). ``date`` is already the
    close-aligned feature date, so no sessionizer is applied. Returns one row
    per ticker-day carrying ``SENTIMENT_FEATURE_COLUMNS``.
    """
    if chain_df.empty:
        return pd.DataFrame(columns=["ticker", "date", *SENTIMENT_FEATURE_COLUMNS])

    df = chain_df.copy()
    dist = (df["k"] - df["spot"]).abs()
    near = dist <= _ATM_BAND * df["spot"]
    otm_call = df["k"] > df["spot"] * (1 + _OTM_BAND)   # calls above spot
    otm_put = df["k"] < df["spot"] * (1 - _OTM_BAND)    # puts below spot

    z = 0.0
    df["_cvol"] = df["cA"] + df["cB"]
    df["_pvol"] = df["pA"] + df["pB"]
    df["_abscP"] = df["cP"].abs()
    df["_abspP"] = df["pP"].abs()
    df["_cA_near"] = df["cA"].where(near, z)
    df["_cB_near"] = df["cB"].where(near, z)
    df["_pA_near"] = df["pA"].where(near, z)
    df["_pB_near"] = df["pB"].where(near, z)
    df["_cA_otm"] = df["cA"].where(otm_call, z)
    df["_pA_otm"] = df["pA"].where(otm_put, z)

    g = (
        df.groupby(["ticker", "date"], sort=False)
        .agg(
            sent_call_vol=("_cvol", "sum"),
            sent_put_vol=("_pvol", "sum"),
            _call_ask=("cA", "sum"),
            _call_bid=("cB", "sum"),
            _put_ask=("pA", "sum"),
            _put_bid=("pB", "sum"),
            sent_net_call_prem=("cP", "sum"),
            sent_net_put_prem=("pP", "sum"),
            _abscP=("_abscP", "sum"),
            _abspP=("_abspP", "sum"),
            _cA_near=("_cA_near", "sum"),
            _cB_near=("_cB_near", "sum"),
            _pA_near=("_pA_near", "sum"),
            _pB_near=("_pB_near", "sum"),
            _cA_otm=("_cA_otm", "sum"),
            _pA_otm=("_pA_otm", "sum"),
            sent_strike_count=("k", "nunique"),
        )
        .reset_index()
    )

    g["sent_net_dir_prem"] = g["sent_net_call_prem"] - g["sent_net_put_prem"]
    g["sent_cp_ratio"] = _safe_div(g["sent_call_vol"], g["sent_put_vol"])
    g["sent_call_buy_frac"] = _safe_div(g["_call_ask"], g["_call_ask"] + g["_call_bid"])
    g["sent_put_buy_frac"] = _safe_div(g["_put_ask"], g["_put_ask"] + g["_put_bid"])
    g["sent_dir_prem_score"] = _safe_div(g["sent_net_dir_prem"], g["_abscP"] + g["_abspP"])
    g["sent_atm_call_imb"] = _safe_div(g["_cA_near"] - g["_cB_near"], g["_cA_near"] + g["_cB_near"])
    g["sent_atm_put_imb"] = _safe_div(g["_pA_near"] - g["_pB_near"], g["_pA_near"] + g["_pB_near"])
    g["sent_otm_call_buy_frac"] = _safe_div(g["_cA_otm"], g["_call_ask"])
    g["sent_otm_put_buy_frac"] = _safe_div(g["_pA_otm"], g["_put_ask"])

    ordered = ["ticker", "date", *SENTIMENT_FEATURE_COLUMNS]
    return g[ordered].sort_values(["ticker", "date"]).reset_index(drop=True)


def join_sentiment_features(matrix: pd.DataFrame, sent_agg: pd.DataFrame) -> pd.DataFrame:
    """Left-join the sparse chain-flow aggregates onto the TA matrix.

    Preserves every TA row and its order. ``has_sentiment`` flags ticker-days
    that had a stored chain; counts/sums 0-fill, ratios stay NaN (LightGBM
    splits on NaN natively).
    """
    out = matrix.merge(sent_agg, on=["ticker", "date"], how="left", validate="one_to_one")
    out["has_sentiment"] = out["sent_call_vol"].notna().astype("int8")
    for col in SENTIMENT_FEATURE_COLUMNS:
        out[col] = out[col].astype("float64")
        if col in SENTIMENT_SUM_COLUMNS:
            out[col] = out[col].fillna(0.0)
    return out
