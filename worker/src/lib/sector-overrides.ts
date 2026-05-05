// Static overrides for tickers UW's classification can't or won't supply.
// Two purposes:
//   (a) ETFs UW returns `sector: null` for (SPY, GLD, TLT, UVXY, ...) —
//       map to one of the 4 ETF asset classes (Index/Commodities/Bonds/Volatility).
//   (b) Sector SPDRs (XLK, XLF, ...) — pin to the underlying sector exposure
//       so they group sensibly on the dashboard.
//
// Used by jobs/refresh-ticker-metadata.ts. Overrides ALWAYS win against
// UW-derived data — an entry here is a final answer.
//
// `Sector` mirrors the union in lib/types/index.ts (15 values: 11 GICS +
// 4 ETF asset classes, locked v1.2.2 / PRD §18). Duplicated here because
// the worker package is not wired to import from the repo-root lib/. If the
// union changes in lib/types/index.ts, update this list too.

export type Sector =
  | "Technology"
  | "Communication"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Energy"
  | "Financials"
  | "Health Care"
  | "Industrials"
  | "Materials"
  | "Real Estate"
  | "Utilities"
  | "Index"
  | "Commodities"
  | "Bonds"
  | "Volatility";

export interface SectorOverride {
  sector: Sector;
  isEtf: boolean;
  name?: string;
}

export const SECTOR_OVERRIDES: Record<string, SectorOverride> = {
  // ─── Broad-market index ETFs ─────────────────────────────────────────────
  SPY:  { sector: "Index", isEtf: true,  name: "SPDR S&P 500 ETF" },
  QQQ:  { sector: "Index", isEtf: true,  name: "Invesco QQQ Trust" },
  IWM:  { sector: "Index", isEtf: true,  name: "iShares Russell 2000 ETF" },
  DIA:  { sector: "Index", isEtf: true,  name: "SPDR Dow Jones Industrial Average ETF" },
  VTI:  { sector: "Index", isEtf: true,  name: "Vanguard Total Stock Market ETF" },
  VOO:  { sector: "Index", isEtf: true,  name: "Vanguard S&P 500 ETF" },
  IVV:  { sector: "Index", isEtf: true,  name: "iShares Core S&P 500 ETF" },
  SPLG: { sector: "Index", isEtf: true,  name: "SPDR Portfolio S&P 500 ETF" },
  MDY:  { sector: "Index", isEtf: true,  name: "SPDR S&P MidCap 400 ETF" },
  VTV:  { sector: "Index", isEtf: true,  name: "Vanguard Value ETF" },
  VUG:  { sector: "Index", isEtf: true,  name: "Vanguard Growth ETF" },
  EFA:  { sector: "Index", isEtf: true,  name: "iShares MSCI EAFE ETF" },
  EEM:  { sector: "Index", isEtf: true,  name: "iShares MSCI Emerging Markets ETF" },

  // ─── Cash-settled indices (NOT ETFs) ─────────────────────────────────────
  SPX:  { sector: "Index",      isEtf: false, name: "S&P 500 Index" },
  NDX:  { sector: "Index",      isEtf: false, name: "Nasdaq-100 Index" },
  RUT:  { sector: "Index",      isEtf: false, name: "Russell 2000 Index" },
  VIX:  { sector: "Volatility", isEtf: false, name: "CBOE Volatility Index" },

  // ─── Volatility ETFs / ETNs ──────────────────────────────────────────────
  UVXY: { sector: "Volatility", isEtf: true, name: "ProShares Ultra VIX Short-Term Futures ETF" },
  VXX:  { sector: "Volatility", isEtf: true, name: "iPath S&P 500 VIX Short-Term Futures ETN" },
  VIXY: { sector: "Volatility", isEtf: true, name: "ProShares VIX Short-Term Futures ETF" },
  SVXY: { sector: "Volatility", isEtf: true, name: "ProShares Short VIX Short-Term Futures ETF" },

  // ─── Bond ETFs ───────────────────────────────────────────────────────────
  TLT:  { sector: "Bonds", isEtf: true, name: "iShares 20+ Year Treasury Bond ETF" },
  IEF:  { sector: "Bonds", isEtf: true, name: "iShares 7-10 Year Treasury Bond ETF" },
  SHY:  { sector: "Bonds", isEtf: true, name: "iShares 1-3 Year Treasury Bond ETF" },
  HYG:  { sector: "Bonds", isEtf: true, name: "iShares iBoxx High Yield Corporate Bond ETF" },
  LQD:  { sector: "Bonds", isEtf: true, name: "iShares iBoxx Investment Grade Corporate Bond ETF" },
  AGG:  { sector: "Bonds", isEtf: true, name: "iShares Core U.S. Aggregate Bond ETF" },
  BND:  { sector: "Bonds", isEtf: true, name: "Vanguard Total Bond Market ETF" },
  TIP:  { sector: "Bonds", isEtf: true, name: "iShares TIPS Bond ETF" },
  MUB:  { sector: "Bonds", isEtf: true, name: "iShares National Muni Bond ETF" },
  JNK:  { sector: "Bonds", isEtf: true, name: "SPDR Bloomberg High Yield Bond ETF" },

  // ─── Commodity ETFs ──────────────────────────────────────────────────────
  GLD:  { sector: "Commodities", isEtf: true, name: "SPDR Gold Shares" },
  IAU:  { sector: "Commodities", isEtf: true, name: "iShares Gold Trust" },
  SLV:  { sector: "Commodities", isEtf: true, name: "iShares Silver Trust" },
  USO:  { sector: "Commodities", isEtf: true, name: "United States Oil Fund" },
  UNG:  { sector: "Commodities", isEtf: true, name: "United States Natural Gas Fund" },
  DBA:  { sector: "Commodities", isEtf: true, name: "Invesco DB Agriculture Fund" },
  PDBC: { sector: "Commodities", isEtf: true, name: "Invesco Optimum Yield Diversified Commodity Strategy" },
  GDX:  { sector: "Commodities", isEtf: true, name: "VanEck Gold Miners ETF" },
  GDXJ: { sector: "Commodities", isEtf: true, name: "VanEck Junior Gold Miners ETF" },

  // ─── Sector SPDRs (map to underlying sector) ─────────────────────────────
  XLK:  { sector: "Technology",             isEtf: true, name: "Technology Select Sector SPDR" },
  XLF:  { sector: "Financials",             isEtf: true, name: "Financial Select Sector SPDR" },
  XLE:  { sector: "Energy",                 isEtf: true, name: "Energy Select Sector SPDR" },
  XLV:  { sector: "Health Care",            isEtf: true, name: "Health Care Select Sector SPDR" },
  XLI:  { sector: "Industrials",            isEtf: true, name: "Industrial Select Sector SPDR" },
  XLY:  { sector: "Consumer Discretionary", isEtf: true, name: "Consumer Discretionary Select Sector SPDR" },
  XLP:  { sector: "Consumer Staples",       isEtf: true, name: "Consumer Staples Select Sector SPDR" },
  XLB:  { sector: "Materials",              isEtf: true, name: "Materials Select Sector SPDR" },
  XLRE: { sector: "Real Estate",            isEtf: true, name: "Real Estate Select Sector SPDR" },
  XLU:  { sector: "Utilities",              isEtf: true, name: "Utilities Select Sector SPDR" },
  XLC:  { sector: "Communication",          isEtf: true, name: "Communication Services Select Sector SPDR" },
};
