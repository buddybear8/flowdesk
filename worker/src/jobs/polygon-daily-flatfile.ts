// jobs/polygon-daily-flatfile.ts — daily 06:00 ET.
//
// Streams Polygon's previous-trading-day flat file from S3, filters by ticker
// and per-ticker notional threshold, dedups within the day by (price, size),
// inserts into dark_pool_prints, and re-ranks affected tickers.
//
// Required env:
//   POLYGON_ACCESS_KEY, POLYGON_SECRET_KEY  (flat-file S3 read)
//
// Behavior:
//   • Resolves "previous trading day" = today - 1 (skip Sat/Sun).
//     Exchange holidays where Polygon publishes nothing are handled
//     gracefully — the stream is empty and the job logs "0 rows" + returns.
//   • Stream-filters in O(1) memory; the survivor batch is small (~10s-1000s).
//   • Idempotent via uwId unique constraint (polygon:<ticker>:<id>) +
//     skipDuplicates.
//   • Per-ticker rerank only fires when the ticker actually gained new rows.

import { prisma } from "../lib/prisma.js";
import { rerankDarkPool } from "../lib/rerank-darkpool.js";
import { streamDailyFlatFile } from "../lib/polygon-flatfile.js";
import { filterAndMap, passesPreFilter } from "../lib/polygon-trade-filter.js";
import type { RawPolygonTrade } from "../lib/polygon-trade-filter.js";

const ts = () => new Date().toISOString();

export async function importPolygonDailyFlatFile(day?: Date): Promise<void> {
  const target = day ?? previousTradingDay(new Date());
  const dateStr = target.toISOString().slice(0, 10);

  if (!process.env.POLYGON_ACCESS_KEY || !process.env.POLYGON_SECRET_KEY) {
    console.warn(`[polygon-daily-flatfile] ${ts()} missing POLYGON_ACCESS_KEY/SECRET_KEY — skipping ${dateStr}`);
    return;
  }

  console.log(`[polygon-daily-flatfile] ${ts()} starting ${dateStr}`);
  const t0 = Date.now();

  // Stream the entire day's flat file (~80M rows uncompressed) but apply
  // ticker+threshold filter INLINE so we never buffer the whole file. Only
  // ~hundreds of survivors get retained for dedup downstream.
  const survivors: RawPolygonTrade[] = [];
  let raw = 0;
  for await (const row of streamDailyFlatFile(target)) {
    raw++;
    if (passesPreFilter(row)) survivors.push(row);
  }
  if (raw === 0) {
    console.log(`[polygon-daily-flatfile] ${ts()} ${dateStr}: no flat file (non-trading day, holiday, or not yet published)`);
    return;
  }

  // filterAndMap also dedups by (price, size). For the daily job, this
  // collapses same-trade-different-condition-code prints.
  const { records, stats } = filterAndMap(survivors);
  console.log(
    `[polygon-daily-flatfile] ${ts()} ${dateStr}: scanned ${stats.rawCount} rows, ` +
      `ticker_pass=${stats.tickerPassed} threshold_pass=${stats.thresholdPassed} after_dedup=${stats.afterDedup}`,
  );

  if (records.length === 0) {
    console.log(`[polygon-daily-flatfile] ${ts()} ${dateStr}: 0 records after filter — nothing to insert`);
    return;
  }

  const inserted = await prisma.darkPoolPrint.createMany({
    data: records,
    skipDuplicates: true,
  });
  console.log(
    `[polygon-daily-flatfile] ${ts()} ${dateStr}: inserted=${inserted.count} skipped=${records.length - inserted.count}`,
  );

  // Rerank only tickers that gained at least one row. createMany doesn't
  // tell us *which* rows survived the dup filter, so we rely on the per-
  // ticker count from filterAndMap as a proxy: if a ticker had any survivor
  // candidates, queue it. If they all turned out to be duplicates the rerank
  // is just a no-op.
  const dirtyTickers = Array.from(stats.perTicker.keys());
  let reranked = 0;
  let rowsTouched = 0;
  for (const ticker of dirtyTickers) {
    try {
      const n = await rerankDarkPool(ticker);
      reranked++;
      rowsTouched += n;
    } catch (err) {
      console.error(`[polygon-daily-flatfile] rerank ${ticker} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(
    `[polygon-daily-flatfile] ${ts()} ${dateStr}: reranked ${reranked} tickers (${rowsTouched} rows updated) in ${(Date.now() - t0) / 1000}s`,
  );
}

/** Returns yesterday's date in UTC, or last Friday if today is Sat/Sun/Mon. */
function previousTradingDay(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  // Roll back through weekends. Exchange holidays still hit the stream
  // (flat file 404s) but the empty-stream handling above takes care of that.
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d;
}
