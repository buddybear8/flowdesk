"""Support/resistance FLIP retest detector (pattern family: ``sr_flip``).

Horizontal levels are built by clustering CONFIRMED swing-pivot prices
(:func:`ta_pipeline.swings.detect_pivots`, confirmation at ``pivot + m``)
within ``cluster_tol_atr`` ATR of each other. A level's current ROLE is
defined by which side of it price closes on:

* price below the level -> the level acts as resistance;
* a close more than ``break_margin_atr`` ATR above it = an upward BREAK
  (resistance -> prospective support);
* a break only ARMS the setup when the level genuinely acted as resistance
  first -- price must have occupied the breaking side's opposite side for at
  least ``min_break_side_bars`` bars;
* the FIRST later bar whose low comes back into the level zone
  (``low <= level + zone_atr * ATR``) decides the setup: if it does not
  pierce deeper than ``max_pierce_atr`` ATR below the level and its close
  holds back above (``close > level + hold_margin_atr * ATR``), it is the
  FLIP RETEST HOLD -> ``event_long`` fires on that bar (the hold day);
  otherwise the retest failed and the break is consumed with no event.

The short side is the exact mirror: support broken downward, retested from
below as resistance, close holding back below.

Strength = (number of prior pivot touches of the level) x (cleanliness of the
hold), where cleanliness in [0.25, 1] decays linearly with how deep the retest
pierced the level (1.0 = the level was never pierced).

Leakage discipline
------------------
Everything at bar t uses only bars <= t:

* pivot prices enter at their CONFIRMATION bar (``p + m``), never the pivot
  bar (mirrors ``swings.add_swings``);
* the Wilder ATR used for all tolerances is strictly trailing;
* the level book is updated by a single forward pass -- the event check at
  bar t runs against the book as of bar t-1's close plus bar t's own OHLC.

Computing ``detect`` on ``history[:t]`` therefore yields exactly the events
that ``detect`` on the full history yields for bars ``< t`` (truncation
invariance -- enforced by ``tests/test_pattern_sr_flip.py``).

HTF conditioning
----------------
``htf_state`` is a weekly-trend state (+1 up / -1 down / 0 mixed / NaN warmup)
resampled W-FRI from the same daily candles, using weekly close vs the weekly
SMA10/SMA20 stack. Day t inside week W carries the state of the PRIOR
completed week (the weekly series is shifted by one completed week), so no
day ever reads its own week's Friday close. It is meta only -- events are
never gated on it; the evaluation reports unconditional and HTF-aligned
metrics side by side.

Operates per ticker (``detect``); ``detect_universe`` maps it over a
long-format multi-ticker frame.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from ..indicators import atr as wilder_atr
from ..swings import detect_pivots


@dataclass(frozen=True)
class SRFlipParams:
    """One pre-registered parameterization of the sr_flip detector."""

    name: str = "base"
    swing_m: int = 3              # pivot confirmation half-width
    atr_period: int = 14          # the project-standard Wilder ATR
    cluster_tol_atr: float = 0.25  # pivots within this of a level merge into it
    min_touches: int = 2          # pivot touches a level needs before its flip counts
    break_margin_atr: float = 0.25  # close must clear the level by this to break it
    zone_atr: float = 0.25        # retest zone half-width around the level
    max_pierce_atr: float = 0.5   # retest piercing deeper than this = failed, no event
    hold_margin_atr: float = 0.0  # close must hold beyond the level by this
    retest_min_bars: int = 2      # retest must come at least this many bars after the break
    retest_max_bars: int = 40     # ... and at most this many
    min_break_side_bars: int = 10  # level must have held its prior role this long
    level_max_age: int = 250      # drop levels untouched/unbroken for this many bars


# Pre-registered parameterizations -- all three are reported, none was tuned
# on outcomes (multiplicity discipline). Densities were calibrated on random
# walks / raw candles BEFORE any label was inspected.
PARAM_SETS = (
    SRFlipParams(name="base"),
    SRFlipParams(name="strict", min_touches=3, retest_max_bars=30,
                 hold_margin_atr=0.1),
    SRFlipParams(name="loose", zone_atr=0.4, retest_min_bars=1,
                 retest_max_bars=60, break_margin_atr=0.1,
                 min_break_side_bars=5),
)


# ---------------------------------------------------------------------------
# HTF weekly trend state
# ---------------------------------------------------------------------------

def weekly_trend_state(df: pd.DataFrame, fast: int = 10, slow: int = 20) -> pd.Series:
    """Prior-completed-week trend state for each daily bar of one ticker.

    Weekly bars are the W-FRI resample of the daily closes. Week state is
    +1 when weekly close > SMA{fast} > SMA{slow}, -1 when the stack is
    inverted, 0 otherwise, NaN until both SMAs are formed. Each daily bar is
    assigned the state of the PRIOR completed week (a one-week shift), so a
    day never reads any close of its own, possibly unfinished, week.
    """
    s = df.set_index("date")["close"].sort_index()
    weekly = s.resample("W-FRI").last().dropna()
    sma_fast = weekly.rolling(fast, min_periods=fast).mean()
    sma_slow = weekly.rolling(slow, min_periods=slow).mean()
    state = pd.Series(0.0, index=weekly.index)
    state[(weekly > sma_fast) & (sma_fast > sma_slow)] = 1.0
    state[(weekly < sma_fast) & (sma_fast < sma_slow)] = -1.0
    state[sma_fast.isna() | sma_slow.isna()] = np.nan
    prior = state.shift(1)  # prior completed week-with-data

    week_end = df["date"].dt.to_period("W-FRI").dt.end_time.dt.normalize()
    out = week_end.map(prior)
    out.name = "htf_state"
    return out.astype(float)


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

def detect(df: pd.DataFrame, params: SRFlipParams = None) -> pd.DataFrame:
    """Run the sr_flip detector on ONE ticker's daily OHLCV frame.

    Returns a same-index DataFrame with ``event_long`` / ``event_short``
    (bool), ``strength`` (float; touches x cleanliness, 0 when no event) and
    meta: ``level_price``, ``level_touches``, ``break_age`` (bars since the
    level's break) and ``htf_state``.
    """
    params = params or PARAM_SETS[0]
    if df.empty:
        return pd.DataFrame(
            columns=["event_long", "event_short", "strength", "level_price",
                     "level_touches", "break_age", "htf_state"],
            index=df.index,
        )
    if "ticker" in df.columns and df["ticker"].nunique() > 1:
        raise ValueError("detect operates on a single ticker; use detect_universe")

    bars = df.sort_values("date").reset_index(drop=True)
    n = len(bars)
    high_s, low_s, close_s = bars["high"], bars["low"], bars["close"]
    h = high_s.to_numpy(dtype=float)
    lo = low_s.to_numpy(dtype=float)
    c = close_s.to_numpy(dtype=float)
    atr = wilder_atr(high_s, low_s, close_s, params.atr_period).to_numpy(dtype=float)

    # Confirmed pivot prices, placed at their confirmation bar p + m.
    m = params.swing_m
    is_high, is_low = detect_pivots(high_s, low_s, m)
    piv_high = high_s.where(is_high).shift(m).to_numpy(dtype=float)
    piv_low = low_s.where(is_low).shift(m).to_numpy(dtype=float)

    event_long = np.zeros(n, dtype=bool)
    event_short = np.zeros(n, dtype=bool)
    strength = np.zeros(n, dtype=float)
    level_price = np.full(n, np.nan)
    level_touches = np.full(n, np.nan)
    break_age = np.full(n, np.nan)

    # Level book. Each level: price (running mean of clustered pivot prices),
    # psum/touches, side (+1 price above / -1 below), break_dir/break_bar of
    # the most recent side flip, consumed (one retest event per break),
    # last_bar (last touch or break -- for pruning).
    levels = []

    for t in range(n):
        a = atr[t]
        if not np.isfinite(a) or a <= 0.0:
            continue

        # ---- 1) event check: book state through t-1, today's OHLC ------
        # The FIRST bar back in the level zone after an armed break decides
        # the setup: hold -> event; pierce-too-deep or close back across ->
        # failed retest. Either way the break is consumed.
        for lev in levels:
            if lev["break_dir"] == 0 or lev["consumed"]:
                continue
            age = t - lev["break_bar"]
            if age < params.retest_min_bars:
                continue
            if age > params.retest_max_bars:
                lev["consumed"] = True       # never retested in time
                continue
            price = lev["price"]
            if lev["break_dir"] == 1:
                # resistance broken up; retest from above must hold.
                if lo[t] > price + params.zone_atr * a:
                    continue                 # not yet back in the zone
                lev["consumed"] = True
                held = (lo[t] >= price - params.max_pierce_atr * a
                        and c[t] > price + params.hold_margin_atr * a
                        and c[t - 1] > price)
                if held and lev["touches"] >= params.min_touches:
                    pierce = max(price - lo[t], 0.0) / (params.max_pierce_atr * a)
                    clean = 1.0 - 0.75 * min(pierce, 1.0)
                    s = lev["touches"] * clean
                    if (not event_long[t]) or s > strength[t]:
                        strength[t] = s
                        level_price[t] = price
                        level_touches[t] = lev["touches"]
                        break_age[t] = age
                    event_long[t] = True
            else:
                # support broken down; retest from below must be rejected.
                if h[t] < price - params.zone_atr * a:
                    continue                 # not yet back in the zone
                lev["consumed"] = True
                held = (h[t] <= price + params.max_pierce_atr * a
                        and c[t] < price - params.hold_margin_atr * a
                        and c[t - 1] < price)
                if held and lev["touches"] >= params.min_touches:
                    pierce = max(h[t] - price, 0.0) / (params.max_pierce_atr * a)
                    clean = 1.0 - 0.75 * min(pierce, 1.0)
                    s = lev["touches"] * clean
                    if (not event_short[t]) or s > strength[t]:
                        strength[t] = s
                        level_price[t] = price
                        level_touches[t] = lev["touches"]
                        break_age[t] = age
                    event_short[t] = True

        # ---- 2) break / side update with today's close ------------------
        for lev in levels:
            price = lev["price"]
            if c[t] > price + params.break_margin_atr * a:
                cur = 1
            elif c[t] < price - params.break_margin_atr * a:
                cur = -1
            else:
                cur = lev["side"]
            if cur != lev["side"]:
                # the break arms a retest setup only when the level genuinely
                # held its prior role for a while first.
                if t - lev["side_since"] >= params.min_break_side_bars:
                    lev["break_dir"] = cur
                    lev["break_bar"] = t
                    lev["consumed"] = False
                lev["side"] = cur
                lev["side_since"] = t
                lev["last_bar"] = t

        # ---- 3) absorb pivots confirmed today ---------------------------
        for pivot in (piv_high[t], piv_low[t]):
            if not np.isfinite(pivot):
                continue
            best, best_dist = None, params.cluster_tol_atr * a
            for lev in levels:
                d = abs(lev["price"] - pivot)
                if d <= best_dist:
                    best, best_dist = lev, d
            if best is not None:
                best["psum"] += pivot
                best["touches"] += 1
                best["price"] = best["psum"] / best["touches"]
                best["last_bar"] = t
            else:
                levels.append({
                    "price": pivot, "psum": pivot, "touches": 1,
                    "side": 1 if c[t] > pivot else -1, "side_since": t,
                    "break_dir": 0, "break_bar": -1, "consumed": True,
                    "last_bar": t,
                })

        # ---- 4) prune stale levels --------------------------------------
        if levels:
            levels = [lev for lev in levels
                      if t - lev["last_bar"] <= params.level_max_age]

    out = pd.DataFrame({
        "event_long": event_long,
        "event_short": event_short,
        "strength": strength,
        "level_price": level_price,
        "level_touches": level_touches,
        "break_age": break_age,
        "htf_state": weekly_trend_state(bars).to_numpy(dtype=float),
    })
    out.index = bars.index
    return out


def detect_universe(df: pd.DataFrame, params: SRFlipParams = None) -> pd.DataFrame:
    """Apply :func:`detect` per ticker over a long-format universe frame.

    Returns ``ticker`` + ``date`` + the detector columns, one row per input
    bar, ready to merge onto the feature matrix on (ticker, date).
    """
    parts = []
    for ticker, g in df.groupby("ticker", sort=False):
        g = g.sort_values("date").reset_index(drop=True)
        res = detect(g, params)
        res.insert(0, "date", g["date"].to_numpy())
        res.insert(0, "ticker", ticker)
        parts.append(res)
    if not parts:
        return pd.DataFrame()
    return pd.concat(parts, ignore_index=True)


def params_dict(params: SRFlipParams) -> dict:
    """Flat dict of a parameterization, for report provenance."""
    return asdict(params)
