import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TradeAlertRow, TradeAlertsPayload } from "@/lib/types";

const SIZE_WEIGHT: Record<string, number> = { Large: 0.1, Medium: 0.05, Small: 0.01, Lotto: 0.005 };

function dteOf(expiry: Date | null): number | null {
  if (!expiry) return null;
  return Math.round((expiry.getTime() - Date.now()) / 86_400_000);
}

function toRow(r: {
  id: bigint; assetType: string; ticker: string; side: string; strike: unknown; expiry: Date | null;
  expiryLabel: string | null; moderator: string; sizeLabel: string; entryPrice: unknown; entryAt: Date;
  status: string; remainingFrac: unknown; realizedPct: unknown; livePct: unknown; lastMark: unknown; bookDelta: unknown;
}): TradeAlertRow {
  const remainingFrac = Number(r.remainingFrac);
  return {
    id: r.id.toString(),
    assetType: r.assetType as "option" | "equity",
    ticker: r.ticker,
    side: r.side as TradeAlertRow["side"],
    strike: r.strike != null ? Number(r.strike) : null,
    expiryLabel: r.expiryLabel,
    dte: dteOf(r.expiry),
    moderator: r.moderator,
    sizeLabel: r.sizeLabel as TradeAlertRow["sizeLabel"],
    entryPrice: Number(r.entryPrice),
    entryAt: r.entryAt.toISOString(),
    status: r.status as "OPEN" | "CLOSED",
    remainingFrac,
    realizedPct: remainingFrac < 1 ? Number(r.realizedPct) : null,
    livePct: r.livePct != null ? Number(r.livePct) : null,
    lastMark: r.lastMark != null ? Number(r.lastMark) : null,
    bookDelta: Number(r.bookDelta),
  };
}

export async function GET(req: NextRequest) {
  const assetType = new URL(req.url).searchParams.get("type") === "equity" ? "equity" : "option";

  const rows = await prisma.tradeAlert.findMany({
    where: { assetType, hidden: false }, // manually-excluded trades dropped from the track record
    orderBy: [{ status: "asc" }, { entryAt: "desc" }],
  });

  // assetType has a row only once the channel is reachable + has alerts.
  const available = assetType === "option" || rows.length > 0;

  const open = rows.filter((r) => r.status === "OPEN").map(toRow);
  const closed = rows.filter((r) => r.status === "CLOSED").map(toRow);

  // Aggregate stats.
  const openBookPct = open.reduce((s, r) => s + r.bookDelta, 0);
  const liveVals = open.map((r) => r.livePct).filter((v): v is number => v != null);
  const rawPct = liveVals.length ? liveVals.reduce((s, v) => s + v, 0) / liveVals.length : 0;
  // A closed position "won" if its net realized result is positive.
  const closedNet = closed.map((r) => (r.realizedPct ?? 0));
  const winRate = closed.length ? closedNet.filter((v) => v > 0).length / closed.length : 0;

  // Equity curve — cumulative size-weighted realized book Δ across closed
  // positions in entry order (the "illustrative equity curve").
  const byTime = [...closed].sort((a, b) => a.entryAt.localeCompare(b.entryAt));
  let cum = 0;
  const equityCurve = byTime.map((r) => {
    cum += (SIZE_WEIGHT[r.sizeLabel] ?? 0.01) * (r.realizedPct ?? 0);
    return { t: r.entryAt, cum: Number(cum.toFixed(3)) };
  });

  const payload: TradeAlertsPayload = {
    assetType,
    available,
    open,
    closed,
    stats: { openBookPct, rawPct, winRate, openCount: open.length, closedCount: closed.length },
    equityCurve,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
