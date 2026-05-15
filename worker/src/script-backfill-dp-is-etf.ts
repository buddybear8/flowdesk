// One-shot backfill: set dark_pool_prints.is_etf based on SECTOR_OVERRIDES.
//
// The Polygon ingest (polygon-trade-filter.ts) hardcoded is_etf=false for
// every row up to 2026-05-14. SECTOR_OVERRIDES now flags every tracked-ticker
// ETF — this script propagates that to all stored prints in one bulk UPDATE.
//
// Run with:
//   cd worker && DATABASE_URL=$PUBLIC_DB npx tsx src/script-backfill-dp-is-etf.ts

import { prisma, disconnectPrisma } from "./lib/prisma.js";
import { SECTOR_OVERRIDES } from "./lib/sector-overrides.js";

async function main(): Promise<void> {
  const etfTickers = Object.entries(SECTOR_OVERRIDES)
    .filter(([, v]) => v.isEtf)
    .map(([t]) => t);

  if (etfTickers.length === 0) {
    console.log("No ETFs in SECTOR_OVERRIDES — nothing to do");
    await disconnectPrisma();
    return;
  }

  console.log(`Marking ${etfTickers.length} ETFs in dark_pool_prints…`);

  // Two-step idempotent update — flip-on for the ETF set, flip-off for
  // everything else (in case an old run left stale `true` values).
  const trueResult = await prisma.darkPoolPrint.updateMany({
    where: { ticker: { in: etfTickers }, isEtf: false },
    data: { isEtf: true },
  });
  const falseResult = await prisma.darkPoolPrint.updateMany({
    where: { ticker: { notIn: etfTickers }, isEtf: true },
    data: { isEtf: false },
  });

  console.log(`Updated ${trueResult.count} rows to is_etf=true`);
  console.log(`Updated ${falseResult.count} rows to is_etf=false`);

  // Final sanity check.
  const [trueCount, falseCount] = await Promise.all([
    prisma.darkPoolPrint.count({ where: { isEtf: true } }),
    prisma.darkPoolPrint.count({ where: { isEtf: false } }),
  ]);
  console.log(`\nFinal state: is_etf=true ${trueCount} · is_etf=false ${falseCount}`);

  await disconnectPrisma();
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
