// jobs/retention.ts — nightly DB retention sweeps.
//
// PRD §3.5 / ARCHITECTURE §2.1 retention rules (locked v1.2.1):
//   • flow_alerts:      60-day rolling window
//   • dark_pool_prints: top-100 ranked per ticker = PERPETUAL
//                       everything else            = 30-day rolling window
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

// ─── Dark pool: split rule (top-100 perpetual, else 30 days) ─────────────────
//
// SQL semantics:
//   DELETE FROM dark_pool_prints
//   WHERE executed_at < NOW() - INTERVAL '30 days'
//     AND (rank IS NULL OR rank > 100);
//
// rationale:
//   • rank IS NULL  → unranked print (no historical-corpus position) → 30d sweep
//   • rank > 100    → outside top-100 per-ticker corpus              → 30d sweep
//   • rank ≤ 100    → KEEP (perpetual; this is the historical ranking corpus)

export async function runDpRetentionSweep(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.darkPoolPrint.deleteMany({
      where: {
        executedAt: { lt: cutoff },
        OR: [{ rank: null }, { rank: { gt: 100 } }],
      },
    });
    console.log(
      `[retention:dp] ${ts()} deleted ${result.count} non-top-100 prints older than ${cutoff.toISOString()}`
    );
  } catch (err) {
    console.error("[retention:dp] failed:", err instanceof Error ? err.message : err);
  }
}

// Shutdown handled centrally via ../lib/prisma.js; no per-file disconnect needed.
