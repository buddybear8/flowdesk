// jobs/polygon-stream.ts — live minute-bar ingestion over Polygon's DELAYED
// websocket cluster (included in our plan; each bar arrives ~15 min after it
// forms). Subscribes to AM.<ticker> (completed minute aggregates) for the GEX
// equity/ETF universe and upserts rows into candle_bars timeframe "1m".
//
// Powers the GEX Chart tab (1m/5m/10m aggregated server-side in the API).
// Index tickers (SPX, VIX) have no Polygon stocks feed — their 1m pseudo-
// candles come from GEX snapshot spot via appendIndexPseudoCandles below.
//
// Lifecycle: startPolygonStream() is called once at worker boot; it holds one
// connection, resubscribes on reconnect (exp backoff), and only connects
// during extended trading hours ET to avoid idling overnight.

import { WebSocket as WsWebSocket } from "ws";
import { prisma } from "../lib/prisma.js";
import { WATCHED_TICKERS } from "../lib/watched-tickers.js";

const ts = () => new Date().toISOString();

// node:20-alpine (the worker image) has no global WebSocket — use ws there,
// the native implementation where it exists (local dev on newer Node).
const WSImpl: typeof WsWebSocket =
  (globalThis as unknown as { WebSocket?: typeof WsWebSocket }).WebSocket ?? WsWebSocket;

const INDEX_TICKERS = new Set(["SPX", "VIX"]);
const STREAM_TICKERS = WATCHED_TICKERS.filter((t) => !INDEX_TICKERS.has(t));

let ws: WsWebSocket | null = null;
let reconnectDelay = 2_000;
let stopped = false;
let barsSinceLog = 0;

function etHourMin(): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  const h = g("hour") === 24 ? 0 : g("hour");
  return h * 100 + g("minute");
}
function etDow(): number {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d);
}
// Stream window: weekdays 09:10–16:25 ET. Bars are 15-min delayed, so this
// captures 08:55–16:10 bar times — full RTH plus a little slack.
function inStreamWindow(): boolean {
  const dow = etDow();
  if (dow === 0 || dow === 6) return false;
  const hm = etHourMin();
  return hm >= 910 && hm <= 1625;
}

interface AmBar {
  ev: string; sym: string;
  o: number; h: number; l: number; c: number; v: number;
  s: number; // bar start epoch ms
}

// ─── Live forming bars (per-second A.* channel) ─────────────────────────────
// In-memory only: the forming 1m bar per ticker, built from per-second
// aggregates as they stream, plus a short ring of completed 1m bars (so the
// live HTTP endpoint can hand clients the current TF bucket without a DB
// round-trip). Served by lib/live-server.ts; never persisted per-second.

export interface LiveBar { t: number; o: number; h: number; l: number; c: number; v: number }

const forming = new Map<string, LiveBar>();
const recentDone = new Map<string, LiveBar[]>(); // last RECENT_KEEP completed 1m bars
const RECENT_KEEP = 15;
let lastSecondAt = 0;

export function liveSnapshot(ticker: string): { forming: LiveBar | null; recent: LiveBar[]; lastEventAt: number } {
  return {
    forming: forming.get(ticker) ?? null,
    recent: recentDone.get(ticker) ?? [],
    lastEventAt: lastSecondAt,
  };
}

function onSecondBar(m: AmBar): void {
  lastSecondAt = Date.now();
  const minuteStart = Math.floor(m.s / 60_000) * 60_000;
  const cur = forming.get(m.sym);
  if (!cur || cur.t !== minuteStart) {
    forming.set(m.sym, { t: minuteStart, o: m.o, h: m.h, l: m.l, c: m.c, v: m.v });
  } else {
    cur.h = Math.max(cur.h, m.h);
    cur.l = Math.min(cur.l, m.l);
    cur.c = m.c;
    cur.v += m.v;
  }
}

function onMinuteDone(m: AmBar): void {
  const bar: LiveBar = { t: m.s, o: m.o, h: m.h, l: m.l, c: m.c, v: m.v };
  const ring = recentDone.get(m.sym) ?? [];
  if (ring.length && ring[ring.length - 1].t === bar.t) ring[ring.length - 1] = bar;
  else ring.push(bar);
  while (ring.length > RECENT_KEEP) ring.shift();
  recentDone.set(m.sym, ring);
  // drop the forming bar for that minute — it's finalized now
  const f = forming.get(m.sym);
  if (f && f.t <= bar.t) forming.delete(m.sym);
}

async function storeBar(b: AmBar): Promise<void> {
  const barTime = new Date(b.s);
  await prisma.candleBar.upsert({
    where: { ticker_timeframe_barTime: { ticker: b.sym, timeframe: "1m", barTime } },
    update: { open: b.o, high: b.h, low: b.l, close: b.c, volume: BigInt(Math.trunc(b.v)) },
    create: {
      ticker: b.sym, timeframe: "1m", barTime,
      open: b.o, high: b.h, low: b.l, close: b.c, volume: BigInt(Math.trunc(b.v)),
    },
  });
}

function connect(): void {
  if (stopped) return;
  ws = new WSImpl("wss://delayed.polygon.io/stocks");

  ws.onopen = () => {
    ws?.send(JSON.stringify({ action: "auth", params: process.env.POLYGON_API_KEY }));
  };

  ws.onmessage = (ev) => {
    let msgs: any[];
    try { msgs = JSON.parse(String(ev.data)); } catch { return; }
    for (const m of msgs) {
      if (m.ev === "status") {
        if (m.status === "auth_success") {
          reconnectDelay = 2_000;
          // AM = completed minute bars (persisted); A = per-second aggregates
          // (in-memory forming bar for the live endpoint).
          const params = STREAM_TICKERS.flatMap((t) => [`AM.${t}`, `A.${t}`]).join(",");
          ws?.send(JSON.stringify({ action: "subscribe", params }));
          console.log(`[poly-stream] ${ts()} authenticated — subscribing ${STREAM_TICKERS.length} tickers (AM+A)`);
        } else if (m.status === "auth_failed") {
          console.error(`[poly-stream] ${ts()} auth failed: ${m.message}`);
        }
      } else if (m.ev === "A") {
        onSecondBar(m as AmBar);
      } else if (m.ev === "AM") {
        onMinuteDone(m as AmBar);
        storeBar(m as AmBar).then(() => {
          barsSinceLog++;
        }).catch((e) => console.error(`[poly-stream] ${ts()} upsert failed ${m.sym}: ${String(e).slice(0, 120)}`));
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    if (stopped) return;
    setTimeout(() => { if (inStreamWindow()) connect(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  };
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

// Called once at boot. A 1-min supervisor opens the socket inside the stream
// window and closes it outside (Polygon idles out silent connections anyway).
export function startPolygonStream(): void {
  if (!process.env.POLYGON_API_KEY) {
    console.log(`[poly-stream] ${ts()} POLYGON_API_KEY unset — stream disabled`);
    return;
  }
  setInterval(() => {
    const want = inStreamWindow();
    if (want && !ws) connect();
    if (!want && ws) { try { ws.close(); } catch { /* noop */ } ws = null; }
    if (barsSinceLog > 0) {
      console.log(`[poly-stream] ${ts()} stored ${barsSinceLog} 1m bars in last minute`);
      barsSinceLog = 0;
    }
  }, 60_000);
  if (inStreamWindow()) connect();
  console.log(`[poly-stream] ${ts()} supervisor started (${STREAM_TICKERS.length} tickers, delayed cluster)`);
}

// ─── Index pseudo-candles (SPX, VIX) ─────────────────────────────────────────
// No Polygon stocks feed for index symbols: build 1m bars from the spot price
// carried on gex_snapshots (SPX turbo = 1-min true resolution; VIX extended =
// 10-min, so its bars are sparse). Cron: every minute during RTH.
export async function appendIndexPseudoCandles(): Promise<void> {
  for (const ticker of INDEX_TICKERS) {
    const snap = await prisma.gexSnapshot.findFirst({
      where: { ticker },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true, spot: true },
    });
    if (!snap) continue;
    const age = Date.now() - snap.capturedAt.getTime();
    if (age > 15 * 60_000) continue; // stale — market closed or pipeline down

    const spot = Number(snap.spot);
    if (!Number.isFinite(spot) || spot <= 0) continue;
    const minute = new Date(Math.floor(snap.capturedAt.getTime() / 60_000) * 60_000);

    const existing = await prisma.candleBar.findUnique({
      where: { ticker_timeframe_barTime: { ticker, timeframe: "1m", barTime: minute } },
      select: { id: true, high: true, low: true },
    });
    if (existing) {
      await prisma.candleBar.update({
        where: { id: existing.id },
        data: {
          close: spot,
          high: Math.max(Number(existing.high), spot),
          low: Math.min(Number(existing.low), spot),
        },
      });
    } else {
      await prisma.candleBar.create({
        data: { ticker, timeframe: "1m", barTime: minute, open: spot, high: spot, low: spot, close: spot, volume: BigInt(0) },
      });
    }
  }
}
