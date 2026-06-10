# Chain-flow event study — 2026-06-10

**Question:** does the per-strike options-flow signal (aggressor-side buy/sell,
from `flow_sentiment_days`) predict forward returns? This is the cheapest honest
read before training any flow model (per `flow/README.md`).

**Data:** 6,120 ticker-days · 227 tickers · **27 dates (2026-05-04 → 2026-06-10)**.
Forward returns close[t]→close[t+h] from `candle_bars`. Signal known at close[t]
(leakage-safe). Reproduce: `python -m ta_pipeline.flow.sentiment_event_study`.

**Method:** Fama-MacBeth — cross-sectional rank correlation of signal vs forward
return computed **per date**, then t-tested across dates. The unit of evidence is
the date (~17–27), not the ~6k clustered ticker-days. This is deliberate: the
pattern-exploration study's #1 kill mode was naive SEs on cross-sectionally
clustered data.

## Headline result: no genuine flow-timing edge

The pooled Fama-MacBeth correlations look striking at first — `sent_cp_ratio`
reaches +0.51 (t=26) at 10 days, `sent_otm_call_buy_frac` −0.44 (t=−23). But two
tells expose them as artifacts:

1. **They *grow* with horizon** (cp_ratio: 1d +0.17 → 10d +0.51). Real flow-timing
   edges decay with horizon; monotonic growth is the signature of a persistent
   cross-sectional characteristic accumulating return.
2. **Between- vs within-ticker decomposition** (fwd_10, rank corr):

   | signal | between-ticker (trait) | within-ticker (timing) |
   |---|---|---|
   | sent_dir_prem_score | +0.287 | **−0.028** |
   | sent_atm_call_imb | +0.092 | −0.034 |
   | sent_call_buy_frac | +0.136 | −0.020 |
   | sent_cp_ratio | **+0.713** | +0.178 |
   | sent_otm_call_buy_frac | **−0.590** | −0.244 |
   | sent_net_dir_prem | +0.170 | −0.063 |

   Every signal's power is **mostly or entirely between-ticker** — a persistent
   trait, not day-to-day timing. The genuine within-ticker timing component is
   ≈0 for the directional signals.

3. **The confound, named:** sort tickers by mean 10-day forward return into
   quintiles → mean `cp_ratio` is **2.8 (worst) … 30.8 (best)**. `cp_ratio` is a
   proxy for "hot high-call-volume retail/momentum name," and those names rallied
   in this single May–June 2026 window. That is regime/selection, not flow
   predicting moves.

The headline directional signal (`sent_dir_prem_score`) — premium-weighted net
call-minus-put buying — has a within-ticker timing correlation of **−0.03**:
essentially zero. Its mild pooled signal (10d quintile spread +1.53%, t=2.0) is
the same cross-sectional/regime effect.

## What this means

- **Do NOT build a flow signal on the cross-sectional power of these features.**
  `cp_ratio`'s +0.71 between-ticker correlation is a momentum/regime proxy that
  would likely reverse out-of-regime.
- **The confluence study MUST use ticker fixed effects / within-ticker variation**
  (or per-date cross-sectional de-meaning) or it will be fooled by exactly these
  confounds — the same trap, one level up.
- **The corpus is the limiting factor.** 27 dates in ONE regime cannot separate
  signal from selection. The S3 archive + live collection grow it ~1 day/day;
  the honest verdict waits on multi-regime coverage (and ideally the reserved
  OOS year, spent once).

**Status: negative/inconclusive, as expected at 5.5 weeks.** The plumbing
(features, leakage-safe join, clustering-honest evaluation) is in place and
correct; the data is not yet deep enough to find an edge if one exists. No
signal graduates to a standalone prior. Re-run this monthly as the corpus grows.
