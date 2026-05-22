"""§7 ATR-consistency test.

The ATR the triple-barrier labeler uses must be identical to the ATR the
features use -- one Wilder ATR(14), computed once, reused everywhere.
"""

import pandas as pd

import ta_pipeline as tp


def test_feature_atr_is_wilder_atr(aaa_bars, cfg):
    """The ``atr_<period>`` column equals an independent Wilder ATR recompute."""
    feat = tp.compute_indicators(aaa_bars, cfg)
    recomputed = tp.atr(feat["high"], feat["low"], feat["close"], cfg.atr_period)
    pd.testing.assert_series_equal(
        feat[f"atr_{cfg.atr_period}"], recomputed, check_names=False
    )


def test_labeler_barriers_match_the_feature_atr(aaa_untrimmed, cfg):
    """Every resolved barrier, reconstructed from the dataset's atr column,
    agrees with the labeler's recorded outcome -- proof of one shared ATR."""
    ds = aaa_untrimmed.reset_index(drop=True)
    atr = ds[f"atr_{cfg.atr_period}"].to_numpy()
    close, high, low = (ds[c].to_numpy() for c in ("close", "high", "low"))
    barrier = ds["label_long_barrier"].to_numpy()
    bars_to = ds["label_long_bars_to_outcome"].to_numpy()

    checked = 0
    for t in range(len(ds)):
        if barrier[t] not in ("profit", "stop"):
            continue
        d = int(bars_to[t])
        upper = close[t] + cfg.label_profit_atr * atr[t]
        lower = close[t] - cfg.label_stop_atr * atr[t]
        if barrier[t] == "profit":
            assert high[t + d] >= upper
            assert not (low[t + 1 : t + d] <= lower).any()
        else:
            assert low[t + d] <= lower
            assert not (high[t + 1 : t + d] >= upper).any()
        checked += 1
    assert checked > 50
