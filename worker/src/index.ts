// FlowDesk worker — single Node service driving all backend cron jobs.
//
// Locked architecture: ARCHITECTURE.md §1 / §6 (single-worker option A, v1.4).
// V1 scope: 10 schedules total. Sentiment Tracker module archived in v1.2.3,
// so the 06:00 ET X-batch and the sentiment branch of ai-summarizer are NOT
// scheduled here.
//
// Phase 2 step 3: UW jobs wired (Phase 2 step 1 stubs replaced). Other job
// modules still log "not implemented yet" until they land in subsequent steps.

import cron from "node-cron";
import {
  pollFlowAlerts,
  pollDarkPool,
  pollGex,
  pollMarketTide,
  computeNetImpact,
} from "./jobs/uw.js";
import { runFlowRetentionSweep, runDpRetentionSweep } from "./jobs/retention.js";
import { refreshTickerMetadata } from "./jobs/refresh-ticker-metadata.js";
import { runAiSummarizerGex } from "./jobs/ai-summarizer-gex.js";
import { computeHitList } from "./jobs/hit-list-compute.js";
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

// Stub for jobs not yet implemented in this step. Removes itself in a later
// commit when the job's source file lands.
const todo = (label: string) =>
  safe(label, () => {
    console.warn(`[${ts()}] [job:${label}] not implemented — Phase 2 step 3+`);
  });

// node-cron 6-field expressions: sec min hour dayOfMonth month dayOfWeek.
// TZ=America/New_York must be set on the Railway service so cron resolves in ET.

// ─── UW polling (jobs/uw.ts — wired in step 3) ───────────────────────────────
cron.schedule("*/30 * 9-15 * * 1-5", safe("uw-poll-mkt", async () => {
  await Promise.all([pollFlowAlerts(), pollDarkPool()]);
}));
cron.schedule("0 */5 0-8,16-23 * * 1-5", safe("uw-poll-off", async () => {
  await Promise.all([pollFlowAlerts(), pollDarkPool()]);
}));
cron.schedule("*/60 * 9-15 * * 1-5", safe("gex-poll", pollGex));
cron.schedule("0 */5 9-15 * * 1-5", safe("market-tide", pollMarketTide));
cron.schedule("30 */5 9-15 * * 1-5", safe("net-impact", computeNetImpact));

// ─── Daily batches (jobs/* — pending steps 4–6) ──────────────────────────────
cron.schedule("0 30 5 * * 1-5", safe("refresh-ticker-metadata", refreshTickerMetadata));
cron.schedule("0 0 7 * * 1-5", safe("ai-summarizer-gex", runAiSummarizerGex));
cron.schedule("0 30 7 * * 1-5", safe("hit-list-compute", computeHitList));
cron.schedule("0 0 3 * * 1-5", safe("retention-sweeps", async () => {
  await Promise.all([runFlowRetentionSweep(), runDpRetentionSweep()]);
}));
cron.schedule("0 0 2 * * 1-5", todo("s3-darkpool-import"));         // 02:00 ET

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

console.log(`[${ts()}] [worker] started — 10 schedules registered (UW + retention + refresh-ticker-metadata + ai-summarizer-gex + hit-list-compute wired; s3-import pending)`);
