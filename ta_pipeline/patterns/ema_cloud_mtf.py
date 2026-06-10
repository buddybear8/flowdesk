"""EMA-cloud multi-timeframe detector — pattern family ``ema_cloud_mtf``.

Ripster's core "EMA cloud" system, ported to daily bars. Two EMA *clouds*
(bands) are stacked:

  * **FAST cloud** — the band between EMA(a) and EMA(b) (small periods). Its
    upper edge is ``max(EMA_a, EMA_b)``, lower edge ``min(EMA_a, EMA_b)``.
  * **SLOW cloud** — the band between EMA(c) and EMA(d) (large periods, default
    34/50). Its *midline* is ``(EMA_c + EMA_d)/2``; the sign of that midline's
    1-bar slope is the cloud's "curl" (clouds curling up = bullish).

Two event modes (multi-cloud alignment, mirror for shorts):

  ``reclaim`` (default)
      LONG = price was below the fast cloud (prior close <= fast-cloud top)
      and now CLOSES above it (close > fast-cloud top) — a reclaim — WHILE the
      slow cloud is bullish (close above the slow-cloud top AND the slow
      midline is curling up, slope >= 0). SHORT mirrors: prior close >= fast
      bottom, close < fast bottom, while slow cloud bearish (close below slow
      bottom and slow midline curling down).

  ``curl_flip``
      LONG = the slow-cloud midline slope FLIPS up (<=0 -> >0) on bar t while
      price is already above the slow cloud (close > slow-cloud top). SHORT
      mirrors. This isolates the "cloud curl" from the fast-cloud reclaim.

``strength`` = reclaim distance through the fast-cloud edge in ATR units
(``reclaim`` mode) or the magnitude of the slow-midline slope flip in ATR
units (``curl_flip`` mode).

PRE-REGISTERED parameterizations (all reported; none tuned post hoc):

  ``ripster``  fast EMA 5/12, slow EMA 34/50   (ripster's stated stack)
  ``classic``  fast EMA 8/21, slow EMA 34/50   (the common 8/21 + 34/50)
  ``wide``     fast EMA 9/20, slow EMA 50/100  (slower confirmation)

Each is evaluated in both modes (``reclaim`` and ``curl_flip``), so six
detector cells total — fixed before any label/outcome was inspected.

No lookahead, by construction:

  * EMAs are causal (``ewm(span=...).mean()`` over closes up to t only);
  * the slow-midline slope at t is ``midline[t] - midline[t-1]`` — past only;
  * the "was below the cloud" condition reads the PRIOR close (``shift(1)``);
  * ATR is the trailing Wilder ATR(14), the labeler's ATR;
  * a warmup mask blanks every bar before the slowest EMA span has formed, so
    no event can fire on a half-formed cloud;
  * :func:`weekly_trend_state` maps each day to the PRIOR completed W-FRI week.

Operates on a single ticker; compute per ticker, never across.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from ..indicators import atr as wilder_atr


@dataclass(frozen=True)
class EmaCloudParams:
    """One pre-registered EMA-cloud parameterization."""

    name: str = "ripster"
    fast_a: int = 5             # fast cloud EMA spans
    fast_b: int = 12
    slow_c: int = 34            # slow cloud EMA spans
    slow_d: int = 50
    atr_period: int = 14

    @property
    def warmup(self) -> int:
        """Bars to blank before the slowest EMA span is meaningfully formed."""
        return max(self.fast_a, self.fast_b, self.slow_c, self.slow_d,
                   self.atr_period) + 2

    def to_dict(self) -> dict:
        return asdict(self)


# Three pre-registered EMA sets (module docstring); both modes each.
PARAM_SETS = {
    "ripster": EmaCloudParams(name="ripster", fast_a=5, fast_b=12,
                              slow_c=34, slow_d=50),
    "classic": EmaCloudParams(name="classic", fast_a=8, fast_b=21,
                              slow_c=34, slow_d=50),
    "wide": EmaCloudParams(name="wide", fast_a=9, fast_b=20,
                           slow_c=50, slow_d=100),
}

MODES = ("reclaim", "curl_flip")

#: The six pre-registered detector cells: (param_set, mode).
VARIANTS = tuple(f"{name}_{mode}" for name in PARAM_SETS for mode in MODES)


def _parse_variant(variant):
    """``"ripster_reclaim"`` -> (EmaCloudParams, "reclaim")."""
    if isinstance(variant, tuple):
        return variant
    for name in PARAM_SETS:
        for mode in MODES:
            if variant == f"{name}_{mode}":
                return PARAM_SETS[name], mode
    raise KeyError(f"unknown variant: {variant}")


def _require_sorted(df: pd.DataFrame) -> None:
    if "date" in df.columns and not df["date"].is_monotonic_increasing:
        raise ValueError("bars must be sorted by date (single ticker)")


def _ema(close: pd.Series, span: int) -> pd.Series:
    """Causal EMA — uses closes up to and including t only."""
    return close.ewm(span=span, adjust=False, min_periods=span).mean()


def detect(df: pd.DataFrame, variant="ripster_reclaim") -> pd.DataFrame:
    """Detect EMA-cloud reclaim / curl-flip events for one ticker.

    Parameters
    ----------
    df : DataFrame
        One ticker's daily OHLCV bars, date-sorted.
    variant : str | tuple
        A key of :data:`VARIANTS` (e.g. ``"ripster_reclaim"``) or an explicit
        ``(EmaCloudParams, mode)`` tuple.

    Returns
    -------
    DataFrame (same index as ``df``) with:

    * ``event_long`` / ``event_short`` — bool.
    * ``strength`` — float (reclaim distance / slope-flip magnitude in ATR).
    * ``slow_slope_atr`` — slow-midline slope in ATR units (meta).
    """
    p, mode = _parse_variant(variant)
    _require_sorted(df)
    close = df["close"].astype(float)
    a = wilder_atr(df["high"], df["low"], df["close"], p.atr_period)

    ema_fa = _ema(close, p.fast_a)
    ema_fb = _ema(close, p.fast_b)
    ema_sc = _ema(close, p.slow_c)
    ema_sd = _ema(close, p.slow_d)

    fast_top = pd.concat([ema_fa, ema_fb], axis=1).max(axis=1)
    fast_bot = pd.concat([ema_fa, ema_fb], axis=1).min(axis=1)
    slow_top = pd.concat([ema_sc, ema_sd], axis=1).max(axis=1)
    slow_bot = pd.concat([ema_sc, ema_sd], axis=1).min(axis=1)
    slow_mid = (ema_sc + ema_sd) / 2.0

    slope = slow_mid.diff()                 # past-only 1-bar slope of the curl
    slope_atr = slope / a

    # bullish / bearish slow cloud (price location + curl direction)
    slow_bull = (close > slow_top) & (slope >= 0)
    slow_bear = (close < slow_bot) & (slope <= 0)

    if mode == "reclaim":
        prev_close = close.shift(1)
        # was genuinely BELOW the fast cloud (prior close under its bottom),
        # now CLOSES above the whole cloud (close over its top): a reclaim that
        # crosses the full band, not a one-tick brush of the upper edge.
        reclaim_up = (prev_close < fast_bot.shift(1)) & (close > fast_top)
        reclaim_dn = (prev_close > fast_top.shift(1)) & (close < fast_bot)
        fired_long = reclaim_up & slow_bull
        fired_short = reclaim_dn & slow_bear
        over_long = (close - fast_top) / a
        over_short = (fast_bot - close) / a
    else:  # curl_flip
        prev_slope = slope.shift(1)
        flip_up = (prev_slope <= 0) & (slope > 0)
        flip_dn = (prev_slope >= 0) & (slope < 0)
        # price already above/below the slow cloud when the curl flips
        fired_long = flip_up & (close > slow_top)
        fired_short = flip_dn & (close < slow_bot)
        over_long = slope_atr
        over_short = -slope_atr

    # warmup mask: nothing fires before the slowest EMA / ATR has formed
    warm = pd.Series(True, index=df.index)
    warm.iloc[: p.warmup] = False
    fired_long = (fired_long & warm).fillna(False)
    fired_short = (fired_short & warm).fillna(False)

    out = pd.DataFrame(index=df.index)
    out["event_long"] = fired_long.astype(bool)
    out["event_short"] = fired_short.astype(bool)

    strength = pd.Series(0.0, index=df.index)
    strength[out["event_long"]] = over_long[out["event_long"]].clip(lower=0.0)
    strength[out["event_short"]] = over_short[out["event_short"]].clip(lower=0.0)
    out["strength"] = strength.fillna(0.0)
    out["slow_slope_atr"] = slope_atr.fillna(0.0)
    return out


def detect_universe(df: pd.DataFrame, variant="ripster_reclaim") -> pd.DataFrame:
    """Apply :func:`detect` per ticker; returns ticker/date + event columns."""
    parts = []
    for _, g in df.groupby("ticker", sort=False):
        res = detect(g, variant)
        res.insert(0, "ticker", g["ticker"].to_numpy())
        res.insert(1, "date", g["date"].to_numpy())
        parts.append(res)
    return pd.concat(parts, ignore_index=True)


def weekly_trend_state(
    df: pd.DataFrame, ema_fast: int = 10, ema_slow: int = 20
) -> pd.Series:
    """Higher-timeframe (weekly) EMA-cloud direction per DAILY bar, no lookahead.

    Daily closes are resampled to W-FRI weekly closes; week w is bullish (+1)
    when ``weekly_close > EMA{fast} > EMA{slow}`` (all weekly), bearish (-1)
    when ``weekly_close < EMA{fast} < EMA{slow}``, else neutral (0). Every day
    of week w is assigned the state of the PRIOR COMPLETED week (w-1) — a
    week's own, possibly partial, bar never feeds its days, so the mapping is
    truncation invariant.

    This is the weekly EMA-cloud direction used as the MTF/HTF filter for the
    mandatory HTF conditioning. Returns a float Series on ``df``'s index:
    +1 / 0 / -1, NaN while the weekly EMAs are still warming up.
    """
    _require_sorted(df)
    dates = pd.to_datetime(df["date"])
    wclose = (
        pd.Series(df["close"].to_numpy(), index=pd.DatetimeIndex(dates))
        .resample("W-FRI")
        .last()
        .dropna()
    )
    fast = wclose.ewm(span=ema_fast, adjust=False, min_periods=ema_fast).mean()
    slow = wclose.ewm(span=ema_slow, adjust=False, min_periods=ema_slow).mean()

    state = pd.Series(np.nan, index=wclose.index)
    known = slow.notna() & fast.notna()
    state[known] = 0.0
    state[known & (wclose > fast) & (fast > slow)] = 1.0
    state[known & (wclose < fast) & (fast < slow)] = -1.0

    prior = state.shift(1)  # week w's days see week w-1's completed state
    week_end = dates.dt.to_period("W-FRI").dt.end_time.dt.normalize()
    mapped = week_end.map(prior)
    return pd.Series(
        mapped.to_numpy(dtype=float), index=df.index, name="weekly_trend_state"
    )
