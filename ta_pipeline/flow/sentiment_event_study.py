"""Chain-flow event study -- does the options-flow signal predict forward
returns? The cheapest honest read before any model (flow/README roadmap).

Design (leakage-safe + clustering-honest):
  * Signal is known at session close[t]; entry is close[t], exit close[t+h].
  * The chain corpus spans only ~5.5 weeks and every ticker shares the same
    handful of dates, so a pooled correlation's naive SE is wildly overstated
    (the pattern-exploration red-team's #1 kill mode). We instead use
    FAMA-MACBETH: compute the cross-sectional rank correlation between the
    signal and the forward return SEPARATELY ON EACH DATE, then t-test the
    resulting time series of daily correlations. The unit of evidence is the
    DATE (~17-26 of them), not the ~thousands of clustered ticker-days.
  * Also reports the long-short quintile spread for the headline signal, formed
    per-date and averaged (same clustering treatment).

Forward returns come from candle_bars (DB) because the local candle parquet
store is stale; everything else reads the offline sentiment cache.

CLI:
  export FLOWDESK_DATABASE_URL=...   # Railway Postgres public URL
  python -m ta_pipeline.flow.sentiment_event_study
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .config import FlowConfig
from .sentiment_extract import load_sentiment
from .sentiment_features import aggregate_sentiment

logger = logging.getLogger(__name__)

HORIZONS = (1, 2, 3, 5, 10)
# (feature, expected directional sign) -- sign is the prior, the study measures it.
SIGNALS = [
    ("sent_dir_prem_score", +1),    # net bullish premium -> up
    ("sent_atm_call_imb", +1),      # ATM call buying -> up
    ("sent_call_buy_frac", +1),     # calls bought not sold -> up
    ("sent_put_buy_frac", -1),      # puts bought -> down
    ("sent_cp_ratio", +1),          # call-heavy volume -> up (weak prior)
    ("sent_otm_call_buy_frac", +1), # far-OTM call lottos -> up
    ("sent_net_dir_prem", +1),      # raw net dir premium (rank handles scale)
]
_MIN_TICKERS_PER_DATE = 20


def load_forward_returns(cfg: FlowConfig, start: str = "2026-04-25") -> pd.DataFrame:
    """Daily close per (ticker, date) from candle_bars + forward returns."""
    import psycopg2

    conn = psycopg2.connect(cfg.resolve_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ticker, bar_time, close FROM candle_bars "
                "WHERE timeframe = '1D' AND bar_time >= %s ORDER BY ticker, bar_time",
                (start,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    df = pd.DataFrame(rows, columns=["ticker", "date", "close"])
    df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None).dt.normalize()
    df["close"] = pd.to_numeric(df["close"], errors="coerce").astype("float64")
    df = df.sort_values(["ticker", "date"]).reset_index(drop=True)
    # close[t] -> close[t+h], per ticker (gap-free within the recent window).
    for h in HORIZONS:
        df[f"fwd_{h}"] = df.groupby("ticker", sort=False)["close"].shift(-h) / df["close"] - 1
    return df


def _spearman(a: pd.Series, b: pd.Series) -> float:
    """Cross-sectional Spearman corr (rank-Pearson), NaN if <3 valid pairs."""
    m = a.notna() & b.notna()
    if m.sum() < 3:
        return np.nan
    ar, br = a[m].rank(), b[m].rank()
    if ar.std() == 0 or br.std() == 0:
        return np.nan
    return float(np.corrcoef(ar, br)[0, 1])


def _fama_macbeth(panel: pd.DataFrame, signal: str, fwd: str) -> dict:
    """Daily cross-sectional Spearman corrs, then t-test across dates."""
    daily = []
    for _, g in panel.groupby("date", sort=True):
        if g[signal].notna().sum() >= _MIN_TICKERS_PER_DATE:
            c = _spearman(g[signal], g[fwd])
            if not np.isnan(c):
                daily.append(c)
    n = len(daily)
    if n < 3:
        return dict(n_dates=n, mean_corr=np.nan, t=np.nan)
    arr = np.array(daily)
    se = arr.std(ddof=1) / np.sqrt(n)
    return dict(n_dates=n, mean_corr=arr.mean(), t=arr.mean() / se if se > 0 else np.nan)


def _quintile_spread(panel: pd.DataFrame, signal: str, fwd: str) -> dict:
    """Per-date top-minus-bottom-quintile forward-return spread, t-tested over
    dates (the headline signal's intuitive economic magnitude)."""
    spreads = []
    for _, g in panel.groupby("date", sort=True):
        gg = g[[signal, fwd]].dropna()
        if len(gg) < _MIN_TICKERS_PER_DATE:
            continue
        q = gg[signal].quantile([0.2, 0.8])
        bot = gg[gg[signal] <= q.iloc[0]][fwd].mean()
        top = gg[gg[signal] >= q.iloc[1]][fwd].mean()
        if np.isfinite(bot) and np.isfinite(top):
            spreads.append(top - bot)
    n = len(spreads)
    if n < 3:
        return dict(n_dates=n, mean_spread=np.nan, t=np.nan)
    arr = np.array(spreads)
    se = arr.std(ddof=1) / np.sqrt(n)
    return dict(n_dates=n, mean_spread=arr.mean(), t=arr.mean() / se if se > 0 else np.nan)


def run_event_study(cfg: FlowConfig = None) -> pd.DataFrame:
    cfg = cfg or FlowConfig()
    sent = aggregate_sentiment(load_sentiment(cfg))
    rets = load_forward_returns(cfg)
    panel = sent.merge(rets, on=["ticker", "date"], how="inner")

    n_dates = panel["date"].nunique()
    logger.info("event-study panel: %d ticker-days, %d tickers, %d dates (%s..%s)",
                len(panel), panel["ticker"].nunique(), n_dates,
                panel["date"].min().date(), panel["date"].max().date())

    records = []
    for signal, sign in SIGNALS:
        for h in HORIZONS:
            fwd = f"fwd_{h}"
            fm = _fama_macbeth(panel, signal, fwd)
            records.append(dict(signal=signal, prior_sign=sign, horizon=h,
                                n_dates=fm["n_dates"], mean_corr=fm["mean_corr"], t=fm["t"]))
    res = pd.DataFrame(records)

    print(f"\n=== chain-flow event study (Fama-MacBeth daily cross-sectional Spearman) ===")
    print(f"panel: {len(panel):,} ticker-days · {panel['ticker'].nunique()} tickers · {n_dates} dates\n")
    print("signal correlation with forward return (mean daily corr | t over dates):")
    for signal, _ in SIGNALS:
        row = res[res.signal == signal]
        cells = " ".join(
            f"{int(h)}d:{r.mean_corr:+.3f}(t={r.t:+.1f})"
            for h, r in zip(row.horizon, row.itertuples())
        )
        print(f"  {signal:24s} {cells}")

    print("\nheadline signal (sent_dir_prem_score) long-short quintile spread, % forward return:")
    for h in HORIZONS:
        qs = _quintile_spread(panel, "sent_dir_prem_score", f"fwd_{h}")
        print(f"  {h:2d}d: top-bottom = {100*qs['mean_spread']:+.2f}%  (t={qs['t']:+.1f}, {qs['n_dates']} dates)")

    # DECISIVE TEST: split each pooled correlation into a BETWEEN-ticker part
    # (persistent characteristic — e.g. "is this a hot high-call-volume name")
    # and a WITHIN-ticker part (genuine day-to-day timing). A signal whose power
    # is mostly between-ticker in a single regime is a confound, not flow alpha.
    print("\nbetween- vs within-ticker decomposition (fwd_10, rank corr):")
    print("  between = persistent ticker trait · within = genuine timing")
    for signal, _ in SIGNALS:
        d = panel[["ticker", signal, "fwd_10"]].dropna()
        tm = d.groupby("ticker").mean(numeric_only=True)
        btw = _spearman(tm[signal], tm["fwd_10"])
        dev = d.copy()
        for c in (signal, "fwd_10"):
            dev[c] = dev[c] - dev.groupby("ticker")[c].transform("mean")
        wth = _spearman(dev[signal], dev["fwd_10"])
        flag = "  <-- CONFOUND (between >> within)" if abs(btw) > 0.3 and abs(btw) > 2 * abs(wth) else ""
        print(f"  {signal:24s} between={btw:+.3f}  within={wth:+.3f}{flag}")

    print("\nCAVEATS: ~5.5-week corpus; |t|>~2 over only this many dates is suggestive, "
          "NOT confirmatory. Single regime (no 2024-25 validation). Close-to-close, "
          "no costs. The strong cross-sectional correlations are dominated by persistent "
          "ticker traits (see decomposition) -- the confluence study MUST use ticker fixed "
          "effects / within-ticker variation or it will be fooled by them.")
    return res


def main(argv=None) -> None:
    import argparse
    argparse.ArgumentParser(description="Chain-flow forward-return event study.").parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run_event_study()


if __name__ == "__main__":
    main()
