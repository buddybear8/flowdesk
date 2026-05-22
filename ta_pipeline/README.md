# ta_pipeline

Leakage-controlled **technical-analysis feature layer + label layer** for the
options-flow trade-idea model. Produces a per-ticker, per-bar feature matrix
plus ATR-scaled triple-barrier labels, ready to be joined (on `ticker` +
`date`) with separately-engineered flow / dark-pool features and fed into a
gradient-boosted classifier.

> **Status — complete (7 / 7 phases).** Candle ingestion (backfill / update / store), §3 indicators, swing
> detection, all §4 feature blocks, the §5 triple-barrier label layer, warmup
> masking, the `build_dataset` master builder and the §7 leakage test suite
> are all in place. Daily candles only; multi-timeframe (hourly / weekly) is
> deferred by design decision.

## Design principles

1. **Continuous, signed features over hand-cut booleans** — trees find their
   own thresholds. Where a categorical/ordinal feature is specified, its
   continuous companion is emitted alongside it.
2. **Cross-ticker comparable** — price magnitudes are normalized to ATR units;
   "extremeness" comes from trailing self-calibrating percentiles.
3. **Strict no-lookahead** — every feature at bar *t* uses only data through
   bar *t*. Trailing windows only, never full-sample statistics.
4. **Features describe the present; the label scores the future** — outcome
   information never enters a feature.

## Project layout

```
ta_pipeline/
├── config.py          PipelineConfig — every parameter from the brief §6
├── ingestion/         Polygon candle backfill / update / load_candles + manifest
├── indicators.py      §3 indicators — Wilder ATR/RSI, Bollinger, SMA, TR
├── swings.py          swing / pivot detection at m=3 and m=5
├── features/          §4 feature blocks — one module per block
│   ├── common.py      trailing_pctile_rank, normalized_slope, bars_since
│   ├── momentum.py    §4.1   bollinger.py §4.2   volatility.py §4.3
│   ├── trend.py       §4.4   zones.py     §4.5
│   └── reclaim.py     §4.6   breakout.py  §4.7
├── labeler.py         §5 ATR-scaled triple-barrier labeler
├── warmup.py          warmup + unlabelable-edge masking
├── pipeline.py        build_features / build_dataset master builders
├── model/             TA-only baseline — walk-forward LightGBM + evaluation
└── tests/             §7 leakage / alignment / ATR-consistency suite
```

## Setup

```bash
cd ta_pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export POLYGON_API_KEY=your_key_here
```

The §3 indicators are implemented directly in pandas/numpy (not via
`pandas-ta`): this gives exact, audited Wilder smoothing — the brief elevates
ATR correctness to the system's single most important alignment — and drops the
`numpy<2.0` pin `pandas-ta` would force. The one-function-per-indicator wrapper
keeps the library swappable.

## Candle ingestion

Daily OHLCV bars are pulled from Polygon.io into a local **parquet store** — one
file per ticker under `data/candles/{TICKER}.parquet` — with a CSV **manifest**
(`data/manifest.csv`) summarizing every ticker. The same store serves the
10-year TA-only baseline and the recent flow-overlap window — just different
`start` / `end` slices on `load_candles`.

### One-time backfill

```bash
export POLYGON_API_KEY=your_key_here
python -m ta_pipeline.ingestion.backfill --universe-file tickers.txt
```

Pulls the full 10 years of split-adjusted daily bars — one request per ticker,
up to 10 concurrent workers — runs the quality checks and writes the store +
manifest. `tickers.txt` is one symbol per line (or comma-separated; `#`
comments allowed). Use `--tickers AAPL,MSFT,NVDA` for an ad-hoc set, and
`--years` / `--data-dir` / `--workers` to override defaults. Re-running is safe
— each ticker's file is overwritten, which also refreshes split adjustments.

### Incremental daily update

```bash
python -m ta_pipeline.ingestion.update --universe-file tickers.txt
```

Reads each ticker's last stored date from the manifest, fetches only newer bars
and appends them (deduped on date). It is a ~200-row append — schedule it after
market close on whatever cron already runs your pipeline; no new infrastructure.
Tickers new to the universe are full-backfilled automatically.

> **Splits** — a split shifts historical split-adjusted prices. The updater does
> not re-adjust history; re-run the full backfill periodically (e.g. monthly) to
> keep adjustments current.

### Quality flags (manifest `qc_flags` column)

| Flag | Meaning |
|---|---|
| `empty` | Polygon returned no bars |
| `short_history` | first bar well after the requested start (IPO'd late — expected; actual start is recorded) |
| `stale` | last bar well before today (possible delisting or symbol change) |
| `gaps` | fewer trading days than expected for the date span |
| `zero_volume_rows` / `zero_price_rows` | suspicious zero/missing values present |
| `error:<Type>` | the fetch failed for this ticker |

Flags are advisory — issues are logged and recorded in the manifest, never
silently dropped.

## Quick start

```python
from ta_pipeline import PipelineConfig, load_candles_universe, build_dataset

cfg = PipelineConfig()                       # feature/label parameters (brief §6)

# candles come from the local parquet store (filled by the backfill job)
bars = load_candles_universe(["AAPL", "MSFT", "NVDA"],
                             start="2018-01-01", end="2024-12-31")

dataset = build_dataset(bars, cfg)           # features + triple-barrier labels;
                                             # warmup + unlabelable rows trimmed
```

`build_dataset(df, cfg, trim=False)` keeps every bar with the
`is_warmup` / `is_labelable` / `is_valid` flags intact — useful for inspection
and the leakage tests. `build_features(df, cfg)` runs the feature blocks only,
without labels.

## Pipeline stages

| Stage | Entry point | Output |
|---|---|---|
| Load | `load_candles` / `load_candles_universe` | adjusted daily OHLCV from the parquet store |
| Indicators (§3) | `compute_indicators` | RSI, Bollinger, ATR, TR, SMA, vol avg |
| Swings | `add_swings` | confirmed swing highs / lows (m=3, m=5) |
| Features (§4) | `add_*_features` | 61 feature columns |
| Label (§5) | `add_labels` | mirrored long/short triple-barrier labels |
| Warmup mask | `add_validity_flags` / `trim_to_valid` | model-ready matrix |

Every stage runs **per ticker** — no ticker's rolling window, swing sequence or
label horizon can cross into another's.

## Feature reference

61 feature columns. The 4 raw swing markers are **inspection-only** (centered,
future-peeking — see Leakage guarantees); the other 57 are model-ready.

### §3 indicators (also raw features)

| Column | Definition |
|---|---|
| `rsi_2`, `rsi_7`, `rsi_14` | Wilder RSI — raw, never binned |
| `bb_upper/middle/lower` | Bollinger bands, 20-period, 2.0σ (population std) |
| `true_range`, `atr_14` | per-bar true range; Wilder ATR(14) |
| `sma_20/50/100/200` | simple moving averages |
| `volume_avg_20` | 20-bar average volume |

### Swing markers

| Column | Definition |
|---|---|
| `swing_high/low_m{3,5}` | raw pivot price at the pivot bar — **inspection only** |
| `swing_high/low_m{3,5}_conf` | same price at the confirmation bar `p+m` — leakage-safe |

### §4.1 RSI / momentum · §4.2 Bollinger · §4.3 volatility

| Column | Definition |
|---|---|
| `rsi_14_pctile` | 252-bar trailing percentile of `rsi_14` |
| `rsi_divergence` | −1/0/+1 price-vs-RSI divergence (confirmed swings) |
| `bb_percent_b` | %B = (close − lower)/(upper − lower); signed, may exit [0,1] |
| `bb_bandwidth` | (upper − lower)/middle |
| `bb_bandwidth_pctile` | 126-bar trailing percentile of bandwidth (squeeze) |
| `atr_normalized` | ATR / close |
| `atr_pctile` | 252-bar trailing percentile of ATR |
| `true_range_in_atr` | true range ÷ ATR (1.0 = a normal day) |
| `atr_slope` | fractional change in ATR over 20 bars |

### §4.4 trend structure · §4.5 MA zones

| Column | Definition |
|---|---|
| `trend_stack_state` | ordinal −2…+2 over the 50/100/200 SMAs |
| `bars_since_stack_change` | trend freshness |
| `ma_spread` | (SMA50 − SMA200)/close |
| `dist_to_sma{20,50,100,200}_atr` | signed (close − SMA)/ATR |
| `slope_sma{20,50,100,200}` | normalized SMA slope over 20 bars |
| `zone_{50,200}_{upper,lower}` | SMA ± 0.5·ATR zone bounds |
| `in_zone_{50,200}` | bar range overlaps the zone (bool) |
| `touch_{50,200}` | signed −1/0/+1 trend-filtered pullback/rally |
| `bars_since_touch_{50,200}` | recency of the last touch |

### §4.6 reclaim · §4.7 consolidation breakout

| Column | Definition |
|---|---|
| `swing_reclaim` | −1/0/+1 false breakout / false breakdown (2-close) |
| `reclaim_penetration_atr` | deepest breach depth in ATR units |
| `bars_since_reclaim` | recency of the last reclaim |
| `reclaim_level_dist_atr` | close distance from the last reclaim level (ATR) |
| `trend_aligned_reclaim` | derived: reclaim filtered by `trend_stack_state` |
| `range_breakout` | −1/0/+1 consolidation breakout |
| `squeeze_intensity` | 1 − bandwidth percentile (higher = tighter) |
| `squeeze_duration` | consecutive compression bars |
| `breakout_strength_atr` | signed distance of close beyond the range edge |
| `bars_since_breakout` | recency of the last breakout |

## Label reference

ATR-scaled **triple barrier** on the underlying — entry `close[t]`, ATR pinned
to the entry bar, profit +1.5·ATR, stop −1.0·ATR, vertical barrier 10 trading
days, first touch wins. A bar touching both barriers counts as the stop
(pessimistic). No touch by the horizon → sign of the terminal return → a clean
binary classifier.

The barrier is **mirrored** — a long and a short — sharing the entry and ATR;
short is the long flipped (profit `-1.5 ATR`, stop `+1.0 ATR`). Each side is an
independent binary label. Emitted for each direction `d` in {`long`, `short`}:

| Column | Definition |
|---|---|
| `label_d` | binary {0, 1}; NaN if unlabelable (right edge) |
| `label_d_barrier` | `profit` / `stop` / `timeout` / None |
| `label_d_bars_to_outcome` | bars from entry to the first touch (or horizon) |
| `label_d_outcome_return` | the trade's directional return at the outcome bar (positive = the trade worked, both sides) |
| `terminal_return_{5,10,21}` | shared raw forward returns, for later DTE re-bucketing |

> **Horizon** — flow DTE is variable but under 30 calendar days, so a 10-trading-day
> (~2-week) barrier sits safely inside that cap. The extra `terminal_return_*`
> columns let the label be re-bucketed by DTE later without recomputing.

## Leakage guarantees

Each guarantee is enforced by a test in `tests/` (run `pytest`).

| Guarantee | Test |
|---|---|
| **Alignment** — a feature at *t* is unchanged when bars > *t* are deleted | `test_leakage_alignment.py` |
| **Trailing percentiles** — every `*_pctile` uses only its trailing window, never the full sample, never a partial window | `test_trailing_percentile.py` |
| **ATR consistency** — the labeler's ATR is the identical Wilder ATR(14) the features use | `test_atr_consistency.py` |
| **Label separation** — features read bars ≤ *t*; the label outcome reads (t, t+horizon]; no overlap | `test_label_separation.py` |
| **Warmup masking** — the ~266-bar warmup region and unlabelable right edge are dropped; no half-formed value survives | `test_warmup.py` |
| **Labeler correctness** — barrier touches, first-touch-wins, tie-break, timeout | `test_labeler.py` |
| **Cross-ticker isolation** — a ticker's features are identical computed alone vs. in a universe | `test_leakage_alignment.py` |

The **raw swing markers** (`swing_high/low_m{3,5}`) are centered — they use *m*
bars *after* the pivot — so they intentionally fail the alignment test and are
excluded from the feature set. Only the confirmation-aligned `*_conf` columns,
which appear at bar `p+m`, are leakage-safe to consume.

## Configuration & the parameter sweep

`PipelineConfig` ([config.py](config.py)) is the single source of truth for
every brief §6 parameter. Construct with no arguments for the defaults; override
fields for a sweep variant, e.g. `PipelineConfig(swing_m=5)`.

Four parameters are genuinely universe-dependent and meant to be **swept** under
walk-forward CV; everything else is fixed by convention to keep
multiple-comparisons risk low. The sweep set and its grids:

| `SWEEP_PARAMS` | Default | `SWEEP_PARAM_RANGES` |
|---|---|---|
| `swing_m` | 3 | 2–6 |
| `breach_recency_N` | 5 | 3–8 |
| `consolidation_K` | 20 | 15–40 |
| `channel_tightness_c` | 4.0 | 3–6 |

Label parameters (`label_horizon`, `label_profit_atr`, `label_stop_atr`) **define
the problem** — they are fixed by reasoning and never optimized for backtest
return.

### Running the sweep under walk-forward CV

```python
import itertools
from ta_pipeline import PipelineConfig, SWEEP_PARAM_RANGES, build_dataset

for m, n, k, c in itertools.product(*SWEEP_PARAM_RANGES.values()):
    cfg = PipelineConfig(swing_m=m, breach_recency_N=n,
                         consolidation_K=k, channel_tightness_c=c)
    dataset = build_dataset(bars, cfg)            # leakage-controlled matrix

    # Walk-forward: sort by date, train on an expanding past window, validate
    # on the *next* time block only — never shuffle, never train on the future.
    # Score with PR-AUC (classes are imbalanced). Reserve a final untouched
    # out-of-sample period and look at it exactly once.
```

Because the four swept parameters are noise-tolerant, the first run should
sweep only these and leave the convention-grounded parameters fixed.

## Model — TA-only baseline

`model/` trains the TA-only baseline classifier on the feature matrix — the
ablation the project is measured against (per the brief: if the combined
TA + flow model can't beat this, the TA layer is dead weight).

```bash
python -m ta_pipeline.model.run        # matrix is cached; trains 12 models (~1 min)
```

`materialize_matrix` (build + cache the matrix from the candle store) →
`oof_predictions` (walk-forward LightGBM per side, isotonic-calibrated) →
`build_predictions_table` + `evaluate`. Artifacts land in `data/models/`:

| Artifact | What |
|---|---|
| `predictions.parquet` / `.csv` | per (ticker, date): `p_long` / `p_short`, entry / target / stop, and the **actual outcome** — the spot-check table |
| `evaluation.csv` | PR-AUC, ROC-AUC, Brier, top-decile precision/recall — per side, CV vs OOS |
| `ta_only_{long,short}.joblib` | the OOS-fold models, trained on all development data |

**Validation discipline** — walk-forward only: expanding-window CV folds plus a
final 12-month out-of-sample slice, with a 10-day embargo between train and
test so a training row's forward label never leaks into its test block. The
OOS PR-AUC is the headline benchmark.

The predictions table answers "would this have been a good long / short
entry": sort by `p_long` (or `p_short`) for the day's top candidates; every row
carries what actually happened (`label_*_barrier` = profit / stop / timeout,
the realized return, days-to-outcome), so predictions are directly
spot-checkable. Two binary models — long and short are independent.

## Running the tests

```bash
cd ta_pipeline && pytest           # 20 tests, ~0.5s, all synthetic data
```

## Roadmap

| Phase | Scope |
|---|---|
| 1 ✅ | Scaffold, config, Polygon data loader |
| 2 ✅ | Indicator layer + swing detection (m=3, m=5) |
| 3 ✅ | Features §4.1–4.3 (RSI/momentum, Bollinger, ATR/volatility) |
| 4 ✅ | Features §4.4–4.5 (MA trend structure, zones/touch) |
| 5 ✅ | Features §4.6–4.7 (false-breakdown reclaim, consolidation breakout) |
| 6 ✅ | ATR-scaled triple-barrier labeler + warmup masking |
| 7 ✅ | Leakage unit tests + full README |

### Deferred / downstream (separate modules)

- Multi-timeframe (hourly / weekly) candles — the pipeline is daily-only for now.
- The join with flow / dark-pool features (on `ticker` + `date`).
- The TA-only baseline classifier is built (`model/`); the flow-only and
  combined ablations, and the `lambdarank` ranking variant, remain.
