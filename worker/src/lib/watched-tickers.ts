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
] as const;

export type WatchedTicker = (typeof WATCHED_TICKERS)[number];
