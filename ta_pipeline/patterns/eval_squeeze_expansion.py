"""Event study for the squeeze -> expansion pattern family.

Replicates the ``model/run_ta_events.py`` evaluation mechanics, but as a pure
event study (no GBM): conditional triple-barrier outcomes on the deterministic
walk-forward folds from ``model/walkforward.py``.

Protocol
--------
* Events are detected per ticker on the FULL raw candle history (so no rolling
  window is distorted by the matrix's warmup trim), then joined onto the
  cached feature+label matrix on ``(ticker, date)``.
* ``make_folds`` (deterministic given the matrix) defines the folds. ONLY the
  CV test segments (``cv1`` .. ``cvN``) are evaluated — the reserved OOS
  window is never touched.
* For each pre-registered variant and side: n_events, the label base rate on
  ALL CV rows of that side, the hit rate on event rows, lift = hit / base,
  the same restricted to HTF-aligned events (long in weekly uptrend / short in
  weekly downtrend), per-fold lift (stability), and median forward outcomes.
* Disagreement analysis: on events where the expansion direction OPPOSES the
  weekly trend, expansion-direction-following (the event side's label) is
  compared with HTF-trend-direction-following (the opposite side's label on
  the same bars).

All three parameterizations in ``VARIANTS`` were pre-registered before looking
at any outcome; all three are reported regardless of result.

CLI:  python -m ta_pipeline.patterns.eval_squeeze_expansion
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from ..ingestion import IngestionConfig, load_candles_universe
from ..model.config import ModelConfig
from ..model.dataset import materialize_matrix
from ..model.walkforward import make_folds
from .squeeze_expansion import VARIANTS, detect_universe

logger = logging.getLogger(__name__)

_REPORT_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "reports"
    / "pattern_squeeze_expansion.json"
)


def _f(x):
    """JSON-safe float (NaN -> None)."""
    if x is None:
        return None
    x = float(x)
    return None if np.isnan(x) else round(x, 4)


def _side_stats(rows: pd.DataFrame, event: pd.Series, side: str, cv_folds) -> dict:
    """Event-conditioned stats for one side on the CV rows.

    ``rows`` are the CV-window matrix rows with a non-null label for ``side``;
    ``event`` is the aligned boolean event mask for that side.
    """
    label = rows[f"label_{side}"]
    base = float(label.mean())
    ev = rows[event]

    htf_want = 1.0 if side == "long" else -1.0
    aligned = ev[ev["htf_trend"] == htf_want]
    opposed = ev[ev["htf_trend"] == -htf_want]

    # --- per-fold lift (stability) on the event rows ----------------------
    per_fold = []
    for fold in cv_folds:
        in_fold = (rows["date"] >= fold.test_start) & (rows["date"] <= fold.test_end)
        fold_rows = rows[in_fold]
        fold_ev = fold_rows[event[in_fold]]
        fold_base = float(fold_rows[f"label_{side}"].mean()) if len(fold_rows) else np.nan
        fold_hit = float(fold_ev[f"label_{side}"].mean()) if len(fold_ev) else np.nan
        per_fold.append({
            "fold": fold.name,
            "n_events": int(len(fold_ev)),
            "base_rate": _f(fold_base),
            "hit_rate": _f(fold_hit),
            "lift": _f(fold_hit / fold_base) if len(fold_ev) and fold_base else None,
        })
    fold_lifts = [p["lift"] for p in per_fold if p["lift"] is not None]

    def _block(sub: pd.DataFrame) -> dict:
        n = int(len(sub))
        hit = float(sub[f"label_{side}"].mean()) if n else np.nan
        return {
            "n_events": n,
            "hit_rate": _f(hit),
            "lift": _f(hit / base) if n and base else None,
            "median_outcome_return": _f(sub[f"label_{side}_outcome_return"].median()) if n else None,
            "median_terminal_return_10": _f(sub["terminal_return_10"].median()) if n else None,
        }

    # --- disagreement: expansion-following vs HTF-following ---------------
    other = "short" if side == "long" else "long"
    other_base = float(rows[f"label_{other}"].mean())
    n_opp = int(len(opposed))
    disagreement = {
        "n_events": n_opp,
        "follow_expansion": {
            "hit_rate": _f(opposed[f"label_{side}"].mean()) if n_opp else None,
            "base_rate": _f(base),
            "lift": _f(float(opposed[f"label_{side}"].mean()) / base) if n_opp and base else None,
            "median_outcome_return": _f(opposed[f"label_{side}_outcome_return"].median()) if n_opp else None,
        },
        "follow_htf_trend": {
            "hit_rate": _f(opposed[f"label_{other}"].mean()) if n_opp else None,
            "base_rate": _f(other_base),
            "lift": _f(float(opposed[f"label_{other}"].mean()) / other_base) if n_opp and other_base else None,
            "median_outcome_return": _f(opposed[f"label_{other}_outcome_return"].median()) if n_opp else None,
        },
    }

    unconditional = _block(ev)
    unconditional["base_rate"] = _f(base)
    unconditional["events_per_1k_rows"] = _f(1000.0 * len(ev) / max(len(rows), 1))
    htf_aligned = _block(aligned)
    htf_aligned["base_rate"] = _f(base)

    return {
        "unconditional": unconditional,
        "htf_aligned": htf_aligned,
        "htf_opposed_disagreement": disagreement,
        "per_fold": per_fold,
        "fold_lift_min": _f(min(fold_lifts)) if fold_lifts else None,
        "fold_lift_max": _f(max(fold_lifts)) if fold_lifts else None,
    }


def run_event_study(model_cfg: ModelConfig = None) -> dict:
    model_cfg = model_cfg or ModelConfig()
    matrix = materialize_matrix(model_cfg)
    logger.info("matrix: %d rows, %d tickers", len(matrix), matrix["ticker"].nunique())

    folds = make_folds(matrix, model_cfg)
    cv_folds = [f for f in folds if not f.is_oos]
    oos_fold = [f for f in folds if f.is_oos][0]
    cv_start, cv_end = cv_folds[0].test_start, cv_folds[-1].test_end
    assert cv_end < oos_fold.test_start, "CV window must precede the OOS window"

    # Detect on the full raw candle history (warmup-trim never distorts a
    # rolling window), then join onto the labeled matrix.
    tickers = sorted(matrix["ticker"].unique())
    bars = load_candles_universe(tickers=tickers, cfg=IngestionConfig())
    logger.info("candles: %d rows", len(bars))

    report = {
        "family": "squeeze_expansion",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "protocol": {
            "evaluation_rows": "CV test segments only (cv1..cv%d); reserved OOS window untouched" % len(cv_folds),
            "cv_window": [str(cv_start.date()), str(cv_end.date())],
            "oos_window_excluded": [str(oos_fold.test_start.date()), str(oos_fold.test_end.date())],
            "n_cv_folds": len(cv_folds),
            "label": "ATR triple-barrier, +1.5/-1.0 ATR, 10d horizon (label_long / label_short)",
            "htf_state": "weekly W-FRI close vs SMA10 vs SMA20 stack; prior completed week only",
            "tickers": len(tickers),
            "preregistered_variants": sorted(VARIANTS),
        },
        "variants": {},
    }

    cv_mask = (matrix["date"] >= cv_start) & (matrix["date"] <= cv_end)
    for variant in sorted(VARIANTS):
        logger.info("--- variant %s ---", variant)
        events = detect_universe(bars, variant=variant)
        joined = matrix.loc[cv_mask].merge(
            events, on=["ticker", "date"], how="left", validate="one_to_one"
        )
        joined["event_long"] = joined["event_long"].fillna(False).astype(bool)
        joined["event_short"] = joined["event_short"].fillna(False).astype(bool)
        joined["htf_trend"] = joined["htf_trend"].fillna(0.0)

        sides = {}
        for side in ("long", "short"):
            rows = joined[joined[f"label_{side}"].notna()].reset_index(drop=True)
            sides[side] = _side_stats(rows, rows[f"event_{side}"], side, cv_folds)
            u = sides[side]["unconditional"]
            logger.info(
                "%s %s: n=%d base=%.4f hit=%s lift=%s",
                variant, side, u["n_events"], u["base_rate"],
                u["hit_rate"], u["lift"],
            )
        report["variants"][variant] = {"params": VARIANTS[variant], "sides": sides}

    _REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_REPORT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    logger.info("wrote %s", _REPORT_PATH)
    return report


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Squeeze -> expansion event study (CV folds only)."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    report = run_event_study()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
