# Pattern Exploration Study — Synthesis

Date: 2026-06-10
Scope: 6 pattern families (flag_pennant, sr_flip, false_break, wedge_triangle, squeeze_expansion, divergence_gap), 22 detectors, 44 detector-side cells, evaluated with identical mechanics (cached 226-ticker feature matrix, `make_folds` CV development windows only, ATR triple-barrier labels, reserved OOS from 2025-05-20 never read). Benchmark: pre-existing breakout/reclaim/zones event sets measured lift 0.96–1.02 (chance) — `data/models/evaluation_ta_events.csv`.

Per-family detail: `pattern_flag_pennant.json`, `pattern_sr_flip.json`, `pattern_false_break.json`, `pattern_wedge_triangle.json`, `pattern_squeeze_expansion.json`, `pattern_divergence_gap.json` (this directory).

Every headline cell submitted to red-team audit reproduced exactly, and **no lookahead/leakage was found anywhere** (truncation-invariance verified independently on real data for every audited detector and every weekly HTF state; prior-completed-week semantics confirmed). The failures below are statistical, not mechanical.

---

## 1. Ranked table — all 44 detector-side cells

Sorted by unconditional lift. `htf_lift` = lift of the weekly-trend-aligned subset vs the unconditional base rate (per-family JSONs also report lift vs the HTF-conditional base, which is the fairer comparison and is generally lower). Fold range = min–max per-fold lift over the 5 CV folds.

| # | Family | Detector | Side | n | Lift | Fold range | HTF n | HTF lift | Red-team |
|---|--------|----------|------|-----|------|-----------|-------|----------|----------|
| 1 | wedge_triangle | p2_strict | short | 39 | 1.326 | 1.06–1.77 | 9 | 1.437 | not audited (underpowered) |
| 2 | flag_pennant | strict | long | 161 | 1.247 | 0.94–1.57 | 89 | 1.140 | REFUTED (2/2, med) |
| 3 | squeeze_expansion | deep_squeeze | long | 282 | 1.120 | 0.84–1.39 | 142 | 1.104 | REFUTED (2/2, high) |
| 4 | divergence_gap | gap_go_1.5 | short | 1197 | 1.107 | 0.85–1.50 | 313 | 1.181 | REFUTED (2/2, high) |
| 5 | wedge_triangle | p3_loose | long | 1373 | 1.106 | 0.99–1.21 | 251 | 1.123 | SPLIT (1 not-refuted/1 refuted, med) |
| 6 | wedge_triangle | p3_loose | short | 1488 | 1.105 | 0.96–1.19 | 224 | 1.201 | REFUTED (2/2, med) |
| 7 | squeeze_expansion | nr7_squeeze | short | 791 | 1.094 | 0.93–1.51 | 212 | 1.150 | REFUTED (2/2, high) |
| 8 | squeeze_expansion | deep_squeeze | short | 249 | 1.093 | 0.99–1.26 | 57 | 1.306 | REFUTED (2/2, high) |
| 9 | squeeze_expansion | nr7_squeeze | long | 880 | 1.089 | 0.96–1.31 | 386 | 1.048 | REFUTED (2/2, high) |
| 10 | flag_pennant | strict | short | 171 | 1.089 | 0.85–1.33 | 80 | 0.873 | REFUTED (2/2, high) |
| 11 | wedge_triangle | p1_base | long | 307 | 1.087 | 0.89–1.24 | 69 | 1.013 | REFUTED (2/2, high) |
| 12 | divergence_gap | gap_go_1.5 | long | 1073 | 1.080 | 0.89–1.25 | 446 | 1.090 | REFUTED (2/2, high) |
| 13 | flag_pennant | momentum_decile | short | 1397 | 1.079 | 1.02–1.29 | 519 | 0.976 | REFUTED (2/2, high) |
| 14 | divergence_gap | gap_go_1.0 | long | 2817 | 1.078 | 0.90–1.26 | 991 | 1.032 | REFUTED (2/2, high) |
| 15 | wedge_triangle | p1_base | short | 354 | 1.074 | 0.84–1.30 | 53 | 1.025 | REFUTED (2/2, high) |
| 16 | squeeze_expansion | bb_squeeze | short | 1189 | 1.073 | 0.98–1.16 | 323 | 1.129 | REFUTED (2/2, high) |
| 17 | squeeze_expansion | bb_squeeze | long | 1349 | 1.073 | 0.92–1.28 | 680 | 1.062 | REFUTED (2/2, high) |
| 18 | divergence_gap | gap_fade_1.5 | short | 1050 | 1.064 | 0.96–1.31 | 274 | 1.171 | REFUTED (2/2, high) |
| 19 | flag_pennant | base | short | 735 | 1.062 | 0.98–1.25 | 312 | 0.961 | REFUTED (2/2, high) |
| 20 | divergence_gap | gap_go_1.0 | short | 3074 | 1.059 | 0.86–1.36 | 794 | 1.200 | REFUTED (2/2, high) |
| 21 | divergence_gap | gap_fade_1.0 | short | 2808 | 1.056 | 0.93–1.21 | 713 | 1.145 | REFUTED (2/2, high) |
| 22 | sr_flip | loose | short | 19416 | 1.032 | 0.99–1.07 | 6116 | 1.034 | not audited (chance) |
| 23 | flag_pennant | momentum_decile | long | 1333 | 1.032 | 0.95–1.17 | 533 | 0.965 | not audited (chance) |
| 24 | divergence_gap | rsi_div_m5 | short | 2484 | 1.025 | 0.93–1.12 | 124 | 1.263 | not audited (chance uncond.) |
| 25 | sr_flip | strict | long | 5659 | 1.021 | 0.97–1.08 | 2221 | 0.998 | not audited (chance) |
| 26 | divergence_gap | rsi_div_m5 | long | 2107 | 1.019 | 0.95–1.10 | 87 | 1.097 | not audited (chance) |
| 27 | divergence_gap | rsi_div_m3 | short | 3580 | 1.017 | 0.87–1.08 | 191 | 1.250 | REFUTED (2/2, med/high) |
| 28 | divergence_gap | rsi_div_m3 | long | 2882 | 1.017 | 0.99–1.06 | 199 | 1.119 | REFUTED (2/2, high) |
| 29 | sr_flip | base | long | 10350 | 1.016 | 0.95–1.06 | 4227 | 0.986 | not audited (chance) |
| 30 | false_break | k20_2bar | long | 6269 | 1.008 | 0.93–1.08 | 657 | 0.944 | not audited (chance) |
| 31 | divergence_gap | rsi_div_m3_ext | short | 2877 | 1.007 | 0.86–1.09 | 21 | 1.100 | not audited (chance) |
| 32 | divergence_gap | rsi_div_m3_ext | long | 2211 | 1.006 | 0.90–1.11 | 14 | 1.298 | not audited (chance; HTF n=14) |
| 33 | sr_flip | loose | long | 19906 | 1.004 | 0.96–1.06 | 6230 | 0.979 | not audited (chance) |
| 34 | divergence_gap | gap_fade_1.5 | long | 1055 | 1.003 | 0.75–1.18 | 415 | 0.832 | not audited (chance/negative) |
| 35 | false_break | k20_2bar | short | 7449 | 0.994 | 0.95–1.07 | 544 | 1.046 | not audited (chance) |
| 36 | sr_flip | base | short | 10352 | 0.988 | 0.90–1.03 | 4309 | 0.987 | not audited (chance) |
| 37 | false_break | k55_1bar | short | 5663 | 0.985 | 0.91–1.08 | 65 | 1.074 | not audited (chance; HTF n=65) |
| 38 | flag_pennant | base | long | 798 | 0.984 | 0.88–1.09 | 370 | 0.933 | not audited (chance) |
| 39 | sr_flip | strict | short | 5575 | 0.983 | 0.86–1.07 | 2333 | 0.965 | not audited (chance) |
| 40 | false_break | k55_1bar | long | 3591 | 0.978 | 0.84–1.07 | 113 | 1.078 | not audited (chance; HTF n=113) |
| 41 | false_break | k20_1bar | long | 6651 | 0.974 | 0.88–1.06 | 1316 | 0.931 | not audited (below chance) |
| 42 | divergence_gap | gap_fade_1.0 | long | 2895 | 0.974 | 0.76–1.20 | 1104 | 0.949 | not audited (below chance) |
| 43 | false_break | k20_1bar | short | 8657 | 0.971 | 0.91–1.03 | 933 | 0.967 | not audited (below chance) |
| 44 | wedge_triangle | p2_strict | long | 32 | 0.916 | 0.88–0.90 | 5 | 0.451 | not audited (underpowered) |

Base rates: ~0.443–0.440 (long) and ~0.387–0.390 (short); they differ slightly across families because dev-window starts differ (see caveats §5).

---

## 2. Red-team survival

22 of the 44 cells (every cell with a notable headline lift) were independently audited, most by two adversarial auditors each. Results:

- **0 cells cleanly survived.** 21 of 22 audited cells were refuted by both auditors; 1 cell — **wedge_triangle p3_loose long** — received a split verdict (one not-refuted at medium confidence, one refuted at medium confidence).
- **What did NOT fail anywhere:** lookahead/leakage (zero mismatches across hundreds of truncated-history reruns spanning all six families), number reproduction (every audited headline replicated exactly), and weekly-HTF prior-completed-week semantics. The pipelines are honest.
- **The four recurring kill modes:**
  1. **Multiplicity.** ~44 detector-side cells (~88+ with HTF conditioning, ~182–374 lift-bearing numbers in the JSONs) were searched. Best naive p-values (~0.003) die under Bonferroni over the search surface. "Pre-registration" of presets is asserted in docstrings only — `ta_pipeline/patterns/` is untracked in git, so it is unverifiable.
  2. **Cross-sectional clustering.** Events co-fire on market-wide days (gap days up to 30–64 events/day) with overlapping 10-day label windows. Date-clustered z-stats collapsed naive z=2.4–3.7 to z≈1.0–2.9; almost nothing stayed nominally significant, let alone corrected.
  3. **Regime/month concentration.** For most cells the top 2–5 calendar months (Dec-2018, Dec-2019, Feb/Mar-2020, Aug/Nov/Dec-2022, Nov-2023, Apr-2024, Apr-2025) carried 50–100%+ of the total excess hits; month-base-rate matching erased ~65–80% of the measured lift. Several short cells were additionally driven by inverse/levered/vol ETFs (SOXS, SPXS, VXX, UVXY, SQQQ, EPV, FXI).
  4. **Recency decay.** Per-year lifts were flat-to-negative in 2024–2025 for most refuted cells (e.g. flag base short cv5=0.98, nr7 short 2024=0.90, gap_fade 2025=0.65–0.73).
- **The split-verdict cell (wedge p3_loose long, n=1373, lift 1.106):** both auditors agreed it is leak-free, broad (211 tickers), fold-stable (worst fold 0.993), positive in 7/9 years, and survives month-base adjustment better than any other cell (~85% of edge retained); date-clustered z=2.94 (p~0.002–0.0035) survives within-family correction but not suite-wide Bonferroni (x44 → ~0.15). The refuting auditor also noted top-20 tickers carry 74% of excess and the HTF sub-claim fails per-fold. Its short twin (1.105) showed the same shape but with 50% of excess in 3 months → both auditors refuted it (medium).

---

## 3. The HTF-conditioning hypothesis: contradicted

Hypothesis under test: daily pattern events aligned with the weekly trend (W-FRI close > SMA10 > SMA20 stack for longs, inverse for shorts, prior completed week only) should show higher lift.

**Long side: clearly contradicted.** HTF alignment LOWERED lift relative to unconditional in 17 of 22 long cells, including every flag_pennant, sr_flip, false_break(high-n), bb/nr7 squeeze, and gap_go_1.0 long cell. The few increases are either tiny-n noise (k55 n=113/65, rsi_div_m3_ext n=14) or marginal (gap_go_1.5 +0.01, wedge p3 +0.017). In squeeze_expansion, on HTF-disagreement bars, following the expansion direction beat following the weekly trend in 5/6 comparisons.

**Short side: superficially supported, but it is a base-rate artifact.** HTF alignment raised the headline number in ~13 of 22 short cells (squeeze shorts 1.13–1.31, gap shorts 1.14–1.20, divergence shorts 1.10–1.26, wedge p3 short 1.20) — but these `htf_lift` figures are computed against the UNCONDITIONAL base rate. Weekly-downtrend periods have elevated short base rates; red-team month-matching and HTF-conditional-base comparisons removed most of the effect (e.g. bb_squeeze short: +2.84pp excess → +0.65pp after month matching; wedge p1 short HTF: 1.025 → 1.013 vs conditional base ≈ 0.27 excess hits). Meanwhile flag_pennant — the one family whose thesis (continuation) most demands trend alignment — saw HTF conditioning INVERT the edge in all its short cells (0.87–0.98).

**Verdict: do not use weekly-trend alignment as a confluence filter.** Across 44 cells it added no reproducible per-event information; apparent short-side gains are regime composition. If anything, the data weakly suggest these daily patterns behave as early-trend/counter-trend events rather than HTF-continuation events.

---

## 4. Shortlist for the pattern-x-flow confluence stage

**No detector earned a standalone-edge designation. The honest shortlist of confirmed edges is empty.**

Conditional carry-forwards (as PRIORS for the confluence stage only — each must show *incremental* lift over its pattern-only baseline, scored with date-clustered errors and month-base-rate adjustment, before being believed):

1. **wedge_triangle p3_loose, long and short** (sole split red-team verdict; broadest, most fold-stable cells in the study; long survives month adjustment ~85%; use unconditional events, ignore the HTF flag). Primary candidate.
2. **flag_pennant strict, long only** (n=161, lift 1.247; ticker-broad and leak-free but refuted on multiplicity + Nov-2023 concentration + 2024 decay). Carry only as a low-weight prior; the confluence test must use post-2023 data heavily.
3. **squeeze_expansion** (bb/nr7/deep): the only family where all 6 cells were positive in sign (1.07–1.12), but every cell refuted on regime concentration. If the flow stage wants a volatility-state interaction term, source it here rather than treating squeeze events as signals.

Explicitly dropped: sr_flip (clean chance, all variants), false_break (clean negative, 0.97–1.01), rsi_divergence (chance unconditionally; HTF short subsets are regime artifacts), all gap detectors (lift = 2–3 crash/panic months plus inverse-ETF composition; date-clustered z ≈ 1.0), flag_pennant base/momentum_decile, wedge p1_base/p2_strict.

Recommended gates for anything promoted out of the confluence stage: date-clustered z ≥ 3 on the incremental (pattern×flow vs flow-only) lift, month-base-adjusted lift retained ≥ 70%, positive per-year lift in ≥ 7/9 years including 2024–2025, top-3-month excess share < 40%, top-10-ticker excess share < 40%, and pre-registration committed to git before the labels are read.

---

## 5. Methodology caveats

1. **Multiplicity is unmanaged at the suite level.** ~44 primary cells, ~88+ with HTF slices, across 6 families run by parallel agents. Per-family "pre-registration" does not protect the cross-family selection, and no git history exists to prove presets predate evaluation (the `patterns/` tree is untracked).
2. **Naive binomial stats overstate evidence.** Events cluster cross-sectionally on market-wide days and the 10-day triple-barrier labels overlap, so effective n << nominal n. Per-family reports use naive SEs; only the red-team applied date/month-clustered inference. Future evals must cluster by date as standard.
3. **Lift ≠ P&L.** Median per-event outcome returns are ~0 to negative in nearly every cell (even lift-1.1+ ones) because of the asymmetric +1.5/−1.0 ATR barriers and timeout dominance. Hit-rate lift is a screening statistic, not tradability.
4. **`htf_lift` is computed against the unconditional base rate in headline tables** — it conflates regime composition with conditional edge. The per-family JSONs carry lift-vs-HTF-base; use that exclusively downstream.
5. **Inconsistent dev windows across families** (base rates 0.4433/0.3867 vs 0.4402/0.3896; window starts 2017-06-13 vs 2018-10-05) — cross-family lift comparisons are approximate.
6. **Universe composition**: the 226-ticker matrix includes leveraged/inverse/vol ETFs whose mechanics (decay, inverse beta) contaminate short-side cells; several refutations traced excess to SOXS/SPXS/VXX/UVXY/SQQQ/EPV/FXI. Consider excluding non-vanilla instruments or reporting ex-ETF lifts.
7. **The reserved OOS window (2025-05-20 → 2026-05-20) remains untouched** by every family and every audit. It is the single uncontaminated resource left; spend it only once, on whatever survives the confluence stage.
8. Sibling-family test interference was observed during parallel development (one sr_flip sparsity test failing in other agents' runs); final suites pass per family, but CI should run the full suite on a merged tree.
