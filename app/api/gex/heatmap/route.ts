import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { HeatmapPayload, HeatmapCell, HeatmapExpiration } from "@/lib/types";
import { pickStrikesCentered } from "@/lib/utils";
import { strikeBandFor } from "@/lib/strike-bands";

const VALID_TICKERS = new Set([
  "SPY", "SPX", "QQQ", "TSLA", "NVDA",
  "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT", "AAPL",
  "MU", "DRAM", "SPCX",
  "ORCL", "MRVL", "BABA", "APP", "HOOD", "ASTS", "ENPH",
]);

// DB cells JSON shape — written by pollGex in worker/src/jobs/uw.ts.
type StoredCells = {
  expirations: { date: string; dte: number }[];
  strikes: { strike: number; byExp: Record<string, { netOI: number; netDV: number; vOI?: number; vDV?: number }> }[];
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
  // horizon=swing → columns are the next weekly (Friday) expirations instead
  // of the absolute nearest ones (which for daily-expiry tickers are all
  // same-week). The worker stores nearest-7 ∪ next-5-Fridays per snapshot.
  const horizon = searchParams.get("horizon") === "swing" ? "swing" : "near";
  if (!VALID_TICKERS.has(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  // UW's expiry-strike endpoint intermittently degrades for some tickers
  // (NVDA/NFLX/AAPL/AMZN as of 2026-06), returning only the front expiration or
  // nothing for minutes-to-hours at a time — which would render a broken
  // single-column heatmap. Prefer the most recent GOOD snapshot (>=2
  // expirations) from the last 24h; the freshness pill (capturedAt) shows its
  // age. Fall back to the absolute latest only when no good snapshot exists.
  const goodId = await prisma.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM gex_heatmap_snapshots
    WHERE ticker = ${ticker}
      AND jsonb_array_length(cells->'expirations') >= 2
      AND captured_at > NOW() - INTERVAL '24 hours'
    ORDER BY captured_at DESC
    LIMIT 1`;
  const snapshot = goodId.length
    ? await prisma.gexHeatmapSnapshot.findUnique({ where: { id: goodId[0]!.id } })
    : await prisma.gexHeatmapSnapshot.findFirst({ where: { ticker }, orderBy: { capturedAt: "desc" } });
  if (!snapshot) {
    return NextResponse.json(
      { error: `No heatmap data for ${ticker} — first snapshot lands within 60s of market open` },
      { status: 404 },
    );
  }

  // Guard against showing ancient data as a live heatmap: if even the best
  // available snapshot is older than ~3 days (covers a long weekend), the
  // provider has stopped serving this chain — surface a clean unavailable state
  // (e.g. AMZN, whose only snapshot is weeks old) rather than a stale 1-strike
  // grid.
  const ageMs = Date.now() - snapshot.capturedAt.getTime();
  if (ageMs > 72 * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: `${ticker} heatmap unavailable — the data provider isn't serving this chain right now` },
      { status: 404 },
    );
  }

  const cells = snapshot.cells as unknown as StoredCells;
  const spot = Number(snapshot.spot);

  // Degraded-chain guard: UW's expiry-strike endpoint intermittently serves a
  // far-OTM-only partial for some tickers (AAPL/NVDA/AMZN as of 2026-07) whose
  // strikes don't straddle spot — rendering a broken grid of ~0 cells nowhere
  // near spot. Require real near-spot coverage on both sides; otherwise surface
  // the clean unavailable state (self-heals when UW's chain returns).
  const NEAR = 0.05;
  const straddlesSpot =
    cells.strikes.some((s) => s.strike >= spot && s.strike <= spot * (1 + NEAR)) &&
    cells.strikes.some((s) => s.strike <= spot && s.strike >= spot * (1 - NEAR));
  if (!straddlesSpot) {
    return NextResponse.json(
      { error: `${ticker} heatmap unavailable — the data provider isn't serving this chain right now` },
      { status: 404 },
    );
  }

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

  // Pick expirations for the heatmap, aiming for MAX_EXPIRATIONS columns:
  //   • Drop any expiration with zero cells in the visible strike range
  //     (UW occasionally returns far-OTM-only chains for an expiry; an
  //     entirely empty column adds nothing).
  //   • Prefer DENSE expirations (≥ MIN_CELLS_DENSE populated cells) — these
  //     render as a meaningful gradient across the band.
  //   • If we don't have MAX_EXPIRATIONS dense ones, top up with the closest-
  //     DTE sparse expirations (≥1 cell) so we still display the full set of
  //     5 columns instead of leaving the user with only 2–3.
  const MIN_CELLS_DENSE = 5;
  const MAX_EXPIRATIONS = 5;
  const isFriday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5;
  const expPool = horizon === "swing"
    ? cells.expirations.filter((e) => isFriday(e.date))
    : cells.expirations;
  const scored = expPool
    .map((e) => {
      const populated = orderedStrikes.reduce(
        (n, s) => n + (s.byExp[e.date] ? 1 : 0),
        0,
      );
      return { e, populated };
    })
    .filter((x) => x.populated >= 1)
    .sort((a, b) => a.e.dte - b.e.dte);
  const dense = scored.filter((x) => x.populated >= MIN_CELLS_DENSE);
  const sparse = scored.filter((x) => x.populated < MIN_CELLS_DENSE);
  const expirations: HeatmapExpiration[] = [...dense, ...sparse]
    .slice(0, MAX_EXPIRATIONS)
    .sort((a, b) => a.e.dte - b.e.dte)
    .map((x) => ({
      date: x.e.date,
      label: fmtExpirationLabel(x.e.date, x.e.dte),
      dte: x.e.dte,
    }));

  const flatCells: HeatmapCell[] = [];
  for (const s of orderedStrikes) {
    for (const exp of expirations) {
      const v = s.byExp[exp.date];
      if (!v) continue;
      flatCells.push({
        strike: s.strike,
        exp: exp.date,
        netOI: v.netOI,
        netDV: v.netDV,
        ...(v.vOI !== undefined ? { vOI: v.vOI, vDV: v.vDV ?? 0 } : {}),
      });
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
