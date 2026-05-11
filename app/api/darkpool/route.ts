import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DarkPoolPrint } from "@/lib/types";

// Cap response size. With ticker + onlyRanked filters in play, callers
// can ask for "all top-100 ranked prints for TSLA" — 500 leaves room.
const MAX_ROWS = 500;

const TICKER_PREFIX_RE = /^[A-Z]{1,5}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Rank window — legacy params, still honored for direct API callers. The
  // UI now uses the onlyRanked toggle below.
  const hasRankParam = searchParams.has("rankMin") || searchParams.has("rankMax");
  const rankMin = Math.max(1, Math.min(10000, Number(searchParams.get("rankMin") ?? 1)));
  const rankMax = Math.max(1, Math.min(10000, Number(searchParams.get("rankMax") ?? 100)));
  if (hasRankParam && (isNaN(rankMin) || isNaN(rankMax) || rankMin > rankMax)) {
    return NextResponse.json({ error: "Invalid rankMin/rankMax" }, { status: 400 });
  }
  // Toggle: when true, return only prints with rank between 1..100 (the
  // canonical historical corpus after the Polygon backfill + rolling
  // rerankDarkPool — see worker/src/lib/rerank-darkpool.ts). Server sorts
  // by rank ASC in this mode so the response is the top-100 directly.
  const onlyRanked = searchParams.get("onlyRanked") === "true";

  // Ticker filter — prefix match so "TSL" surfaces TSLA. Validated as
  // 1–5 uppercase letters before it touches the query; missing or empty
  // means "no filter."
  const tickerRaw = (searchParams.get("ticker") ?? "").toUpperCase();
  if (tickerRaw && !TICKER_PREFIX_RE.test(tickerRaw)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const hideETF = searchParams.get("hideETF") === "true";
  const regularHour = searchParams.get("regularHour") !== "false";
  const extendedHour = searchParams.get("extendedHour") !== "false";

  const where: Prisma.DarkPoolPrintWhereInput = {};
  if (onlyRanked) where.rank = { gte: 1, lte: 100 };
  else if (hasRankParam) where.rank = { gte: rankMin, lte: rankMax };
  if (tickerRaw) where.ticker = { startsWith: tickerRaw };
  if (hideETF) where.isEtf = false;
  // regular vs extended is a partition: filter only when one is OFF.
  // Both ON or both OFF → no filter (both-OFF is a degenerate UI state).
  if (regularHour && !extendedHour) where.isExtended = true;
  else if (!regularHour && extendedHour) where.isExtended = false;

  const rows = await prisma.darkPoolPrint.findMany({
    where,
    // onlyRanked → top-of-corpus first; otherwise live-feed ordering.
    orderBy: onlyRanked
      ? [{ rank: "asc" }, { executedAt: "desc" }]
      : { executedAt: "desc" },
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
    // exchange_id is null for some UW-sourced rows (UW returns market_center
    // letter, not numeric id). Polygon-sourced rows carry the real exchange
    // (always 4 for FINRA TRF). Default to 4 when null so the frontend
    // filter still works.
    exchange_id: r.exchangeId ?? 4,
    trf_id: r.trfId,
    is_etf: r.isEtf,
    is_extended: r.isExtended,
    all_time_rank: r.rank ?? 0,
    percentile: r.percentile == null ? 0 : Number(r.percentile),
  }));

  return NextResponse.json({ prints });
}
