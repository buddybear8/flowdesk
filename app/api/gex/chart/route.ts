// GET /api/gex/chart?ticker=SPY&tf=1m|5m|10m|1h — candles + GEX node series
// for the GEX Chart tab (nodes-on-price-chart view).
//
// Candles: candle_bars "1m" rows (Polygon delayed stream for equities/ETFs;
// GEX-spot pseudo-candles for SPX/VIX), aggregated server-side to 5m/10m.
// 1h uses the existing "1H" rows (longer history). 1m/5m/10m return the last
// 3 trading days' worth of rows.
//
// Nodes: gex_node_days buckets for the same span (per-bucket top strikes by
// |net GEX|, front expiry + all-expiry scopes), plus walls/flip and a live
// spot tail (bridges the 15-min candle delay with true-now GEX spot samples).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { WATCHED_GEX_TICKERS } from "@/lib/gex-tickers";

const TF = { "1m": 1, "5m": 5, "10m": 10, "1h": 60 } as const;
type Tf = keyof typeof TF;

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

function aggregate(bars: Candle[], minutes: number): Candle[] {
  if (minutes === 1) return bars;
  const out: Candle[] = [];
  const ms = minutes * 60_000;
  let cur: Candle | null = null;
  for (const b of bars) {
    const bucket = Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") ?? "SPY").toUpperCase();
  const tf = (sp.get("tf") ?? "5m") as Tf;
  if (!WATCHED_GEX_TICKERS.has(ticker)) {
    return NextResponse.json({ error: "unknown ticker" }, { status: 400 });
  }
  if (!(tf in TF)) {
    return NextResponse.json({ error: "tf must be 1m|5m|10m|1h" }, { status: 400 });
  }

  const now = Date.now();
  const since = new Date(now - (tf === "1h" ? 30 : 5) * 24 * 3600 * 1000);
  const timeframe = tf === "1h" ? "1H" : "1m";

  const rows = await prisma.candleBar.findMany({
    where: { ticker, timeframe, barTime: { gte: since } },
    orderBy: { barTime: "asc" },
    select: { barTime: true, open: true, high: true, low: true, close: true, volume: true },
  });
  const raw: Candle[] = rows.map((r) => ({
    t: r.barTime.getTime(),
    o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close),
    v: Number(r.volume),
  }));
  const candles = tf === "1h" ? raw : aggregate(raw, TF[tf]);

  // Node buckets for the covered days
  const sinceDate = new Date(since.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const nodeDays = await prisma.gexNodeDay.findMany({
    where: { ticker, tradingDate: { gte: sinceDate } },
    orderBy: { tradingDate: "asc" },
    select: { tradingDate: true, buckets: true },
  });

  // Live spot tail: GEX snapshot spots newer than the last candle (true-now
  // segment past the 15-min Polygon delay). 1-min resolution on turbo tickers.
  const lastCandleT = candles.length ? candles[candles.length - 1].t : now - 3600_000;
  const spotRows = await prisma.gexSnapshot.findMany({
    where: { ticker, capturedAt: { gt: new Date(lastCandleT) } },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, spot: true },
  });
  const liveSpot = spotRows
    .map((r) => ({ t: r.capturedAt.getTime(), p: Number(r.spot) }))
    .filter((r) => Number.isFinite(r.p) && r.p > 0);

  return NextResponse.json(
    {
      ticker, tf, candles,
      nodeDays: nodeDays.map((d) => ({ date: d.tradingDate.toISOString().slice(0, 10), buckets: d.buckets })),
      liveSpot,
      asOf: now,
    },
    { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } },
  );
}
