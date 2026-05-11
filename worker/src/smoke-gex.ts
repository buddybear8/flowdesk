// One-shot GEX poll. Mirrors smoke-uw.ts but only fires pollGex so we can
// verify the centered-retry logic without touching the other tables.
//
// Run with:
//   cd worker && railway run -- npx tsx src/smoke-gex.ts

import { pollGex } from "./jobs/uw.js";
import { disconnectPrisma } from "./lib/prisma.js";

async function main() {
  console.log("──────── gex (5 tickers) ────────");
  await pollGex();
  console.log("──────── done ────────");
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("smoke-gex failed:", err);
  process.exit(1);
});
