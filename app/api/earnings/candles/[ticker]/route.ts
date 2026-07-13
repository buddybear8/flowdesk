import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Candle, CandlesResult } from "@/lib/candles";

// Daily candles for the Earnings Analyst deep-dive chart. The worker's
// candle_bars only covers the ~230-ticker tracked corpus; index names outside
// it fall back to a direct Polygon daily-aggs fetch (Starter tier, ~6 months).
// The 15-minute edge cache keeps Polygon traffic to one call per ticker per
// window regardless of viewer count.

const TICKER_RE = /^[A-Z][A-Z.]{0,7}$/;
const FALLBACK_DAYS_1D = 190;
const FALLBACK_DAYS_1H = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: raw } = await params;
  const ticker = (raw ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const tf = new URL(req.url).searchParams.get("tf") === "1H" ? "1H" : "1D";

  // Preferred: our own stored bars.
  const rows = await prisma.candleBar.findMany({
    where: { ticker, timeframe: tf },
    orderBy: { barTime: "asc" },
    select: { barTime: true, open: true, high: true, low: true, close: true, volume: true },
  });

  let candles: Candle[] = rows.map((r) => ({
    time: Math.floor(r.barTime.getTime() / 1000),
    open: Number(r.open), high: Number(r.high), low: Number(r.low),
    close: Number(r.close), volume: Number(r.volume),
  }));

  if (candles.length < 30 && process.env.POLYGON_API_KEY) {
    const days = tf === "1H" ? FALLBACK_DAYS_1H : FALLBACK_DAYS_1D;
    const span = tf === "1H" ? "1/hour" : "1/day";
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    try {
      const r = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${span}/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${process.env.POLYGON_API_KEY}`,
        { cache: "no-store" },
      );
      if (r.ok) {
        const j = (await r.json()) as { results?: { t: number; o: number; h: number; l: number; c: number; v: number }[] };
        const bars = j.results ?? [];
        if (bars.length > candles.length) {
          candles = bars.map((b) => ({
            time: Math.floor(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
          }));
        }
      }
    } catch { /* fall through with whatever we have */ }
  }

  const payload: CandlesResult = {
    ticker,
    timeframe: tf,
    candles,
    stats: { high52w: candles.reduce<number | null>((m, c) => (m == null || c.high > m ? c.high : m), null) },
  };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=1800" },
  });
}
