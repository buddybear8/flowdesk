// jobs/refresh-ticker-metadata.ts — daily at 05:30 ET.
//
// Populates the ticker_metadata table by:
//   1. Collecting distinct tickers seen in the last LOOKBACK_DAYS (flow_alerts
//      + dark_pool_prints + the watched ticker list).
//   2. Resolving each ticker's sector / isEtf / name using:
//        a. SECTOR_OVERRIDES (always wins — known ETFs, indices, etc.)
//        b. Most recent sector from flow_alerts (UW's classification),
//           normalized to the Sector union.
//        c. Default fallback ("Technology", isEtf=false) with a logged count.
//   3. Upserting one row per ticker into ticker_metadata.
//
// Sector values must match the `Sector` union (PRD §18 — 11 GICS + 4 ETF
// asset classes). UW returns Yahoo-style names for some equities (e.g.
// "Financial Services") that don't match GICS exactly; SECTOR_NORMALIZE
// translates the common cases.
//
// Idempotent — running twice in a row is a no-op the second time.
//
// Consumer-side enrichment (replacing the `// TODO: enrich from
// ticker_metadata` hooks in pollFlowAlerts/pollDarkPool) lands in a
// follow-up commit.

import { prisma } from "../lib/prisma.js";
import { SECTOR_OVERRIDES, type Sector } from "../lib/sector-overrides.js";
import { WATCHED_TICKERS } from "../lib/watched-tickers.js";

const ts = () => new Date().toISOString();

// Look-back window for "recent" tickers. 7 days covers a full trading week
// of activity; tickers that haven't traded in a week aren't worth refreshing
// (they'll get refreshed the next time they appear).
const LOOKBACK_DAYS = 7;

export async function refreshTickerMetadata(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    // 1a. Latest sector per ticker from flow_alerts. Single Postgres query
    // using DISTINCT ON — much cheaper than N findFirst calls.
    const sectorRows = await prisma.$queryRaw<
      Array<{ ticker: string; sector: string }>
    >`
      SELECT DISTINCT ON (ticker) ticker, sector
      FROM flow_alerts
      WHERE captured_at >= ${cutoff}
      ORDER BY ticker, captured_at DESC
    `;
    const latestSector = new Map<string, string>(
      sectorRows.map((r) => [r.ticker.toUpperCase(), r.sector])
    );

    // 1b. Tickers seen in dark_pool_prints (covers tickers that don't trade
    // options frequently enough to surface in flow alerts — e.g. low-volume
    // stocks with notable DP prints).
    const dpTickers = await prisma.darkPoolPrint.findMany({
      where: { executedAt: { gte: cutoff } },
      select: { ticker: true },
      distinct: ["ticker"],
    });

    // 1c. Union of all ticker sources.
    const allTickers = new Set<string>([
      ...WATCHED_TICKERS,
      ...latestSector.keys(),
      ...dpTickers.map((r) => r.ticker.toUpperCase()),
    ]);

    if (allTickers.size === 0) {
      console.log(
        `[refresh-ticker-metadata] ${ts()} no tickers found in last ${LOOKBACK_DAYS} days, nothing to refresh`
      );
      return;
    }

    // 2. Resolve and upsert each ticker.
    let upserted = 0;
    let unresolved = 0;
    for (const ticker of allTickers) {
      const resolved = resolveTickerMeta(ticker, latestSector.get(ticker));
      if (resolved.unresolved) unresolved++;
      await prisma.tickerMetadata.upsert({
        where: { ticker },
        update: {
          sector: resolved.sector,
          isEtf: resolved.isEtf,
          name: resolved.name ?? null,
        },
        create: {
          ticker,
          sector: resolved.sector,
          isEtf: resolved.isEtf,
          name: resolved.name ?? null,
        },
      });
      upserted++;
    }

    console.log(
      `[refresh-ticker-metadata] ${ts()} upserted ${upserted} tickers ` +
        `(${unresolved} unresolved → defaulted to Technology)`
    );
  } catch (err) {
    console.error(
      "[refresh-ticker-metadata] failed:",
      err instanceof Error ? err.message : err
    );
  }
}

interface ResolvedMeta {
  sector: Sector;
  isEtf: boolean;
  name?: string;
  // True when neither override nor flow-alert sector resolved — caller
  // counts these for the run summary so we can spot growing blind spots.
  unresolved: boolean;
}

function resolveTickerMeta(
  ticker: string,
  rawFlowSector: string | undefined
): ResolvedMeta {
  // (a) Override always wins.
  const override = SECTOR_OVERRIDES[ticker];
  if (override) {
    return {
      sector: override.sector,
      isEtf: override.isEtf,
      name: override.name,
      unresolved: false,
    };
  }

  // (b) Most recent sector from flow_alerts (UW's classification).
  const normalized = normalizeSector(rawFlowSector);
  if (normalized) {
    return { sector: normalized, isEtf: false, unresolved: false };
  }

  // (c) Default fallback. isEtf=false is a guess; if this ticker IS an ETF,
  // adding it to SECTOR_OVERRIDES is the right fix.
  return { sector: "Technology", isEtf: false, unresolved: true };
}

// Map UW's sector strings to the Sector union. UW uses Yahoo-style names
// for some equities; the lower-cased keys cover the common cases. Returns
// null for unknown values so the caller can fall through to the default.
function normalizeSector(raw: string | null | undefined): Sector | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return SECTOR_NORMALIZE[trimmed.toLowerCase()] ?? null;
}

const SECTOR_NORMALIZE: Record<string, Sector> = {
  // Direct matches (the 15 union values, lowercased).
  "technology": "Technology",
  "communication": "Communication",
  "consumer discretionary": "Consumer Discretionary",
  "consumer staples": "Consumer Staples",
  "energy": "Energy",
  "financials": "Financials",
  "health care": "Health Care",
  "industrials": "Industrials",
  "materials": "Materials",
  "real estate": "Real Estate",
  "utilities": "Utilities",
  "index": "Index",
  "commodities": "Commodities",
  "bonds": "Bonds",
  "volatility": "Volatility",

  // UW / Yahoo aliases observed in production.
  "financial services": "Financials",
  "financial": "Financials",
  "healthcare": "Health Care",
  "consumer cyclical": "Consumer Discretionary",
  "consumer defensive": "Consumer Staples",
  "basic materials": "Materials",
  "communication services": "Communication",
};
