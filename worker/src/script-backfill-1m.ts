// One-off: backfill candle_bars "1m" history so the GEX Chart tab isn't
// empty on launch (the websocket stream only captures bars going forward).
//  - Equities/ETFs: Polygon REST minute aggs, last 5 trading days (1 call per
//    ticker; delayed tier serves full history).
//  - SPX/VIX: synthesize from gex_snapshots spot samples (30-day retention;
//    SPX is 1-min turbo since late Sep, VIX ~10-min).
// Run: DATABASE_URL=... POLYGON_API_KEY=... npx tsx src/script-backfill-1m.ts

import { prisma } from "./lib/prisma.js";
import { WATCHED_TICKERS } from "./lib/watched-tickers.js";

const INDEX_TICKERS = new Set(["SPX", "VIX"]);
const EQUITIES = WATCHED_TICKERS.filter((t) => !INDEX_TICKERS.has(t));
const KEY = process.env.POLYGON_API_KEY;
const DAYS = 5;

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

async function backfillEquity(ticker: string, from: string, to: string): Promise<number> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/minute/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`${ticker}: HTTP ${res.status}`); return 0; }
  const json = (await res.json()) as { results?: { t: number; o: number; h: number; l: number; c: number; v: number }[] };
  const rows = (json.results ?? []).map((r) => ({
    ticker, timeframe: "1m", barTime: new Date(r.t),
    open: r.o, high: r.h, low: r.l, close: r.c, volume: BigInt(Math.trunc(r.v)),
  }));
  if (!rows.length) return 0;
  const out = await prisma.candleBar.createMany({ data: rows, skipDuplicates: true });
  return out.count;
}

async function backfillIndex(ticker: string, since: Date): Promise<number> {
  const snaps = await prisma.gexSnapshot.findMany({
    where: { ticker, capturedAt: { gte: since } },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, spot: true },
  });
  const byMinute = new Map<number, { o: number; h: number; l: number; c: number }>();
  for (const s of snaps) {
    const spot = Number(s.spot);
    if (!Number.isFinite(spot) || spot <= 0) continue;
    const m = Math.floor(s.capturedAt.getTime() / 60_000) * 60_000;
    const cur = byMinute.get(m);
    if (!cur) byMinute.set(m, { o: spot, h: spot, l: spot, c: spot });
    else { cur.h = Math.max(cur.h, spot); cur.l = Math.min(cur.l, spot); cur.c = spot; }
  }
  const rows = [...byMinute.entries()].map(([t, b]) => ({
    ticker, timeframe: "1m", barTime: new Date(t),
    open: b.o, high: b.h, low: b.l, close: b.c, volume: BigInt(0),
  }));
  if (!rows.length) return 0;
  const out = await prisma.candleBar.createMany({ data: rows, skipDuplicates: true });
  return out.count;
}

async function main() {
  const to = iso(new Date());
  const from = iso(new Date(Date.now() - (DAYS + 3) * 24 * 3600 * 1000)); // pad weekends
  let total = 0;
  for (const t of EQUITIES) {
    const n = await backfillEquity(t, from, to);
    total += n;
    console.log(`${t}: +${n}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  for (const t of INDEX_TICKERS) {
    const n = await backfillIndex(t, new Date(Date.now() - (DAYS + 3) * 24 * 3600 * 1000));
    total += n;
    console.log(`${t}: +${n} (spot-derived)`);
  }
  console.log(`backfill complete: ${total} bars`);
  await prisma.$disconnect();
}
main();
