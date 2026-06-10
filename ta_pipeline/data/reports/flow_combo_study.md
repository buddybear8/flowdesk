# Flow-COMBINATION mining study — 2026-06-10

**Question:** does *combining* characteristics — especially order×ticker
**confluence** (an order printing on the same day its ticker's aggregate flow
agrees) — find a tradeable rule the single-characteristic search missed?
**Short answer: no, and it did worse.** Combinations bought a handful of giant
mining t-stats (up to 17) at the cost of making nearly every rule too narrow to
even *test* out of sample. **Zero of 125 candidates survived the holdout** — a
strictly weaker result than the single-char study (which at least found 7
confound-driven "survivors").

Reproduce / inspect: `ta_pipeline/data/reports/flow_combo_results.csv`
(125-candidate table, mine_* vs hold_* side by side, `error` flags `insufficient`).
Cross-reference: `flow_mining_study.md`, `flow_event_study.md`.

---

## 1. What combination space was searched

Five families, all permuted on the **MINE split only** (holdout untouched),
scored with the same date-clustered mean/t (unit of evidence = the date, ~14–19),
gates MIN_ROWS=150 / MIN_DATES=8, horizons 1/2/3/5/10. The combination space is
the cross-product of atoms *within* and *across* grains:

| family | grain | rules tried | best mine_t | what it crosses |
|---|---|---|---|---|
| combo_order_categorical | order | 10,990 | 7.83 | order cat × cat × continuous (greedy + bounded enum) |
| combo_order_conviction | order | 3,054 | −6.08 | order conviction (premium/vol_oi/exec) conjunctions |
| combo_ticker_multi | tkr_demeaned/tickers | 92,520 | **17.28** | ticker sent_* feature × feature (pairs+triples, raw & demeaned) |
| combo_confluence_raw | confluence | 3,684 | 9.36 | **order char × raw ticker sent_* state (same day)** |
| combo_confluence_demeaned | confluence | 4,354 | −9.21 | **order char × within-ticker-DEMEANED ticker state** |
| **TOTAL** | | **114,602** | | top-25 by \|t\| per family → **125 pooled candidates** |

This is an ~11× wider search than the single-char study (114,602 vs 10,239 rules).
The confluence families (rows 4–5) are the novel object: they test whether
an order + its ticker's *aggregate agreement* beats either signal alone.

## 2. The mine→holdout SHRINKAGE — and the testability collapse

The combo headline number is not shrinkage, it is **untestability**. Conjunctions
slice the data so thin that **only 24 of 125 candidates (all confluence-grain)
had enough holdout rows/dates to even be scored.** The other 101 returned
`insufficient`:

- **order grain: 0 / 50 testable.** Every high-mine-t Commodities/conviction
  order combo had <150 holdout rows or <5 holdout dates. *Failure to replicate
  volume out-of-sample is itself the overfit signal.*
- **ticker grains: 0 / 25 testable** (combo_ticker_multi). The mine_t=17.28
  flagship `sent_put_vol_dm<−984 & sent_cp_ratio_dm>0.48 & sent_strike_count_dm<−0.67`
  had 236 mine rows / 17 dates → **38 holdout rows, 0 usable dates.**
- **confluence grain: 24 tested / 50 insufficient.** Of the 24 tested, **all 24
  kept their mining sign and all had ≥150 rows — but NONE reached \|hold_t\|≥2.**
  Holdout means run ~½ to ⅓ of mining means across the board (heavy shrinkage,
  classic selection bias). Best near-miss: confluence h=3
  `sent_cp_ratio>1.154 & BULLISH & sent_cp_ratio_dm>0 …` → mine_mean ~0.066,
  **hold_t=1.54, hold_mean=0.0276 (n=399)**. The Tech+BULLISH cluster lands at
  hold_t≈0.93. The Tech+BEARISH OTM-call "edges" (mine_t≈−9) collapse to
  hold_t≈−0.2 to −0.6 — economically gone.

## 3. Survivors vs expected-by-chance

**Survivors: 0 of 125. The single-char study got 7 of 150.** Combinations did
strictly worse on the only number that matters.

- Full-search multiplicity: 114,602 permuted rules × ~0.046 two-sided rate ⇒
  **~5,272 spurious \|t\|≥2 hits expected by chance.** The mining t-stats (incl.
  the 17.28 flagship) live entirely inside that floor.
- Among the **24 actually-testable** holdout candidates, chance expects
  24 × 0.046 ≈ **1.1 survivors**; we observed **0**. We found *fewer* survivors
  than the null would produce — i.e. the tested combos are indistinguishable
  from (or worse than) noise.

## 4. Did confluence beat standalone order or ticker rules?

**No.** This is the direct answer to the study's reason for existing. The
confluence families were the *only* grain that stayed testable on holdout
(because order-only and ticker-only conjunctions self-destructed on volume), so
in a narrow sense confluence "won" the testability contest — but it still
produced **zero survivors**. The best confluence rule (hold_t=1.54) does not
clear the bar the single-char raw `sent_cp_ratio` cut cleared in the prior study
(hold_t≈4.3–4.5). Adding an order-characteristic AND-condition to a ticker-state
signal **shrank n, shrank dates, and shrank hold_t** — it added overfitting
surface, not signal. Order+aggregate agreement did not beat either leg alone.

## 5. Are any survivors free of the cp_ratio / momentum-regime confound?

Moot — there are **no survivors to clear it.** But the diagnostic is worse than
neutral: every confluence candidate that came *closest* to surviving is built on
`sent_cp_ratio` / `sent_cp_ratio_dm` (the call/put-ratio sentiment feature) — the
**exact between-ticker momentum/regime proxy** the event study named and killed
(quintile mean cp_ratio 2.8→30.8; +0.71 between-ticker vs +0.18 within). The
demeaned confluence family was meant to strip this out and still ranks
cp_ratio_dm at the top, still fading on holdout. So combinations did not find a
confound-free pocket; they re-discovered the same tainted feature, now wrapped in
extra conditions that destroy out-of-sample volume.

## 6. Verdict — and what corpus depth would change it

**Blunt verdict: combinations are a net negative on this corpus.** They multiplied
the search ~11× (114,602 rules, ~5,272 expected false positives), produced the
biggest mining t-stats in the entire project (17.28), and converted them into
**zero holdout survivors** — strictly worse than the single-char baseline's 7
(themselves confound-driven). The single mechanism is mechanical: conjunctions
shrink n and date-coverage below the holdout sufficiency floor, so 101/125 rules
can't even be scored, and the 24 that can all fade to \|hold_t\|<2. The plumbing is
clean (untouched holdout, honest dedup/multiplicity accounting, no cherry-picking).

**What changes the answer: corpus DEPTH across REGIMES, not more rule WIDTH.** The
study spans ~16–19 dates in one May–June 2026 regime; widening the conjunction
search inside one regime only deepens the overfit. The unlock is multi-month /
multi-quarter coverage spanning distinct regimes, enough that a 3–5-condition
confluence rule can clear MIN_ROWS/MIN_DATES *on the holdout* and be retested
across two or more independent windows. Only if a within-ticker-demeaned
confluence rule earns a same-sign \|hold_t\|≥2 across ≥2 regimes should combinations
be re-opened. Until then: do not promote any combo rule. Re-run monthly as the
corpus grows.
