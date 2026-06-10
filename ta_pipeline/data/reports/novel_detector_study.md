# Novel-Detector Study: Real Traders' Setups vs the Random-Pattern Baseline

Generated: 2026-06-10
Dev window: 2017-06-13 .. 2025-05-19 | 219 tickers | 358,570 dev rows
Label: ATR triple barrier, +1.5 / -1.0 ATR, 10d horizon | CV folds only, reserved OOS untouched
Prior context: geometric-pattern round (`pattern_exploration.md`) measured ~all families at chance,
lift 0.96-1.10, 21/22 refuted. The two families here were transcribed from REAL traders' charts:
`fib_confluence` (efficientenzyme) and `ema_cloud_mtf` (ripster), to test whether learning from
human discretionary setups beats blind geometric search.

--------------------------------------------------------------------------------
## 1. What was built + tested

### fib_confluence (efficientenzyme)
`patterns/fib_confluence.py`. From `swings.detect_pivots` confirmed pivots, each completed impulse
leg A->B yields fib retracement levels (0.382/0.5/0.618/0.786). A pullback that touches a fib level
CONFLUENT with another confirmed structural pivot (within `confluence_atr`*ATR) and then RECLAIMS
(close back past the pullback-zone boundary in the impulse direction) fires an event.
strength = confluent-factor count * reclaim cleanliness.
- 3 pre-registered param-sets: f1_base (band 0.3 ATR, impulse 2.0), f2_tight (golden-pocket 0.5/0.618,
  band 0.2, impulse 3.0), f3_loose (band 0.5, impulse 1.5).
- CRITICAL additivity control: each `<name>_nofib` twin runs the IDENTICAL swing structure + reclaim
  with require_fib=False / require_confluence=False, isolating whether the fib/confluence gate adds
  anything over the bare swing-reclaim the prior round already refuted.
- 6 gated cells + 6 nofib controls, x 2 sides. No-lookahead enforced via pivot confirmation at p+m;
  truncation-invariance tests 9/9 pass.

### ema_cloud_mtf (ripster)
`patterns/ema_cloud_mtf.py`. fast EMA cloud + slow EMA cloud. reclaim = was below fast cloud, closes
above it while slow cloud bullish; curl_flip = slow-midline slope flips up while price above slow cloud
(mirror for shorts). 3 pre-registered EMA sets (ripster 5/12+34/50, classic 8/21+34/50, wide 9/20+50/100)
x 2 modes = 6 cells x 2 sides = 12 cells. MTF/HTF filter = weekly W-FRI EMA-cloud direction using only the
PRIOR completed week. 9/9 module tests pass; full 158-test suite green.

--------------------------------------------------------------------------------
## 2. Did EITHER detector beat the random-pattern baseline / survive red-team?

NO. Every cell in both families lands at lift 1.02-1.10 -- entirely inside the prior round's 0.96-1.10
chance band. There is no separation from the geometric baseline.

Red-team: 22 of 23 adversarial verdicts returned REFUTED (high confidence on most); the single
non-refuted verdict (wide_curl_flip short) was explicitly tagged "corroborated, not refuted" only as
a literal-numbers reproduction, with the same reviewer noting the edge is "economically marginal"
(negative median return). Reviewers reproduced every headline number EXACTLY and found NO lookahead in
either detector (truncation-invariant; weekly HTF correctly uses prior completed week). The detectors are
honestly built and leak-free -- they are refuted on EDGE, not integrity. Median forward outcome is
NEGATIVE in every single cell of both families (-0.004 to -0.014): lift is a screening hit-rate statistic
on an asymmetric barrier, not P&L.

--------------------------------------------------------------------------------
## 3. Is fib confluence ADDITIVE? Does EMA cloud MTF carry edge?

fib_confluence -- NOT ADDITIVE. The fib/confluence gate adds only +0.01 to +0.02 lift over its nofib
twin in 5 of 6 cells, and is NEGATIVE for f2_tight long (1.0239 gated vs 1.0265 nofib). The increment is
non-monotone (it REVERSES sign for the tightest/most-canonical golden-pocket gate, where a real structural
effect should strengthen). Red-team showed the gated set is not even a clean nested subset of nofib (the
touch bar relocates the reclaim zone), and within the shared population the bars the gate KEEPS vs DROPS
are statistically indistinguishable (z~0.16-1.27, p=0.20-0.87). The nofib baseline itself sits at chance
(1.03-1.05), consistent with the prior round refuting plain reclaim. So fib confluence rides on a base
with no edge and contributes nothing reproducible on top.

ema_cloud_mtf -- NO EDGE / NON-ADDITIVE. The slow-cloud "confluence" requirement adds essentially nothing
over a plain fast-cloud reclaim: red-team ablations put plain reclaim at lift ~1.05-1.08 and the full
slow-cloud-gated detector at ~1.06-1.10, with gated-vs-rejected reclaims indistinguishable (z~0.5-1.1).
curl_flip is the only place with a small genuine increment over a bare "below slow cloud" regime, but it
too is economically negative and regime-driven. Note ripster_curl_flip == classic_curl_flip byte-for-byte
(curl_flip ignores the fast EMAs; both share the 34/50 slow cloud), so the "6 cells" are effectively ~5.

--------------------------------------------------------------------------------
## 4. HTF / MTF-conditioning effect

Negligible and not reproducible in either family. Measured fairly (lift_vs_htf_base, against the
HTF-conditional base rate), weekly-trend alignment moves cells by only +/-0.01-0.03 and sits BELOW the
unconditional lift in many cells (5 of 12 in ema_cloud_mtf; the asymmetry favoring shorts is a base-rate
artifact of weekly downtrends, not a filter edge). The HTF-aligned base rate over all rows ~= the overall
base rate (0.443 vs 0.443 long; 0.394 vs 0.387 short), so "HTF helps everything" weakly rather than
selecting this pattern. Weekly-trend conditioning is not a useful confluence filter -- the same finding the
prior geometric round documented.

--------------------------------------------------------------------------------
## 5. Blunt verdict: did learning from real traders' setups beat geometric search?

NO. Transcribing two well-known discretionary frameworks from actual traders' charts (efficientenzyme's
fib confluence, ripster's EMA-cloud MTF) produced nothing the blind geometric search did not. Both land in
the identical 1.02-1.10 chance band, both have negative median forward returns in every cell, the
"confluence" overlays (fib + structure; slow cloud + weekly trend) are non-additive over the plain
swing-reclaim / fast-cloud reclaim primitives, and 22/23 red-team verdicts refute. Human chart intuition
did not encode a measurable forward edge here: the visually compelling part (the fib level, the cloud
stack, the weekly alignment) is exactly the part that adds zero. This makes 23/24 geometric+trader patterns
refuted across both rounds -- a clean, valuable negative.

--------------------------------------------------------------------------------
## 6. Still untested (out of scope / data-blocked)

- VIX-regime conditioning: DATA-BLOCKED (no VIX series wired into the feature matrix); cannot test whether
  these setups separate by volatility regime.
- True intraday/hourly MTF: only daily bars with a weekly HTF were available; the genuine multi-timeframe
  context ripster trades (hourly entry under daily/weekly cloud) is untested.
- efficientenzyme's discretionary projected-path component: the human overlay (anticipated path / where the
  trader expects price to travel after the reclaim) is not mechanizable from OHLC and was not modeled; only
  the objective fib-touch-and-reclaim trigger was tested.

================================================================================
EXECUTIVE SUMMARY (<=20 lines)
================================================================================
Built two detectors from real traders' charts -- efficientenzyme's fib_confluence and ripster's
ema_cloud_mtf -- to test whether human discretionary setups beat the geometric search that refuted
21/22 patterns last round. They do not. All 6 fib cells and all 12 EMA-cloud cells land at lift
1.02-1.10, squarely inside the prior 0.96-1.10 chance band, with NEGATIVE median forward return in
every cell. Red-team reproduced every number exactly and found NO lookahead (both detectors are
leak-free and truncation-invariant), but 22 of 23 adversarial verdicts REFUTE on edge, not integrity.
ADDITIVITY is the decisive failure: the fib/confluence gate adds only +0.01-0.02 lift over the plain
swing-reclaim twin and goes NEGATIVE for the tightest golden-pocket gate -- the increment is within
noise, non-nested, and rides on a baseline that is itself at chance. The EMA slow-cloud requirement
likewise adds nothing over a plain fast-cloud reclaim (gated vs rejected indistinguishable, z~0.5-1.1).
HTF/MTF weekly-trend conditioning is negligible and sits BELOW unconditional lift in roughly half of
cells -- weekly alignment is not a confluence filter. Verdict: learning from these traders' actual
setups produced nothing the geometric search did not; the visually compelling overlays (fib levels,
cloud stacks, weekly trend) are exactly what adds zero. Now 23/24 patterns refuted across both rounds.
Still untested: VIX-regime conditioning (data-blocked), true hourly MTF (only daily+weekly available),
and efficientenzyme's discretionary projected-path overlay (not mechanizable from OHLC). Clean negative.
