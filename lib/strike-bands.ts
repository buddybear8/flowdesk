// Per-ticker strike-band width for the GEX heatmap (and any other view that
// needs to filter UW's 50-strike response down to a near-money window).
//
// Why this varies by ticker:
//   Indices (SPY/QQQ/SPX) — tight gamma concentration, daily expirations.
//     A narrow band keeps the matrix dense and meaningful.
//   Megacaps (META/AMZN/GOOGL/MSFT) — moderate beta; ~15% band captures the
//     range a typical week's price action can travel.
//   High-beta names (TSLA/NVDA/NFLX/AMD) — can move 10–15% in a single day
//     on earnings or news; need a wider band so the heatmap still shows
//     strikes that price could reach.
//
// Numbers are expressed as a decimal fraction of spot (0.10 = ±10% of spot).

const BAND: Record<string, number> = {
  // Indices
  SPY: 0.10,
  QQQ: 0.10,
  SPX: 0.10,
  // Megacaps
  META: 0.15,
  AMZN: 0.15,
  GOOGL: 0.15,
  MSFT: 0.15,
  // High-beta
  TSLA: 0.25,
  NVDA: 0.25,
  NFLX: 0.25,
  AMD: 0.20,
};

const DEFAULT_BAND = 0.15;

export function strikeBandFor(ticker: string): number {
  return BAND[ticker] ?? DEFAULT_BAND;
}
