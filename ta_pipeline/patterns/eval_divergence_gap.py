"""Event study for the ``divergence_gap`` pattern family.

Replicates the ``model/run_ta_events.py`` evaluation mechanics — the cached
feature + label matrix, the deterministic ``make_folds`` walk-forward splits
— but as a pure event study: no model is trained; each detector's event rows
are scored against the ATR triple-barrier labels (``label_long`` /
``label_short``, 10d horizon).

Validation discipline
---------------------
* Detectors run per ticker on the FULL candle history (so indicators are
  fully formed), then events are joined to matrix rows on (ticker, date).
* Headline stats use ONLY the union of the CV folds' test windows. The
  reserved OOS window (final ``oos_months``) is never touched, and the
  pre-CV head segment (training-only in the model protocol) is excluded so
  the evaluated rows are exactly the rows the model protocol scores on.
* Per-fold lift (cv1..cvN test windows) is reported as a stability range.
* Every metric is reported twice: unconditional, and HTF-aligned — long
  events with the prior completed week's trend state +1, short events with
  -1 (the user hypothesis under test).

Writes ``data/reports/pattern_divergence_gap.json``.

CLI:  python -m ta_pipeline.patterns.eval_divergence_gap
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from ..ingestion import IngestionConfig, load_candles
from ..model.config import ModelConfig
from ..model.dataset import materialize_matrix
from ..model.walkforward import make_folds
from .divergence_gap import SUB_FAMILY, make_detectors, weekly_trend_state

logger = logging.getLogger(__name__)

_PACKAGE_DIR = Path(__file__).resolve().parents[1]
REPORT_PATH = _PACKAGE_DIR / "data" / "reports" / "pattern_divergence_gap.json"

#: minimum events inside one CV fold's test window for a per-fold lift
MIN_FOLD_EVENTS = 10

PARAMS = {
    "rsi_div_m3": {"m": 3, "rsi_period": 14, "extreme_rsi": None},
    "rsi_div_m5": {"m": 5, "rsi_period": 14, "extreme_rsi": None},
    "rsi_div_m3_ext": {"m": 3, "rsi_period": 14, "extreme_rsi": 40.0},
    "gap_go_1.0": {"mode": "go", "gap_min_atr": 1.0},
    "gap_go_1.5": {"mode": "go", "gap_min_atr": 1.5},
    "gap_fade_1.0": {"mode": "fade", "gap_min_atr": 1.0},
    "gap_fade_1.5": {"mode": "fade", "gap_min_atr": 1.5},
}


def _detect_universe(tickers, detectors, ingestion_cfg=None):
    """Run every detector per ticker on full history.

    Returns ``(events, htf)``: ``events[name]`` is a sparse frame of fired
    rows (ticker, date, event_long, event_short, strength); ``htf`` carries
    the prior-completed-week trend state for EVERY (ticker, date), so
    HTF-conditional base rates can be computed on non-event rows too.
    """
    ingestion_cfg = ingestion_cfg or IngestionConfig()
    event_parts = {name: [] for name in detectors}
    htf_parts = []
    for ticker in tickers:
        bars = load_candles(ticker, cfg=ingestion_cfg)
        if bars.empty:
            continue
        bars = bars.sort_values("date").reset_index(drop=True)
        htf_parts.append(pd.DataFrame({
            "ticker": ticker,
            "date": bars["date"],
            "htf_state": weekly_trend_state(bars).to_numpy(),
        }))
        for name, detect in detectors.items():
            out = detect(bars)
            fired = out["event_long"] | out["event_short"]
            if not fired.any():
                continue
            part = pd.DataFrame({
                "ticker": ticker,
                "date": bars.loc[fired, "date"].to_numpy(),
                "event_long": out.loc[fired, "event_long"].to_numpy(),
                "event_short": out.loc[fired, "event_short"].to_numpy(),
                "strength": out.loc[fired, "strength"].to_numpy(),
            })
            event_parts[name].append(part)
    events = {
        name: (pd.concat(parts, ignore_index=True) if parts
               else pd.DataFrame(columns=["ticker", "date", "event_long",
                                          "event_short", "strength"]))
        for name, parts in event_parts.items()
    }
    return events, pd.concat(htf_parts, ignore_index=True)


def _side_stats(cv, ev_mask, side, cv_folds):
    """Event-conditioned label stats for one detector side on the CV rows.

    ``cv`` is the CV-window slice of the matrix (with ``htf_state``);
    ``ev_mask`` flags this side's event rows within it.
    """
    label = cv[f"label_{side}"]
    outcome = cv[f"label_{side}_outcome_return"]
    base_rate = float(label.mean())
    want_htf = 1.0 if side == "long" else -1.0
    htf_aligned = cv["htf_state"] == want_htf

    ev = ev_mask & label.notna()
    ev_htf = ev & htf_aligned
    n, n_htf = int(ev.sum()), int(ev_htf.sum())

    def _rate(mask):
        return float(label[mask].mean()) if int(mask.sum()) else float("nan")

    hit = _rate(ev)
    hit_htf = _rate(ev_htf)
    base_htf = _rate(htf_aligned & label.notna())   # HTF-conditional base

    fold_lifts = []
    for fold in cv_folds:
        in_fold = (cv["date"] >= fold.test_start) & (cv["date"] <= fold.test_end)
        f_ev = ev & in_fold
        f_base = _rate(in_fold & label.notna())
        if int(f_ev.sum()) >= MIN_FOLD_EVENTS and f_base > 0:
            fold_lifts.append(_rate(f_ev) / f_base)

    def _median(mask):
        return float(outcome[mask].median()) if int(mask.sum()) else None

    return {
        "n_events": n,
        "base_rate": round(base_rate, 4),
        "hit_rate": round(hit, 4) if n else None,
        "lift": round(hit / base_rate, 4) if n and base_rate > 0 else None,
        "median_outcome_return": _median(ev),
        "htf_aligned": {
            "n_events": n_htf,
            "base_rate_htf_rows": round(base_htf, 4) if not np.isnan(base_htf) else None,
            "hit_rate": round(hit_htf, 4) if n_htf else None,
            "lift_vs_unconditional_base": (
                round(hit_htf / base_rate, 4) if n_htf and base_rate > 0 else None
            ),
            "lift_vs_htf_base": (
                round(hit_htf / base_htf, 4)
                if n_htf and not np.isnan(base_htf) and base_htf > 0 else None
            ),
            "median_outcome_return": _median(ev_htf),
        },
        "fold_lifts": [round(x, 4) for x in fold_lifts],
        "fold_lift_min": round(min(fold_lifts), 4) if fold_lifts else None,
        "fold_lift_max": round(max(fold_lifts), 4) if fold_lifts else None,
        "n_folds_with_min_events": len(fold_lifts),
    }


def run_event_study(model_cfg: ModelConfig = None):
    """Run the divergence_gap event study on the CV windows; write the report."""
    model_cfg = model_cfg or ModelConfig()
    matrix = materialize_matrix(model_cfg)
    folds = make_folds(matrix, model_cfg)
    cv_folds = [f for f in folds if not f.is_oos]
    oos = folds[-1]
    assert oos.is_oos

    # CV rows = the union of the CV folds' test windows. Strictly before the
    # reserved OOS window, which is never evaluated here.
    cv_start, cv_end = cv_folds[0].test_start, cv_folds[-1].test_end
    assert cv_end < oos.test_start
    cv = matrix[(matrix["date"] >= cv_start) & (matrix["date"] <= cv_end)]
    cv = cv.reset_index(drop=True)
    logger.info("CV rows: %d (%s .. %s); OOS (excluded) starts %s",
                len(cv), cv_start.date(), cv_end.date(), oos.test_start.date())

    detectors = make_detectors()
    tickers = sorted(matrix["ticker"].unique())
    events, htf = _detect_universe(tickers, detectors)

    cv = cv.merge(htf, on=["ticker", "date"], how="left")

    report = {
        "family": "divergence_gap",
        "generated": date.today().isoformat(),
        "protocol": {
            "labels": "ATR triple-barrier, +1.5/-1.0 ATR, 10d horizon "
                      "(label_long / label_short from the cached matrix)",
            "evaluation_rows": "union of make_folds CV test windows only; "
                               "reserved OOS window untouched",
            "cv_window": [str(cv_start.date()), str(cv_end.date())],
            "oos_start_excluded": str(oos.test_start.date()),
            "n_cv_rows": int(len(cv)),
            "n_tickers": len(tickers),
            "htf_state": "weekly (W-FRI) close > SMA10 > SMA20 stack from "
                         "daily candles; days carry the PRIOR completed "
                         "week's state",
            "per_fold_min_events": MIN_FOLD_EVENTS,
            "preregistration": "7 parameterizations fixed before evaluation "
                               "(<=3 per detector family); all reported, "
                               "none tuned",
        },
        "detectors": {},
    }

    key = ["ticker", "date"]
    cv_keys = cv[key]
    for name, det_events in events.items():
        merged = cv_keys.merge(
            det_events, on=key, how="left"
        )
        long_mask = merged["event_long"].eq(True)     # NaN (no event) -> False
        short_mask = merged["event_short"].eq(True)
        entry = {
            "sub_family": SUB_FAMILY[name],
            "params": PARAMS[name],
            "n_event_rows_all_history": int(len(det_events)),
            "long": _side_stats(cv, long_mask, "long", cv_folds),
            "short": _side_stats(cv, short_mask, "short", cv_folds),
        }
        report["detectors"][name] = entry
        logger.info(
            "%s: long n=%d lift=%s (htf %s) | short n=%d lift=%s (htf %s)",
            name,
            entry["long"]["n_events"], entry["long"]["lift"],
            entry["long"]["htf_aligned"]["lift_vs_unconditional_base"],
            entry["short"]["n_events"], entry["short"]["lift"],
            entry["short"]["htf_aligned"]["lift_vs_unconditional_base"],
        )

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    logger.info("wrote %s", REPORT_PATH)
    return report


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="divergence_gap event study (CV folds only)."
    )
    parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    report = run_event_study()
    rows = []
    for name, entry in report["detectors"].items():
        for side in ("long", "short"):
            s = entry[side]
            rows.append({
                "detector": name, "side": side,
                "n": s["n_events"], "base": s["base_rate"],
                "hit": s["hit_rate"], "lift": s["lift"],
                "htf_n": s["htf_aligned"]["n_events"],
                "htf_hit": s["htf_aligned"]["hit_rate"],
                "htf_lift": s["htf_aligned"]["lift_vs_unconditional_base"],
                "fold_lift": "%s..%s" % (s["fold_lift_min"], s["fold_lift_max"]),
                "med_ret": s["median_outcome_return"],
            })
    print(pd.DataFrame(rows).to_string(index=False))


if __name__ == "__main__":
    main()
