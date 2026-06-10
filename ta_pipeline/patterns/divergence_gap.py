"""Pattern family ``divergence_gap`` — RSI divergence at swings + ATR gaps.

Two sub-families of sparse, event-grained detectors over daily OHLCV:

* **rsi_divergence** — price makes a lower low across two consecutive
  confirmed swing lows while RSI(14) makes a higher low → bullish event,
  fired at the SECOND swing's confirmation bar (``pivot + m``); mirrored for
  bearish (higher high in price, lower high in RSI, at confirmed swing
  highs). Built on the same centered-pivot / confirmation-bar machinery as
  :mod:`ta_pipeline.swings` — only confirmed pivots, only past values.

* **gap** — opening gaps of at least ``gap_min_atr`` ATRs versus the prior
  close (ATR pinned to the PRIOR bar, so the threshold is knowable at the
  open). Two pre-registered hypotheses share the gap definition and
  partition the gap days by the intraday resolution at that day's close:

  - ``gap-and-go``  (mode="go"):   close beyond the open in the gap
    direction → continuation event in the gap direction.
  - ``gap-fade``    (mode="fade"): close against the open → reversal event
    against the gap direction.

Every event dated ``t`` uses only data through ``t``'s close (truncation
test in ``tests/test_pattern_divergence_gap.py``), so an event row can be
joined to the triple-barrier label at ``t`` without leakage.

HTF conditioning — :func:`weekly_trend_state` derives a weekly trend state
from the SAME daily candles (resample W-FRI; weekly close > SMA10 > SMA20
stack = +1, mirrored = -1, else 0). A week's state is knowable only after
its Friday close, so every day inside week ``w`` carries week ``w-1``'s
state. All detectors emit it as the ``htf_state`` meta column.

Pre-registered parameterizations (fixed BEFORE looking at outcomes —
multiplicity discipline; all are reported, none is tuned):

==================  =====================================================
``rsi_div_m3``      divergence at swing_m=3 confirmed pivots (pipeline
                    default sensitivity)
``rsi_div_m5``      divergence at swing_m=5 (slower pivots)
``rsi_div_m3_ext``  m=3 + first pivot's RSI must be extreme
                    (<= 40 bullish / >= 60 bearish)
``gap_go_1.0``      gap >= 1.0 ATR, continuation close
``gap_go_1.5``      gap >= 1.5 ATR, continuation close
``gap_fade_1.0``    gap >= 1.0 ATR, reversal close
``gap_fade_1.5``    gap >= 1.5 ATR, reversal close
==================  =====================================================

Operates on a single ticker, sorted by date (the eval harness groups by
ticker).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..indicators import atr as wilder_atr
from ..indicators import rsi as wilder_rsi
from ..swings import detect_pivots

#: weekly SMA windows for the higher-timeframe trend stack
HTF_SMA_FAST = 10
HTF_SMA_SLOW = 20


def _check_input(df: pd.DataFrame) -> None:
    if df["date"].is_monotonic_increasing:
        return
    raise ValueError("detector expects a single ticker sorted by date")


def weekly_trend_state(df: pd.DataFrame) -> pd.Series:
    """Prior-completed-week trend state for each daily bar (+1 / 0 / -1 / NaN).

    Weekly bars are resampled W-FRI from the daily candles. Week ``w``'s
    state is +1 when its weekly close > weekly SMA10 > weekly SMA20, -1 when
    mirrored below, 0 otherwise (NaN until SMA20 has 20 completed weeks).
    The state is knowable only after ``w``'s Friday close, so every day
    inside week ``w`` is assigned week ``w-1``'s state — no lookahead, and
    a truncation mid-week cannot change any earlier day's value.
    """
    _check_input(df)
    week = df["date"].dt.to_period("W-FRI")
    weekly_close = df.groupby(week.to_numpy(), sort=True)["close"].last()
    fast = weekly_close.rolling(HTF_SMA_FAST, min_periods=HTF_SMA_FAST).mean()
    slow = weekly_close.rolling(HTF_SMA_SLOW, min_periods=HTF_SMA_SLOW).mean()
    state = pd.Series(np.nan, index=weekly_close.index)
    state[slow.notna()] = 0.0
    state[(weekly_close > fast) & (fast > slow)] = 1.0
    state[(weekly_close < fast) & (fast < slow)] = -1.0
    prior = state.shift(1)  # week w's days carry week w-1's state
    mapped = week.map(prior)
    return pd.Series(mapped.to_numpy(dtype=float), index=df.index,
                     name="htf_state")


def _divergence_side(
    pivot_price: pd.Series,
    pivot_rsi: pd.Series,
    price_dir: int,
    rsi_dir: int,
    extreme_rsi: float = None,
    extreme_dir: int = 0,
) -> "tuple":
    """One-sided divergence events on confirmation-aligned pivot series.

    ``pivot_price`` / ``pivot_rsi`` are sparse (NaN except at confirmation
    bars). At each confirmed pivot the change versus the PREVIOUS confirmed
    pivot of the same kind is measured; an event fires when price moved in
    ``price_dir`` while RSI moved in ``rsi_dir``. ``extreme_rsi`` optionally
    requires the FIRST pivot's RSI to be at/beyond it (direction given by
    ``extreme_dir``: -1 = at most, +1 = at least).

    Returns ``(event, strength)`` — a boolean Series and the |RSI delta| at
    the event bars (0 elsewhere), both on the full index.
    """
    events = pivot_price.dropna()
    rsi_at = pivot_rsi.reindex(events.index)
    d_price = events.diff()
    d_rsi = rsi_at.diff()
    hit = (d_price * price_dir > 0) & (d_rsi * rsi_dir > 0)
    if extreme_rsi is not None:
        first_rsi = rsi_at.shift(1)
        if extreme_dir < 0:
            hit = hit & (first_rsi <= extreme_rsi)
        else:
            hit = hit & (first_rsi >= extreme_rsi)
    event = pd.Series(False, index=pivot_price.index)
    event.loc[events.index[hit.to_numpy()]] = True
    strength = pd.Series(0.0, index=pivot_price.index)
    strength[event] = d_rsi.reindex(events.index)[hit].abs().to_numpy()
    return event, strength


def detect_rsi_divergence(
    df: pd.DataFrame,
    m: int = 3,
    rsi_period: int = 14,
    extreme_rsi: float = None,
) -> pd.DataFrame:
    """RSI divergence events at confirmed swing pivots.

    Bullish (``event_long``): across two consecutive confirmed swing lows,
    price lower low + RSI higher low — fired at the second low's
    confirmation bar (``pivot + m``). Bearish (``event_short``) mirrored at
    swing highs. ``extreme_rsi`` (e.g. 40.0) additionally requires the first
    pivot's RSI <= 40 (bullish) / >= 60 (bearish).

    Returns a same-index DataFrame: ``event_long``, ``event_short``,
    ``strength`` (|RSI delta| between the two pivots), ``htf_state``.
    """
    _check_input(df)
    high, low, close = df["high"], df["low"], df["close"]
    r = wilder_rsi(close, rsi_period)
    is_high, is_low = detect_pivots(high, low, m)

    # Pivot price and RSI-at-pivot, shifted to the confirmation bar (p + m).
    high_price = high.where(is_high).shift(m)
    low_price = low.where(is_low).shift(m)
    high_rsi = r.where(is_high).shift(m)
    low_rsi = r.where(is_low).shift(m)

    bull, bull_strength = _divergence_side(
        low_price, low_rsi, price_dir=-1, rsi_dir=+1,
        extreme_rsi=extreme_rsi, extreme_dir=-1,
    )
    bear, bear_strength = _divergence_side(
        high_price, high_rsi, price_dir=+1, rsi_dir=-1,
        extreme_rsi=(None if extreme_rsi is None else 100.0 - extreme_rsi),
        extreme_dir=+1,
    )

    out = pd.DataFrame(index=df.index)
    out["event_long"] = bull
    out["event_short"] = bear
    out["strength"] = bull_strength.where(bull_strength > 0, bear_strength)
    out["htf_state"] = weekly_trend_state(df)
    return out


def detect_gap(
    df: pd.DataFrame,
    mode: str = "go",
    gap_min_atr: float = 1.0,
    atr_period: int = 14,
) -> pd.DataFrame:
    """ATR-scaled opening-gap events, continuation ("go") or reversal ("fade").

    A gap day has ``|open - prior close| >= gap_min_atr * ATR(prior bar)``
    (Wilder ATR pinned to the prior bar — fully formed before the gap). The
    event is dated to the gap day itself and uses that day's close:

    * ``mode="go"``   — gap up & close > open → ``event_long``;
      gap down & close < open → ``event_short``  (continuation).
    * ``mode="fade"`` — gap up & close < open → ``event_short``;
      gap down & close > open → ``event_long``   (reversal).

    Returns a same-index DataFrame: ``event_long``, ``event_short``,
    ``strength`` (|gap| in ATR), ``gap_atr`` (signed), ``htf_state``.
    """
    if mode not in ("go", "fade"):
        raise ValueError(f"mode must be 'go' or 'fade', got {mode!r}")
    _check_input(df)
    open_, close = df["open"], df["close"]
    atr_prev = wilder_atr(df["high"], df["low"], close, atr_period).shift(1)
    gap_atr = (open_ - close.shift(1)) / atr_prev
    gap_up = gap_atr >= gap_min_atr
    gap_down = gap_atr <= -gap_min_atr

    if mode == "go":
        event_long = gap_up & (close > open_)
        event_short = gap_down & (close < open_)
    else:
        event_long = gap_down & (close > open_)
        event_short = gap_up & (close < open_)

    out = pd.DataFrame(index=df.index)
    out["event_long"] = event_long.fillna(False)
    out["event_short"] = event_short.fillna(False)
    fired = out["event_long"] | out["event_short"]
    out["strength"] = gap_atr.abs().where(fired, 0.0).fillna(0.0)
    out["gap_atr"] = gap_atr
    out["htf_state"] = weekly_trend_state(df)
    return out


def make_detectors() -> "dict":
    """The pre-registered detector set: ``{name: detect(df) callable}``.

    Exactly the seven parameterizations declared in the module docstring —
    fixed before evaluation, all reported, none tuned afterwards.
    """
    return {
        "rsi_div_m3": lambda df: detect_rsi_divergence(df, m=3),
        "rsi_div_m5": lambda df: detect_rsi_divergence(df, m=5),
        "rsi_div_m3_ext": lambda df: detect_rsi_divergence(
            df, m=3, extreme_rsi=40.0
        ),
        "gap_go_1.0": lambda df: detect_gap(df, mode="go", gap_min_atr=1.0),
        "gap_go_1.5": lambda df: detect_gap(df, mode="go", gap_min_atr=1.5),
        "gap_fade_1.0": lambda df: detect_gap(df, mode="fade", gap_min_atr=1.0),
        "gap_fade_1.5": lambda df: detect_gap(df, mode="fade", gap_min_atr=1.5),
    }


#: sub-family of each pre-registered detector (for separate reporting)
SUB_FAMILY = {
    "rsi_div_m3": "rsi_divergence",
    "rsi_div_m5": "rsi_divergence",
    "rsi_div_m3_ext": "rsi_divergence",
    "gap_go_1.0": "gap",
    "gap_go_1.5": "gap",
    "gap_fade_1.0": "gap",
    "gap_fade_1.5": "gap",
}
