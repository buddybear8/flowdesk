// lib/polygon-trade-filter.ts
//
// Shared filter + dedup + mapping for Polygon trade rows. Used by both the
// daily flat-file job and the hourly REST poll. Source-agnostic: takes any
// iterable of raw rows (CSV-parsed strings or REST JSON) and produces
// Prisma-ready DarkPoolPrintCreateManyInput records.
//
// Pipeline:
//   1. Ticker filter (drop non-target tickers)
//   2. Per-ticker notional threshold filter (drop trades < ticker's floor)
//   3. (price, size) dedup within batch (keep earliest sip_timestamp)
//   4. Map to DarkPoolPrintCreateManyInput shape
//
// Thresholds are static (worker/src/lib/ticker-thresholds.json) — see resume
// in ~/polygon-pull-project/ for how they were computed.

import { Prisma } from "@prisma/client";
import thresholdsJson from "./ticker-thresholds.json" with { type: "json" };
import { SECTOR_OVERRIDES } from "./sector-overrides.js";

export const THRESHOLDS: Record<string, number> = thresholdsJson as Record<string, number>;
export const TICKER_SET: Set<string> = new Set(Object.keys(THRESHOLDS));

/**
 * Common shape after parsing rows from either CSV or REST. All values
 * normalized to the types the mapper expects.
 */
export interface RawPolygonTrade {
  ticker: string;
  id: string;
  price: number;
  size: number;
  sipTimestampNs: bigint;     // nanoseconds since epoch
  exchange: number | null;
  trfId: number | null;
}

export interface FilterStats {
  rawCount: number;
  tickerPassed: number;
  thresholdPassed: number;
  afterDedup: number;
  perTicker: Map<string, number>;  // ticker -> records ready to insert
}

export interface FilterResult {
  records: Prisma.DarkPoolPrintCreateManyInput[];
  stats: FilterStats;
}

/**
 * Fast pre-filter for use during streaming: returns true iff the row is for
 * a tracked ticker AND clears that ticker's notional threshold. Used by the
 * daily flat-file job to filter ~80M rows down to ~hundreds before buffering.
 */
export function passesPreFilter(row: RawPolygonTrade): boolean {
  if (!TICKER_SET.has(row.ticker)) return false;
  const threshold = THRESHOLDS[row.ticker]!;
  return row.price * row.size >= threshold;
}

/**
 * Filter, dedup, and map a batch of raw trades.
 *
 * Within-batch dedup only — does not query DB. Two trades on different
 * dates with identical (price, size) will both survive; cross-day dedup
 * was applied during the historical filter_top200 pass and isn't repeated
 * for ongoing ingest (very rare in single-day batches; would require a DB
 * query per insert which kills throughput).
 */
export function filterAndMap(rows: Iterable<RawPolygonTrade>): FilterResult {
  let rawCount = 0;
  let tickerPassed = 0;
  let thresholdPassed = 0;

  // (ticker, price, size) -> earliest survivor
  const dedupMap = new Map<string, RawPolygonTrade>();

  for (const r of rows) {
    rawCount++;
    if (!TICKER_SET.has(r.ticker)) continue;
    tickerPassed++;

    const threshold = THRESHOLDS[r.ticker]!;
    const notional = r.price * r.size;
    if (notional < threshold) continue;
    thresholdPassed++;

    const key = `${r.ticker}|${r.price}|${r.size}`;
    const prev = dedupMap.get(key);
    if (!prev || r.sipTimestampNs < prev.sipTimestampNs) {
      dedupMap.set(key, r);
    }
  }

  const perTicker = new Map<string, number>();
  const records: Prisma.DarkPoolPrintCreateManyInput[] = [];
  for (const t of dedupMap.values()) {
    const rec = mapToRecord(t);
    if (rec === null) continue;
    records.push(rec);
    perTicker.set(t.ticker, (perTicker.get(t.ticker) ?? 0) + 1);
  }

  return {
    records,
    stats: {
      rawCount,
      tickerPassed,
      thresholdPassed,
      afterDedup: records.length,
      perTicker,
    },
  };
}

function mapToRecord(t: RawPolygonTrade): Prisma.DarkPoolPrintCreateManyInput | null {
  const executedAt = new Date(Number(t.sipTimestampNs / 1_000_000n));
  if (Number.isNaN(executedAt.getTime())) return null;
  if (!Number.isFinite(t.price) || !Number.isFinite(t.size)) return null;
  if (!t.id) return null;

  const notional = t.price * t.size;

  return {
    uwId: `polygon:${t.ticker}:${t.id}`,
    executedAt,
    ticker: t.ticker,
    price: new Prisma.Decimal(t.price),
    size: t.size,
    premium: new Prisma.Decimal(notional),
    volume: null,
    exchangeId: t.exchange,
    trfId: t.trfId,
    isEtf: SECTOR_OVERRIDES[t.ticker]?.isEtf ?? false,
    isExtended: !isIntradayET(executedAt),
    isIntraday: isIntradayET(executedAt),
    rank: null,         // rerankDarkPool fills these after insert
    percentile: null,
  };
}

/**
 * True if a Date falls inside Regular Trading Hours (09:30–15:59 ET) on a
 * weekday. Copy of the helper in s3-darkpool-import.ts.
 */
export function isIntradayET(date: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;
  if (wd === "Sat" || wd === "Sun") return false;
  if (hour < 9 || hour >= 16) return false;
  if (hour === 9 && minute < 30) return false;
  return true;
}
