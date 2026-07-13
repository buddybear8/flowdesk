// Single source of truth for the watched tickers (PRD §8 — Options GEX
// module dropdown). Used by:
//   - jobs/uw.ts (pollGex iterates these)
//   - jobs/refresh-ticker-metadata.ts (always seeded)
//   - jobs/ai-summarizer-gex.ts (one summary per ticker per day)
//
// To add or remove a watched ticker, change THIS list — every consumer
// follows automatically. The per-ticker option expiration cadence lives
// separately in lib/option-expirations.ts.

export const WATCHED_TICKERS = [
  "SPY",
  "SPX",
  "QQQ",
  "TSLA",
  "NVDA",
  "AMD",
  "META",
  "AMZN",
  "GOOGL",
  "NFLX",
  "MSFT",
  "AAPL",
  "MU",
  "DRAM",
  "SPCX",
  "ORCL",
  "MRVL",
  "BABA",
  "APP",
  "HOOD",
  "ASTS",
  "ENPH",
  "SOXX",
  "SMH",
  "NBIS",
  "SNOW",
  "PLTR",
  "NOW",
  "SNDK",
  "QCOM",
  "COIN",
] as const;

export type WatchedTicker = (typeof WATCHED_TICKERS)[number];

// Cadence tiers (2026-07-13 quota incident: 31 tickers × 2-min polling plus
// the earnings sweeps exhausted UW's daily budget by early afternoon).
// HOT keeps the original 2-minute cadence; everything else polls on a
// 10-minute rotation.
export const HOT_TICKERS = [
  "SPY", "SPX", "QQQ", "TSLA", "NVDA", "AMD", "META", "AMZN",
  "GOOGL", "NFLX", "MSFT", "AAPL", "MU", "DRAM", "SPCX",
] as const;
const HOT_SET: Set<string> = new Set(HOT_TICKERS);
export const EXTENDED_TICKERS: string[] = WATCHED_TICKERS.filter((t) => !HOT_SET.has(t));
