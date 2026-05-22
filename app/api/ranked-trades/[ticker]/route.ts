import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { RankedTrade, RankedTradesResult } from "@/lib/candles";

// Ranked dark-pool trades for the /charts trade overlays. Returns every
// ranked print for a ticker (rank 1 = largest notional) — the chart filters
// by rank / date client-side. Auth enforced upstream by proxy.ts.
//
// GET /api/ranked-trades/{ticker}

const TICKER_RE = /^[A-Z][A-Z.]{0,7}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const ticker = (rawTicker ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const rows = await prisma.darkPoolPrint.findMany({
    where: { ticker, rank: { not: null } },
    orderBy: { rank: "asc" },
    select: { rank: true, price: true, executedAt: true, premium: true },
  });

  const trades: RankedTrade[] = rows.map((r) => ({
    rank: r.rank ?? 0,
    time: Math.floor(r.executedAt.getTime() / 1000),
    price: Number(r.price),
    notional: Number(r.premium),
  }));

  const payload: RankedTradesResult = { ticker, trades };
  return NextResponse.json(payload, {
    headers: {
      // Ranks shift only when a new large print lands or the worker reranks;
      // a 60s edge cache is plenty.
      "Cache-Control": "s-maxage=60, stale-while-revalidate=120",
    },
  });
}
