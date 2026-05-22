"""Central configuration for the TA feature + label pipeline.

Every swept and fixed parameter from the build brief (§6) lives here so the
walk-forward sweep harness has a single source of truth. The four
universe-dependent, high-leverage parameters are listed in ``SWEEP_PARAMS``;
all others are convention-grounded and fixed for the first run to keep
multiple-comparisons risk low.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, Tuple


# Parameters genuinely universe-dependent and meant to be swept under
# walk-forward CV. Everything else is fixed by convention for the first run.
SWEEP_PARAMS = frozenset(
    {"swing_m", "breach_recency_N", "consolidation_K", "channel_tightness_c"}
)

# Test ranges for the sweep params (brief §6 "Test range" column). Consumed by
# the walk-forward sweep harness in a later phase.
SWEEP_PARAM_RANGES: Dict[str, tuple] = {
    "swing_m": (2, 3, 4, 5, 6),
    "breach_recency_N": (3, 4, 5, 6, 7, 8),
    "consolidation_K": (15, 20, 25, 30, 35, 40),
    "channel_tightness_c": (3.0, 4.0, 5.0, 6.0),
}


@dataclass(frozen=True)
class PipelineConfig:
    """Immutable parameter set for one pipeline run.

    Construct with no arguments for the brief defaults; override individual
    fields to produce a sweep variant, e.g. ``PipelineConfig(swing_m=5)``.
    """

    # ---- §3 / §4.1 RSI --------------------------------------------------
    rsi_periods: Tuple[int, ...] = (2, 7, 14)
    rsi_pctile_period: int = 14          # which RSI gets a trailing percentile
    pctile_window_long: int = 252        # RSI & ATR percentile window

    # ---- §4.2 Bollinger -------------------------------------------------
    bb_period: int = 20
    bb_std: float = 2.0
    bb_squeeze_pctile_q: float = 20.0    # bottom-q pctile of bandwidth = "squeeze"
    bb_bandwidth_pctile_window: int = 126

    # ---- §3 / §4.3 ATR / volatility ------------------------------------
    atr_period: int = 14                 # Wilder; SAME ATR for features + labels
    atr_slope_lookback: int = 20

    # ---- §3 / §4.4 Moving averages -------------------------------------
    sma_periods: Tuple[int, ...] = (20, 50, 100, 200)
    sma_stack_periods: Tuple[int, ...] = (50, 100, 200)  # ordinal uses only these
    ma_slope_lookback: int = 20

    # ---- §4.5 MA zones -------------------------------------------------
    ma_zone_width_atr: float = 0.5       # ±0.5 ATR around the 50- and 200-day SMA

    # ---- §3 swing detection -------------------------------------------
    swing_m: int = 3                     # SWEEP — primary pivot confirmation
    swing_m_secondary: int = 5           # second sensitivity (fixed companion)

    # ---- §4.6 false breakdown / breakout (reclaim) --------------------
    reclaim_lookback_W: int = 60         # how long a confirmed swing level stays valid
    breach_recency_N: int = 5            # SWEEP — breach must be within N bars
    breach_penetration_min_atr: float = 0.1
    breach_penetration_max_atr: float = 1.5

    # ---- §4.7 consolidation breakout ----------------------------------
    consolidation_K: int = 20            # SWEEP — compression window
    channel_tightness_c: float = 4.0     # SWEEP — channel height < c·ATR
    consolidation_anchor_frac: float = 0.5     # first frac·K bars define the early
                                               # sub-channel (stayed-inside test)
    consolidation_max_closes_outside: int = 2  # max late closes escaping that channel
    breakout_require_volume: bool = False      # optional volume gate on breakouts
    volume_confirm_mult: float = 1.5     # breakout volume > mult × 20-bar avg
    volume_avg_window: int = 20

    # ---- §5 label (ATR-scaled triple barrier) -------------------------
    label_horizon: int = 10              # vertical barrier, trading days
    label_profit_atr: float = 1.5        # upper barrier, +ATR multiples from entry
    label_stop_atr: float = 1.0          # lower barrier, -ATR multiples from entry
    # Extra terminal-return horizons stored alongside the label so the flow can
    # be re-bucketed by DTE later without recomputing (flow DTE is variable,
    # <30 calendar days; the 10-bar default sits safely inside that cap).
    terminal_return_horizons: Tuple[int, ...] = (5, 10, 21)

    def __post_init__(self) -> None:
        if self.rsi_pctile_period not in self.rsi_periods:
            raise ValueError(
                f"rsi_pctile_period {self.rsi_pctile_period} must be one of "
                f"rsi_periods {self.rsi_periods}"
            )
        if not set(self.sma_stack_periods).issubset(self.sma_periods):
            raise ValueError("sma_stack_periods must be a subset of sma_periods")
        for name in ("atr_period", "bb_period", "label_horizon", "swing_m"):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} must be >= 1, got {getattr(self, name)}")
        if self.label_stop_atr <= 0 or self.label_profit_atr <= 0:
            raise ValueError("label barriers must be positive ATR multiples")
        if not 0.0 < self.consolidation_anchor_frac < 1.0:
            raise ValueError("consolidation_anchor_frac must be in (0, 1)")

    @property
    def warmup_bars(self) -> int:
        """Conservative count of leading bars to mask before features are valid.

        Driven by the longest trailing window: a long-window percentile of an
        indicator that itself needs ``atr_period`` / RSI bars to form, or the
        200-day SMA plus its slope lookback. Per-feature validity flags are
        applied in the warmup-masking phase; this is the bulk drop estimate.
        """
        return max(
            max(self.sma_periods) + self.ma_slope_lookback,
            self.atr_period + self.pctile_window_long,
            max(self.rsi_periods) + self.pctile_window_long,
            self.bb_period + self.bb_bandwidth_pctile_window,
            self.reclaim_lookback_W,
        )

    def to_dict(self) -> dict:
        """Flat dict of all parameters — for run logging and provenance."""
        return asdict(self)
