import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { FlowSentimentPayload, SentimentMinute } from "@/lib/types";

const TICKER_RE = /^[A-Z]{1,5}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "YYYY-MM-DD" for the current ET session date.
function etDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// flow_sentiment_days.trading_date is stored at UTC midnight of the ET session
// day (see worker/src/jobs/flow-sentiment.ts) — match that here.
function tradingDateValue(etDate: string): Date {
  return new Date(`${etDate}T00:00:00.000Z`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") ?? "SPY").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const rawDate = searchParams.get("date");
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : etDateString();

  const row = await prisma.flowSentimentDay.findUnique({
    where: { ticker_tradingDate: { ticker, tradingDate: tradingDateValue(date) } },
  });

  if (!row) {
    return NextResponse.json(
      { error: `No options sentiment data for ${ticker} on ${date}` },
      { status: 404 },
    );
  }

  const payload: FlowSentimentPayload = {
    ticker: row.ticker,
    tradingDate: date,
    capturedAt: row.capturedAt.toISOString(),
    spot: Number(row.spot),
    minutes: (row.minutes as unknown as SentimentMinute[]) ?? [],
  };

  return NextResponse.json(payload);
}
