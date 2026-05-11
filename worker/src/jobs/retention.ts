// jobs/retention.ts — nightly DB retention sweeps.
//
// Retention rules (v1.4 — Polygon backfill landed):
//   • flow_alerts:      60-day rolling window
//   • dark_pool_prints: ANY ranked print           = PERPETUAL
//                       rank IS NULL & older 30d  = deleted
//
// Why the change: pre-Polygon, "ranked" meant rank ≤ 100 inside a UW-only
// corpus and rank > 100 was treated as deletable noise. After the Polygon
// backfill the ranking corpus is the canonical top-200 per ticker
// (Polygon historical + UW rolling), so any row with a non-null rank is
// in the top-200 for its ticker and worth keeping indefinitely. Unranked
// rows (rank IS NULL after rerankDarkPool ran) sit outside the top-200
// and age out on the 30-day window.
//
// Both run in the worker's daily 03:00 ET sweep window (off-hours, weekdays).
// Idempotent — running twice in a row is a no-op the second time.

import { prisma } from "../lib/prisma.js";

const ts = () => new Date().toISOString();

// ─── Flow alerts: 60-day rolling delete ──────────────────────────────────────

export async function runFlowRetentionSweep(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const result = await prisma.flowAlert.deleteMany({
      where: { capturedAt: { lt: cutoff } },
    });
    console.log(
      `[retention:flow] ${ts()} deleted ${result.count} alerts older than ${cutoff.toISOString()}`
    );
  } catch (err) {
    console.error("[retention:flow] failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Dark pool: perpetual ranked, 30d rolling for unranked ──────────────────
//
// SQL semantics:
//   DELETE FROM dark_pool_prints
//   WHERE executed_at < NOW() - INTERVAL '30 days'
//     AND rank IS NULL;
//
// rationale:
//   • rank IS NULL → outside the per-ticker top-200 → 30d sweep
//   • rank set     → KEEP (in the top-200 ranking corpus)

export async function runDpRetentionSweep(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.darkPoolPrint.deleteMany({
      where: {
        executedAt: { lt: cutoff },
        rank: null,
      },
    });
    console.log(
      `[retention:dp] ${ts()} deleted ${result.count} unranked prints older than ${cutoff.toISOString()}`
    );
  } catch (err) {
    console.error("[retention:dp] failed:", err instanceof Error ? err.message : err);
  }
}

// Shutdown handled centrally via ../lib/prisma.js; no per-file disconnect needed.
