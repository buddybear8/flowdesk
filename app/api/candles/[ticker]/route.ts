import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeframe, type Candle, type CandlesResult } from "@/lib/candles";

// Price-chart candles route. Reads candle_bars from Postgres — the worker's
// pollCandles job is the sole Polygon caller; this route never touches
// Polygon. Auth is enforced upstream by proxy.ts (all /api/* paths 401
// without a session).
//
// GET /api/candles/{ticker}?tf=1W|1D|1H

// Light path-safety check — letters + optional dots (e.g. BRK.B), max 8.
const TICKER_RE = /^[A-Z][A-Z.]{0,7}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const ticker = (rawTicker ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const tf = new URL(req.url).searchParams.get("tf") ?? "1D";
  if (!isTimeframe(tf)) {
    return NextResponse.json(
      { error: "Invalid timeframe — use 1W, 1D, or 1H" },
      { status: 400 },
    );
  }

  const since52w = new Date(Date.now() - 52 * 7 * 86_400_000);
  const [rows, agg] = await Promise.all([
    prisma.candleBar.findMany({
      where: { ticker, timeframe: tf },
      orderBy: { barTime: "asc" },
      select: { barTime: true, open: true, high: true, low: true, close: true, volume: true },
    }),
    // 52-week high — always from the 1D series so it's stable across the
    // displayed timeframe (the 1H series only spans ~60 days).
    prisma.candleBar.aggregate({
      where: { ticker, timeframe: "1D", barTime: { gte: since52w } },
      _max: { high: true },
    }),
  ]);

  const candles: Candle[] = rows.map((r) => ({
    time: Math.floor(r.barTime.getTime() / 1000),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }));

  const payload: CandlesResult = {
    ticker,
    timeframe: tf,
    candles,
    stats: { high52w: agg._max.high != null ? Number(agg._max.high) : null },
  };
  return NextResponse.json(payload, {
    headers: {
      // candle_bars is refreshed by the worker ~once/min; a 30s edge cache
      // collapses concurrent viewers onto one DB read per ticker+tf.
      "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
    },
  });
}
