// script-smoke-flatfile.ts — dry-run smoke for polygon-daily-flatfile.
//
// Streams a given day's flat file, runs it through filterAndMap, and prints
// summary stats + sample rows. Does NOT insert or rerank.
//
//   POLYGON_ACCESS_KEY=... POLYGON_SECRET_KEY=... npx tsx src/script-smoke-flatfile.ts 2026-05-04

import { streamDailyFlatFile } from "./lib/polygon-flatfile.js";
import { filterAndMap, passesPreFilter } from "./lib/polygon-trade-filter.js";
import type { RawPolygonTrade } from "./lib/polygon-trade-filter.js";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: tsx src/script-smoke-flatfile.ts <YYYY-MM-DD>");
    process.exit(1);
  }
  const [y, m, d] = arg.split("-").map(Number);
  const day = new Date(Date.UTC(y!, m! - 1, d!));
  console.log(`Streaming ${arg}...`);
  const t0 = Date.now();

  const survivors: RawPolygonTrade[] = [];
  let raw = 0;
  let lastLogged = 0;
  for await (const row of streamDailyFlatFile(day)) {
    raw++;
    if (passesPreFilter(row)) survivors.push(row);
    if (raw - lastLogged >= 5_000_000) {
      console.log(`  ... ${raw.toLocaleString()} rows scanned (survivors=${survivors.length})`);
      lastLogged = raw;
    }
  }
  const elapsedStream = (Date.now() - t0) / 1000;
  console.log(`Streamed ${raw.toLocaleString()} rows in ${elapsedStream.toFixed(1)}s`);
  console.log(`Pre-filter survivors (ticker+threshold pass): ${survivors.length}`);

  const { records, stats } = filterAndMap(survivors);
  console.log(`\nFilter stats:`);
  console.log(`  raw:               ${stats.rawCount}`);
  console.log(`  ticker pass:       ${stats.tickerPassed}`);
  console.log(`  threshold pass:    ${stats.thresholdPassed}`);
  console.log(`  after dedup:       ${stats.afterDedup}`);
  console.log(`  records to insert: ${records.length}`);
  console.log(`  tickers touched:   ${stats.perTicker.size}`);

  // top 5 by notional
  const sorted = [...records].sort((a, b) => Number(b.premium) - Number(a.premium));
  console.log(`\nTop 5 by notional (would be inserted):`);
  for (const r of sorted.slice(0, 5)) {
    console.log(`  ${r.ticker.padEnd(6)} ${r.executedAt.toISOString().slice(0, 19)} price=$${r.price} size=${r.size} notional=$${Number(r.premium).toLocaleString(undefined, { maximumFractionDigits: 2 })} uwId=${r.uwId}`);
  }

  // per-ticker count for the top 5 most prolific tickers
  const perTicker = [...stats.perTicker.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nMost rows per ticker:`);
  for (const [t, n] of perTicker.slice(0, 10)) {
    console.log(`  ${t.padEnd(6)} ${n}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
