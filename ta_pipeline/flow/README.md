# ta_pipeline/flow — options-flow / dark-pool feature join

Joins **Unusual Whales options-flow alerts** and **Polygon dark-pool prints**
onto the leakage-controlled TA feature matrix, on `ticker` + `date`, and runs
the dark-pool and (gated) flow model ablations against the TA-only baseline.

> **Status.** Dark-pool path complete and measured. Flow path built but
> **guard-gated** — the flow corpus is far too short to model honestly yet
> (see [Data recency](#data-recency--the-uw-30-day-window)).

## Pipeline

```
extract        Railway Postgres  -> data/flow/{flow_alerts,dark_pool_prints}.parquet
sessionize     Rule A: event timestamp -> feature_date (the close-aligned trading day)
features       per-(ticker, date) flow + dark-pool aggregates
join           left-join onto the TA matrix -> data/flow/joined_matrix.parquet
ablation       walk-forward model: TA vs dark-pool vs combined
```

| Module | Role |
|---|---|
| `config.py` | `FlowConfig` — cache paths, DB env var, dark-pool history floor, guard thresholds |
| `extract.py` | the one DB-touching step — both tables → parquet cache |
| `sessionize.py` | Rule A — assigns each event its `feature_date` |
| `darkpool_features.py` | sparse dark-pool aggregates + the dense derived features |
| `flow_features.py` | sparse options-flow aggregates |
| `join.py` | left-join onto the TA matrix, fill policy, `has_flow` / `has_dp` |
| `guard.py` | refuses the flow ablation until the corpus is large enough |

The model ablation lives in `model/run_ablation.py`.

## Setup

The extract is the only step that touches the database. Everything downstream
reads the parquet cache offline (same design as the candle store).

```bash
# the Railway Postgres *public* proxy URL (not the internal reference)
export FLOWDESK_DATABASE_URL="$(railway variables --service Postgres --kv \
    | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)"

python -m ta_pipeline.flow.extract          # -> data/flow/*.parquet
python -m ta_pipeline.model.run_ablation    # dark-pool ablation
python -m ta_pipeline.model.run_ablation --flow   # flow ablation (gated)
```

## Rule A — the leakage-critical join alignment

The TA labeler enters at `close[t]` and scores `(t, t+10]`. A flow / dark-pool
feature on row `t` may therefore use **only events known by `close[t]`**.

**Rule A:** an event is assigned to the first trading day whose 16:00 ET close
it precedes.

- regular-hours / pre-market event on a trading day → that day
- after-hours event (ET time > 16:00) → next trading day
- weekend / holiday event → next trading day
- event after the last candle → dropped (no entry bar yet)

UTC timestamps are converted to US/Eastern; the trading-day calendar is the
candle store's own dates. The close is taken as 16:00 ET for every day — the
~3 early-close half-days a year would mis-bucket a thin slice of afternoon
events and are left uncorrected. Enforced by `tests/test_sessionize.py` and
the truncation test in `tests/test_flow_join.py`.

## Features

### Dark-pool (`dp_*`, 2023-01-03 → present, ~99.7% on the TA universe)

Sparse raw aggregates per ticker-day: `dp_print_count`, `dp_total_premium`,
`dp_total_size`, `dp_max_premium`. Derived post-join on the dense series:
`dp_premium_to_dollar_vol` (block premium ÷ close×volume — cross-ticker
comparable), `dp_premium_pctile` (126-day trailing percentile of that ratio).
Plus the `has_dp` presence flag.

> The DB's own `rank` / `percentile` columns are **not used** — they are
> recomputed against the whole evolving corpus on every insert, so a print's
> rank reflects a distribution that includes *future* prints (lookahead
> leakage). `dp_premium_pctile`, a strictly trailing window, replaces them.

### Options flow (`flow_*`, raw aggregates only)

Per ticker-day: alert count, total / call / put / net-call premium, bullish /
bearish / net-sentiment premium, sweep count & premium, total size, average
DTE, opening-flow fraction, high-confidence count, plus `has_flow`. No
trailing-percentile normalization — the corpus is too short for a reference
distribution.

### Fill policy

Counts / premiums / sizes 0-fill on activity-free ticker-days; averages /
fractions (`flow_avg_dte`, `flow_opening_frac`) stay `NaN` (no honest 0 —
LightGBM splits on `NaN` natively).

## Result — dark-pool ablation

TA vs dark-pool vs combined, all on the 2023+ window with **identical folds
and OOS rows** (apples-to-apples). OOS = the reserved 12-month slice:

| Feature set | Long ROC-AUC | Short ROC-AUC |
|---|---|---|
| `ta` (baseline, 2023+ rows) | 0.5065 | 0.5011 |
| `dp` (dark-pool only) | 0.5083 | 0.5150 |
| `ta+dp` (combined) | 0.5152 | 0.5129 |
| **delta (ta+dp − ta)** | **+0.009** | **+0.012** |

**Honest read: dark-pool features do not meaningfully beat the baseline.**
The +0.01 lift is consistent across both sides but the model is still ≈ chance
(CV is in fact slightly *below* 0.50; the `dp`-only model is near-degenerate).
A dark-pool block is **direction-agnostic** — a large print is a buy or a sell
— so block aggregates were always going to be a weak *directional* predictor.
The full-history TA-only baseline (`evaluation.csv`) sits at OOS ROC-AUC
0.506 / 0.513 for reference.

Artifacts: `data/models/evaluation_darkpool.csv`,
`predictions_darkpool.{parquet,csv}`, `ta_dp_{long,short}.joblib`.

## Data recency — the UW 30-day window

The flow corpus is dense only from **2026-05-04** (~13 trading days). UW's API
serves a **rolling ~30-trading-day window** on `flow-alerts` — probed
2026-05-21, the reachable floor was ~2026-04-21. Full historical flow is gated
behind a paid add-on (`dev@unusualwhales.com`; ~$250/mo for full-market
historical option trades). The decision taken: **do not backfill or pay —
accumulate live.** The worker already polls and stores ~10–12k alerts/day, so
the corpus grows ~1 trading day per day.

The flow ablation is therefore **guard-gated** (`guard.py`): it refuses to run
until the joined matrix clears `FlowConfig.min_flow_dates` (60) and
`min_labelable_flow_rows` (10000). Today it reports ~1,800 labelable flow rows
on ~18 dates and skips. **When the corpus matures, `run_ablation.py --flow` is
a one-command rerun** — no code change.

## Roadmap — making the flow model functional

The current 50/50 is mostly a **framing** problem, not only a data-quantity
one. When the corpus is large enough, the flow model should be rebuilt — not
just re-run — along these lines:

1. **Model flow *events*, not every ticker-day.** "Will a random stock move"
   is near-unpredictable by construction. "Given unusual flow just fired, does
   the underlying follow" is the project's actual hypothesis and a far
   higher-signal question. TA + dark pool become *conditioning context*.
2. **Event-grain rows.** One row per alert, keeping its own premium / strike /
   DTE / exec type — daily aggregation discards the distribution.
3. **Unified directional label.** One model, label = "did the move go the way
   the flow predicted" — every event contributes a row; the model learns flow
   *reliability*.
4. **Multi-scope flow.** Layer the ticker's flow with **sector net flow** and
   **market net flow**; add a daily **cross-sectional rank** of flow
   conviction. Sector/market aggregates are sturdy even on short history.
5. **Confluence features.** Agreement across streams — bullish flow + a
   same-day dark-pool block; flow direction vs the GEX gamma regime.
6. **Ranking objective + right-sizing.** `lambdarank` over binary
   classification (the hit-list needs ordering, not calibrated probabilities);
   far fewer trees / leaves, monotonic constraints, and a compressed TA
   feature set — ~12k events cannot support a 400-tree, 57-feature GBM.
7. **Multi-horizon labels (3 / 5 / 10-day).** A shorter barrier makes more
   recent data labelable and matches flow's near-term thesis.

Before training a model at all, an **event study** — short-horizon forward
returns by flow direction / premium size / sweep / confidence, with
confidence intervals — is the cheapest honest read on whether an edge exists.
