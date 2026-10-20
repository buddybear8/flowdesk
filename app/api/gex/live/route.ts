// GET /api/gex/live?ticker=SPY — live forming-bar feed for the GEX Chart.
//
// Primary source: the worker's in-memory per-second stream endpoint (Railway
// domain; forming 1m OHLCV + recent completed ring). Fallback when that's
// unreachable (e.g. the 2026-10-20 Railway build outage): Polygon's REST
// snapshot — its lastTrade price ticks second-by-second on the delayed feed,
// and the client accumulates it into the forming bar.
//
// Polled at 1s per open chart; no-store. Prices are 15-min delayed either way.

import { NextRequest, NextResponse } from "next/server";
import { WATCHED_GEX_TICKERS } from "@/lib/gex-tickers";

const WORKER_LIVE = process.env.GEX_LIVE_WORKER_URL ?? "https://flowdesk-production-2bb8.up.railway.app";

type LiveBar = { t: number; o: number; h: number; l: number; c: number; v: number };

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "").toUpperCase();
  if (!WATCHED_GEX_TICKERS.has(ticker)) {
    return NextResponse.json({ error: "unknown ticker" }, { status: 400 });
  }
  const headers = { "Cache-Control": "no-store" };

  // 1) worker stream (true per-second forming OHLCV)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 900);
    const r = await fetch(`${WORKER_LIVE}/live?ticker=${ticker}`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (r.ok) {
      const j = (await r.json()) as { forming: LiveBar | null; recent: LiveBar[] };
      if (j.forming || (j.recent?.length ?? 0) > 0) {
        return NextResponse.json({ src: "worker", forming: j.forming, recent: j.recent ?? [], last: null }, { headers });
      }
    }
  } catch { /* fall through to snapshot */ }

  // 2) Polygon snapshot fallback (equities only — SPX/VIX have no stock snapshot)
  const key = process.env.POLYGON_API_KEY;
  if (!key || ticker === "SPX" || ticker === "VIX") {
    return NextResponse.json({ src: "none", forming: null, recent: [], last: null }, { headers });
  }
  try {
    const r = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${key}`,
      { cache: "no-store" },
    );
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as {
      ticker?: { min?: { t: number; o: number; h: number; l: number; c: number; v: number }; lastTrade?: { p: number; t: number } };
    };
    const min = j.ticker?.min;
    const lt = j.ticker?.lastTrade;
    return NextResponse.json({
      src: "snap",
      forming: null,
      recent: min?.t ? [{ t: min.t, o: min.o, h: min.h, l: min.l, c: min.c, v: min.v }] : [],
      last: lt?.p ? { p: lt.p, t: Math.floor((lt.t ?? 0) / 1e6) || Date.now() - 15 * 60_000 } : null,
    }, { headers });
  } catch {
    return NextResponse.json({ src: "none", forming: null, recent: [], last: null }, { headers });
  }
}
