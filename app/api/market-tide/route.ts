import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type {
  MarketTidePoint,
  MarketTideSnapshot,
  NetImpactRow,
  NetImpactSnapshot,
} from "@/lib/mock/market-tide-data";

// Last 6.5h of 5-min buckets covers a full RTH session (78 buckets). We pull
// up to 200 to leave headroom for the 1-min UW cadence the worker may store.
const TIDE_LOOKBACK_MS = 6.5 * 60 * 60 * 1000;
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

export async function GET() {
  const cutoff = new Date(Date.now() - TIDE_LOOKBACK_MS);

  const bars = await prisma.marketTideBar.findMany({
    where: { bucketStart: { gte: cutoff } },
    orderBy: { bucketStart: "asc" },
    take: TIDE_MAX_ROWS,
  });

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

  // Net Impact: most-recent snapshot date, top-N by signed netPremium.
  // Querying "today (ET)" left the panel blank between 00:00 ET and the next
  // 09:30 ET worker write, even though yesterday's session was still in DB.
  const latest = await prisma.netImpactDaily.findFirst({
    orderBy: { snapshotDate: "desc" },
    select: { snapshotDate: true },
  });
  const netImpactRows = latest
    ? await prisma.netImpactDaily.findMany({
        where: { snapshotDate: latest.snapshotDate },
        orderBy: { netPremium: "desc" },
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
