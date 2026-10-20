// One-off: verify the TS shadow scorer reproduces the python pipeline's
// scores on 2026-10-05..16 (ta_pipeline/data/scratch_oct/crosscheck_cand2.csv).
// Run: DATABASE_URL=... npx tsx src/script-crosscheck-shadow.ts
import { readFileSync } from "node:fs";
import { prisma } from "./lib/prisma.js";
import { pxFeatures, engineer, scoreFrozen } from "./jobs/model-shadow-score.js";

const CSV = "/Users/Stefan/Documents/Coding/Champagne Room Software/flowdesk/ta_pipeline/data/scratch_oct/crosscheck_cand2.csv";

async function main() {
  const lines = readFileSync(CSV, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const iDate = header.indexOf("date"), iTicker = header.indexOf("ticker"), iRank = header.indexOf("rank"), iP = header.indexOf("p");

  let n = 0, maxDiff = 0, bad = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const dateIso = cells[iDate].slice(0, 10);
    const ticker = cells[iTicker];
    const rank = Number(cells[iRank]);
    const pPy = Number(cells[iP]);
    const date = new Date(`${dateIso}T00:00:00.000Z`);

    const idea = await prisma.hitListDaily.findUnique({
      where: { date_rank: { date, rank } },
      select: { ticker: true, price: true, direction: true, atrTargets: true },
    });
    if (!idea || idea.ticker !== ticker) { console.log(`MISS row ${dateIso} #${rank}`); continue; }

    const bars = await prisma.candleBar.findMany({
      where: { ticker, timeframe: "1D", barTime: { lt: date } },
      orderBy: { barTime: "desc" },
      take: 210,
      select: { close: true, high: true, low: true, volume: true },
    });
    bars.reverse();

    const at = (idea.atrTargets ?? {}) as { atrW?: number };
    const price = Number(idea.price);
    const atrW = at.atrW != null ? Number(at.atrW) : null;
    const atrwPct = atrW != null && price > 0 ? atrW / price : NaN;

    const px = pxFeatures(bars.map((b) => ({ close: Number(b.close), high: Number(b.high), low: Number(b.low), volume: Number(b.volume) })), atrW);
    const pTs = px ? scoreFrozen(engineer(px, idea.direction === "UP", atrwPct)) : scoreFrozen({});
    const diff = Math.abs(pTs - pPy);
    maxDiff = Math.max(maxDiff, diff);
    if (diff > 0.005) { bad++; console.log(`DIFF ${dateIso} ${ticker} #${rank}: ts=${pTs.toFixed(4)} py=${pPy.toFixed(4)}`); }
    n++;
  }
  console.log(`checked ${n} rows — max |ts-py| = ${maxDiff.toFixed(6)}, rows >0.005 off: ${bad}`);
  await prisma.$disconnect();
}
main();
