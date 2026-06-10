"""Event study for the ``ema_cloud_mtf`` pattern family.

Replicates run_ta_events.py / eval_false_break.py mechanics — event-conditioned
ATR triple-barrier outcomes on the deterministic walk-forward folds from
``model.walkforward.make_folds`` — as a pure event study: NO model is trained,
the question is "given this EMA-cloud reclaim / curl-flip just fired, did the
mirrored 10d ATR triple-barrier label resolve profitably more often than base?".

Discipline (identical to the prior round):

  * **CV folds only.** The reserved OOS fold (``is_oos``) is never touched;
    every statistic is on the development window (dates <= last CV test end).
  * **Detection on full store history** so the EMAs/ATR have real warmup before
    the matrix's first row; events are inner-joined onto the warmup-trimmed,
    labelable matrix on ``(ticker, date)``. An event at day t uses only data
    through day t's close, so OOS-dated events are simply discarded by the dev
    filter.
  * **Pre-registered variants.** All six cells (3 EMA sets x 2 modes) are
    reported; none is tuned against these numbers.
  * **HTF conditioning** (mandatory): every metric is reported twice —
    unconditional, and restricted to HTF-aligned events (long in a weekly
    EMA-cloud uptrend / short in a downtrend, prior-completed-week W-FRI). The
    HTF hit rate is compared BOTH to the overall base rate and to the base rate
    of all HTF-aligned rows, separating "HTF helps this pattern" from "HTF
    helps everything".

Writes ``ta_pipeline/data/reports/pattern_ema_cloud_mtf.json``.

CLI:  python -m ta_pipeline.patterns.eval_ema_cloud_mtf
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np

from ..ingestion import load_candles
from ..model.config import ModelConfig
from ..model.dataset import materialize_matrix
from ..model.walkforward import make_folds
from .ema_cloud_mtf import PARAM_SETS, VARIANTS, detect, weekly_trend_state

logger = logging.getLogger(__name__)

_REPORT_PATH = Path(__file__).resolve().parents[1] / "data" / "reports" / \
    "pattern_ema_cloud_mtf.json"

_MIN_FOLD_EVENTS = 5      # folds with fewer events report no lift (too noisy)

_SIDES = (
    ("long", "event_long", "label_long", "label_long_outcome_return", 1.0),
    ("short", "event_short", "label_short", "label_short_outcome_return", -1.0),
)


def _variant_pset(variant: str):
    """The PARAM_SETS key for a variant (variant = ``"{key}_{mode}"``)."""
    return next(k for k in PARAM_SETS if variant.startswith(k + "_"))


def _detect_events(tickers):
    """Run every variant + the weekly HTF state per ticker on full history."""
    import pandas as pd

    parts = []
    for ticker in tickers:
        try:
            bars = load_candles(ticker)
        except FileNotFoundError:
            logger.warning("no candles for %s — skipped", ticker)
            continue
        if len(bars) < 120:
            continue
        part = bars[["ticker", "date"]].copy()
        part["htf_state"] = weekly_trend_state(bars)
        for name in VARIANTS:
            res = detect(bars, name)
            part[f"{name}_event_long"] = res["event_long"].to_numpy()
            part[f"{name}_event_short"] = res["event_short"].to_numpy()
            part[f"{name}_strength"] = res["strength"].to_numpy()
        parts.append(part)
    return pd.concat(parts, ignore_index=True)


def _side_stats(dev, cv_folds, variant, side_spec) -> dict:
    """All reported numbers for one (variant, side)."""
    side, event_col, label_col, outcome_col, aligned_state = side_spec
    event_flag = dev[f"{variant}_{event_col}"].fillna(False).astype(bool)

    rows = dev[dev[label_col].notna()]
    flag = event_flag[rows.index]
    base_rate = float(rows[label_col].mean())

    events = rows[flag]
    n_events = int(len(events))
    hit_rate = float(events[label_col].mean()) if n_events else float("nan")
    lift = hit_rate / base_rate if n_events and base_rate > 0 else float("nan")

    # ---- HTF-aligned slice (and the HTF-aligned base for comparison) ----
    aligned_rows = rows[rows["htf_state"] == aligned_state]
    htf_base_rate = (
        float(aligned_rows[label_col].mean()) if len(aligned_rows) else float("nan")
    )
    htf_events = events[events["htf_state"] == aligned_state]
    n_htf = int(len(htf_events))
    htf_hit = float(htf_events[label_col].mean()) if n_htf else float("nan")

    # ---- per-CV-fold stability ----
    fold_lifts = {}
    for fold in cv_folds:
        seg = rows[(rows["date"] >= fold.test_start) & (rows["date"] <= fold.test_end)]
        seg_events = seg[event_flag[seg.index]]
        seg_base = float(seg[label_col].mean()) if len(seg) else float("nan")
        if len(seg_events) >= _MIN_FOLD_EVENTS and seg_base > 0:
            fold_lifts[fold.name] = {
                "n_events": int(len(seg_events)),
                "lift": round(float(seg_events[label_col].mean()) / seg_base, 4),
            }
        else:
            fold_lifts[fold.name] = {"n_events": int(len(seg_events)), "lift": None}
    lifts = [v["lift"] for v in fold_lifts.values() if v["lift"] is not None]

    def _r(x, nd=4):
        return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(x, nd)

    return {
        "n_events": n_events,
        "event_rate": _r(float(flag.mean())),
        "base_rate": _r(base_rate),
        "hit_rate": _r(hit_rate),
        "lift": _r(lift),
        "median_outcome_return": _r(
            float(events[outcome_col].median()) if n_events else float("nan")
        ),
        "median_strength_atr": _r(
            float(events[f"{variant}_strength"].median()) if n_events else float("nan")
        ),
        "htf_aligned": {
            "n_events": n_htf,
            "hit_rate": _r(htf_hit),
            "lift_vs_overall_base": _r(
                htf_hit / base_rate if n_htf and base_rate > 0 else float("nan")
            ),
            "htf_base_rate_all_rows": _r(htf_base_rate),
            "lift_vs_htf_base": _r(
                htf_hit / htf_base_rate if n_htf and htf_base_rate > 0 else float("nan")
            ),
        },
        "per_fold": fold_lifts,
        "fold_lift_min": _r(min(lifts)) if lifts else None,
        "fold_lift_max": _r(max(lifts)) if lifts else None,
    }


def run_event_study(model_cfg: ModelConfig = None):
    """Run the ema_cloud_mtf event study on the CV development window only."""
    model_cfg = model_cfg or ModelConfig()
    matrix = materialize_matrix(model_cfg)
    folds = make_folds(matrix, model_cfg)
    cv_folds = [f for f in folds if not f.is_oos]
    dev_end = cv_folds[-1].test_end          # last CV date; OOS starts after

    keep = ["ticker", "date", "label_long", "label_short",
            "label_long_outcome_return", "label_short_outcome_return"]
    dev = matrix.loc[matrix["date"] <= dev_end, keep].copy()
    logger.info(
        "dev window: %s .. %s (%d rows; OOS untouched)",
        dev["date"].min().date(), dev["date"].max().date(), len(dev),
    )

    tickers = sorted(matrix["ticker"].unique())
    events = _detect_events(tickers)
    dev = dev.merge(events, on=["ticker", "date"], how="left", validate="1:1")
    dev = dev.reset_index(drop=True)

    report = {
        "family": "ema_cloud_mtf",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "protocol": {
            "evaluation": "event-conditioned triple-barrier outcomes; no model trained",
            "folds": "model.walkforward.make_folds defaults; CV folds only, "
                     "reserved OOS window never evaluated",
            "dev_window": [str(dev["date"].min().date()), str(dev["date"].max().date())],
            "label": "ATR triple barrier, +1.5/-1.0 ATR, 10d horizon "
                     "(label_long / label_short)",
            "detector": "fast EMA cloud (band a/b) + slow EMA cloud (band c/d); "
                        "reclaim = was below fast cloud, closes above it while "
                        "slow cloud bullish (price above + midline curling up); "
                        "curl_flip = slow-midline slope flips up while price "
                        "above the slow cloud (mirror for shorts)",
            "htf_state": "WEEKLY EMA-cloud direction: W-FRI weekly close vs "
                         "weekly EMA10/EMA20 stack; each day uses the PRIOR "
                         "completed week's state (the MTF filter)",
            "preregistration": "3 EMA sets (ripster 5/12+34/50, classic "
                               "8/21+34/50, wide 9/20+50/100) x 2 modes = 6 "
                               "cells, fixed before any outcome was inspected",
            "min_fold_events": _MIN_FOLD_EVENTS,
        },
        "dev_rows": int(len(dev)),
        "tickers": int(dev["ticker"].nunique()),
        "detectors": {},
    }
    for variant in VARIANTS:
        pset = PARAM_SETS[_variant_pset(variant)]
        entry = {"params": pset.to_dict(), "mode": variant.split("_", 1)[1]}
        for side_spec in _SIDES:
            entry[side_spec[0]] = _side_stats(dev, cv_folds, variant, side_spec)
        report["detectors"][variant] = entry
        logger.info(
            "%s: long n=%d lift=%s | short n=%d lift=%s",
            variant,
            entry["long"]["n_events"], entry["long"]["lift"],
            entry["short"]["n_events"], entry["short"]["lift"],
        )

    _REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _REPORT_PATH.write_text(json.dumps(report, indent=2))
    logger.info("wrote %s", _REPORT_PATH)
    return report


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="ema_cloud_mtf pattern-family event study (CV folds only)."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    report = run_event_study()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
