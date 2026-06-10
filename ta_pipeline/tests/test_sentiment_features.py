"""Chain-flow sentiment feature tests.

Covers the per-(ticker, date) aggregation maths (whole-chain / ATM / far-OTM
scopes), the close-aligned no-sessionizer mapping, the sparse join's 0-fill /
NaN policy and presence flag, cross-ticker isolation, and the leakage
guarantee (a feature for date D uses only D's chain).
"""

import numpy as np
import pandas as pd

from ta_pipeline.flow.sentiment_features import (
    SENTIMENT_RATIO_COLUMNS,
    SENTIMENT_SUM_COLUMNS,
    aggregate_sentiment,
    join_sentiment_features,
)


def _strike(ticker, date, spot, k, cA, cB, pA, pB, cP=0.0, pP=0.0):
    return dict(ticker=ticker, date=pd.Timestamp(date), spot=spot, k=k,
                cA=cA, cB=cB, pA=pA, pB=pB, cP=cP, pP=pP)


def _matrix(tickers=("AAA",), start="2026-05-04", n=10):
    dates = pd.bdate_range(start, periods=n)
    return pd.concat(
        [pd.DataFrame({"ticker": t, "date": dates, "close": 100.0 + np.arange(n)})
         for t in tickers],
        ignore_index=True,
    )


def test_whole_chain_aggregates():
    # spot 100; two call strikes, two put strikes.
    chain = pd.DataFrame([
        _strike("AAA", "2026-05-04", 100, 100, cA=60, cB=40, pA=10, pB=30, cP=500, pP=-200),
        _strike("AAA", "2026-05-04", 100, 110, cA=20, cB=10, pA=0, pB=0, cP=300, pP=0),
    ])
    g = aggregate_sentiment(chain).iloc[0]
    assert g["sent_call_vol"] == 130          # 60+40+20+10
    assert g["sent_put_vol"] == 40            # 10+30
    assert g["sent_cp_ratio"] == 130 / 40
    # call buy frac = ask / (ask+bid) = (60+20)/130
    assert g["sent_call_buy_frac"] == 80 / 130
    # net dir prem = net_call - net_put = 800 - (-200) = 1000
    assert g["sent_net_call_prem"] == 800
    assert g["sent_net_put_prem"] == -200
    assert g["sent_net_dir_prem"] == 1000
    # dir score = 1000 / (|500|+|300| + |-200|+|0|) = 1000/1000
    assert g["sent_dir_prem_score"] == 1.0
    assert g["sent_strike_count"] == 2


def test_atm_and_otm_scopes():
    # spot 100: 100 is ATM (<=2.5%), 110 is far-OTM call (>5%), 90 far-OTM put.
    chain = pd.DataFrame([
        _strike("AAA", "2026-05-04", 100, 100, cA=80, cB=20, pA=30, pB=70),
        _strike("AAA", "2026-05-04", 100, 110, cA=40, cB=0, pA=0, pB=0),   # OTM call buying
        _strike("AAA", "2026-05-04", 100, 90, cA=0, cB=0, pA=50, pB=0),    # OTM put buying
    ])
    g = aggregate_sentiment(chain).iloc[0]
    # ATM call imbalance uses only the 100 strike: (80-20)/(80+20)=0.6
    assert g["sent_atm_call_imb"] == 0.6
    assert g["sent_atm_put_imb"] == (30 - 70) / (30 + 70)
    # OTM call buy frac = 40 / total call ask (80+40) = 40/120
    assert g["sent_otm_call_buy_frac"] == 40 / 120
    assert g["sent_otm_put_buy_frac"] == 50 / (30 + 50)


def test_zero_put_volume_ratio_is_nan():
    chain = pd.DataFrame([
        _strike("AAA", "2026-05-04", 100, 100, cA=50, cB=50, pA=0, pB=0),
    ])
    g = aggregate_sentiment(chain).iloc[0]
    assert np.isnan(g["sent_cp_ratio"])        # no puts -> no honest ratio
    assert np.isnan(g["sent_put_buy_frac"])
    assert g["sent_call_vol"] == 100


def test_join_fill_policy_and_presence_flag():
    matrix = _matrix(("AAA", "BBB"), n=5)
    chain = pd.DataFrame([
        _strike("AAA", matrix["date"].iloc[0], 100, 100, cA=10, cB=5, pA=2, pB=8),
    ])
    agg = aggregate_sentiment(chain)
    out = join_sentiment_features(matrix, agg)

    assert len(out) == len(matrix)             # row preservation
    assert out["has_sentiment"].sum() == 1     # only the one AAA day
    hit = out[out["has_sentiment"] == 1].iloc[0]
    assert hit["ticker"] == "AAA"
    # sums 0-filled on the misses, ratios NaN
    miss = out[out["has_sentiment"] == 0]
    for col in SENTIMENT_SUM_COLUMNS:
        assert (miss[col] == 0.0).all()
    for col in SENTIMENT_RATIO_COLUMNS:
        assert miss[col].isna().all()


def test_cross_ticker_isolation():
    chain = pd.DataFrame([
        _strike("AAA", "2026-05-04", 100, 100, cA=100, cB=0, pA=0, pB=0),
        _strike("BBB", "2026-05-04", 100, 100, cA=0, cB=100, pA=0, pB=0),
    ])
    g = aggregate_sentiment(chain).set_index("ticker")
    assert g.loc["AAA", "sent_call_buy_frac"] == 1.0   # all ask
    assert g.loc["BBB", "sent_call_buy_frac"] == 0.0   # all bid


def test_no_lookahead_date_is_close_aligned():
    # Each ticker-day's features must depend only on that day's strikes:
    # aggregating the full frame, then slicing to one date, equals aggregating
    # that date alone.
    chain = pd.DataFrame([
        _strike("AAA", "2026-05-04", 100, 100, cA=10, cB=5, pA=1, pB=2, cP=100, pP=-50),
        _strike("AAA", "2026-05-05", 101, 101, cA=99, cB=1, pA=0, pB=9, cP=999, pP=10),
    ])
    full = aggregate_sentiment(chain)
    day1 = aggregate_sentiment(chain[chain["date"] == pd.Timestamp("2026-05-04")])
    merged = full[full["date"] == pd.Timestamp("2026-05-04")].reset_index(drop=True)
    pd.testing.assert_frame_equal(merged, day1, check_dtype=False)


def test_empty_chain_returns_empty_schema():
    g = aggregate_sentiment(pd.DataFrame(columns=["ticker", "date", "spot", "k", "cA", "cB", "pA", "pB", "cP", "pP"]))
    assert g.empty
    assert "sent_net_dir_prem" in g.columns
