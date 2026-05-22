// lib/candles.ts — shared types + constants for the /charts price-chart
// feature. /api/candles reads candle_bars (worker → Polygon → Postgres);
// /api/ranked-trades reads dark_pool_prints. These types describe both
// routes' response shapes and are consumed by the chart component.

export type Timeframe = "1W" | "1D" | "1H";

export const TIMEFRAMES: readonly Timeframe[] = ["1W", "1D", "1H"];

export function isTimeframe(v: string): v is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(v);
}

// Chartable tickers — stocks/ETFs the worker polls. Mirrors the worker's
// CHART_TICKERS (worker/src/jobs/candles.ts). SPX is excluded — it's an
// index, not on Polygon's Stocks tier.
export const CHART_TICKERS = [
  "SPY", "QQQ", "TSLA", "NVDA", "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT",
] as const;

// One OHLCV bar. `time` is UNIX seconds — the Lightweight Charts UTCTimestamp
// shape — so the chart component can feed it straight to a series.
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Header stats that aren't timeframe-dependent. high52w is computed from the
// stored 1D bars so it's stable regardless of which timeframe is displayed.
export interface CandleStats {
  high52w: number | null;
}

export interface CandlesResult {
  ticker: string;
  timeframe: Timeframe;
  candles: Candle[];
  stats: CandleStats;
}

// A ranked dark-pool print, for the chart's trade overlays. `time` is UNIX
// seconds (executedAt); `notional` is premium = price × size.
export interface RankedTrade {
  rank: number;
  time: number;
  price: number;
  notional: number;
}

export interface RankedTradesResult {
  ticker: string;
  trades: RankedTrade[];
}
