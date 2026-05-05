import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DarkPoolPrint } from "@/lib/types";

// Cap response size. UW returns ~200/poll and we accumulate across the day;
// 100 is plenty for a feed view, ranked subsets are smaller still.
const MAX_ROWS = 100;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Rank filter is opt-in. Live UW polls store NULL rank (UW's
  // /api/darkpool/recent doesn't expose rank — it comes from the S3 backfill
  // that's still stubbed). Applying a default rank range here would exclude
  // every live-polled row, which is most of the table today.
  const hasRankParam = searchParams.has("rankMin") || searchParams.has("rankMax");
  const rankMin = Math.max(1, Math.min(10000, Number(searchParams.get("rankMin") ?? 1)));
  const rankMax = Math.max(1, Math.min(10000, Number(searchParams.get("rankMax") ?? 100)));
  if (hasRankParam && (isNaN(rankMin) || isNaN(rankMax) || rankMin > rankMax)) {
    return NextResponse.json({ error: "Invalid rankMin/rankMax" }, { status: 400 });
  }
  const hideETF = searchParams.get("hideETF") === "true";
  const regularHour = searchParams.get("regularHour") !== "false";
  const extendedHour = searchParams.get("extendedHour") !== "false";

  const where: Prisma.DarkPoolPrintWhereInput = {};
  if (hasRankParam) where.rank = { gte: rankMin, lte: rankMax };
  if (hideETF) where.isEtf = false;
  // regular vs extended is a partition: filter only when one is OFF.
  // Both ON or both OFF → no filter (both-OFF is a degenerate UI state).
  if (regularHour && !extendedHour) where.isExtended = true;
  else if (!regularHour && extendedHour) where.isExtended = false;

  const rows = await prisma.darkPoolPrint.findMany({
    where,
    // Most-recent first — the only meaningful ordering until rank backfill
    // (every live-polled row has NULL rank, so ordering by rank is a no-op).
    orderBy: { executedAt: "desc" },
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
