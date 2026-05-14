import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { HeatmapPayload, HeatmapCell, HeatmapExpiration } from "@/lib/types";
import { pickStrikesCentered } from "@/lib/utils";
import { strikeBandFor } from "@/lib/strike-bands";

const VALID_TICKERS = new Set([
  "SPY", "SPX", "QQQ", "TSLA", "NVDA",
  "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT",
]);

// DB cells JSON shape — written by pollGex in worker/src/jobs/uw.ts.
type StoredCells = {
  expirations: { date: string; dte: number }[];
  strikes: { strike: number; byExp: Record<string, { netOI: number; netDV: number }> }[];
};

function fmtExpirationLabel(isoDate: string, dte: number): string {
  // isoDate is YYYY-MM-DD (UTC-naive). Format as MM/DD without timezone math —
  // worker writes these in ET, the client just renders the string.
  const parts = isoDate.split("-");
  const mm = parts[1] ?? "??";
  const dd = parts[2] ?? "??";
  const stem = `${mm}/${dd}`;
  return dte === 0 ? `${stem} (0DTE)` : `${stem} (${dte}d)`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") ?? "SPY").toUpperCase();
  if (!VALID_TICKERS.has(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const snapshot = await prisma.gexHeatmapSnapshot.findFirst({
    where: { ticker },
    orderBy: { capturedAt: "desc" },
  });
  if (!snapshot) {
    return NextResponse.json(
      { error: `No heatmap data for ${ticker} — first snapshot lands within 60s of market open` },
      { status: 404 },
    );
  }

  const cells = snapshot.cells as unknown as StoredCells;
  const spot = Number(snapshot.spot);

  // Strikes are already a union across expirations. Filter to the per-ticker
  // band (wider for higher-beta names — see lib/strike-bands.ts) to drop
  // deep-OTM LEAPS that UW occasionally returns, then pick the 50 closest to
  // spot using the same centered-selection rule as /api/gex.
  const band = strikeBandFor(ticker);
  const inBand = cells.strikes.filter((s) => Math.abs(s.strike - spot) <= spot * band);
  const picked = pickStrikesCentered(inBand, spot, 50);
  // pickStrikesCentered returns ascending; the heatmap renders strikes
  // top-down by descending price, so reverse here.
  const orderedStrikes = [...picked].sort((a, b) => b.strike - a.strike);

  const expirations: HeatmapExpiration[] = cells.expirations.map((e) => ({
    date: e.date,
    label: fmtExpirationLabel(e.date, e.dte),
    dte: e.dte,
  }));

  const flatCells: HeatmapCell[] = [];
  for (const s of orderedStrikes) {
    for (const exp of expirations) {
      const v = s.byExp[exp.date];
      if (!v) continue;
      flatCells.push({ strike: s.strike, exp: exp.date, netOI: v.netOI, netDV: v.netDV });
    }
  }

  const payload: HeatmapPayload = {
    ticker: snapshot.ticker,
    asOf: snapshot.asOf.toISOString(),
    capturedAt: snapshot.capturedAt.toISOString(),
    spot,
    expirations,
    strikes: orderedStrikes.map((s) => s.strike),
    cells: flatCells,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
