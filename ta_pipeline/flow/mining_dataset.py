"""Build frozen, labeled datasets for the flow-characteristic mining study.

Two grains, each with a per-(close-aligned)-date forward-return label and a
time-ordered MINE / HOLDOUT split (holdout = most recent ~35% of dates, never
touched during mining):

  * orders  -- one row per flow_alert, with its own characteristics (type, side,
    sentiment, exec, DTE, moneyness, vol/OI, premium, aggressor $, flags) and a
    directional P&L proxy = thesis_dir * underlying_fwd_return.
  * tickers -- one row per (ticker, date) of chain-flow sentiment features +
    underlying forward returns.

This is the ONE place labels are defined, so the mining agents all share an
identical, frozen, leakage-controlled dataset. Forward returns are
close[t]->close[t+h] (signal known at close[t]).

CLI:
  export FLOWDESK_DATABASE_URL=...
  python -m ta_pipeline.flow.mining_dataset
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .config import FlowConfig
from .sentiment_extract import load_sentiment
from .sentiment_features import aggregate_sentiment
from .sentiment_event_study import HORIZONS, load_forward_returns
from .sessionize import add_feature_date

logger = logging.getLogger(__name__)

_HOLDOUT_FRAC = 0.35  # most-recent share of dates reserved, untouched, for validation

_ALERTS_QUERY = """
    SELECT id, time, ticker, type, side, sentiment, "exec" AS exec_type,
           multi_leg, strike, expiry, size, oi, premium, spot, confidence,
           sector, ask_prem, bid_prem, all_opening, has_floor, has_single_leg
    FROM flow_alerts
    ORDER BY time
"""


def _pull_alerts(cfg: FlowConfig) -> pd.DataFrame:
    import psycopg2
    conn = psycopg2.connect(cfg.resolve_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(_ALERTS_QUERY)
            cols = [d.name for d in cur.description]
            rows = cur.fetchall()
    finally:
        conn.close()
    df = pd.DataFrame(rows, columns=cols)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df["expiry"] = pd.to_datetime(df["expiry"]).dt.tz_localize(None)
    for c in ("strike", "premium", "spot", "ask_prem", "bid_prem"):
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
    for c in ("size", "oi"):
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
    return df


def _split_by_date(df: pd.DataFrame) -> pd.DataFrame:
    dates = np.sort(df["date"].unique())
    cut = dates[int(len(dates) * (1 - _HOLDOUT_FRAC))]
    df["split"] = np.where(df["date"] < cut, "mine", "holdout")
    return df


def build_orders(cfg: FlowConfig, rets: pd.DataFrame) -> pd.DataFrame:
    """Order-grain dataset: per-alert characteristics + directional P&L proxy."""
    a = _pull_alerts(cfg)
    trading_days = rets["date"].unique()
    a = add_feature_date(a, "time", trading_days)
    a = a[a["feature_date"].notna()].rename(columns={"feature_date": "date"})

    # characteristics
    a["dte"] = (a["expiry"] - a["date"]).dt.days
    a["is_call"] = (a["type"] == "CALL").astype("int8")
    # OTM distance in the option's own direction (>0 = OTM, <0 = ITM)
    a["otm_pct"] = np.where(
        a["type"] == "CALL", (a["strike"] - a["spot"]) / a["spot"],
        (a["spot"] - a["strike"]) / a["spot"],
    )
    a["vol_oi"] = a["size"] / a["oi"].clip(lower=1)
    a["ask_frac"] = a["ask_prem"] / (a["ask_prem"] + a["bid_prem"]).replace(0, np.nan)
    a["log_premium"] = np.log10(a["premium"].clip(lower=1))
    # thesis direction: UW's bullish/bearish call on the alert
    a["thesis_dir"] = np.where(a["sentiment"] == "BULLISH", 1.0,
                       np.where(a["sentiment"] == "BEARISH", -1.0, 0.0))

    a = a.merge(rets[["ticker", "date", *[f"fwd_{h}" for h in HORIZONS]]],
                on=["ticker", "date"], how="inner")
    for h in HORIZONS:
        a[f"pnl_{h}"] = a["thesis_dir"] * a[f"fwd_{h}"]   # directional underlying P&L proxy
        a[f"win_{h}"] = (a[f"pnl_{h}"] > 0).astype("int8")

    keep = [
        "id", "ticker", "date", "type", "side", "sentiment", "exec_type",
        "confidence", "sector", "multi_leg", "all_opening", "has_floor",
        "has_single_leg", "is_call", "strike", "spot", "expiry", "dte",
        "otm_pct", "size", "oi", "vol_oi", "premium", "log_premium",
        "ask_prem", "bid_prem", "ask_frac", "thesis_dir",
        *[f"fwd_{h}" for h in HORIZONS], *[f"pnl_{h}" for h in HORIZONS],
        *[f"win_{h}" for h in HORIZONS],
    ]
    out = _split_by_date(a[keep].copy())
    return out.sort_values(["date", "ticker"]).reset_index(drop=True)


def build_tickers(cfg: FlowConfig, rets: pd.DataFrame) -> pd.DataFrame:
    """Ticker-grain dataset: chain-flow features + forward returns."""
    sent = aggregate_sentiment(load_sentiment(cfg))
    t = sent.merge(rets, on=["ticker", "date"], how="inner")
    return _split_by_date(t).sort_values(["date", "ticker"]).reset_index(drop=True)


def run_build(cfg: FlowConfig = None) -> dict:
    cfg = cfg or FlowConfig()
    cfg.flow_dir.mkdir(parents=True, exist_ok=True)
    rets = load_forward_returns(cfg)

    orders = build_orders(cfg, rets)
    tickers = build_tickers(cfg, rets)
    op = cfg.flow_dir / "mining_orders.parquet"
    tp = cfg.flow_dir / "mining_tickers.parquet"
    orders.to_parquet(op, index=False)
    tickers.to_parquet(tp, index=False)

    def _span(d):
        return f"{d['date'].min().date()}..{d['date'].max().date()} ({d['date'].nunique()} dates)"
    print("\n=== mining datasets ===")
    print(f"orders : {len(orders):>7,d} rows · {_span(orders)}")
    print(f"  split: {dict(orders['split'].value_counts())}")
    for h in HORIZONS:
        m = orders[orders.split == 'mine']
        print(f"  win_{h} base rate (mine): {m[f'win_{h}'].mean():.3f}")
    print(f"tickers: {len(tickers):>7,d} rows · {_span(tickers)}")
    print(f"  split: {dict(tickers['split'].value_counts())}")
    return {"orders": str(op), "tickers": str(tp)}


def main(argv=None) -> None:
    import argparse
    argparse.ArgumentParser(description="Build flow-mining datasets.").parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_build()


if __name__ == "__main__":
    main()
