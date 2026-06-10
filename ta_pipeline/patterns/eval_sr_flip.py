"""Event study for the sr_flip pattern family (S/R flip retests).

Replicates the ``model/run_ta_events.py`` evaluation mechanics WITHOUT
training anything: deterministic walk-forward folds from
``model.walkforward.make_folds`` on the cached feature matrix, conditional
triple-barrier outcomes only.

Discipline:

* CV folds only -- every statistic is computed on the union of the CV test
  windows. The reserved OOS window is never touched.
* All three pre-registered parameterizations are reported, win or lose.
* Every metric is reported twice: unconditional, and HTF-aligned (long events
  in a weekly uptrend / short events in a weekly downtrend; prior completed
  week only).

Per (parameterization, side): n_events, the side's label base rate over ALL
CV rows, hit rate over event rows, lift = hit/base, per-fold lift range
(folds with >= 10 events), and the median forward outcome return
(``label_<side>_outcome_return``).

Writes ``ta_pipeline/data/reports/pattern_sr_flip.json``.

CLI:  python -m ta_pipeline.patterns.eval_sr_flip
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from ..ingestion import load_candles
from ..model.config import ModelConfig
from ..model.dataset import materialize_matrix
from ..model.walkforward import fold_masks, make_folds
from .sr_flip import PARAM_SETS, detect_universe, params_dict

logger = logging.getLogger(__name__)

FAMILY = "sr_flip"
REPORT_PATH = Path(__file__).resolve().parents[1] / "data" / "reports" / f"pattern_{FAMILY}.json"
MIN_FOLD_EVENTS = 10          # folds with fewer events are excluded from the range


def _compute_events(tickers, params) -> pd.DataFrame:
    """Run the detector on every ticker's FULL candle history from the store.

    The detector needs the warmup bars the trimmed matrix drops; events are
    then merged back onto matrix rows on (ticker, date).
    """
    frames = []
    for ticker in tickers:
        candles = load_candles(ticker)
        if candles.empty:
            continue
        frames.append(detect_universe(candles, params))
    events = pd.concat(frames, ignore_index=True)
    return events[["ticker", "date", "event_long", "event_short",
                   "strength", "level_touches", "htf_state"]]


def _side_stats(cv: pd.DataFrame, folds, side: str) -> dict:
    """Event-conditioned stats for one side, CV rows only."""
    label_col = f"label_{side}"
    outcome_col = f"label_{side}_outcome_return"
    event_col = f"event_{side}"
    htf_dir = 1.0 if side == "long" else -1.0

    rows = cv[cv[label_col].notna()]
    base_rate = float(rows[label_col].mean())

    def _block(sub: pd.DataFrame) -> dict:
        n = int(len(sub))
        if n == 0:
            return {"n_events": 0, "hit_rate": None, "lift": None,
                    "median_outcome_return": None}
        hit = float(sub[label_col].mean())
        return {
            "n_events": n,
            "hit_rate": round(hit, 4),
            "lift": round(hit / base_rate, 4) if base_rate > 0 else None,
            "median_outcome_return": round(float(sub[outcome_col].median()), 5),
        }

    events = rows[rows[event_col].fillna(False).astype(bool)]
    aligned = events[events["htf_state"] == htf_dir]

    # per-fold stability (unconditional events), CV folds only
    fold_lifts = {}
    for fold in folds:
        _, test = fold_masks(rows, fold)
        fr = rows[test]
        fe = fr[fr[event_col].fillna(False).astype(bool)]
        fb = float(fr[label_col].mean()) if len(fr) else float("nan")
        if len(fe) >= MIN_FOLD_EVENTS and fb > 0:
            fold_lifts[fold.name] = round(float(fe[label_col].mean()) / fb, 4)
        else:
            fold_lifts[fold.name] = None
    lifts = [v for v in fold_lifts.values() if v is not None]

    out = {
        "side": side,
        "n_cv_rows": int(len(rows)),
        "base_rate": round(base_rate, 4),
        "unconditional": _block(events),
        "htf_aligned": _block(aligned),
        "fold_lifts": fold_lifts,
        "fold_lift_min": min(lifts) if lifts else None,
        "fold_lift_max": max(lifts) if lifts else None,
        "events_per_1000_cv_rows": round(1000.0 * len(events) / max(len(rows), 1), 2),
        "mean_strength": round(float(events["strength"].mean()), 3) if len(events) else None,
    }
    return out


def run_eval(model_cfg: ModelConfig = None) -> dict:
    model_cfg = model_cfg or ModelConfig()
    matrix = materialize_matrix(model_cfg)
    folds = make_folds(matrix, model_cfg)
    cv_folds = [f for f in folds if not f.is_oos]
    oos_fold = [f for f in folds if f.is_oos][0]

    # CV rows = union of the CV folds' test windows; the OOS window is excluded.
    cv_mask = pd.Series(False, index=matrix.index)
    for fold in cv_folds:
        _, test = fold_masks(matrix, fold)
        cv_mask |= test
    assert not (cv_mask & (matrix["date"] >= oos_fold.test_start)).any(), \
        "CV mask must never reach into the reserved OOS window"

    tickers = sorted(matrix["ticker"].unique())
    keep = ["ticker", "date", "label_long", "label_short",
            "label_long_outcome_return", "label_short_outcome_return"]
    cv = matrix.loc[cv_mask, keep].copy()
    logger.info("CV rows: %d of %d matrix rows (%s .. %s); OOS untouched from %s",
                len(cv), len(matrix), cv["date"].min().date(),
                cv["date"].max().date(), oos_fold.test_start.date())

    results = []
    for params in PARAM_SETS:
        logger.info("detecting events: params=%s", params.name)
        events = _compute_events(tickers, params)
        merged = cv.merge(events, on=["ticker", "date"], how="left", validate="1:1")
        entry = {"params": params_dict(params), "sides": []}
        for side in ("long", "short"):
            stats = _side_stats(merged, cv_folds, side)
            entry["sides"].append(stats)
            logger.info(
                "%s/%s: n=%d base=%.4f hit=%s lift=%s | HTF n=%d hit=%s lift=%s",
                params.name, side,
                stats["unconditional"]["n_events"], stats["base_rate"],
                stats["unconditional"]["hit_rate"], stats["unconditional"]["lift"],
                stats["htf_aligned"]["n_events"],
                stats["htf_aligned"]["hit_rate"], stats["htf_aligned"]["lift"],
            )
        results.append(entry)

    report = {
        "family": FAMILY,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "protocol": {
            "labels": "ATR triple-barrier, +1.5/-1.0 ATR, 10d horizon "
                      "(label_long / label_short from the cached matrix)",
            "folds": f"{len(cv_folds)} expanding-window CV folds from "
                     "model.walkforward.make_folds; statistics on the union "
                     "of the CV test windows only",
            "oos_excluded_from": str(oos_fold.test_start.date()),
            "htf": "weekly W-FRI close vs SMA10/SMA20 stack, prior completed "
                   "week only; aligned = long in weekly uptrend / short in "
                   "weekly downtrend",
            "min_fold_events": MIN_FOLD_EVENTS,
            "preregistration": "the three parameterizations were fixed (and "
                               "density-calibrated on random walks / raw "
                               "candles) before any label was inspected",
        },
        "cv_rows": int(len(cv)),
        "cv_window": [str(cv["date"].min().date()), str(cv["date"].max().date())],
        "n_tickers": len(tickers),
        "results": results,
    }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    logger.info("wrote %s", REPORT_PATH)
    return report


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="sr_flip pattern event study.")
    parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    report = run_eval()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
