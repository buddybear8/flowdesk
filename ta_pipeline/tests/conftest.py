"""Shared fixtures for the ta_pipeline test suite."""

import pathlib
import sys

# Make the repository root importable regardless of the invocation directory,
# so ``import ta_pipeline`` works whether pytest runs from the repo root or
# from inside ta_pipeline/.
_REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

import ta_pipeline as tp  # noqa: E402


@pytest.fixture(scope="session")
def cfg():
    """Default pipeline configuration (brief §6 defaults)."""
    return tp.PipelineConfig()


@pytest.fixture(scope="session")
def make_ohlcv():
    """Factory: deterministic random-walk daily OHLCV for one ticker."""
    def _make(ticker="AAA", seed=1, n=900, vol=0.018, drift=0.0):
        rng = np.random.default_rng(seed)
        close = 100.0 * np.exp(np.cumsum(rng.normal(drift, vol, n)))
        high = close * (1.0 + np.abs(rng.normal(0, 0.012, n)))
        low = close * (1.0 - np.abs(rng.normal(0, 0.012, n)))
        return pd.DataFrame({
            "ticker": ticker,
            "date": pd.bdate_range("2019-01-02", periods=n),
            "open": close * (1.0 + rng.normal(0, 0.005, n)),
            "high": high,
            "low": low,
            "close": close,
            "volume": rng.integers(1_000_000, 5_000_000, n).astype(float),
            "vwap": close,
        })
    return _make


@pytest.fixture(scope="session")
def make_monotone():
    """Factory: a strictly monotone series with deterministic barrier outcomes."""
    def _make(ticker="MONO", step=0.5, n=160):
        close = 100.0 + step * np.arange(n, dtype=float)
        return pd.DataFrame({
            "ticker": ticker,
            "date": pd.bdate_range("2022-01-03", periods=n),
            "open": close,
            "high": close + 0.1,
            "low": close - 0.1,
            "close": close,
            "volume": np.full(n, 2e6),
            "vwap": close,
        })
    return _make


@pytest.fixture(scope="session")
def aaa_bars(make_ohlcv):
    """Raw OHLCV for one ticker (long enough to clear warmup)."""
    return make_ohlcv("AAA", seed=1, n=900)


@pytest.fixture(scope="session")
def aaa_untrimmed(aaa_bars, cfg):
    """Full built dataset, warmup + edge rows kept (with validity flags)."""
    return tp.build_dataset(aaa_bars, cfg, trim=False)


@pytest.fixture(scope="session")
def aaa_trimmed(aaa_bars, cfg):
    """The model-ready matrix: warmup + unlabelable rows trimmed."""
    return tp.build_dataset(aaa_bars, cfg, trim=True)
