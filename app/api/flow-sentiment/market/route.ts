import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { MarketSentimentPayload, MarketSentimentTicker, SentimentMinute } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fixed display sets (order preserved in the UI).
const INDICES = ["SPY", "SPX", "QQQ", "IWM", "DIA"];
const MEGA_CAPS = ["TSLA", "SPCX", "AMZN", "AMD", "NVDA", "GOOGL", "MU", "MSFT", "NFLX", "AAPL"];

// Bull/bear thresholds (per the spec) + a liquidity floor so a thin name with a
// handful of contracts can't dominate a list on a meaningless ratio.
const BULLISH_CP = 2.0;
const BEARISH_CP = 0.5;
const MIN_VOLUME = 5_000; // Σ(call+put) near-the-money contracts
const LIST_LIMIT = 20;
const RATIO_CAP = 99; // keep ratios finite for JSON (no Infinity / divide-by-zero)

const ratio = (num: number, den: number): number =>
  den > 0 ? Math.min(num / den, RATIO_CAP) : num > 0 ? RATIO_CAP : 0;

// Collapse a ticker's latest cumulative snapshot into a single summary row.
function summarize(ticker: string, last: SentimentMinute | null): MarketSentimentTicker {
  if (!last || !Array.isArray(last.strikes)) {
    return { ticker, hasData: false, callVol: 0, putVol: 0, cpRatio: 0, callBuyRatio: 0, putBuyRatio: 0 };
  }
  let cA = 0, cB = 0, pA = 0, pB = 0;
  for (const s of last.strikes) {
    cA += s.cA; cB += s.cB; pA += s.pA; pB += s.pB;
  }
  const callVol = cA + cB;
  const putVol = pA + pB;
  return {
    ticker,
    hasData: callVol + putVol > 0,
    callVol,
    putVol,
    cpRatio: ratio(callVol, putVol),
    callBuyRatio: ratio(cA, cB),
    putBuyRatio: ratio(pA, pB),
  };
}

interface LastSnapshotRow {
  ticker: string;
  capturedAt: Date;
  last: SentimentMinute | null;
}

export async function GET(req: NextRequest) {
  const rawDate = new URL(req.url).searchParams.get("date");
  const wantDate = rawDate && DATE_RE.test(rawDate) ? rawDate : null;

  // Default to the most recent session that has data; honor ?date= if given.
  const dateStr =
    wantDate ??
    (await prisma.flowSentimentDay.findFirst({ orderBy: { tradingDate: "desc" }, select: { tradingDate: true } }))
      ?.tradingDate.toISOString().slice(0, 10);

  if (!dateStr) {
    return NextResponse.json({ error: "No options sentiment data available." }, { status: 404 });
  }

  // Pull ONLY the final cumulative snapshot per ticker (minutes can grow to
  // dozens of 60-strike snapshots through the session — fetching the whole
  // array for every ticker is multi-MB and times out on serverless). Negative
  // JSON indexing grabs the last element server-side.
  const rows = await prisma.$queryRaw<LastSnapshotRow[]>`
    SELECT ticker,
           captured_at AS "capturedAt",
           minutes -> (jsonb_array_length(minutes) - 1) AS last
    FROM flow_sentiment_days
    WHERE trading_date = ${dateStr}::date
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "No options sentiment data for this session." }, { status: 404 });
  }

  const lastByTicker = new Map(rows.map((r) => [r.ticker, r.last]));
  const capturedAt = rows.reduce<Date>((m, r) => (r.capturedAt > m ? r.capturedAt : m), rows[0]!.capturedAt);

  const rowFor = (ticker: string): MarketSentimentTicker =>
    summarize(ticker, lastByTicker.get(ticker) ?? null);

  // Every tracked ticker, summarized — the pool the bull/bear lists draw from.
  const all = rows.map((r) => summarize(r.ticker, r.last));
  const liquid = all.filter((t) => t.hasData && t.callVol + t.putVol >= MIN_VOLUME);

  const topBullish = liquid
    .filter((t) => t.cpRatio > BULLISH_CP)
    .sort((a, b) => b.cpRatio - a.cpRatio)
    .slice(0, LIST_LIMIT);
  const topBearish = liquid
    .filter((t) => t.cpRatio < BEARISH_CP)
    .sort((a, b) => a.cpRatio - b.cpRatio)
    .slice(0, LIST_LIMIT);

  const payload: MarketSentimentPayload = {
    tradingDate: dateStr,
    capturedAt: capturedAt.toISOString(),
    minVolume: MIN_VOLUME,
    indices: INDICES.map(rowFor),
    megaCaps: MEGA_CAPS.map(rowFor),
    topBullish,
    topBearish,
  };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
