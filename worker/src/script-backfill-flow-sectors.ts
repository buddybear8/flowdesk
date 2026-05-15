// One-shot backfill: re-resolve flow_alerts.sector using SECTOR_OVERRIDES
// (lib/sector-overrides.ts).
//
// Before 2026-05-14 pollFlowAlerts wrote `raw.sector ?? "Technology"` directly
// from UW's payload, which left every alert UW didn't tag with a sector
// (effectively all of them) as "Technology". This script walks every row,
// runs the same `resolveTickerSector` we now apply on ingest, and updates
// rows whose stored sector differs.
//
// Run with:
//   cd worker && DATABASE_URL=$PUBLIC_DB npx tsx src/script-backfill-flow-sectors.ts

import { prisma, disconnectPrisma } from "./lib/prisma.js";
import { resolveTickerSector } from "./lib/sector-overrides.js";

const BATCH = 5000;

async function main(): Promise<void> {
  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  const unresolved = new Map<string, number>();

  while (true) {
    const batch: { id: string; ticker: string; sector: string }[] = await prisma.flowAlert.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, ticker: true, sector: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    const updates: { id: string; sector: string }[] = [];
    for (const row of batch) {
      const resolved = resolveTickerSector(row.ticker, row.sector);
      if (resolved.unresolved) {
        unresolved.set(row.ticker, (unresolved.get(row.ticker) ?? 0) + 1);
      }
      if (resolved.sector !== row.sector) {
        updates.push({ id: row.id, sector: resolved.sector });
      }
    }

    await Promise.all(
      updates.map((u) =>
        prisma.flowAlert.update({ where: { id: u.id }, data: { sector: u.sector } }),
      ),
    );

    scanned += batch.length;
    updated += updates.length;
    console.log(`  scanned=${scanned} updated=${updated} (cursor=${cursor})`);
    if (batch.length < BATCH) break;
  }

  console.log(`\nDone. scanned=${scanned} updated=${updated}`);
  if (unresolved.size > 0) {
    console.log(`\nUnresolved tickers (defaulted to Technology) — ${unresolved.size} unique:`);
    const sorted = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [t, n] of sorted) console.log(`  ${t.padEnd(8)} ${n}`);
    if (unresolved.size > 30) console.log(`  ... and ${unresolved.size - 30} more`);
  }
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
