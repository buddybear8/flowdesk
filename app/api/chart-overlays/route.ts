import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { GEXLevel, HitListAtrTargets } from "@/lib/types";

const TICKER_RE = /^[A-Z]{1,5}$/;
const MAX_GEX_NODES = 5;

// Overlay levels for the /charts price chart: major GEX levels (call/put
// wall, gamma flip, top |net GEX| nodes) and the move targets from the most
// recent Daily Watch appearance of the ticker. Either section is null when
// the ticker has no data for it (GEX covers only the watched tickers; watch
// targets only tickers that have made the daily top-10).

export type ChartOverlaysPayload = {
  gex: {
    asOf: string;
    spot: number;
    callWall: number;
    putWall: number;
    gammaFlip: number;
    nodes: { price: number; rank: number }[];
  } | null;
  watch: {
    date: string; // YYYY-MM-DD (hit-list date)
    dateLabel: string; // "Jul 9"
    direction: "UP" | "DOWN";
    contract: string;
    targets: { n: 1 | 2 | 3; price: number }[];
  } | null;
};

function utcDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const [gexSnapshot, watchRow] = await Promise.all([
    prisma.gexSnapshot.findFirst({ where: { ticker }, orderBy: { capturedAt: "desc" } }),
    prisma.hitListDaily.findFirst({
      where: { ticker, atrTargets: { not: Prisma.DbNull } },
      orderBy: { date: "desc" },
    }),
  ]);

  let gex: ChartOverlaysPayload["gex"] = null;
  if (gexSnapshot) {
    const spot = Number(gexSnapshot.spot);
    const strikes = Array.isArray(gexSnapshot.strikes)
      ? (gexSnapshot.strikes as unknown as GEXLevel[]).filter((s) => typeof s?.strike === "number")
      : [];
    // "Major" nodes = biggest |net GEX (OI)| strikes near spot — the same
    // magnets the heatmap highlights. ±10% band matches /api/gex.
    // Skip nodes that coincide with the wall/flip levels — they'd draw a
    // second line and axis label on top of the named one.
    const named = new Set([Number(gexSnapshot.callWall), Number(gexSnapshot.putWall), Number(gexSnapshot.gammaFlip)]);
    const nodes = strikes
      .filter((s) => Math.abs(s.strike - spot) <= spot * 0.1 && !named.has(s.strike))
      .sort((a, b) => Math.abs(b.netOI) - Math.abs(a.netOI))
      .slice(0, MAX_GEX_NODES)
      .map((s, i) => ({ price: s.strike, rank: i + 1 }));
    gex = {
      asOf: gexSnapshot.asOf.toISOString(),
      spot,
      callWall: Number(gexSnapshot.callWall),
      putWall: Number(gexSnapshot.putWall),
      gammaFlip: Number(gexSnapshot.gammaFlip),
      nodes,
    };
  }

  let watch: ChartOverlaysPayload["watch"] = null;
  if (watchRow?.atrTargets) {
    const t = watchRow.atrTargets as unknown as HitListAtrTargets;
    const direction = watchRow.direction === "DOWN" ? "DOWN" : "UP";
    // Direction-matched ladder, same as the Watches panel: Target 1/2/3 on
    // the signal's side only.
    const ladder = direction === "UP" ? [t.up05, t.up1, t.up2] : [t.dn05, t.dn1, t.dn2];
    if (ladder.every((p) => Number.isFinite(p) && p > 0)) {
      watch = {
        date: watchRow.date.toISOString().slice(0, 10),
        dateLabel: utcDateLabel(watchRow.date),
        direction,
        contract: watchRow.contract,
        targets: ladder.map((price, i) => ({ n: (i + 1) as 1 | 2 | 3, price })),
      };
    }
  }

  const payload: ChartOverlaysPayload = { gex, watch };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
