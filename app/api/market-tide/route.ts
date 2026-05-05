import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type {
  MarketTidePoint,
  MarketTideSnapshot,
  NetImpactRow,
  NetImpactSnapshot,
} from "@/lib/mock/market-tide-data";

// One RTH session = ~78 5-min buckets. 200 leaves headroom for finer-grained
// UW cadences and for partial-day fetches (e.g. mid-morning) that still want
// the prior session as context. Pulling more than one session would mix dates.
const TIDE_MAX_ROWS = 200;
const NET_IMPACT_LIMIT = 20;

const HHMM_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
});

export async function GET() {
  // Pull the most recent N bars, then keep only the ones from the same ET
  // trading day as the newest one. This means after-hours / weekends still
  // show the last completed session (with its real date) instead of going
  // blank, and during RTH it grows intraday as new buckets land.
  const recent = await prisma.marketTideBar.findMany({
    orderBy: { bucketStart: "desc" },
    take: TIDE_MAX_ROWS,
  });
  const newest = recent[0];
  const sessionETDate = newest ? ET_DATE_FMT.format(newest.bucketStart) : null;
  const bars = (sessionETDate
    ? recent.filter((b) => ET_DATE_FMT.format(b.bucketStart) === sessionETDate)
    : []
  ).reverse();

  const series: MarketTidePoint[] = bars.map((b) => ({
    time: HHMM_FMT.format(b.bucketStart),
    spyPrice: Number(b.spyPrice),
    netCallPremium: Number(b.netCallPremium),
    // Mock convention: net put premium is rendered as a negative number.
    // UW stores the magnitude positive; flip the sign here so the chart's
    // red-below-zero line behavior matches the V1 mock.
    netPutPremium: -Math.abs(Number(b.netPutPremium)),
    volume: Number(b.volume),
  }));

  const last = bars[bars.length - 1];
  const tide: MarketTideSnapshot = last
    ? {
        asOf: last.bucketStart.toISOString(),
        asOfLabel: LABEL_FMT.format(last.bucketStart),
        spyCurrent: Number(last.spyPrice),
        volumeCurrent: Number(last.volume),
        netCallPremiumCurrent: Number(last.netCallPremium),
        netPutPremiumCurrent: -Math.abs(Number(last.netPutPremium)),
        series,
      }
    : {
        asOf: new Date().toISOString(),
        asOfLabel: "—",
        spyCurrent: 0,
        volumeCurrent: 0,
        netCallPremiumCurrent: 0,
        netPutPremiumCurrent: 0,
        series: [],
      };

  // Net Impact: latest UW poll's curated top-N (already split half-bullish /
  // half-bearish by UW). The worker upserts by (snapshotDate, ticker), so by
  // mid-session the table accumulates 30+ tickers as UW's leaderboard rotates;
  // ordering by netPremium DESC then returns the day's most-positive movers
  // and drops the largest negatives. Ordering by updatedAt DESC and taking N
  // returns exactly the most recent poll's row set — matches UW's chart.
  const latest = await prisma.netImpactDaily.findFirst({
    orderBy: { snapshotDate: "desc" },
    select: { snapshotDate: true },
  });
  const netImpactRows = latest
    ? await prisma.netImpactDaily.findMany({
        where: { snapshotDate: latest.snapshotDate },
        orderBy: { updatedAt: "desc" },
        take: NET_IMPACT_LIMIT,
      })
    : [];

  const netImpact: NetImpactSnapshot = {
    asOf: new Date().toISOString(),
    period: "1D",
    rows: netImpactRows.map<NetImpactRow>((r) => ({
      ticker: r.ticker,
      netPremium: Number(r.netPremium),
    })),
  };

  return NextResponse.json({ tide, netImpact });
}
