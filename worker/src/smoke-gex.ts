// One-shot GEX poll. Fires pollGex (which now also writes per-(strike × expiry)
// heatmap snapshots) and verifies the latest heatmap row landed for each
// watched ticker.
//
// Run with:
//   cd worker && railway run -- npx tsx src/smoke-gex.ts

import { pollGex } from "./jobs/uw.js";
import { prisma, disconnectPrisma } from "./lib/prisma.js";
import { WATCHED_TICKERS } from "./lib/watched-tickers.js";

async function main() {
  console.log("──────── gex (5 tickers, incl. heatmap) ────────");
  await pollGex();

  console.log("\n──────── verify heatmap snapshots ────────");
  for (const ticker of WATCHED_TICKERS) {
    const row = await prisma.gexHeatmapSnapshot.findFirst({
      where: { ticker },
      orderBy: { capturedAt: "desc" },
    });
    if (!row) {
      console.warn(`  ${ticker}: NO ROW (UW returned no data?)`);
      continue;
    }
    const cells = row.cells as unknown as {
      expirations: { date: string; dte: number }[];
      strikes: { strike: number; byExp: Record<string, { netOI: number; netDV: number }> }[];
    };
    const populatedCells = cells.strikes.reduce(
      (sum, s) => sum + Object.keys(s.byExp).length,
      0,
    );
    console.log(
      `  ${ticker.padEnd(5)} spot=$${Number(row.spot).toFixed(2)} · ` +
        `${cells.expirations.length} expirations · ` +
        `${cells.strikes.length} strikes · ` +
        `${populatedCells} populated cells · ` +
        `captured=${row.capturedAt.toISOString()}`,
    );
  }

  console.log("\n──────── done ────────");
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("smoke-gex failed:", err);
  process.exit(1);
});
