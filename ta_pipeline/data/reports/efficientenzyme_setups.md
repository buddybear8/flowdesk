# efficientenzyme — Setup Taxonomy (vision-extraction synthesis)

Source: 15 shards, `ta_pipeline/data/reports/vision_extractions/shard_00..14.jsonl`
(599 lines; `is_chart=false` rows dropped). Generated 2026-06-10.

---

## 1. Corpus

- **Charts analyzed:** 593 valid price charts (6 non-charts excluded: P&L/leaderboard
  screenshots, Discord text/alert dumps, a meme, a tweet screenshot).
- **Date span:** 2024-09-17 → 2026-04-14 (~19 months, continuous).
- **Ticker mix:** ES (S&P 500 E-mini) 580; SPX 5; BTC 3; OXY 2; BTC/DXY 1; BTC/ES 1; AMD 1.
  Effectively a **single-instrument (ES/SPX index) author**; a handful of off-index one-offs.
- **Timeframe mix:** 1h 199, 15m 182, 4h 64, 5m 63, 10m 17, "intraday" 16, 1m 10,
  1D 6, plus a few 6h/12h/2h/3m/30m/1W/1M. **Intraday-dominant (15m + 1h ≈ 64%)**; daily/weekly rare.
- **Direction skew:** bullish 400 / neutral 102 / bearish 91 (dip-buy / recovery bias).
- **Projection present (`has_projection`):** 444 of 593 (75%) — hand-drawn forward price path
  is his signature, not an afterthought.
- **Self-labeled novelty:** 585 "tested" / 8 "novel".

---

## 2. SETUP TAXONOMY (ranked by # of charts the family appears on)

Families collapsed from 543 raw free-text setup strings. A chart usually stacks 3–5 families,
so counts sum > 593. Tag = relation to already-tested family set
(flag, S/R flip, false-break/sweep/reclaim, wedge/triangle, squeeze, divergence, gaps, MA-zone).

| # | Family | Charts | Share | Tag | Notes |
|---|--------|-------:|------:|-----|-------|
| 1 | Trendline / channel (break · bounce · support) | 364 | 61% | **tested** | trendline break + channel; core "T1/T2/T3" tiers |
| 2 | Projected price PATH (zigzag / V / W / M measured-move) | 299 | 50% | **mixed** | the drawing habit is signature; mechanics = double-bottom/measured-move (tested), but the *codifiable* swing-projection geometry is the most distinctive thing |
| 3 | Horizontal level ladder / target callout boxes | 283 | 48% | **tested** | stacked rounded-price target boxes; = S/R level mapping |
| 4 | Fibonacci confluence (retracement + extension) | 251 | 42% | **tested** | his real signature overlay; recurring 0.382/0.5/0.618/0.786 & 1.618/2.618/3.618 |
| 5 | S/R flip & reclaim / retest | 183 | 31% | **tested** | "reclaim" framing everywhere; = S/R flip |
| 6 | Supply / demand zone reject / bounce | 62 | 10% | **tested** | orange/cyan zone boxes; = S/R zone |
| 7 | Range / consolidation / ORB | 42 | 7% | **tested** | range reject/reclaim |
| 8 | Plain breakout / momentum thrust | 32 | 5% | **tested** | plain breakout |
| 9 | ATH / "pATH" retest-breakout | 28 | 5% | **tested** | prior-ATH overhead reference (label on 141 charts) |
| 10 | Breakdown / gap | 27 | 5% | **tested** | incl. one breakaway→continuation→exhaustion gap-phase label |
| 11 | Wedge / triangle / compression | 23 | 4% | **tested** | wedge/triangle |
| 12 | False-break / liquidity-sweep + reclaim | 22* | 4%* | **tested** | *under-counts: "sweep/false-break/reclaim/tarp" language hits 209 charts when annotation text is scanned; it is his dominant verbal thesis ("ITS A TARP") even if rarely the top setup tag* |
| 13 | MA / EMA-zone trend | 14 | 2% | **tested** | EMA cloud/ribbon appears as overlay on far more (54) |
| 14 | Conditional dual-scenario playbook ("which way") | 3–11 | — | **mixed→novel** | verbal decision-tree, not a single bias |
| 15 | Elliott / impulse wave count (numbered 1-2-3-4) | 4 | <1% | **novel** | macro impulse projections to far targets (7150 / 9367) |
| 16 | "bing / bong" two-pivot reclaim-retest (personal jargon) | 3 | <1% | **novel** | idiosyncratic label = sweep/reclaim mechanically |
| 17 | RSI / momentum divergence | 2 | <1% | **tested** | rare; only 14 charts even show RSI |

**Bottom line:** ~99% of his book is composites of already-tested families
(trendline + fib + horizontal levels + S/R-reclaim + measured-move projection).
Genuinely novel-leaning material = the **8 novel records**: Elliott/impulse wave counts (4),
bing/bong reclaim pivots (3 charts / 1 idea), and explicit conditional dual-scenario playbooks (~11).

---

## 3. INDICATOR / METHOD profile (overlay reliance, % of 593 charts)

| Overlay | Charts | Share |
|---------|-------:|------:|
| Horizontal levels | 591 | **99.7%** |
| Trendlines | 539 | **91%** |
| Moving averages (single MA/EMA line) | 374 | **63%** |
| Fibonacci retracement/extension | 350 | **59%** |
| EMA cloud / ribbon | 54 | 9% |
| RSI (sub-panel) | 14 | 2% |
| Volume profile | 4 | <1% |
| VWAP | 0 | **0%** |

Profile = **price-geometry trader**: horizontal levels + trendlines + fib + one MA on
essentially every chart. **No VWAP, almost no volume profile, almost no oscillators.**
Forward price-path projection (zigzag/V/W/M) drawn on 75% of charts. Recurring personal
motifs: "pATH" (prior-ATH overhead line, 141 charts), "reclaim"/"TARP"
(sweep-then-reclaim, 209 charts by text), labeled rounded-price target boxes, orange
direction/zone arrows, "T1/T2/T3" trendline tiers.

---

## 4. MATERIALLY-DIFFERENT, CODIFIABLE shortlist (buildable on daily + hourly OHLCV)

These are the items that are (a) the most distinctive vs the tested set AND (b) expressible
as numeric detectors on our 10y daily / 3y hourly OHLCV (228 names + index proxies). Note all
are *index/ES discretionary in origin*, so detectors generalize the geometry, not his ticker.

### D1 — Liquidity-sweep + reclaim (false-breakdown long)  [his #1 verbal thesis]
- **Direction:** long (mirror for short).
- **Timeframe:** hourly entry; daily for swing-level context.
- **Math:** Let `L = min(low)` over prior `N` bars (N=20 hourly / 10 daily). Trigger when a bar
  prints `low < L − k*ATR14` (sweep below, k≈0.05–0.25) **then** within `M` bars (M≤5) closes
  back `> L` (reclaim). Entry on the reclaim close; invalidation = new close below the sweep low;
  target = next horizontal level / prior swing high. Symmetric for sweep-of-highs short.
- **Why novel-ish:** not plain S/R retest — requires the *overshoot-then-recover* sequence
  (wick beyond extreme + same/next-bar reclaim), his "ITS A TARP."

### D2 — Measured-move / V-W swing projection (zigzag continuation)
- **Direction:** continuation of pre-swing trend (mostly long).
- **Timeframe:** hourly; confirm on daily.
- **Math:** Detect swing pivots via fractal/ZigZag (`pct≥1.5%` or ATR-scaled). On a
  bullish leg A→B, pullback B→C holding `0.382–0.618 × (B−A)` fib retrace, then break of B.
  Detector fires at the break-of-B bar; **projected target = C + (B−A)** (1.0 measured move)
  with secondary 1.618 extension. V = single pullback; W = double-bottom variant where two
  C-lows are within `j*ATR` of each other before the B break.
- **Why codifiable:** pure pivot geometry + fib ratios on OHLCV; this is his most-drawn shape.

### D3 — Fib-confluence reclaim cluster
- **Direction:** long bias (dip-buy).
- **Timeframe:** hourly + daily.
- **Math:** From last major daily swing (high H, low Lo), compute 0.382/0.5/0.618/0.786.
  Flag a setup when price (a) sits within `±0.15*ATR` of a fib **and** (b) that fib is within
  `±0.25*ATR` of a horizontal pivot (prior swing) — i.e. *confluence of fib + structural level*.
  Entry trigger = bullish reclaim bar (close back above the cluster after tagging it).
- **Why codifiable:** confluence = co-location test of two numeric series; his signature stack.

### D4 (stretch) — Impulse / wave-count projection
- **Direction:** trend-continuation, larger horizon.
- **Timeframe:** daily (4h in his charts).
- **Math:** Approximate Elliott as alternating ZigZag legs where wave-2 retrace `<1.0×` wave-1
  and wave-3 length `≥1.0×` wave-1; project wave-5 target as `wave1_len × {1.0,1.618}` from
  wave-4 low. Treat as a *labeling/feature* detector, not a high-precision pattern.
- **Caveat:** Elliott is famously subjective; build as a loose feature flag, expect noisy labels.

> Recommended first build order: **D1 then D2** (highest frequency, cleanest rules, least
> subjectivity). D3 adds confluence filtering. D4 only if wave features earn their keep.

---

## 5. NOT codifiable on current data / needs extra inputs

| Item | Missing data / why |
|------|--------------------|
| "Low-confidence zone" / discretionary conviction tags | Subjective; no numeric proxy. |
| Conditional dual-scenario "which way" playbooks | A branch tree, not a single trigger; needs both legs + a decider event (often news). |
| Supply/demand & "pATH" zones drawn from order-flow intuition | He places them discretionarily; OHLCV can approximate via swing pivots only (lossy). |
| Liquidity-sweep *quality* (real stop-run vs noise) | Needs **footprint / order-flow / volume-at-price** — we have OHLCV only. Volume profile in <1% of his charts but underlies his "TARP" logic. |
| Anything VIX / internals / breadth driven | We have **no VIX, no TICK/ADD/internals, no options data**; several FOMC/event-timed plans hinge on macro context. |
| Intraday ORB / session-open plays | Need clean session-aligned intraday bars + RTH/ETH session map; partially doable on hourly but coarse. |
| Precise fib anchors he chose | He hand-picks swing anchors; our auto-pivot anchors will differ → label/feature drift. |

---

## 6. Honest caveats

- **Vision-extraction noise:** setups/levels are model-read from images; 543 distinct free-text
  setup strings show labeling inconsistency. Level numbers off mobile/watermarked screenshots are
  best-effort; family bucketing here is heuristic (regex over strings + annotation text).
- **Heavy discretion:** 75% of charts are *forward projections* — intent, not executed trades.
  Anchors, zones, and "which way" branches are chosen by feel; detectors approximate the geometry,
  not his judgment. Sweep/reclaim is far more central in his *text* (209 charts) than in the
  top-setup tags (22), so frequency tables understate his true thesis.
- **Single-author, single-instrument, single-regime-window:** ~98% ES/SPX index, Sep-2024→Apr-2026,
  bullish-skewed (400/91). Patterns are tuned to an index that mostly went up; survivorship and
  regime bias are severe. Generalizing to 228 single names is an untested leap.
- **Codification ≠ edge:** D1–D4 are candidate *detectors*, not validated signals. Each must clear
  the full leakage-controlled gauntlet (purged/embargoed CV, multi-regime out-of-sample,
  transaction costs, multiple-testing correction) before any claim of predictive value. Expect
  most of his "edge" to be discretionary execution/risk management that no OHLCV detector captures.
