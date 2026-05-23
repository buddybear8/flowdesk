// worker/src/lib/polygon-aggs.ts
//
// Polygon /v2/aggs (aggregate bars) client for the /charts price-chart
// feature. The pollCandles job (jobs/candles.ts) calls this and upserts the
// bars into candle_bars. Polygon's tier is 15-min delayed — fine for the
// polled (non-realtime) chart.

export type Timeframe = "1W" | "1D" | "1H";

export const TIMEFRAMES: readonly Timeframe[] = ["1W", "1D", "1H"];

const POLYGON_BASE = "https://api.polygon.io";
const FETCH_TIMEOUT_MS = 15_000;

// Polygon aggregate params per timeframe. `backfillDays` = history depth
// requested on the first run for a (ticker, tf) — generously sized; Polygon
// returns only as far back as the account's plan entitles (~10 years on the
// current tier). `intervalMs` = one bar's span, used to anchor the per-minute
// tail refresh just before the latest bar.
export const TF_CONFIG: Record<
  Timeframe,
  { multiplier: number; timespan: string; backfillDays: number; intervalMs: number }
> = {
  "1W": { multiplier: 1, timespan: "week", backfillDays: 365 * 20, intervalMs: 7 * 86_400_000 },
  "1D": { multiplier: 1, timespan: "day", backfillDays: 365 * 12, intervalMs: 86_400_000 },
  "1H": { multiplier: 1, timespan: "hour", backfillDays: 365 * 3, intervalMs: 3_600_000 },
};

export interface AggBar {
  barTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Raw Polygon /v2/aggs result row (only the fields we use).
interface PolygonBar {
  t: number; // bar-start, ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Fetch aggregate bars for a ticker + timeframe over [from, to], ascending by
 * time. Returns [] for an unknown ticker (Polygon answers OK with no
 * results). Throws on network / non-OK / Polygon error.
 */
export async function fetchAggs(
  ticker: string,
  tf: Timeframe,
  from: Date,
  to: Date,
): Promise<AggBar[]> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not set");

  const { multiplier, timespan } = TF_CONFIG[tf];
  // Polygon's range endpoint accepts ms-epoch bounds — use them so the tail
  // refresh can anchor sub-day-precisely to the latest stored bar.
  const url =
    `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
    `/range/${multiplier}/${timespan}/${from.getTime()}/${to.getTime()}` +
    `?adjusted=true&sort=asc&limit=50000`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Key in the Authorization header, never the URL — keeps it out of logs.
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Polygon HTTP ${res.status}`);
    const json = (await res.json()) as { results?: PolygonBar[]; error?: string };
    if (json.error) throw new Error(`Polygon: ${json.error}`);
    const rows = Array.isArray(json.results) ? json.results : [];
    return rows
      .filter((b) => b && [b.t, b.o, b.h, b.l, b.c].every((n) => Number.isFinite(n)))
      .map((b) => ({
        barTime: new Date(b.t),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: Number.isFinite(b.v) ? Math.round(b.v) : 0,
      }));
  } finally {
    clearTimeout(timer);
  }
}
