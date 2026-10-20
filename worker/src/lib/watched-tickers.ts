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
  "INTC",
  "VIX",
  "GLD",
  "GDX",
  "SLV",
  // 2026-09-23 additions (community requests, warm tier)
  "DELL",
  "SMCI",
  "IREN",
  "AVGO",
  "BE",
  "ARM",
  "CVNA",
  "DDOG",
  "PANW",
  "RDDT",
  "PDD",
  "CRWD",
  "VALE",
  "IWM",
  "DIA",
  "USO",
] as const;

export type WatchedTicker = (typeof WATCHED_TICKERS)[number];

// Cadence tiers (2026-07-13 quota incident: 31 tickers × 2-min polling plus
// the earnings sweeps exhausted UW's daily budget by early afternoon).
// TURBO: once per minute — UW's native refresh cadence (SPX 2026-09-03;
// SPY/QQQ 2026-09-23; megacaps promoted 2026-10-21).
// HOT: 2-minute cadence. WARM: 3-minute cadence (2026-09-23 additions).
// Everything else polls on a 10-minute rotation.
// Budget ≈ 11×2.3K + 4×1.2K + 16×0.8K + 21×0.25K ≈ 48K GEX calls/day
// (+~10K non-GEX) against the 80K limit — headers are gone since Oct '26,
// so this arithmetic and 429s are the only quota signals.
export const TURBO_TICKERS = [
  "SPX", "SPY", "QQQ",
  "TSLA", "NVDA", "AAPL", "META", "AMZN", "MU", "GOOGL", "AMD",
] as const;
export const HOT_TICKERS = ["NFLX", "MSFT", "DRAM", "SPCX"] as const;
export const WARM_TICKERS = [
  "DELL", "SMCI", "IREN", "AVGO", "BE", "ARM", "CVNA", "DDOG",
  "PANW", "RDDT", "PDD", "CRWD", "VALE", "IWM", "DIA", "USO",
] as const;
const FAST_SET: Set<string> = new Set([...TURBO_TICKERS, ...HOT_TICKERS, ...WARM_TICKERS]);
export const EXTENDED_TICKERS: string[] = WATCHED_TICKERS.filter((t) => !FAST_SET.has(t));
