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

  // Walk backward through recent snapshots and pick the first one with at
  // least 5 strikes within ±20% of spot. UW's spot-exposures endpoint is
  // intermittently noisy — for SPY it alternates between full near-money
  // chains and pure deep-OTM LEAPS dumps; for QQQ it's been returning only
  // legacy non-standard strikes (e.g. $174 when spot is $682) every poll.
  // Falling back to a recent good snapshot avoids flicker between polls.
  const recent = await prisma.gexSnapshot.findMany({
    where: {
      ticker,
      capturedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // last hour
    },
    orderBy: { capturedAt: "desc" },
    take: 60,
  });

  if (recent.length === 0) {
    return NextResponse.json(
      { error: `No GEX data for ${ticker}` },
      { status: 404 }
    );
  }

  const NEAR_SPOT_THRESHOLD = 5;
  let snapshot = recent[0]!;
  let allStrikes: GEXLevel[] = [];
  for (const candidate of recent) {
    const candidateStrikes = Array.isArray(candidate.strikes)
      ? (candidate.strikes as unknown as GEXLevel[]).filter(
          (s) => typeof s?.strike === "number"
        )
      : [];
    const candidateSpot = Number(candidate.spot);
    const nearSpotCount = candidateStrikes.filter(
      (s) => Math.abs(s.strike - candidateSpot) <= candidateSpot * 0.2
    ).length;
    if (nearSpotCount >= NEAR_SPOT_THRESHOLD) {
      snapshot = candidate;
      allStrikes = candidateStrikes;
      break;
    }
  }
  // If nothing in the last hour passed the threshold (e.g. QQQ), fall back
  // to the absolute latest so the page shows *something* — empty chart from
  // the API's own ±20% clamp will still flag the issue.
  if (allStrikes.length === 0) {
    allStrikes = Array.isArray(snapshot.strikes)
      ? (snapshot.strikes as unknown as GEXLevel[]).filter(
          (s) => typeof s?.strike === "number"
        )
      : [];
  }

  // Window the strikes to ±20% of spot, then sort by distance and slice.
  // Sorting by distance alone wasn't enough: when the worker stores a sparse
  // chain (e.g. SPY data clustered at $50–$295 LEAPS strikes far below
  // spot=$723), "nearest spot" still returns those rows because they're the
  // only rows that exist. Clamping enforces the at-the-money invariant —
  // if there's nothing near spot, the chart goes empty and that's a true
  // signal rather than a misleading deep-OTM fill.
  const spot = Number(snapshot.spot);
  const window = spot * 0.2;
  const nearSpot = allStrikes.filter(
    (s) => Math.abs(s.strike - spot) <= window
  );
  const topStrikes = [...nearSpot]
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
