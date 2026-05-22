"""§7 labeler correctness — mirrored long/short triple barriers.

Barrier touches, first-touch-wins, the two-sided tie-break, the no-touch
(timeout) rule, and that long / short are genuine mirrors.
"""

import numpy as np
import pandas as pd

import ta_pipeline as tp


def test_monotone_up_long_wins_short_loses(cfg, make_monotone):
    lab = tp.add_labels(tp.compute_indicators(make_monotone(step=0.5), cfg), cfg)
    assert (lab["label_long"].dropna() == 1.0).all()
    assert (lab["label_short"].dropna() == 0.0).all()


def test_monotone_down_long_loses_short_wins(cfg, make_monotone):
    lab = tp.add_labels(tp.compute_indicators(make_monotone(step=-0.5), cfg), cfg)
    assert (lab["label_long"].dropna() == 0.0).all()
    assert (lab["label_short"].dropna() == 1.0).all()


def test_two_sided_bar_breaks_to_the_stop_on_both_sides(cfg):
    """A single bar that touches both barriers is counted as the stop — for
    the long AND the short."""
    # 60 calm bars (constant true range -> ATR == 1.0); bar 41 breaches both.
    n, t = 60, 40
    close = np.full(n, 100.0)
    high = close + 0.5
    low = close - 0.5
    high[t + 1] = 105.0   # above both the long +1.5 ATR and the short +1.0 ATR
    low[t + 1] = 95.0     # below both the long -1.0 ATR and the short -1.5 ATR
    df = pd.DataFrame({
        "ticker": "TIE",
        "date": pd.bdate_range("2022-01-03", periods=n),
        "open": close, "high": high, "low": low, "close": close,
        "volume": np.full(n, 2e6), "vwap": close,
    })
    lab = tp.add_labels(tp.compute_indicators(df, cfg), cfg)
    for side in ("long", "short"):
        assert lab[f"label_{side}_barrier"].iloc[t] == "stop"
        assert lab[f"label_{side}"].iloc[t] == 0.0
        assert lab[f"label_{side}_bars_to_outcome"].iloc[t] == 1.0


def test_first_touch_wins_on_both_sides(aaa_untrimmed, cfg):
    """No barrier of a side is touched before that side's recorded outcome."""
    ds = aaa_untrimmed.reset_index(drop=True)
    atr = ds[f"atr_{cfg.atr_period}"].to_numpy()
    close, high, low = (ds[c].to_numpy() for c in ("close", "high", "low"))
    for side in ("long", "short"):
        barrier = ds[f"label_{side}_barrier"].to_numpy()
        bars_to = ds[f"label_{side}_bars_to_outcome"].to_numpy()
        if side == "long":
            up = close + cfg.label_profit_atr * atr      # long profit
            dn = close - cfg.label_stop_atr * atr        # long stop
        else:
            up = close + cfg.label_stop_atr * atr        # short stop
            dn = close - cfg.label_profit_atr * atr      # short profit
        for t in range(len(ds)):
            if barrier[t] not in ("profit", "stop"):
                continue
            d = int(bars_to[t])
            assert not (high[t + 1 : t + d] >= up[t]).any()
            assert not (low[t + 1 : t + d] <= dn[t]).any()


def test_timeout_label_is_sign_of_the_trade_return(aaa_untrimmed):
    long_to = aaa_untrimmed[aaa_untrimmed["label_long_barrier"] == "timeout"]
    short_to = aaa_untrimmed[aaa_untrimmed["label_short_barrier"] == "timeout"]
    assert len(long_to) > 0 and len(short_to) > 0
    # long wins on a positive terminal move, short wins on a negative one.
    assert (long_to["label_long"]
            == (long_to["terminal_return_10"] > 0).astype(float)).all()
    assert (short_to["label_short"]
            == (short_to["terminal_return_10"] < 0).astype(float)).all()
