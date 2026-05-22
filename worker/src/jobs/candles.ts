// worker/src/jobs/candles.ts — pollCandles.
//
// Keeps candle_bars fresh for the /charts price chart. Each run, for every
// chartable ticker × timeframe:
//   • first run (no rows) → backfill the full history window (bulk insert)
//   • subsequent runs     → re-fetch from one bar before the latest stored
//                           bar and upsert (the forming bar's OHLC changes
//                           run-to-run, so createMany+skipDuplicates would
//                           never update it)
//
// Cron: every minute during 08:00–20:59 ET Mon–Fri (pre-market through
// after-hours — the window where bars actually move; off-hours the bars are
// frozen). An in-flight guard skips a tick if the previous run is still
// going — the first-run backfill across 10 tickers × 3 timeframes can exceed
// 60s.
//
// This is the SOLE Polygon caller for chart data — the Vercel /api/candles
// route reads candle_bars from Postgres, never Polygon directly.

import { prisma } from "../lib/prisma.js";
import { fetchAggs, TF_CONFIG, TIMEFRAMES } from "../lib/polygon-aggs.js";
import type { Timeframe } from "../lib/polygon-aggs.js";
import { TICKER_SET } from "../lib/polygon-trade-filter.js";

const ts = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Chartable tickers — the full tracked-ticker corpus (~229; the same universe
// dark_pool_prints covers). Sourced from TICKER_SET so it stays in sync with
// the dark-pool threshold list. It's equities/ETFs only — every entry is a
// valid Polygon Stocks-tier ticker.
export const CHART_TICKERS: string[] = [...TICKER_SET].sort();

const INTER_CALL_MS = 150; // polite spacing between Polygon calls

let inFlight = false;

export async function pollCandles(): Promise<void> {
  if (inFlight) {
    console.warn(`[candles] ${ts()} previous run still in progress — skipping tick`);
    return;
  }
  inFlight = true;
  const t0 = Date.now();
  let ok = 0;
  let bars = 0;
  let failures = 0;
  try {
    for (const ticker of CHART_TICKERS) {
      for (const tf of TIMEFRAMES) {
        try {
          bars += await refreshOne(ticker, tf);
          ok++;
        } catch (err) {
          failures++;
          console.error(
            `[candles] ${ticker} ${tf} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
        await sleep(INTER_CALL_MS);
      }
    }
    console.log(
      `[candles] ${ts()} ${ok}/${CHART_TICKERS.length * TIMEFRAMES.length} ok, ` +
        `${bars} bars written, ${failures} failures, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  } finally {
    inFlight = false;
  }
}

async function refreshOne(ticker: string, tf: Timeframe): Promise<number> {
  const cfg = TF_CONFIG[tf];
  const to = new Date();

  const latest = await prisma.candleBar.findFirst({
    where: { ticker, timeframe: tf },
    orderBy: { barTime: "desc" },
    select: { barTime: true },
  });

  if (!latest) {
    // First run for this ticker×tf — backfill history with a bulk insert.
    const from = new Date(to.getTime() - cfg.backfillDays * 86_400_000);
    const fetched = await fetchAggs(ticker, tf, from, to);
    if (fetched.length === 0) return 0;
    const res = await prisma.candleBar.createMany({
      data: fetched.map((b) => ({
        ticker,
        timeframe: tf,
        barTime: b.barTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: BigInt(b.volume),
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  // Tail refresh — re-fetch from one bar before the latest stored bar so the
  // forming bar gets fresh OHLC and any genuinely new bars are inserted.
  // Typically 1–2 bars; a real upsert because the forming bar mutates.
  const from = new Date(latest.barTime.getTime() - cfg.intervalMs);
  const fetched = await fetchAggs(ticker, tf, from, to);
  let count = 0;
  for (const b of fetched) {
    await prisma.candleBar.upsert({
      where: {
        ticker_timeframe_barTime: { ticker, timeframe: tf, barTime: b.barTime },
      },
      create: {
        ticker,
        timeframe: tf,
        barTime: b.barTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: BigInt(b.volume),
      },
      update: {
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: BigInt(b.volume),
      },
    });
    count++;
  }
  return count;
}
