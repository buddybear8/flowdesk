"""§7 warmup test.

The warmup region (half-formed features) and the unlabelable right edge are
dropped before the matrix reaches a model; no half-formed value survives.
"""

import pytest

import ta_pipeline as tp

# Columns bound by the longest lookbacks -- all must be formed after warmup.
_WARMUP_BOUND = [
    "sma_200", "atr_14", "rsi_14", "rsi_14_pctile", "atr_pctile",
    "bb_bandwidth_pctile", "bb_percent_b", "trend_stack_state",
    "atr_normalized", "slope_sma200",
]


def test_trim_filters_exactly_the_valid_rows(aaa_untrimmed, aaa_trimmed, cfg):
    assert len(aaa_trimmed) == int(aaa_untrimmed["is_valid"].sum())
    labelable = (aaa_untrimmed["label_long"].notna()
                 & aaa_untrimmed["label_short"].notna())
    expected_valid = ~aaa_untrimmed["is_warmup"] & labelable
    assert (aaa_untrimmed["is_valid"] == expected_valid).all()
    assert int(aaa_untrimmed["is_warmup"].sum()) == cfg.warmup_bars
    unlabelable = int((~labelable).sum())
    assert 1 <= unlabelable <= cfg.label_horizon


def test_no_half_formed_values_survive(aaa_trimmed):
    for col in _WARMUP_BOUND:
        assert aaa_trimmed[col].notna().all(), f"{col} still has NaN after trim"


def test_flag_columns_removed_after_trim(aaa_trimmed):
    for flag in ("is_warmup", "is_labelable", "is_valid"):
        assert flag not in aaa_trimmed.columns


def test_trim_requires_validity_flags(aaa_bars, cfg):
    features_only = tp.build_features(aaa_bars, cfg)
    with pytest.raises(KeyError):
        tp.trim_to_valid(features_only)
