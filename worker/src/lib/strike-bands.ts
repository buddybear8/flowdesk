// Worker-side mirror of frontend `lib/strike-bands.ts`. Same per-ticker
// strike bands the API route uses to filter UW heatmap rows down to the
// near-money window. Kept here so pollGex can pre-bound its UW request to
// the band UW will end up filtering to anyway, slashing the row count we
// paginate through.
//
// MUST stay in sync with `lib/strike-bands.ts` (frontend). If a value changes
// on one side, update both. (Re-synced 2026-09-23 — the mirror had drifted
// to only the original 11 names, so wide-band tickers were being pre-bounded
// to the 0.15 default.)

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
  AAPL: 0.15,
  // High-beta
  TSLA: 0.25,
  NVDA: 0.25,
  NFLX: 0.25,
  AMD: 0.20,
  ORCL: 0.15,
  BABA: 0.15,
  MRVL: 0.20,
  ENPH: 0.20,
  APP: 0.25,
  HOOD: 0.25,
  ASTS: 0.30,
  SOXX: 0.15,
  SMH: 0.15,
  QCOM: 0.15,
  NOW: 0.15,
  SNOW: 0.20,
  PLTR: 0.20,
  COIN: 0.25,
  SNDK: 0.25,
  NBIS: 0.30,
  INTC: 0.25,
  // Index/ETF additions (2026-08)
  VIX: 0.35, // volatility index — wide, strikes are ~1pt on a ~15-20 base
  GLD: 0.10,
  SLV: 0.15,
  GDX: 0.20,
  XBI: 0.15,
  XLE: 0.12,
  XLK: 0.10,
  // 2026-09-23 additions
  DELL: 0.20,
  SMCI: 0.30,
  IREN: 0.35,
  AVGO: 0.15,
  BE: 0.30,
  ARM: 0.25,
  CVNA: 0.30,
  DDOG: 0.20,
  PANW: 0.15,
  RDDT: 0.30,
  PDD: 0.20,
  CRWD: 0.15,
  VALE: 0.15,
  IWM: 0.10,
  DIA: 0.10,
  USO: 0.15,
};

const DEFAULT_BAND = 0.15;

export function strikeBandFor(ticker: string): number {
  return BAND[ticker] ?? DEFAULT_BAND;
}
