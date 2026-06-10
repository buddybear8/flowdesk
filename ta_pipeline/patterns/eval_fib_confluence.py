"""Event study for the ``fib_confluence`` pattern family.

Replicates the run_ta_events.py mechanics — event-conditioned triple-barrier
outcomes on the deterministic walk-forward CV folds — as a pure event study (NO
model trained). The question: "given a Fibonacci-confluence reclaim just fired,
did the mirrored ATR triple-barrier label resolve profitably more often than
base?", AND, crucially, "is the fib-confluence filter ADDITIVE over the bare
swing-reclaim already measured at chance by the prior round?".

Discipline (identical to eval_false_break):

  * **CV folds only.** The reserved OOS fold is never touched; every statistic
    is on the development window (dates <= the last CV fold's test end).
  * **Detection on full store history** so swing context / ATR have warmup
    before the matrix's first row; events inner-join onto the labelable matrix
    on (ticker, date). An event at day t uses only data through t's close, so
    detecting on full history leaks nothing — OOS-dated events are discarded by
    the dev filter.
  * **Pre-registered variants.** The 3 :data:`PARAM_SETS` are reported, none
    tuned against these numbers.
  * **Additivity control.** Alongside the 3 fib-gated detectors, the SAME swing
    structure + reclaim mechanic is run with ``require_fib=False`` /
    ``require_confluence=False`` (one control per fib param-set, keyed
    ``<name>_nofib``). Comparing the gated lift to its no-fib twin isolates
    whether fib confluence ADDS edge over plain swing-reclaim.
  * **HTF conditioning.** Every metric is reported twice — unconditional, and
    restricted to HTF-aligned events — with the HTF-aligned hit rate compared
    BOTH to the overall base rate and to the HTF-aligned base rate.

Writes ``ta_pipeline/data/reports/pattern_fib_confluence.json``.

CLI:  python -m ta_pipeline.patterns.eval_fib_confluence
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from ..ingestion import IngestionConfig, load_candles
from ..model.config import ModelConfig
from ..model.dataset import materialize_matrix
from ..model.walkforward import make_folds
from .fib_confluence import PARAM_SETS, detect, weekly_trend_state

logger = logging.getLogger(__name__)

_REPORT_PATH = Path(__file__).resolve().parents[1] / "data" / "reports" / \
    "pattern_fib_confluence.json"

_MIN_FOLD_EVENTS = 5      # folds with fewer events report no lift (too noisy)

_SIDES = (
    ("long", "event_long", "label_long", "label_long_outcome_return", 1.0),
    ("short", "event_short", "label_short", "label_short_outcome_return", -1.0),
)


def _build_detectors():
    """Return the ordered list of (key, params) to evaluate.

    Each registered fib param-set, followed by its no-fib additivity control
    (``<name>_nofib``: same swing structure + reclaim, no fib/confluence gate).
    """
    detectors = []
    for p in PARAM_SETS:
        detectors.append((p.name, p))
    for p in PARAM_SETS:
        detectors.append((
            f"{p.name}_nofib",
            replace(p, name=f"{p.name}_nofib",
                    require_fib=False, require_confluence=False),
        ))
    return detectors


def _detect_events(tickers, detectors, ingestion_cfg) -> pd.DataFrame:
    """Run every detector + the weekly HTF state per ticker on full history."""
    parts = []
    for i, ticker in enumerate(tickers):
        try:
            bars = load_candles(ticker, cfg=ingestion_cfg)
        except FileNotFoundError:
            logger.warning("no candles for %s — skipped", ticker)
            continue
        if bars is None or len(bars) < 60:
            continue
        bars = bars.sort_values("date").reset_index(drop=True)
        part = bars[["ticker", "date"]].copy()
        part["htf_state"] = weekly_trend_state(bars)
        for key, params in detectors:
            res = detect(bars, params)
            part[f"{key}_event_long"] = res["event_long"].to_numpy()
            part[f"{key}_event_short"] = res["event_short"].to_numpy()
            part[f"{key}_strength"] = res["strength"].to_numpy()
        parts.append(part)
        if (i + 1) % 50 == 0:
            logger.info("detected %d / %d tickers", i + 1, len(tickers))
    return pd.concat(parts, ignore_index=True)


def _r(x, nd=4):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) \
        else round(float(x), nd)


def _side_stats(dev, cv_folds, key, side_spec) -> dict:
    """All reported numbers for one (detector, side)."""
    side, event_col, label_col, outcome_col, aligned_state = side_spec
    event_flag = dev[f"{key}_{event_col}"].fillna(False).astype(bool)

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

    return {
        "n_events": n_events,
        "event_rate": _r(float(flag.mean())),
        "base_rate": _r(base_rate),
        "hit_rate": _r(hit_rate),
        "lift": _r(lift),
        "median_outcome_return": _r(
            float(events[outcome_col].median()) if n_events else float("nan")
        ),
        "median_strength": _r(
            float(events[f"{key}_strength"].median()) if n_events else float("nan")
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


def run_event_study(model_cfg: ModelConfig = None,
                    ingestion_cfg: IngestionConfig = None):
    """Run the fib_confluence event study on the CV development window only."""
    model_cfg = model_cfg or ModelConfig()
    ingestion_cfg = ingestion_cfg or IngestionConfig()
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

    detectors = _build_detectors()
    tickers = sorted(matrix["ticker"].unique())
    events = _detect_events(tickers, detectors, ingestion_cfg)
    dev = dev.merge(events, on=["ticker", "date"], how="left", validate="1:1")
    dev = dev.reset_index(drop=True)

    report = {
        "family": "fib_confluence",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "protocol": {
            "evaluation": "event-conditioned triple-barrier outcomes; no model trained",
            "folds": "model.walkforward.make_folds defaults; CV folds only, "
                     "reserved OOS window never evaluated",
            "dev_window": [str(dev["date"].min().date()), str(dev["date"].max().date())],
            "label": "ATR triple barrier, +1.5/-1.0 ATR, 10d horizon "
                     "(label_long / label_short)",
            "htf_state": "W-FRI weekly close vs weekly SMA10/SMA20 stack; each "
                         "day uses the PRIOR completed week's state",
            "preregistration": "3 fib param-sets fixed before any outcome was "
                               "inspected; axes swept = {fib levels}, "
                               "{confluence ATR band}, {min impulse ATR}",
            "additivity_control": "each <name>_nofib uses the SAME swing "
                                  "structure + reclaim with require_fib=False / "
                                  "require_confluence=False, so gated-vs-nofib "
                                  "isolates whether fib confluence is additive "
                                  "over the bare swing-reclaim already refuted",
            "min_fold_events": _MIN_FOLD_EVENTS,
        },
        "dev_rows": int(len(dev)),
        "tickers": int(dev["ticker"].nunique()),
        "detectors": {},
    }
    pmap = {p.name: p for p in PARAM_SETS}
    for key, params in detectors:
        entry = {"params": params.to_dict(),
                 "is_additivity_control": params.require_fib is False}
        for side_spec in _SIDES:
            entry[side_spec[0]] = _side_stats(dev, cv_folds, key, side_spec)
        report["detectors"][key] = entry
        logger.info(
            "%s: long n=%d lift=%s | short n=%d lift=%s",
            key,
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
        description="fib_confluence pattern-family event study (CV folds only)."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    report = run_event_study()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
