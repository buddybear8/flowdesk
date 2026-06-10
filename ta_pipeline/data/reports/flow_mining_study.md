# Flow-characteristic mining study — 2026-06-10

**Question:** does a brute-force permutation search over options-flow
characteristics turn up a tradeable rule that survives an untouched holdout?
**Short answer: no.** The search is a textbook multiplicity machine, the
mining t-stats collapse on holdout, and the one feature that "replicates"
(`sent_cp_ratio`) is the exact between-ticker regime confound the event study
already named and killed. Treat everything below as exploratory and unowned.

Reproduce / inspect: `ta_pipeline/data/reports/flow_mining_results.csv`
(full 150-candidate table, mine_* vs hold_* side by side, survivor flag).
Cross-reference: `ta_pipeline/data/reports/flow_event_study.md`.

---

## 1. What was searched

Six families were permuted on the **MINE split only** (holdout untouched
except for a means-only de-mean in `tkr_demeaned`). Value is thesis-signed
PnL (orders) or `direction*fwd_h` (tickers), scored with a date-clustered
Fama-MacBeth mean/t (the unit of evidence is the date, ~14–18, not the
~6k clustered rows). Gates: MIN_ROWS=150, MIN_DATES=8.

| family | grain | rules tried | best mine_t | best query (abbrev) |
|---|---|---|---|---|
| ord_exec_dte_otm | orders | 2,250 | 3.54 | SINGLE CALL, dte>30, ITM [-0.05,0), h=3 |
| ord_conviction | orders | 1,495 | 4.01 | log_premium>6 & ask_frac<0.4 & PUT, h=10 |
| ord_flags | orders | 1,944 | −4.00 | BEARISH+MED+single-leg+BUY, h=10 (inverse) |
| ord_sector | orders | 2,160 | 3.54 | Energy CALL, log_premium>5, h=3 |
| tkr_feature_cuts | tickers | 350 | 11.65 | sent_cp_ratio ≥ 7.18, h=10 |
| tkr_demeaned | tickers | 2,040 | 11.08 | sent_cp_ratio_dm ≥ 4.36, h=10 |
| **TOTAL** | | **10,239** | | top-25 by \|t\| per family → **150 pooled candidates** |

The two ticker families produce the eye-popping t-stats (11+); the four
order families top out around \|t\|≈4. That gap is itself a tell — see §5.

## 2. The mine→holdout SHRINKAGE (headline honesty number)

This is the number to internalize. Mining t-stats do not partially fade on
holdout — for the order families they **evaporate**, and for the ticker
families they **halve at best**.

- **150 candidates mined; 131 had enough holdout rows/dates to even score;
  53 reached \|hold_t\|≥2; 7 cleared the full survivor bar.**
- **Order families (ord_exec_dte_otm, ord_conviction, ord_flags, ord_sector):
  mining \|t\| of 3.5–4.0 → holdout \|t\| of ~0.0–1.4 in nearly every row.**
  Many of the strongest (all h=10 conviction/flags rules) could not even be
  scored on holdout (fewer than 5 dates / 150 rows survive the horizon).
  Example: the ord_exec_dte_otm flagship (SINGLE CALL dte>30 ITM, h=3)
  goes **mine_t=+3.54, mean +0.61% → hold_t=−0.49, mean −0.13%** — sign flip.
- **Ticker families: mine_t≈11 (h=10) → unscorable on holdout** (holdout
  h=10 leaves too few dates). The cuts that *do* score are the shorter
  horizons, where mine_t≈6–8 → **hold_t≈3–4.5**. Roughly a 2× shrinkage,
  and only at h=3/h=5.

Plain version: a t-stat from a 10,000-rule search carries almost no
information. The honest collapse ratio is ~3–4 → ~0 (orders) and ~7 → ~3–4
(tickers, best case). Anyone quoting the mining t-stats is quoting noise.

## 3. Survivor list (mine vs holdout, side by side)

Bar: holdout mean SAME SIGN as mining mean AND \|hold_t\|≥2.0 AND
hold_n_rows≥150. **7 of 150 pass.** They collapse to **three distinct
signals** (two are direction +1/−1 mirrors of one query):

| family | query | h | dir | mine_mean | mine_t | hold_mean | hold_t | hold_n |
|---|---|---|---|---|---|---|---|---|
| tkr_feature_cuts | sent_cp_ratio ≥ 5.61 | 5 | +1 | +0.0796 | 7.57 | +0.0557 | **4.28** | 186 |
| tkr_feature_cuts | sent_cp_ratio ≥ 5.61 | 3 | +1 | +0.0500 | 6.04 | +0.0426 | **4.48** | 186 |
| tkr_feature_cuts | sent_cp_ratio ≥ 4.16 | 5 | +1 | +0.0719 | 6.82 | +0.0447 | **3.40** | 278 |
| tkr_demeaned | sent_cp_ratio_dm ≥ 1.69 | 5 | +1 | +0.0777 | 7.83 | +0.0404 | **3.16** | 167 |
| tkr_demeaned | sent_cp_ratio_dm ≥ 1.69 | 5 | −1 | −0.0777 | −7.83 | −0.0404 | **−3.16** | 167 |
| ord_sector | Cons.Disc. PUT, dte>7, vol_oi>3 | 3 | +1 | −0.0147 | −3.52 | −0.0105 | **−3.77** | 189 |
| ord_sector | Cons.Disc. PUT, dte>7, vol_oi>3 | 2 | +1 | −0.0117 | −2.99 | −0.0089 | **−2.65** | 189 |

Distinct signals: (A) high `sent_cp_ratio` cut → long, h=3/5; (B) its
demeaned mirror pair; (C) Consumer-Discretionary PUT + vol_oi cut → negative
PnL, h=2/3. Note A and B are the **same underlying feature** (raw vs
per-ticker de-meaned call/put-ratio sentiment).

## 4. Multiplicity: survivors vs expected-by-chance — did we beat noise?

**No, not on count.** At the per-rule two-sided rate ~0.046, the full search
of 10,239 rules expects **~471 spurious \|t\|≥2 hits by pure chance.** We got
**7** survivors at the (stricter) full-bar. **7 ≪ 471.** Survivor *count* is
not just unimpressive — it is far below the chance floor, so the count alone
is evidence of *nothing*.

What is mildly more than noise is **concentration**: the survivors are not
scattered randomly. They pile onto one feature (`sent_cp_ratio` /
`_dm`) that replicates across two families and two horizons (3 and 5) with
consistent sign, plus one order-grain rule that replicates across two
adjacent horizons. Chance would smear hits across families/horizons; this
clustering is the only thing that rises above the multiplicity floor — and
even that is weak, since the horizons/families are correlated re-tests of the
same data.

## 5. Did anything survive holdout AND avoid the known confound?

**No — and this is the decisive finding.** The strongest, most-replicated
survivor (`sent_cp_ratio`) is the **exact confound the event study already
identified and discarded** (`flow_event_study.md`, §3):

- The event study sorted tickers by mean 10-day forward return into quintiles
  and found mean `cp_ratio` ran **2.8 (worst) → 30.8 (best)**: cp_ratio is a
  proxy for "hot high-call-volume momentum name," and those names happened to
  rally in this single May–June 2026 window. That is **regime/selection, not
  flow predicting moves.**
- Its power is **almost entirely between-ticker** (+0.71 between vs +0.18
  within). A persistent ticker trait, not day-to-day timing.
- The `tkr_demeaned` family was built specifically to strip this out
  (per-ticker de-meaning). It is telling that `sent_cp_ratio_dm` *still*
  survives — but only at h=5, with hold_t falling to ~3.2 (vs ~4.5 raw), and
  it remains a within-regime cut on the most heavy-tailed feature in the set
  (max ~5883). A single 17-date regime cannot tell a de-meaned momentum tail
  from a timing edge. **It does not clear the confound; it is weakened by it.**
- The Consumer-Discretionary PUT survivor is a thin single-sector, single-type
  rule (n_rows≈189, 8 dates) — a plausible single-regime/single-sector
  artifact, not a general characteristic. Not ownable on this corpus.

So: **zero candidates survive holdout AND escape the regime/selection
confound.** Everything that replicates does so *because* of the confound, not
in spite of it.

## 6. Verdict — what to act on

**There is no tradeable flow characteristic here.** Do not promote any rule
from this study to a standalone prior, a model feature with assumed sign, or
a live signal. Concretely:

- The mining t-stats (up to 11) are search artifacts; the honest holdout
  picture is ~0 for all order families and a confound-driven 3–4 for the
  ticker families.
- The 7 survivors are below the ~471 chance floor and collapse to one
  feature (`sent_cp_ratio`) that the event study already proved is a
  between-ticker momentum/regime proxy from a single May–June 2026 window.
- The plumbing is correct (leakage-safe joins, date-clustered scoring, a
  truly untouched holdout, honest multiplicity accounting, no cherry-picking
  — full top-25 emitted). The data, not the method, is the limit.

**What would change the answer: corpus DEPTH across REGIMES, not width.**
The study spans ~17–27 dates in ONE regime; that cannot separate "flow times
the move" from "high-cp_ratio names rallied this month." The unlock is
multiple distinct market regimes (multi-month/multi-quarter, ideally a
reserved OOS year spent once) AND within-ticker scoring as the default. If
`sent_cp_ratio_dm` still earns a positive, same-sign, \|t\|≥2 holdout at
h=3–5 across two or more independent regimes — *then* re-open the question.
Until then: negative, as expected at 5.5 weeks. Re-run monthly as the corpus
grows.
