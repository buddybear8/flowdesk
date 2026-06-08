// One-shot smoke for the Options Sentiment job. Runs pollFlowSentiment for a
// couple of tickers, then reads the stored flow_sentiment_days row back and
// prints the latest snapshot so we can eyeball the per-strike buy/sell split.
//
// Run with (UW token + internal DB via Railway):
//   cd worker && railway run -- npx tsx src/smoke-flow-sentiment.ts
// or against the public DB locally:
//   DATABASE_URL=$PUBLIC_DB UW_API_TOKEN=... npx tsx src/smoke-flow-sentiment.ts

import { pollFlowSentiment } from "./jobs/flow-sentiment.js";
import { prisma, disconnectPrisma } from "./lib/prisma.js";

interface Strike { k: number; cA: number; cB: number; pA: number; pB: number }
interface Minute { t: string; callVol: number; putVol: number; cpRatio: number; sentiment: string; strikes: Strike[] }

async function main() {
  const tickers = (process.argv[2] ?? "SPY").split(",").map((t) => t.toUpperCase());
  console.log(`──────── pollFlowSentiment(${tickers.join(", ")}) ────────`);
  await pollFlowSentiment(tickers);

  console.log("\n──────── verify stored rows ────────");
  for (const ticker of tickers) {
    const row = await prisma.flowSentimentDay.findFirst({
      where: { ticker },
      orderBy: { tradingDate: "desc" },
    });
    if (!row) {
      console.warn(`  ${ticker}: NO ROW`);
      continue;
    }
    const minutes = row.minutes as unknown as Minute[];
    const last = minutes[minutes.length - 1];
    console.log(
      `  ${ticker.padEnd(5)} spot=$${Number(row.spot).toFixed(2)} · ${minutes.length} snapshot(s) · ` +
        `latest ${last?.t} → CALL ${last?.callVol} / PUT ${last?.putVol} · C/P ${last?.cpRatio.toFixed(2)} · ${last?.sentiment} · ${last?.strikes.length} strikes`,
    );
    // Show a few near-the-money strikes' buy/sell split.
    if (last) {
      const mid = Math.floor(last.strikes.length / 2);
      for (const s of last.strikes.slice(Math.max(0, mid - 3), mid + 3)) {
        console.log(
          `      $${s.k}  CALLS buy=${s.cA} sell=${s.cB} (r=${s.cB ? (s.cA / s.cB).toFixed(2) : "∞"})   PUTS buy=${s.pA} sell=${s.pB} (r=${s.pB ? (s.pA / s.pB).toFixed(2) : "∞"})`,
        );
      }
    }
  }

  console.log("\n──────── done ────────");
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("smoke-flow-sentiment failed:", err);
  process.exit(1);
});
