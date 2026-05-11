// One-shot: re-rank every ticker that has dark-pool rows. Used after a
// partial import where some per-ticker rerank calls were lost to DB
// connectivity issues. Sequential with a small delay so we don't slam
// Postgres again.

import { prisma } from "./lib/prisma.js";
import { rerankDarkPool } from "./lib/rerank-darkpool.js";

async function main() {
  const tickers = (
    await prisma.darkPoolPrint.findMany({
      distinct: ["ticker"],
      select: { ticker: true },
    })
  ).map((r) => r.ticker);
  console.log(`reranking ${tickers.length} tickers`);
  let touched = 0;
  let failed = 0;
  for (const t of tickers) {
    try {
      const n = await rerankDarkPool(t);
      touched += n;
    } catch (err) {
      failed++;
      console.error(`rerank ${t} failed:`, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`done — ${touched} rows updated, ${failed} tickers failed`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
