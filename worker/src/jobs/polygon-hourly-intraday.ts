// jobs/polygon-hourly-intraday.ts — hourly Mon-Fri 10:00-17:00 ET.
//
// For each of the 229 tracked tickers, hits Polygon REST
// /v3/trades/{ticker}?timestamp.gte=<cursor> to fetch trades since the last
// successful insert. Applies the same threshold + dedup as the daily job.
//
// Cursor: max(executed_at) of existing polygon rows per ticker. Self-healing
// — if a poll fails the next one picks up wherever the last successful insert
// landed. skipDuplicates handles overlap from the >= boundary.
//
// Required env: POLYGON_API_KEY
//
// Polygon data is 15-min delayed at the Starter ($79) tier, so even a
// "real-time" trade is at minimum 15 min behind the wall clock. Combined
// with hourly polling, max delay between actual trade and DB row is ~75 min.

import { prisma } from "../lib/prisma.js";
import { rerankDarkPool } from "../lib/rerank-darkpool.js";
import { fetchTradesSince } from "../lib/polygon-rest.js";
import { filterAndMap, TICKER_SET } from "../lib/polygon-trade-filter.js";

const ts = () => new Date().toISOString();

const CONCURRENCY = 8;
// If a ticker has no rows yet, start from this lookback (1 day) rather than
// pulling years of history. The daily flat-file job owns the historical
// backfill; the hourly job only catches new trades.
const COLD_START_LOOKBACK_NS = 24n * 60n * 60n * 1_000_000_000n;

export async function pollPolygonIntraday(): Promise<void> {
  if (!process.env.POLYGON_API_KEY) {
    console.warn(`[polygon-hourly] ${ts()} missing POLYGON_API_KEY — skipping`);
    return;
  }

  const tickers = Array.from(TICKER_SET);
  console.log(`[polygon-hourly] ${ts()} polling ${tickers.length} tickers (concurrency=${CONCURRENCY})`);
  const t0 = Date.now();

  let totalInserted = 0;
  let totalSurvivors = 0;
  let totalRaw = 0;
  let totalErrored = 0;
  const dirtyTickers: string[] = [];

  // Simple semaphore: chunk tickers and run each chunk in parallel.
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(pollOneTicker));
    for (let j = 0; j < results.length; j++) {
      const r = results[j]!;
      const t = chunk[j]!;
      if (r.status === "rejected") {
        totalErrored++;
        console.error(`[polygon-hourly] ${t}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        continue;
      }
      totalRaw += r.value.rawCount;
      totalSurvivors += r.value.afterDedup;
      totalInserted += r.value.inserted;
      if (r.value.inserted > 0) dirtyTickers.push(t);
    }
  }

  console.log(
    `[polygon-hourly] ${ts()} fetched raw=${totalRaw}, survivors=${totalSurvivors}, inserted=${totalInserted}, errored=${totalErrored} in ${(Date.now() - t0) / 1000}s`,
  );

  // Rerank only tickers that gained rows. For a typical hourly poll most
  // tickers see zero new qualifying trades, so this loop is small.
  let reranked = 0;
  let rowsTouched = 0;
  for (const ticker of dirtyTickers) {
    try {
      const n = await rerankDarkPool(ticker);
      reranked++;
      rowsTouched += n;
    } catch (err) {
      console.error(`[polygon-hourly] rerank ${ticker} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (reranked > 0) {
    console.log(`[polygon-hourly] ${ts()} reranked ${reranked} tickers (${rowsTouched} rows updated)`);
  }
}

interface PerTickerResult {
  rawCount: number;
  afterDedup: number;
  inserted: number;
}

async function pollOneTicker(ticker: string): Promise<PerTickerResult> {
  const cursor = await getCursor(ticker);
  const survivors = [];
  let raw = 0;
  for await (const row of fetchTradesSince(ticker, cursor)) {
    raw++;
    survivors.push(row);
  }

  if (raw === 0) return { rawCount: 0, afterDedup: 0, inserted: 0 };

  const { records, stats } = filterAndMap(survivors);
  if (records.length === 0) {
    return { rawCount: raw, afterDedup: 0, inserted: 0 };
  }
  const res = await prisma.darkPoolPrint.createMany({
    data: records,
    skipDuplicates: true,
  });
  return { rawCount: stats.rawCount, afterDedup: stats.afterDedup, inserted: res.count };
}

/**
 * Returns the cursor (sip_timestamp ns) to query Polygon from. Uses the most
 * recent polygon row's executed_at as a baseline. Falls back to a 1-day
 * lookback for cold tickers (no rows yet).
 *
 * Note: executed_at is the millisecond-truncated form of sip_timestamp, so
 * we lose sub-ms precision. We multiply ms → ns and trust skipDuplicates to
 * handle the boundary row.
 */
async function getCursor(ticker: string): Promise<bigint> {
  const row = await prisma.darkPoolPrint.findFirst({
    where: { ticker, uwId: { startsWith: "polygon:" } },
    orderBy: { executedAt: "desc" },
    select: { executedAt: true },
  });
  if (row) {
    return BigInt(row.executedAt.getTime()) * 1_000_000n;
  }
  // Cold ticker: only look at the last 24h. Daily flat-file owns deeper history.
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  return nowNs - COLD_START_LOOKBACK_NS;
}
