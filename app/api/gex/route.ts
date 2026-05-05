import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { GEXPayload, GEXLevel, GammaRegime } from "@/lib/types";

const TICKER_RE = /^[A-Z]{1,5}$/;
const ALLOWED_EXPIRIES = ["all", "weekly", "monthly"] as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") ?? "SPY").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const rawExpiry = searchParams.get("expiry") ?? "all";
  const _expiry = ALLOWED_EXPIRIES.includes(rawExpiry as typeof ALLOWED_EXPIRIES[number]) ? rawExpiry : "all";
  // Expiry filter is currently a no-op against the DB (worker stores combined
  // strike-level data without expiry segmentation). The frontend pill toggle
  // is parsed/validated here so the URL is still well-formed; honoring it
  // requires a UW endpoint change tracked as post-V1 polish.
  void _expiry;
  const strikes = Math.max(1, Math.min(200, Number(searchParams.get("strikes") ?? 100)));
  if (isNaN(strikes)) {
    return NextResponse.json({ error: "Invalid strikes" }, { status: 400 });
  }

  const snapshot = await prisma.gexSnapshot.findFirst({
    where: { ticker },
    orderBy: { capturedAt: "desc" },
  });

  if (!snapshot) {
    return NextResponse.json(
      { error: `No GEX data for ${ticker}` },
      { status: 404 }
    );
  }

  const allStrikes = Array.isArray(snapshot.strikes)
    ? (snapshot.strikes as unknown as GEXLevel[]).filter(
        (s) => typeof s?.strike === "number"
      )
    : [];

  // Only show strikes surrounding spot — ±10%. Deep-OTM LEAPS and
  // corp-action-adjusted legacy strikes (e.g. UW returns $174 strikes for
  // QQQ when spot is $682) are excluded. If the latest snapshot has no
  // near-spot strikes, the chart goes empty rather than backfilling with
  // irrelevant deep-OTM rows.
  const spot = Number(snapshot.spot);
  const topStrikes = allStrikes
    .filter((s) => Math.abs(s.strike - spot) <= spot * 0.1)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, strikes)
    .sort((a, b) => a.strike - b.strike);

  const payload: GEXPayload = {
    ticker: snapshot.ticker,
    asOf: snapshot.asOf.toISOString(),
    strikes: topStrikes,
    keyLevels: {
      callWall: Number(snapshot.callWall),
      putWall: Number(snapshot.putWall),
      gammaFlip: Number(snapshot.gammaFlip),
      maxPain: Number(snapshot.maxPain),
      spot: Number(snapshot.spot),
    },
    netGexOI: Number(snapshot.netGexOI),
    netGexDV: Number(snapshot.netGexDV),
    gammaRegime: snapshot.gammaRegime as GammaRegime,
  };

  return NextResponse.json(payload);
}
