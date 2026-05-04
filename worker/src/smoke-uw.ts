// One-shot smoke test for jobs/uw.ts.
//
// Runs each of the 4 active polling functions exactly once (skips
// computeNetImpact — it's a documented placeholder). Logs sample rows
// from each UW endpoint via logSampleOnce so we can verify field
// mappings against the real response shape.
//
// Run with:
//   cd worker
//   UW_API_TOKEN=<your-token> \
//     DATABASE_URL=<railway-public-url-with-sslmode=require> \
//     npx tsx src/smoke-uw.ts
//
// Expected output: one [uw:flow] sample row dump, one [uw:dp] dump, one
// [uw:tide] dump, and 5 [uw:gex:TICKER] dumps. Then row counts inserted.
// Errors are logged but don't crash the script. Run repeatedly is safe —
// `skipDuplicates: true` on every insert prevents duplicate rows.

import {
  pollFlowAlerts,
  pollDarkPool,
  pollGex,
  pollMarketTide,
  computeNetImpact,
} from "./jobs/uw.js";
import { disconnectPrisma } from "./lib/prisma.js";

async function main() {
  console.log("──────── flow alerts ────────");
  await pollFlowAlerts();

  console.log("──────── dark pool ────────");
  await pollDarkPool();

  console.log("──────── market tide ────────");
  await pollMarketTide();

  console.log("──────── net impact ────────");
  await computeNetImpact();

  console.log("──────── gex (5 tickers) ────────");
  await pollGex();

  console.log("──────── done ────────");
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("smoke-uw failed:", err);
  process.exit(1);
});
