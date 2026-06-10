"""Event study for the flag/pennant pattern family.

Replicates the ``run_ta_events`` evaluation mechanics WITHOUT training a
model: pure event-conditioned triple-barrier statistics on the deterministic
walk-forward folds from ``model.walkforward.make_folds``.

Discipline:

* **CV folds only.** Every statistic is computed on the development period
  (all dates strictly before the reserved OOS fold's test window). The OOS
  slice is never touched.
* **Pre-registered parameterizations.** Exactly the three presets in
  ``flag_pennant.PRESETS`` are evaluated; all three are reported, good or bad.
* **HTF conditioning.** Each metric is also reported restricted to
  higher-timeframe-aligned events: long events in a weekly uptrend, short
  events in a weekly downtrend (prior-completed-week state -- no lookahead).

Per (preset, side): n_events, label base rate over ALL CV rows of that side,
hit rate on event rows, lift = hit_rate / base_rate, median directional
forward outcome return, per-CV-fold lift range (stability), and the
HTF-aligned versions of all of it.

Writes ``data/reports/pattern_flag_pennant.json``.

CLI:  python -m ta_pipeline.patterns.eval_flag_pennant
"""

from __future__ import annotations

import datetime
import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import PipelineConfig
from ..ingestion import load_candles_universe
from ..model.config import ModelConfig
from ..model.dataset import materialize_matrix
from ..model.walkforward import make_folds
from .flag_pennant import PRESETS, detect, params_dict, weekly_trend_state

logger = logging.getLogger(__name__)

_REPORT_PATH = Path(__file__).resolve().parents[1] / "data" / "reports" / "pattern_flag_pennant.json"
_MIN_FOLD_EVENTS = 5     # folds with fewer events report no lift (too noisy)


def compute_events(candles: pd.DataFrame, pipeline_cfg: PipelineConfig) -> pd.DataFrame:
    """Per (ticker, date): event/strength columns per preset + HTF state."""
    parts = []
    for ticker, g in candles.groupby("ticker", sort=False):
        g = g.sort_values("date").reset_index(drop=True)
        cols = {"ticker": ticker, "date": g["date"]}
        cols["htf_state"] = weekly_trend_state(g)
        for p in PRESETS:
            ev = detect(g, p, pipeline_cfg)
            cols[f"ev_{p.name}_long"] = ev["event_long"]
            cols[f"ev_{p.name}_short"] = ev["event_short"]
            cols[f"strength_{p.name}"] = ev["strength"]
        parts.append(pd.DataFrame(cols))
    return pd.concat(parts, ignore_index=True)


def _rate(series: pd.Series) -> float:
    return float(series.mean()) if len(series) else float("nan")


def _round(x, nd=4):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


def _side_stats(rows, event_mask, label_col, outcome_col, base_rate, strength_col):
    """Event-conditioned stats on already CV-restricted, labeled ``rows``."""
    ev = rows[event_mask]
    n = int(len(ev))
    hit = _rate(ev[label_col]) if n else float("nan")
    return {
        "n_events": n,
        "hit_rate": _round(hit),
        "lift": _round(hit / base_rate, 3) if n and base_rate > 0 else None,
        "median_outcome_return": _round(ev[outcome_col].median()) if n else None,
        "mean_strength": _round(ev[strength_col].mean(), 3) if n else None,
    }


def _fold_lifts(rows, event_mask, label_col, cv_folds):
    """Per-CV-fold lift (fold hit rate / fold base rate) on fold test windows."""
    out = {}
    for fold in cv_folds:
        in_fold = (rows["date"] >= fold.test_start) & (rows["date"] <= fold.test_end)
        fold_rows = rows[in_fold]
        fold_ev = fold_rows[event_mask[in_fold]]
        base = _rate(fold_rows[label_col])
        if len(fold_ev) < _MIN_FOLD_EVENTS or not base > 0:
            out[fold.name] = {"n_events": int(len(fold_ev)), "lift": None}
            continue
        out[fold.name] = {
            "n_events": int(len(fold_ev)),
            "lift": _round(_rate(fold_ev[label_col]) / base, 3),
        }
    return out


def run_event_study(model_cfg: ModelConfig = None, pipeline_cfg: PipelineConfig = None) -> dict:
    model_cfg = model_cfg or ModelConfig()
    pipeline_cfg = pipeline_cfg or PipelineConfig()

    matrix = materialize_matrix(model_cfg, pipeline_cfg)
    folds = make_folds(matrix, model_cfg)
    oos = folds[-1]
    assert oos.is_oos
    cv_folds = [f for f in folds if not f.is_oos]

    tickers = sorted(matrix["ticker"].unique())
    logger.info("loading candles for %d tickers", len(tickers))
    candles = load_candles_universe(tickers=tickers)
    events = compute_events(candles, pipeline_cfg)
    matrix = matrix.merge(events, on=["ticker", "date"], how="left", validate="1:1")
    for p in PRESETS:
        for side in ("long", "short"):
            col = f"ev_{p.name}_{side}"
            matrix[col] = matrix[col].fillna(False).astype(bool)

    # ---- CV-only restriction: never touch the reserved OOS window --------
    cv_mask = matrix["date"] < oos.test_start
    logger.info(
        "CV rows: %d (dev period %s .. %s); OOS window from %s EXCLUDED",
        int(cv_mask.sum()), matrix["date"].min().date(),
        cv_folds[-1].test_end.date(), oos.test_start.date(),
    )

    results = []
    for p in PRESETS:
        for side in ("long", "short"):
            label_col = f"label_{side}"
            outcome_col = f"label_{side}_outcome_return"
            rows = matrix[cv_mask & matrix[label_col].notna()].reset_index(drop=True)
            base_rate = _rate(rows[label_col])

            event_mask = rows[f"ev_{p.name}_{side}"]
            aligned_state = 1.0 if side == "long" else -1.0
            htf_mask = event_mask & (rows["htf_state"] == aligned_state)

            uncond = _side_stats(rows, event_mask, label_col, outcome_col,
                                 base_rate, f"strength_{p.name}")
            htf = _side_stats(rows, htf_mask, label_col, outcome_col,
                              base_rate, f"strength_{p.name}")
            fold_lifts = _fold_lifts(rows, event_mask, label_col, cv_folds)
            fold_lifts_htf = _fold_lifts(rows, htf_mask, label_col, cv_folds)
            lifts = [v["lift"] for v in fold_lifts.values() if v["lift"] is not None]

            results.append({
                "detector": f"flag_pennant_{p.name}",
                "side": side,
                "n_cv_rows": int(len(rows)),
                "base_rate": _round(base_rate),
                "unconditional": uncond,
                "htf_aligned": htf,
                "fold_lifts": fold_lifts,
                "fold_lifts_htf_aligned": fold_lifts_htf,
                "fold_lift_min": min(lifts) if lifts else None,
                "fold_lift_max": max(lifts) if lifts else None,
            })
            logger.info(
                "%s %s: n=%d hit=%s lift=%s | HTF n=%d hit=%s lift=%s",
                p.name, side, uncond["n_events"], uncond["hit_rate"],
                uncond["lift"], htf["n_events"], htf["hit_rate"], htf["lift"],
            )

    report = {
        "family": "flag_pennant",
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "protocol": {
            "labels": "ATR triple-barrier (profit +1.5 ATR, stop -1.0 ATR, 10d horizon)",
            "evaluation": "event-conditioned label stats on walk-forward CV folds only; "
                          "the reserved OOS window is untouched",
            "oos_excluded_from": str(oos.test_start.date()),
            "cv_folds": [
                {"name": f.name, "test_start": str(f.test_start.date()),
                 "test_end": str(f.test_end.date())}
                for f in cv_folds
            ],
            "htf_conditioning": "weekly W-FRI close > SMA10 > SMA20 stack (+1) / "
                                "inverse (-1), prior completed week only",
            "min_fold_events_for_lift": _MIN_FOLD_EVENTS,
            "preregistered_presets": [params_dict(p) for p in PRESETS],
            "tickers": len(tickers),
        },
        "results": results,
    }

    _REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_REPORT_PATH, "w") as fh:
        json.dump(report, fh, indent=2)
    logger.info("wrote %s", _REPORT_PATH)
    return report


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Flag/pennant event study (CV only).")
    parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    report = run_event_study()
    print(json.dumps(report["results"], indent=2))


if __name__ == "__main__":
    main()
