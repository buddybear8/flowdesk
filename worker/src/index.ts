// FlowDesk worker — single Node service driving all backend cron jobs.
//
// Locked architecture: ARCHITECTURE.md §1 / §6 (single-worker option A, v1.4).
// Dark-pool source switched 2026-05-13 from UW polling to Polygon. UW dark-
// pool ingest and the s3-darkpool-import stub are both retired. Polygon
// daily flat-file + hourly REST poll own dark_pool_prints going forward.

import cron from "node-cron";
import {
  pollFlowAlerts,
  pollLottoAlerts,
  pollSweeperAlerts,
  pollGex,
  pollMarketTide,
  computeNetImpact,
} from "./jobs/uw.js";
import { runFlowRetentionSweep, runDpRetentionSweep, runGexHeatmapRetentionSweep } from "./jobs/retention.js";
import { refreshTickerMetadata } from "./jobs/refresh-ticker-metadata.js";
import { runAiSummarizerGex } from "./jobs/ai-summarizer-gex.js";
import { computeHitList } from "./jobs/hit-list-compute.js";
import { importPolygonDailyFlatFile } from "./jobs/polygon-daily-flatfile.js";
import { pollPolygonIntraday } from "./jobs/polygon-hourly-intraday.js";
import { disconnectPrisma } from "./lib/prisma.js";

const ts = () => new Date().toISOString();

// Wraps a job in error-isolation: a single failing run never bubbles to
// node-cron and never kills the process.
const safe =
  (label: string, fn: () => Promise<unknown> | unknown) =>
  () => {
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error(`[${ts()}] [job:${label}] uncaught:`, err));
  };

// node-cron 6-field expressions: sec min hour dayOfMonth month dayOfWeek.
// TZ=America/New_York must be set on the Railway service so cron resolves in ET.

// ─── UW polling (jobs/uw.ts) — flow/lotto/sweeper only; dark pool moved to Polygon
cron.schedule("*/30 * 9-15 * * 1-5", safe("uw-poll-mkt", async () => {
  await Promise.all([pollFlowAlerts(), pollLottoAlerts(), pollSweeperAlerts()]);
}));
cron.schedule("0 */5 0-8,16-23 * * 1-5", safe("uw-poll-off", async () => {
  await Promise.all([pollFlowAlerts(), pollLottoAlerts(), pollSweeperAlerts()]);
}));
cron.schedule("*/60 * 9-15 * * 1-5", safe("gex-poll", pollGex));
cron.schedule("0 */5 9-15 * * 1-5", safe("market-tide", pollMarketTide));
cron.schedule("30 */5 9-15 * * 1-5", safe("net-impact", computeNetImpact));

// ─── Polygon dark-pool ingest (replaces UW dark-pool + s3-darkpool-import) ───
// Polygon publishes the previous trading day's flat file around 3-5 AM ET;
// 06:00 leaves a safe buffer. Hourly intraday picks up the rest of the day
// (15-min delay floor at the $79 Starter tier; ~75 min max delay to DB).
cron.schedule("0 0 6 * * 1-5", safe("polygon-daily-flatfile", importPolygonDailyFlatFile));
cron.schedule("0 0 10-17 * * 1-5", safe("polygon-hourly-intraday", pollPolygonIntraday));

// ─── Daily batches (jobs/*) ──────────────────────────────────────────────────
cron.schedule("0 30 5 * * 1-5", safe("refresh-ticker-metadata", refreshTickerMetadata));
cron.schedule("0 0 7 * * 1-5", safe("ai-summarizer-gex", runAiSummarizerGex));
cron.schedule("0 30 7 * * 1-5", safe("hit-list-compute", computeHitList));
cron.schedule("0 0 3 * * 1-5", safe("retention-sweeps", async () => {
  await Promise.all([runFlowRetentionSweep(), runDpRetentionSweep(), runGexHeatmapRetentionSweep()]);
}));

// ─── 🗄 Archived in v1.4 (do NOT re-add in V1) ────────────────────────────────
// "0 0 6 * * 1-5"  — was the X API daily batch. Sentiment Tracker module
//                    deferred from V1 (see PRD §7 archive banner).

// Graceful shutdown — disconnect Prisma on SIGINT/SIGTERM so Railway redeploys
// don't leak DB connections.
const shutdown = async (signal: string) => {
  console.log(`[${ts()}] [worker] received ${signal}, disconnecting Prisma...`);
  await disconnectPrisma();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`[${ts()}] [worker] started — 11 schedules registered (Polygon dark-pool ingest live; UW dark-pool retired)`);
