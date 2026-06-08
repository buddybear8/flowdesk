// jobs/flow-sentiment.ts — Options Sentiment polling job.
//
// Powers the /flow-sentiment module (per-strike call/put buy-vs-sell bars +
// intraday replay slider). Polls UW:
//   • /api/stock/{ticker}/flow-per-strike?date=YYYY-MM-DD
//     → whole-day CUMULATIVE per-strike totals for the FULL chain, split by
//       aggressor side (ask = bought, bid = sold).
//
// Each poll appends one cumulative snapshot to flow_sentiment_days.minutes for
// (ticker, tradingDate). The replay slider scrubs those snapshots, so its time
// resolution equals the poll cadence (hot tickers 5m, tail hourly).
//
// We deliberately use /flow-per-strike (full chain) rather than
// /flow-per-strike-intraday (top-N strikes only, no count param) so the chart
// shows the same ~20-40 strike chain at every slider position.
//
// Quota: UW enforces both a daily cap (x-uw-token-req-limit) and a per-minute
// window (x-uw-req-per-minute-remaining). This job is one of several UW
// consumers, so it watches both headers and short-circuits the rest of a sweep
// when headroom runs low (the worker exhausted the daily quota on 2026-05-20).

import { prisma } from "../lib/prisma.js";

export { disconnectPrisma } from "../lib/prisma.js";

const UW_BASE = "https://api.unusualwhales.com";

const uwHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${process.env.UW_API_TOKEN ?? ""}`,
  "UW-CLIENT-API-ID": "100001",
  Accept: "application/json",
});

const FETCH_TIMEOUT_MS = 15_000;
const ts = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Stop a sweep early once we're this close to either UW limit, leaving headroom
// for the other UW consumers (flow / gex / market-tide).
const MIN_DAILY_HEADROOM = 500;
const MIN_MINUTE_HEADROOM = 8;

// Strikes within this fraction of the reference price are kept; deep-OTM / LEAP
// strikes UW returns for the full chain are dropped. The frontend toggles down
// further. Mirrors the GEX route's ±10% band, slightly wider for headroom.
const STRIKE_BAND = 0.12;
const MAX_STRIKES = 60;

interface UwStrikeRow {
  strike: string | number;
  call_volume?: number;
  put_volume?: number;
  call_volume_ask_side?: number;
  call_volume_bid_side?: number;
  put_volume_ask_side?: number;
  put_volume_bid_side?: number;
  call_premium_ask_side?: string | number;
  call_premium_bid_side?: string | number;
  put_premium_ask_side?: string | number;
  put_premium_bid_side?: string | number;
}

interface SentimentStrike {
  k: number;
  cA: number;
  cB: number;
  pA: number;
  pB: number;
  cP: number;
  pP: number;
}

interface SentimentMinute {
  t: string;
  callVol: number;
  putVol: number;
  cpRatio: number;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  strikes: SentimentStrike[];
}

interface UwQuota {
  dailyRemaining: number | null;
  minuteRemaining: number | null;
}

// Fetch the full chain plus the quota headers in one shot.
async function fetchChain(
  ticker: string,
  date: string,
): Promise<{ rows: UwStrikeRow[]; quota: UwQuota } | null> {
  if (!process.env.UW_API_TOKEN) {
    console.error("[flow-sentiment] UW_API_TOKEN not set — skipping");
    return null;
  }
  const path = `/api/stock/${ticker}/flow-per-strike?date=${date}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${UW_BASE}${path}`, {
      headers: uwHeaders(),
      signal: controller.signal,
    });
    const quota = readQuota(res);
    if (!res.ok) {
      console.error(`[flow-sentiment:${ticker}] HTTP ${res.status} ${res.statusText}`);
      return { rows: [], quota };
    }
    const json: unknown = await res.json();
    const rows = Array.isArray(json)
      ? (json as UwStrikeRow[])
      : Array.isArray((json as { data?: unknown })?.data)
        ? ((json as { data: UwStrikeRow[] }).data)
        : [];
    return { rows, quota };
  } catch (err) {
    console.error(`[flow-sentiment:${ticker}] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readQuota(res: Response): UwQuota {
  const limit = Number(res.headers.get("x-uw-token-req-limit"));
  const used = Number(res.headers.get("x-uw-daily-req-count"));
  const minuteRemaining = Number(res.headers.get("x-uw-req-per-minute-remaining"));
  return {
    dailyRemaining: Number.isFinite(limit) && Number.isFinite(used) ? limit - used : null,
    minuteRemaining: Number.isFinite(minuteRemaining) ? minuteRemaining : null,
  };
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

// ── ET date/time helpers ─────────────────────────────────────────────────────

// "YYYY-MM-DD" for the current ET session date.
function etDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// "HH:MM" ET, 24-hour.
function etHHMM(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = p.find((x) => x.type === "hour")?.value ?? "00";
  const m = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${h === "24" ? "00" : h}:${m}`;
}

// @db.Date column — store the ET session day at UTC midnight to avoid TZ drift.
function tradingDateValue(etDate: string): Date {
  return new Date(`${etDate}T00:00:00.000Z`);
}

// ── Reference price ──────────────────────────────────────────────────────────
//
// Used to center the strike band and draw the spot line. No extra UW call:
//   1) latest gex_snapshots.spot (present for the hot/GEX tickers), else
//   2) latest candle_bars.close, else
//   3) volume-weighted average strike from the chain itself.
async function referencePrice(ticker: string, strikes: SentimentStrike[]): Promise<number> {
  const gex = await prisma.gexSnapshot.findFirst({
    where: { ticker },
    orderBy: { capturedAt: "desc" },
    select: { spot: true },
  });
  if (gex?.spot) return Number(gex.spot);

  const candle = await prisma.candleBar.findFirst({
    where: { ticker },
    orderBy: { barTime: "desc" },
    select: { close: true },
  });
  if (candle?.close) return Number(candle.close);

  let wSum = 0;
  let vSum = 0;
  for (const s of strikes) {
    const v = s.cA + s.cB + s.pA + s.pB;
    wSum += s.k * v;
    vSum += v;
  }
  return vSum > 0 ? wSum / vSum : 0;
}

// ── Transform ────────────────────────────────────────────────────────────────

function mapStrikes(rows: UwStrikeRow[]): SentimentStrike[] {
  return rows
    .map((r) => ({
      k: num(r.strike),
      cA: num(r.call_volume_ask_side),
      cB: num(r.call_volume_bid_side),
      pA: num(r.put_volume_ask_side),
      pB: num(r.put_volume_bid_side),
      // Net premium per strike: ask-side (buying) minus bid-side (selling).
      cP: num(r.call_premium_ask_side) - num(r.call_premium_bid_side),
      pP: num(r.put_premium_ask_side) - num(r.put_premium_bid_side),
    }))
    .filter((s) => s.k > 0);
}

// Keep strikes within STRIKE_BAND of ref, then the MAX_STRIKES nearest, sorted
// ascending by strike.
function trimToBand(strikes: SentimentStrike[], ref: number): SentimentStrike[] {
  const band = ref > 0 ? strikes.filter((s) => Math.abs(s.k - ref) <= ref * STRIKE_BAND) : strikes;
  const pool = band.length ? band : strikes;
  return [...pool]
    .sort((a, b) => Math.abs(a.k - ref) - Math.abs(b.k - ref))
    .slice(0, MAX_STRIKES)
    .sort((a, b) => a.k - b.k);
}

function buildMinute(t: string, strikes: SentimentStrike[]): SentimentMinute {
  let callVol = 0;
  let putVol = 0;
  let netCallPrem = 0;
  let netPutPrem = 0;
  let absPrem = 0;
  for (const s of strikes) {
    callVol += s.cA + s.cB;
    putVol += s.pA + s.pB;
    netCallPrem += s.cP;
    netPutPrem += s.pP;
    absPrem += Math.abs(s.cP) + Math.abs(s.pP);
  }
  // Net directional premium: net call buying minus net put buying. Calls bought
  // / puts sold = bullish; puts bought / calls sold = bearish. C/P ratio alone
  // is insufficient (the screenshot stays "Bearish" across C/P 0.80–1.20).
  const net = netCallPrem - netPutPrem;
  const sentiment: SentimentMinute["sentiment"] =
    absPrem > 0 && Math.abs(net) < 0.1 * absPrem
      ? "NEUTRAL"
      : net >= 0
        ? "BULLISH"
        : "BEARISH";
  return {
    t,
    callVol,
    putVol,
    cpRatio: putVol > 0 ? callVol / putVol : 0,
    sentiment,
    strikes,
  };
}

// Append (or replace, if the same HH:MM already landed) one snapshot into the
// day's minutes array and upsert the row.
async function appendSnapshot(
  ticker: string,
  etDate: string,
  spot: number,
  minute: SentimentMinute,
): Promise<void> {
  const tradingDate = tradingDateValue(etDate);
  const existing = await prisma.flowSentimentDay.findUnique({
    where: { ticker_tradingDate: { ticker, tradingDate } },
    select: { minutes: true },
  });
  const prior = (existing?.minutes as unknown as SentimentMinute[] | null) ?? [];
  const merged = [...prior.filter((m) => m.t !== minute.t), minute].sort((a, b) =>
    a.t < b.t ? -1 : a.t > b.t ? 1 : 0,
  );
  const now = new Date();
  await prisma.flowSentimentDay.upsert({
    where: { ticker_tradingDate: { ticker, tradingDate } },
    create: { ticker, tradingDate, capturedAt: now, spot, minutes: merged as unknown as object },
    update: { capturedAt: now, spot, minutes: merged as unknown as object },
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function pollFlowSentiment(tickers: readonly string[]): Promise<void> {
  const etDate = etDateString();
  const t = etHHMM();
  let stored = 0;
  let skipped = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i]!;
    const result = await fetchChain(ticker, etDate);
    if (!result) {
      skipped++;
      continue;
    }

    const { rows, quota } = result;
    if (rows.length > 0) {
      const allStrikes = mapStrikes(rows);
      const refFromVol = await referencePrice(ticker, allStrikes);
      const strikes = trimToBand(allStrikes, refFromVol);
      const minute = buildMinute(t, strikes);
      try {
        await appendSnapshot(ticker, etDate, refFromVol, minute);
        stored++;
      } catch (err) {
        console.error(`[flow-sentiment:${ticker}] store failed:`, err instanceof Error ? err.message : err);
      }
    }

    // Quota guard — bail out of the rest of the sweep before tripping a limit.
    if (quota.dailyRemaining != null && quota.dailyRemaining < MIN_DAILY_HEADROOM) {
      console.warn(`[flow-sentiment] ${ts()} daily headroom ${quota.dailyRemaining} < ${MIN_DAILY_HEADROOM} — aborting sweep after ${i + 1}/${tickers.length}`);
      break;
    }
    if (quota.minuteRemaining != null && quota.minuteRemaining < MIN_MINUTE_HEADROOM) {
      // Per-minute window nearly empty — pause until it resets (~60s) rather than abort.
      await sleep(60_000);
    } else if (i < tickers.length - 1) {
      // Spread calls (~1/sec) so a 200-ticker tail sweep never bursts the
      // per-minute window.
      await sleep(1_000);
    }
  }

  console.log(`[flow-sentiment] ${ts()} stored ${stored}, skipped ${skipped} of ${tickers.length} (${etDate} ${t} ET)`);
}
