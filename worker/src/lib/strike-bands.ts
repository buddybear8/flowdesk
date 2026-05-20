// Worker-side mirror of frontend `lib/strike-bands.ts`. Same per-ticker
// strike bands the API route uses to filter UW heatmap rows down to the
// near-money window. Kept here so pollGex can pre-bound its UW request to
// the band UW will end up filtering to anyway, slashing the row count we
// paginate through.
//
// MUST stay in sync with `lib/strike-bands.ts` (frontend). If a value changes
// on one side, update both.

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
