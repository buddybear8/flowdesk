import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DarkPoolPrint } from "@/lib/types";

// Cap response size. UW returns ~200/poll and we accumulate across the day;
// 100 is plenty for a feed view, ranked subsets are smaller still.
const MAX_ROWS = 100;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rankMin = Math.max(1, Math.min(10000, Number(searchParams.get("rankMin") ?? 1)));
  const rankMax = Math.max(1, Math.min(10000, Number(searchParams.get("rankMax") ?? 100)));
  if (isNaN(rankMin) || isNaN(rankMax) || rankMin > rankMax) {
    return NextResponse.json({ error: "Invalid rankMin/rankMax" }, { status: 400 });
  }
  const hideETF = searchParams.get("hideETF") === "true";
  const regularHour = searchParams.get("regularHour") !== "false";
  const extendedHour = searchParams.get("extendedHour") !== "false";

  const where: Prisma.DarkPoolPrintWhereInput = {
    rank: { gte: rankMin, lte: rankMax },
  };
  if (hideETF) where.isEtf = false;
  // regular vs extended is a partition: filter only when one is OFF.
  // Both ON or both OFF → no filter (both-OFF is a degenerate UI state).
  if (regularHour && !extendedHour) where.isExtended = true;
  else if (!regularHour && extendedHour) where.isExtended = false;

  const rows = await prisma.darkPoolPrint.findMany({
    where,
    orderBy: { rank: "asc" },
    take: MAX_ROWS,
  });

  const prints: DarkPoolPrint[] = rows.map((r) => ({
    id: Number(r.id),
    executed_at: r.executedAt.toISOString(),
    ticker: r.ticker,
    price: Number(r.price),
    size: r.size,
    premium: Number(r.premium),
    volume: r.volume == null ? 0 : Number(r.volume),
    // exchange_id is null for live UW polls (UW returns market_center letter,
    // not numeric id — see worker/src/jobs/uw.ts mapDarkPoolPrint). The S3
    // backfill fills it in. Default to 4 (dark pool per PRD §3.2) when null
    // so the frontend filter still works.
    exchange_id: r.exchangeId ?? 4,
    trf_id: r.trfId,
    is_etf: r.isEtf,
    is_extended: r.isExtended,
    all_time_rank: r.rank ?? 0,
    percentile: r.percentile == null ? 0 : Number(r.percentile),
  }));

  return NextResponse.json({ prints });
}
