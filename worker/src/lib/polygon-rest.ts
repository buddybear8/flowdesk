// lib/polygon-rest.ts
//
// Thin REST client for Polygon's /v3/trades/{ticker} endpoint. Used by the
// hourly intraday job to fetch trades for each ticker since the last poll.
//
// Auth: POLYGON_API_KEY env var (Bearer header).
// Rate limits: Stocks Starter ($79/mo) is "unlimited" API calls, but we
//              still apply a concurrency cap upstream and backoff on 429.

import type { RawPolygonTrade } from "./polygon-trade-filter.js";

const POLYGON_REST_BASE = "https://api.polygon.io";
const PAGE_LIMIT = 50_000;
const MAX_PAGES_PER_TICKER = 20;     // safety cap: 1M trades = AAPL daily max
const RETRY_LIMIT = 4;
const RETRY_BASE_MS = 500;

interface RestTradeResult {
  // Polygon REST response field shapes for /v3/trades/{stocksTicker}
  // (see https://polygon.io/docs/stocks/get_v3_trades__stockticker)
  id?: string;
  price: number;
  size: number;
  sip_timestamp: number | string;     // ns int64 — may exceed JS Number precision; we BigInt it
  exchange?: number;
  trf_id?: number;
}

interface RestResponse {
  results?: RestTradeResult[];
  next_url?: string;
  status?: string;
}

/**
 * Iterator over all trades for `ticker` with sip_timestamp >= sinceNs.
 * Auto-paginates via next_url; capped at MAX_PAGES_PER_TICKER for safety.
 *
 * sinceNs is inclusive — Polygon's API also supports timestamp.gt for strict,
 * but the dedup downstream (uw_id unique on `polygon:${ticker}:${id}`) handles
 * the boundary cleanly.
 */
export async function* fetchTradesSince(
  ticker: string,
  sinceNs: bigint,
): AsyncGenerator<RawPolygonTrade, void, undefined> {
  const apiKey = requireApiKey();
  let url: string | null = `${POLYGON_REST_BASE}/v3/trades/${encodeURIComponent(ticker)}?timestamp.gte=${sinceNs.toString()}&order=asc&limit=${PAGE_LIMIT}`;
  let pages = 0;

  while (url) {
    if (++pages > MAX_PAGES_PER_TICKER) {
      console.warn(`[polygon-rest] ${ticker}: hit MAX_PAGES_PER_TICKER (${MAX_PAGES_PER_TICKER}), truncating`);
      return;
    }
    const json = await fetchWithRetry(url, apiKey);
    const results = json.results ?? [];
    for (const r of results) {
      const parsed = parseRestRow(ticker, r);
      if (parsed !== null) yield parsed;
    }
    if (json.next_url) {
      // next_url already encodes filters; append apiKey
      url = appendApiKey(json.next_url, apiKey);
    } else {
      url = null;
    }
  }
}

function requireApiKey(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) throw new Error("POLYGON_API_KEY env var required for REST polling");
  return k;
}

function appendApiKey(url: string, apiKey: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("apiKey")) u.searchParams.set("apiKey", apiKey);
  return u.toString();
}

async function fetchWithRetry(url: string, apiKey: string): Promise<RestResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
        const wait = RETRY_BASE_MS * Math.pow(2, attempt);
        await sleep(wait);
        continue;
      }
      if (!resp.ok) {
        throw new Error(`Polygon REST ${resp.status} ${resp.statusText} for ${url}`);
      }
      return (await resp.json()) as RestResponse;
    } catch (err) {
      lastErr = err;
      if (attempt === RETRY_LIMIT - 1) break;
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRestRow(ticker: string, r: RestTradeResult): RawPolygonTrade | null {
  if (!r.id) return null;
  const price = Number(r.price);
  const size = Number(r.size);
  if (!Number.isFinite(price) || !Number.isFinite(size)) return null;

  let sipNs: bigint;
  try {
    // sip_timestamp is int64 nanoseconds. May arrive as number (lossy past
    // ~2^53) or string. BigInt() handles both safely IF the source is the
    // string form; for number form we accept the precision loss (insignificant
    // for our millisecond-truncated executedAt).
    sipNs = typeof r.sip_timestamp === "string"
      ? BigInt(r.sip_timestamp)
      : BigInt(Math.trunc(r.sip_timestamp as number));
  } catch {
    return null;
  }

  return {
    ticker,
    id: r.id,
    price,
    size: Math.trunc(size),
    sipTimestampNs: sipNs,
    exchange: r.exchange != null && Number.isFinite(r.exchange) ? Math.trunc(r.exchange) : null,
    trfId: r.trf_id != null && Number.isFinite(r.trf_id) ? Math.trunc(r.trf_id) : null,
  };
}
