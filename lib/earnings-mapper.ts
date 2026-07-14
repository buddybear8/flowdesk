import type { EarningsEventRow } from "@/lib/types";

// DB → API row mapper shared by the earnings routes.
export function eventToRow(e: {
  ticker: string; reportDate: Date; reportTime: string; fullName: string | null;
  sector: string | null; marketcap: unknown; isSp500: boolean; epsEstimate: unknown;
  actualEps: unknown; expectedMovePct: unknown; preEarningsClose: unknown;
  postEarningsClose: unknown; reactionPct: unknown;
  fiscalQuarter: string | null; avgMovePct: unknown; beatCount: number | null; quarterCount: number | null;
}): EarningsEventRow {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    ticker: e.ticker,
    reportDate: e.reportDate.toISOString().slice(0, 10),
    reportTime: (e.reportTime === "premarket" || e.reportTime === "postmarket" ? e.reportTime : "unknown"),
    fullName: e.fullName,
    sector: e.sector,
    marketcap: n(e.marketcap),
    isSp500: e.isSp500,
    epsEstimate: n(e.epsEstimate),
    actualEps: n(e.actualEps),
    expectedMovePct: n(e.expectedMovePct),
    preEarningsClose: n(e.preEarningsClose),
    postEarningsClose: n(e.postEarningsClose),
    reactionPct: n(e.reactionPct),
    fiscalQuarter: e.fiscalQuarter,
    avgMovePct: n(e.avgMovePct),
    beatCount: e.beatCount,
    quarterCount: e.quarterCount,
  };
}
