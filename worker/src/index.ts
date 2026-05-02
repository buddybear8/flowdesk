// FlowDesk worker — single Node service driving all backend cron jobs.
//
// Locked architecture: ARCHITECTURE.md §1 / §6 (single-worker option A, v1.4).
// V1 scope: 10 schedules total. Sentiment Tracker module archived in v1.2.3,
// so the 06:00 ET X-batch and the sentiment branch of ai-summarizer are NOT
// scheduled here.
//
// Phase 2 step 1 (this file) registers all schedules with stub loggers so we
// can verify the worker starts cleanly on Railway and cron expressions parse.
// Step 3 will replace each `log(...)` call with an import from `./jobs/...`.

import cron from "node-cron";

const ts = () => new Date().toISOString();
const log = (job: string) => () => {
  console.log(`[${ts()}] [job:${job}] fired (stub — Phase 2 step 1)`);
};

// node-cron 6-field expressions: sec min hour dayOfMonth month dayOfWeek.
// TZ=America/New_York must be set on the Railway service so cron resolves in ET.

// ─── UW polling ──────────────────────────────────────────────────────────────
// Flow alerts + dark pool prints — every 30s during market hours (9:00–15:59 ET
// covers 9:30 open through 16:00 close), every 5m off-hours.
cron.schedule("*/30 * 9-15 * * 1-5", log("uw-poll-mkt"));         // mkt hours
cron.schedule("0 */5 0-8,16-23 * * 1-5", log("uw-poll-off"));     // off hours

// GEX per watched ticker — every 60s during market hours.
cron.schedule("*/60 * 9-15 * * 1-5", log("gex-poll"));

// Market Tide — UW returns 5-min buckets; poll on the 5-min boundary.
cron.schedule("0 */5 9-15 * * 1-5", log("market-tide"));

// Top Net Impact — top 10 by |Net Impact| per day, recomputed every 5m
// (offset 30s after the tide poll lands so flow_alerts is up to date).
cron.schedule("30 */5 9-15 * * 1-5", log("net-impact"));

// ─── Daily batches ───────────────────────────────────────────────────────────
// Refresh ticker_metadata (sector + name + isEtf cache).
cron.schedule("0 30 5 * * 1-5", log("refresh-ticker-metadata"));   // 05:30 ET

// AI summarizer — V1 scope: per-ticker GEX explanations only (sentiment
// summary archived in v1.2.3). Writes ai_summaries(kind="gex-{TICKER}-{date}").
cron.schedule("0 0 7 * * 1-5", log("ai-summarizer-gex"));          // 07:00 ET

// Hit-list compute — reads flow_alerts + dark_pool_prints, applies
// WatchesCriteria, writes top-20 to hit_list_daily.
cron.schedule("0 30 7 * * 1-5", log("hit-list-compute"));          // 07:30 ET

// Retention sweeps — flow (60d) + DP (top-100 perpetual / 30d otherwise).
cron.schedule("0 0 3 * * 1-5", log("retention-sweeps"));           // 03:00 ET

// Dark-pool history import — pull new files from S3 (Polygon-extracted,
// out-of-band per PRD §3.5).
cron.schedule("0 0 2 * * 1-5", log("s3-darkpool-import"));         // 02:00 ET

// ─── 🗄 Archived in v1.4 (do NOT re-add in V1) ────────────────────────────────
// "0 0 6 * * 1-5"  — was the X API daily batch. Sentiment Tracker module
//                    deferred from V1 (see PRD §7 archive banner).

console.log(`[${ts()}] [worker] started — 10 schedules registered (Phase 2 step 1 stubs)`);
