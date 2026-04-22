import type { GEXPayload, GEXLevel, KeyLevels } from "@/lib/types";

// SPY GEX data verbatim from the mockup (netOI + netDV arrays).
const SPY_RAW = {
  spot: 544.40,
  atm: 544,
  o1Label: "$18.06B",
  o2Label: "35,723",
  d1Label: "$765M",
  d2Label: "1,514,064",
  strikes: [525, 528, 531, 534, 537, 540, 542, 543, 544, 545, 546, 547, 548, 550, 552, 554, 556, 558, 560],
  netOI: [-90, -30, 200, 480, 820, 1400, 2400, 3200, 4200, 3800, 2600, 1800, 1100, 700, 420, 260, 160, 100, 55],
  netDV: [-36, -12, 80, 192, 328, 560, 960, 1280, 1680, 1520, 1040, 720, 440, 280, 168, 104, 64, 40, 22],
  cWall: 550,
  pWall: 525,
  flip: 536,
  maxPain: 542,
};

// Parallel stubs for the other 4 tickers (mockup shows just SPY data in detail; others can fall back).
const TICKERS = {
  SPY: SPY_RAW,
  QQQ: { ...SPY_RAW, spot: 462.80, atm: 463, cWall: 468, pWall: 448, flip: 455, maxPain: 461, o1Label: "$12.4B", o2Label: "24,800", d1Label: "$540M", d2Label: "1,080,000" },
  SPX: { ...SPY_RAW, spot: 5445, atm: 5445, cWall: 5500, pWall: 5250, flip: 5360, maxPain: 5420, o1Label: "$24.2B", o2Label: "48,400", d1Label: "$980M", d2Label: "1,960,000" },
  NVDA: { ...SPY_RAW, spot: 872.20, atm: 872, cWall: 900, pWall: 840, flip: 858, maxPain: 872, o1Label: "$4.8B", o2Label: "9,600", d1Label: "$280M", d2Label: "560,000" },
  TSLA: { ...SPY_RAW, spot: 247.60, atm: 248, cWall: 270, pWall: 230, flip: 244, maxPain: 247, o1Label: "$2.1B", o2Label: "4,200", d1Label: "$140M", d2Label: "280,000" },
};

export function buildGEXPayload(ticker: string = "SPY"): GEXPayload {
  const t = (TICKERS as Record<string, typeof SPY_RAW>)[ticker.toUpperCase()] ?? SPY_RAW;

  const strikes: GEXLevel[] = t.strikes.map((strike, i) => {
    const netOI = t.netOI[i]! * 1_000_000;   // mockup values are in $M
    const netDV = t.netDV[i]! * 1_000_000;
    const call_gamma_oi = Math.max(0, netOI);
    const put_gamma_oi = Math.max(0, -netOI);
    return {
      strike,
      call_gamma_oi,
      put_gamma_oi,
      call_gamma_bid: call_gamma_oi * 0.4,
      call_gamma_ask: call_gamma_oi * 0.45,
      put_gamma_bid: put_gamma_oi * 0.4,
      put_gamma_ask: put_gamma_oi * 0.38,
      netDV,
      netOI,
      combined: netOI + netDV,
    };
  });

  const keyLevels: KeyLevels = {
    callWall: t.cWall,
    putWall: t.pWall,
    gammaFlip: t.flip,
    maxPain: t.maxPain,
    spot: t.spot,
  };

  const netGexOI = strikes.reduce((s, r) => s + r.netOI, 0);
  const netGexDV = strikes.reduce((s, r) => s + r.netDV, 0);

  return {
    ticker,
    asOf: new Date().toISOString(),
    strikes,
    keyLevels,
    netGexOI,
    netGexDV,
    gammaRegime: t.spot > t.flip ? "POSITIVE" : "NEGATIVE",
  };
}

export const buildGexPayload = buildGEXPayload;

// Extra labels consumers can pull for the details panel (not in the GEXPayload shape
// because PRD defines raw numbers only — labels formatted at render time otherwise).
export function gexLabels(ticker: string = "SPY") {
  const t = (TICKERS as Record<string, typeof SPY_RAW>)[ticker.toUpperCase()] ?? SPY_RAW;
  return { o1: t.o1Label, o2: t.o2Label, d1: t.d1Label, d2: t.d2Label, atm: t.atm };
}
