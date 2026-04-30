import { seededRng } from "@/lib/utils";

// =============================================================
// Market Tide (time-series) + Top Net Impact (per-ticker snapshot)
// Mock fixtures that mirror UW's Market Tide screen.
// =============================================================

export interface MarketTidePoint {
  time: string;           // "09:30"
  spyPrice: number;
  netCallPremium: number; // cumulative $ through session
  netPutPremium: number;  // cumulative $ (negative)
  volume: number;         // 5-min bucket share volume
}

export interface MarketTideSnapshot {
  asOf: string;           // "2026-04-22T11:34:00-04:00"
  asOfLabel: string;      // "11:34 AM"
  spyCurrent: number;
  volumeCurrent: number;
  netCallPremiumCurrent: number;
  netPutPremiumCurrent: number;
  series: MarketTidePoint[];
}

/**
 * Builds a deterministic Market Tide series from 9:30 AM to `endTime` (default 11:35 AM)
 * in 5-minute buckets. SPY meanders ~703 → 709.75 with noise. Net call premium climbs
 * monotonically ~360M, net put premium drifts to –30M.
 */
export function buildMarketTide(): MarketTideSnapshot {
  const series: MarketTidePoint[] = [];
  const rng = seededRng(422);
  const startMin = 9 * 60 + 30;
  const endMin = 11 * 60 + 35;
  const step = 5;

  let spy = 703.42;
  const spyTarget = 709.75;
  const bucketCount = Math.floor((endMin - startMin) / step);

  for (let i = 0; i <= bucketCount; i++) {
    const t = startMin + i * step;
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;

    // Drift SPY toward target + noise.
    const drift = (spyTarget - spy) * 0.06;
    const noise = (rng() - 0.5) * 0.9;
    spy = Number((spy + drift + noise).toFixed(2));

    // Net call premium climbs sigmoidally to ~360M.
    const progress = i / bucketCount;
    const netCallPremium = Math.round(360_000_000 * (1 - Math.exp(-3.2 * progress)));
    // Net put premium dips to ~-30M mid-morning then recovers slightly.
    const dipProgress = Math.sin(progress * Math.PI);
    const netPutPremium = Math.round(-28_000_000 * dipProgress - 2_000_000);

    // Volume: high open, tapers.
    const openBias = Math.exp(-progress * 3.5);
    const volume = Math.round((80_000 + openBias * 420_000) * (0.85 + rng() * 0.3));

    series.push({ time, spyPrice: spy, netCallPremium, netPutPremium, volume });
  }

  // Nudge the last point to the "current" figures from the UW screenshot.
  const last = series[series.length - 1]!;
  last.spyPrice = 709.75;
  last.netCallPremium = 360_000_000;
  last.netPutPremium = -30_000_000;
  last.volume = 509_000;

  return {
    asOf: "2026-04-22T11:34:00-04:00",
    asOfLabel: "11:34 AM",
    spyCurrent: last.spyPrice,
    volumeCurrent: last.volume,
    netCallPremiumCurrent: last.netCallPremium,
    netPutPremiumCurrent: last.netPutPremium,
    series,
  };
}

// =============================================================
// Top Net Impact Chart — per-ticker net premium snapshot
//
// Net Impact = (call_ask_premium - call_bid_premium)
//            + (put_bid_premium - put_ask_premium)
// i.e. aggressive call buying minus aggressive put buying.
// Bullish flow → positive; bearish flow → negative.
//
// The 10 tickers with the largest |Net Impact| during the same calendar
// day are selected (so a fully-bearish tape still surfaces 10 names).
// Display order: most-positive → most-negative for chart readability.
// =============================================================

export interface NetImpactRow {
  ticker: string;
  netPremium: number; // USD; negative = bearish flow, positive = bullish
}

export interface NetImpactSnapshot {
  asOf: string;
  period: "1D" | "4H" | "1H";
  rows: NetImpactRow[];
}

export function buildNetImpact(): NetImpactSnapshot {
  return {
    asOf: "2026-04-22T11:33:00-04:00",
    period: "1D",
    rows: [
      { ticker: "MU",   netPremium: 118_000_000 },
      { ticker: "AAPL", netPremium: 82_000_000 },
      { ticker: "AVGO", netPremium: 46_000_000 },
      { ticker: "AMD",  netPremium: 38_000_000 },
      { ticker: "SNDK", netPremium: 34_000_000 },
      { ticker: "MRVL", netPremium: 31_000_000 },
      { ticker: "LITE", netPremium: 26_000_000 },
      { ticker: "BA",   netPremium: 22_000_000 },
      { ticker: "TSLA", netPremium: -46_000_000 },
      { ticker: "CAR",  netPremium: -58_000_000 },
    ],
  };
}
