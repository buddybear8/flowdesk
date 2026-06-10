"""Flag / pennant continuation-breakout detector.

Anatomy (long side; the short side is the mirror):

  * **Pole** — a strong directional run: a net move of at least
    ``pole_min_atr`` ATR over the ``pole_len`` bars ending at the pole-end bar
    (or, in the ``pctile`` pole mode, a top-decile trailing-percentile 5-bar
    ATR-normalized momentum at the pole end).
  * **Flag** — a subsequent tight consolidation of ``flag_min``..``flag_max``
    bars: total high-low range at most ``flag_range_max_atr`` ATR, per-bar true
    range contracting versus the pole (flag mean TR <= ``contraction_max`` x
    pole mean TR), net drift AGAINST the pole direction but retracing at most
    ``retrace_max_frac`` of the pole, and (optionally) mean flag volume below
    ``volume_ratio_max`` x mean pole volume.
  * **Event** — the first close beyond the flag boundary in the pole
    direction: ``close > flag_high`` fires ``event_long`` for an up-pole,
    ``close < flag_low`` fires ``event_short`` for a down-pole.

Strength = |pole move in ATR| x consolidation tightness
(tightness = 1 / flag range in ATR, floored at 0.25 ATR).

Strict no-lookahead: every input at bar t is a trailing rolling window or a
``shift`` toward the past — computing on ``history[:t]`` yields identical
events as computing on the full history then slicing (tested).

HTF conditioning: :func:`weekly_trend_state` derives a weekly trend state
(-1/0/+1) from the same daily candles via a W-FRI resample and a weekly
close > SMA10 > SMA20 stack. Day t is assigned the state of the most recent
COMPLETED week strictly before t (``merge_asof`` with
``allow_exact_matches=False``), so no day ever sees its own week's close.

Operates on a single ticker, bars in chronological order. Pure pandas; the
ATR is the same audited Wilder ATR(14) the features and labels use.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np
import pandas as pd

from ..config import PipelineConfig
from ..features.common import require_columns, trailing_pctile_rank
from ..indicators import atr, true_range


@dataclass(frozen=True)
class FlagPennantParams:
    """One pre-registered parameterization of the flag/pennant detector."""

    name: str = "base"
    # ---- pole ---------------------------------------------------------
    pole_len: int = 5                 # bars in the directional run
    pole_mode: str = "atr"            # "atr" (fixed threshold) | "pctile"
    pole_min_atr: float = 2.5         # net move >= this many ATR ("atr" mode)
    pole_pctile: float = 0.90         # top-decile 5-bar momentum ("pctile" mode)
    pole_pctile_window: int = 252     # trailing window for the momentum pctile
    # ---- flag / pennant -------------------------------------------------
    flag_min: int = 3                 # min consolidation length, bars
    flag_max: int = 10                # max consolidation length, bars
    flag_range_max_atr: float = 1.5   # total flag high-low range, ATR units
    retrace_max_frac: float = 0.6     # flag drift retraces <= this of the pole
    contraction_max: float = 0.9      # flag mean TR <= this x pole mean TR
    volume_ratio_max: Optional[float] = None  # flag vol <= this x pole vol; None = off

    def __post_init__(self) -> None:
        if self.pole_mode not in ("atr", "pctile"):
            raise ValueError(f"unknown pole_mode {self.pole_mode!r}")
        if not 1 <= self.flag_min <= self.flag_max:
            raise ValueError("need 1 <= flag_min <= flag_max")
        if self.pole_len < 2:
            raise ValueError("pole_len must be >= 2")
        if not 0.0 < self.retrace_max_frac < 1.0:
            raise ValueError("retrace_max_frac must be in (0, 1)")


# Pre-registered parameterizations -- fixed BEFORE looking at any outcome
# statistics; all three are reported (honesty bar: no post-hoc tuning).
PRESETS = (
    FlagPennantParams(name="base"),
    FlagPennantParams(
        name="strict",
        pole_min_atr=3.0,
        flag_range_max_atr=1.2,
        retrace_max_frac=0.5,
        contraction_max=0.75,
        volume_ratio_max=0.85,
    ),
    FlagPennantParams(
        name="momentum_decile",
        pole_mode="pctile",
        pole_pctile=0.90,
    ),
)


def preset(name: str) -> FlagPennantParams:
    """Look up a pre-registered parameterization by name."""
    for p in PRESETS:
        if p.name == name:
            return p
    raise KeyError(f"unknown flag_pennant preset {name!r}")


def detect(
    df: pd.DataFrame,
    params: FlagPennantParams = None,
    cfg: PipelineConfig = None,
) -> pd.DataFrame:
    """Detect flag/pennant continuation breakouts on one ticker's daily bars.

    ``df`` must hold OHLC (volume optional unless the preset gates on it) in
    chronological order. Returns a same-index DataFrame with:

    * ``event_long`` / ``event_short`` -- bool, the breakout-close bar
    * ``strength`` -- |pole ATR move| x tightness (0 off-event)
    * ``flag_len`` -- bars in the winning flag window (NaN off-event)
    * ``pole_move_atr`` -- signed pole move in ATR (NaN off-event)
    """
    params = params or PRESETS[0]
    cfg = cfg or PipelineConfig()
    need = ["high", "low", "close"]
    if params.volume_ratio_max is not None:
        need.append("volume")
    require_columns(df, need, "flag_pennant.detect")

    idx = df.index
    out = pd.DataFrame(index=idx)
    high, low, close = df["high"], df["low"], df["close"]

    atr_s = atr(high, low, close, cfg.atr_period)
    tr = true_range(high, low, close)
    p = params.pole_len

    mom_pct = None
    if params.pole_mode == "pctile":
        mom = (close - close.shift(p)) / atr_s
        mom_pct = trailing_pctile_rank(mom, params.pole_pctile_window)

    event_long = pd.Series(False, index=idx)
    event_short = pd.Series(False, index=idx)
    best_strength = pd.Series(0.0, index=idx)
    flag_len = pd.Series(np.nan, index=idx)
    pole_move_atr = pd.Series(np.nan, index=idx)

    for f in range(params.flag_min, params.flag_max + 1):
        # Flag window = bars [t-f, t-1]; pole ends at bar t-f-1.
        pole_end = f + 1

        flag_high = high.rolling(f, min_periods=f).max().shift(1)
        flag_low = low.rolling(f, min_periods=f).min().shift(1)
        flag_range_atr = (flag_high - flag_low) / atr_s.shift(1)
        flag_tr = tr.rolling(f, min_periods=f).mean().shift(1)

        pm = close.shift(pole_end) - close.shift(pole_end + p)   # price units
        pm_atr = pm / atr_s.shift(pole_end)                      # ATR at pole end
        pole_tr = tr.rolling(p, min_periods=p).mean().shift(pole_end)
        drift = close.shift(1) - close.shift(pole_end)           # net flag move

        tight = flag_range_atr <= params.flag_range_max_atr
        contracting = flag_tr <= params.contraction_max * pole_tr
        common = tight & contracting
        if params.volume_ratio_max is not None:
            flag_vol = df["volume"].rolling(f, min_periods=f).mean().shift(1)
            pole_vol = df["volume"].rolling(p, min_periods=p).mean().shift(pole_end)
            common = common & (flag_vol <= params.volume_ratio_max * pole_vol)

        if params.pole_mode == "atr":
            pole_up = pm_atr >= params.pole_min_atr
            pole_down = pm_atr <= -params.pole_min_atr
        else:
            pct = mom_pct.shift(pole_end)
            pole_up = (pct >= params.pole_pctile) & (pm_atr > 0)
            pole_down = (pct <= 1.0 - params.pole_pctile) & (pm_atr < 0)

        # Drift AGAINST the pole, retracing at most retrace_max_frac of it.
        retrace_long = (drift <= 0) & (-drift <= params.retrace_max_frac * pm)
        retrace_short = (drift >= 0) & (drift <= params.retrace_max_frac * (-pm))

        long_f = common & pole_up & retrace_long & (close > flag_high)
        short_f = common & pole_down & retrace_short & (close < flag_low)

        tightness = 1.0 / flag_range_atr.clip(lower=0.25)
        strength_f = (pm_atr.abs() * tightness).fillna(0.0)

        event_long = event_long | long_f
        event_short = event_short | short_f
        fired = long_f | short_f
        better = fired & (strength_f > best_strength)
        best_strength = best_strength.where(~better, strength_f)
        flag_len = flag_len.where(~better, float(f))
        pole_move_atr = pole_move_atr.where(~better, pm_atr)

    # A bar matching both directions (different flag windows) is ambiguous --
    # drop it rather than guess.
    both = event_long & event_short
    event_long = event_long & ~both
    event_short = event_short & ~both
    on_event = event_long | event_short

    out["event_long"] = event_long
    out["event_short"] = event_short
    out["strength"] = best_strength.where(on_event, 0.0)
    out["flag_len"] = flag_len.where(on_event)
    out["pole_move_atr"] = pole_move_atr.where(on_event)
    return out


def weekly_trend_state(
    df: pd.DataFrame, fast: int = 10, slow: int = 20
) -> pd.Series:
    """Higher-timeframe (weekly) trend state per daily bar -- -1 / 0 / +1.

    Weekly bars are the W-FRI resample of the daily closes. A week is +1 when
    its close > SMA``fast`` > SMA``slow`` of weekly closes (stacked uptrend),
    -1 when close < SMA``fast`` < SMA``slow``, else 0; NaN until ``slow``
    weeks exist.

    No lookahead: day t receives the state of the most recent COMPLETED week
    strictly before t (``allow_exact_matches=False``), so even a Friday bar
    uses the PRIOR week's state, never its own week's close.
    """
    require_columns(df, ["date", "close"], "flag_pennant.weekly_trend_state")
    dates = pd.DatetimeIndex(df["date"])
    s = pd.Series(df["close"].to_numpy(dtype=float), index=dates)
    wk = s.resample("W-FRI").last().dropna()
    fast_ma = wk.rolling(fast, min_periods=fast).mean()
    slow_ma = wk.rolling(slow, min_periods=slow).mean()
    state = np.where(
        (wk > fast_ma) & (fast_ma > slow_ma), 1.0,
        np.where((wk < fast_ma) & (fast_ma < slow_ma), -1.0, 0.0),
    )
    state_s = pd.Series(state, index=wk.index).where(slow_ma.notna())
    weekly = pd.DataFrame({
        "date": wk.index.to_numpy(),
        "htf_state": state_s.to_numpy(),
    })
    daily = pd.merge_asof(
        pd.DataFrame({"date": dates}),
        weekly,
        on="date",
        allow_exact_matches=False,   # strictly-prior completed week only
    )
    return pd.Series(daily["htf_state"].to_numpy(), index=df.index)


def params_dict(params: FlagPennantParams) -> dict:
    """Flat dict of a parameterization -- for report provenance."""
    return asdict(params)
