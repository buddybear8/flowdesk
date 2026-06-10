"""Event study for the ``wedge_triangle`` pattern family.

Replicates the ``model/run_ta_events.py`` evaluation mechanics WITHOUT
training anything: events are conditioned on the ATR triple-barrier labels
(``label_long`` / ``label_short``) over the deterministic walk-forward CV
folds from ``model/walkforward.make_folds``. The reserved OOS window (the
final ``oos_months``) is NEVER touched — every statistic here is CV-only.

For each pre-registered parameterization (exactly the three in
``wedge_triangle.PARAM_SETS`` — no post-hoc tuning) and each side:

  * n_events, base_rate (label mean over ALL CV rows of that side),
    hit_rate (label mean over event rows), lift = hit_rate / base_rate,
    median directional outcome return;
  * the same restricted to HTF-aligned events (long events in a weekly
    uptrend / short events in a weekly downtrend), plus the HTF-conditional
    base rate (label mean over ALL CV rows in that weekly-trend state) so
    pattern lift is separable from pure trend lift;
  * per-CV-fold lift (test segment of each fold) and its min / max range.

Writes ``data/reports/pattern_wedge_triangle.json``.

CLI:  python -m ta_pipeline.patterns.eval_wedge_triangle
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from ..ingestion import IngestionConfig, load_candles
from ..model.config import ModelConfig
from ..model.dataset import materialize_matrix
from ..model.walkforward import fold_masks, make_folds
from .wedge_triangle import PARAM_SETS, detect, params_dict, weekly_trend_state

logger = logging.getLogger(__name__)

_REPORT_PATH = Path(__file__).resolve().parents[1] / "data" / "reports" / "pattern_wedge_triangle.json"
_MIN_FOLD_EVENTS = 5            # folds with fewer events report no lift


def _round(x, nd=4):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), nd)


def build_events(tickers, ingestion_cfg: IngestionConfig = None) -> pd.DataFrame:
    """Run the detector (all 3 parameterizations) + HTF state per ticker.

    Detection runs on the RAW candle store (full history, including the
    feature-warmup region the matrix trims) so swing context is never
    truncated; results join onto the matrix by (ticker, date).
    """
    ingestion_cfg = ingestion_cfg or IngestionConfig()
    parts = []
    for i, ticker in enumerate(tickers):
        bars = load_candles(ticker, cfg=ingestion_cfg)
        if bars is None or len(bars) == 0:
            continue
        bars = bars.sort_values("date").reset_index(drop=True)
        out = bars[["ticker", "date"]].copy()
        out["htf_state"] = weekly_trend_state(bars)
        for p in PARAM_SETS:
            res = detect(bars, p)
            out[f"{p.name}_long"] = res["event_long"]
            out[f"{p.name}_short"] = res["event_short"]
            out[f"{p.name}_strength"] = res["strength"]
            out[f"{p.name}_type"] = res["pattern_type"]
        parts.append(out)
        if (i + 1) % 50 == 0:
            logger.info("detected %d / %d tickers", i + 1, len(tickers))
    return pd.concat(parts, ignore_index=True)


def _side_stats(sub: pd.DataFrame, cv_folds, event_col: str, side: str) -> dict:
    """Event-conditioned label stats for one (parameterization, side), CV only.

    ``sub`` must already be restricted to CV rows with a non-null label.
    """
    label_col = f"label_{side}"
    outcome_col = f"label_{side}_outcome_return"
    y = sub[label_col]
    base = float(y.mean())
    ev = sub[event_col].fillna(False).astype(bool)

    n_events = int(ev.sum())
    hit = float(y[ev].mean()) if n_events else float("nan")
    lift = hit / base if n_events and base > 0 else float("nan")
    med_out = float(sub.loc[ev, outcome_col].median()) if n_events else float("nan")

    # HTF alignment: long in weekly uptrend / short in weekly downtrend.
    want = 1.0 if side == "long" else -1.0
    htf_rows = sub["htf_state"] == want
    htf_ev = ev & htf_rows
    n_htf = int(htf_ev.sum())
    htf_hit = float(y[htf_ev].mean()) if n_htf else float("nan")
    htf_lift = htf_hit / base if n_htf and base > 0 else float("nan")
    # conditional base: ALL CV rows in that weekly state (events or not), so
    # pattern lift is separable from pure trend-following lift.
    htf_base = float(y[htf_rows].mean()) if int(htf_rows.sum()) else float("nan")
    htf_lift_vs_htf_base = htf_hit / htf_base if n_htf and htf_base > 0 else float("nan")
    htf_med_out = float(sub.loc[htf_ev, outcome_col].median()) if n_htf else float("nan")

    # per-fold stability: lift inside each CV fold's TEST segment.
    fold_lifts = {}
    for fold in cv_folds:
        _, test = fold_masks(sub, fold)
        fy, fev = y[test], ev[test]
        n_f = int(fev.sum())
        f_base = float(fy.mean()) if len(fy) else float("nan")
        if n_f >= _MIN_FOLD_EVENTS and f_base > 0:
            fold_lifts[fold.name] = float(fy[fev].mean()) / f_base
        else:
            fold_lifts[fold.name] = None
    valid = [v for v in fold_lifts.values() if v is not None]

    return {
        "side": side,
        "n_cv_rows": int(len(sub)),
        "base_rate": _round(base),
        "unconditional": {
            "n_events": n_events,
            "hit_rate": _round(hit),
            "lift": _round(lift, 3),
            "median_outcome_return": _round(med_out),
        },
        "htf_aligned": {
            "n_events": n_htf,
            "hit_rate": _round(htf_hit),
            "lift_vs_base": _round(htf_lift, 3),
            "htf_conditional_base_rate": _round(htf_base),
            "lift_vs_htf_base": _round(htf_lift_vs_htf_base, 3),
            "median_outcome_return": _round(htf_med_out),
        },
        "per_fold_lift": {k: _round(v, 3) for k, v in fold_lifts.items()},
        "fold_lift_min": _round(min(valid), 3) if valid else None,
        "fold_lift_max": _round(max(valid), 3) if valid else None,
    }


def run_event_study(model_cfg: ModelConfig = None):
    """Run the full wedge_triangle event study; returns (report_dict, path)."""
    model_cfg = model_cfg or ModelConfig()
    matrix = materialize_matrix(model_cfg)
    folds = make_folds(matrix, model_cfg)
    cv_folds = [f for f in folds if not f.is_oos]
    oos_fold = folds[-1]
    dev_end = cv_folds[-1].test_end
    logger.info(
        "matrix: %d rows; CV through %s; OOS (%s+) excluded",
        len(matrix), dev_end.date(), oos_fold.test_start.date(),
    )

    tickers = sorted(matrix["ticker"].unique())
    events = build_events(tickers)
    merged = matrix.merge(events, on=["ticker", "date"], how="left")

    # CV rows ONLY -- the reserved OOS window is never read past this line.
    cv = merged[merged["date"] <= dev_end].reset_index(drop=True)

    results = []
    pattern_mix = {}
    for p in PARAM_SETS:
        for side in ("long", "short"):
            label_col = f"label_{side}"
            sub = cv[cv[label_col].notna()].reset_index(drop=True)
            stats = _side_stats(sub, cv_folds, f"{p.name}_{side}", side)
            stats = dict({"detector": f"wedge_triangle_{p.name}"}, **stats)
            results.append(stats)
        # pattern-kind mix on CV event rows (diagnostic)
        fired = cv[(cv[f"{p.name}_long"].fillna(False)) | (cv[f"{p.name}_short"].fillna(False))]
        pattern_mix[p.name] = fired[f"{p.name}_type"].value_counts().to_dict()

    report = {
        "family": "wedge_triangle",
        "generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "protocol": {
            "labels": "ATR triple-barrier (profit +1.5 ATR, stop -1.0 ATR, 10d horizon)",
            "evaluation": (
                "event-conditioned label stats on walk-forward CV folds only; "
                "the reserved OOS window is untouched"
            ),
            "oos_excluded_from": str(oos_fold.test_start.date()),
            "cv_folds": [
                {"name": f.name, "test_start": str(f.test_start.date()),
                 "test_end": str(f.test_end.date())}
                for f in cv_folds
            ],
            "htf_conditioning": (
                "weekly W-FRI close > SMA10 > SMA20 stack (+1) / inverse (-1), "
                "prior completed week only"
            ),
            "min_fold_events_for_lift": _MIN_FOLD_EVENTS,
            "preregistered_params": [params_dict(p) for p in PARAM_SETS],
            "tickers": len(tickers),
        },
        "pattern_kind_mix": pattern_mix,
        "results": results,
    }

    _REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_REPORT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    logger.info("wrote %s", _REPORT_PATH)
    return report, _REPORT_PATH


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="wedge_triangle pattern event study (CV folds only)."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    report, path = run_event_study()
    rows = []
    for r in report["results"]:
        rows.append({
            "detector": r["detector"], "side": r["side"],
            "n_events": r["unconditional"]["n_events"],
            "base": r["base_rate"],
            "hit": r["unconditional"]["hit_rate"],
            "lift": r["unconditional"]["lift"],
            "htf_n": r["htf_aligned"]["n_events"],
            "htf_hit": r["htf_aligned"]["hit_rate"],
            "htf_lift": r["htf_aligned"]["lift_vs_base"],
            "fold_min": r["fold_lift_min"], "fold_max": r["fold_lift_max"],
        })
    print(pd.DataFrame(rows).to_string(index=False))
    print(f"\nreport: {path}")


if __name__ == "__main__":
    main()
