import type { HitListItem, HitListPayload, SectorFlow } from "@/lib/types";

// Six HITS from the mockup verbatim.
export function buildHitList(): HitListItem[] {
  return [
    {
      rank: 1,
      ticker: "MRVL",
      price: 136.34,
      direction: "UP",
      confidence: "MOD",
      premium: 2_500_000,
      contract: "$145P May 15",
      dpConf: true,
      dpRank: 7,
      dpAge: "today",
      dpPrem: 1_800_000,
      thesis: "Ascending fill pattern. Multi-leg structure.",
      sector: "Technology",
      contracts: [
        { strikeLabel: "$145P", expiryLabel: "May 15", premiumLabel: "$1.9M", rule: "Repeated Hits Ascending Fill — Sweep", vOiLabel: "80.7x" },
        { strikeLabel: "$160C", expiryLabel: "May 15", premiumLabel: "$552.4K", rule: "Repeated Hits", vOiLabel: "—" },
      ],
      peers: [
        { ticker: "INTC", premiumLabel: "$1.6M", direction: "UP" },
        { ticker: "CDNS", premiumLabel: "$4.8M", direction: "UP" },
        { ticker: "MSTR", premiumLabel: "$4.4M", direction: "UP" },
      ],
      theme: { name: "Semiconductors", totalPremiumLabel: "$15.1M", tickers: ["CDNS", "NVDA", "MRVL", "INTC", "LITE", "SMH"] },
    },
    {
      rank: 2,
      ticker: "IVZ",
      price: 14.82,
      direction: "UP",
      confidence: "MOD",
      premium: 3_600_000,
      contract: "$25C Jul 17",
      dpConf: false,
      thesis: "Call spread structure. Institutional accumulation.",
      sector: "Financial Ser.",
      contracts: [
        { strikeLabel: "$25C", expiryLabel: "Jul 17", premiumLabel: "$3.6M", rule: "Large Floor Trade — Call Spread", vOiLabel: "42.1x" },
      ],
      peers: [{ ticker: "BLK", premiumLabel: "$2.1M", direction: "UP" }],
      theme: { name: "Asset managers", totalPremiumLabel: "$6.5M", tickers: ["IVZ", "BLK", "BEN"] },
    },
    {
      rank: 3,
      ticker: "GLD",
      price: 242.70,
      direction: "UP",
      confidence: "HIGH",
      premium: 2_600_000,
      contract: "$425C May 1",
      dpConf: true,
      dpRank: 3,
      dpAge: "yesterday",
      dpPrem: 4_200_000,
      thesis: "Ascending call strikes across 4 consecutive sweeps.",
      sector: "Commodities",
      contracts: [
        { strikeLabel: "$425C", expiryLabel: "May 1", premiumLabel: "$1.4M", rule: "Repeated Hits Sweep", vOiLabel: "18.2x" },
        { strikeLabel: "$430C", expiryLabel: "May 1", premiumLabel: "$1.2M", rule: "Repeated Hits", vOiLabel: "14.7x" },
      ],
      peers: [
        { ticker: "SLV", premiumLabel: "$3.0M", direction: "UP" },
        { ticker: "GDX", premiumLabel: "$1.8M", direction: "UP" },
      ],
      theme: { name: "Precious metals", totalPremiumLabel: "$8.9M", tickers: ["GLD", "SLV", "GDX", "GDXJ"] },
    },
    {
      rank: 4,
      ticker: "CDNS",
      price: 247.80,
      direction: "UP",
      confidence: "LOW",
      premium: 4_800_000,
      contract: "$330C Jun 18",
      dpConf: true,
      dpRank: 22,
      dpAge: "today",
      dpPrem: 2_100_000,
      thesis: "Multi-leg block + sweep combination.",
      sector: "Technology",
      contracts: [
        { strikeLabel: "$330C", expiryLabel: "Jun 18", premiumLabel: "$4.8M", rule: "Multi-leg Block Print", vOiLabel: "61.4x" },
      ],
      peers: [{ ticker: "MRVL", premiumLabel: "$2.5M", direction: "UP", highlighted: true }],
      theme: { name: "EDA software", totalPremiumLabel: "$7.2M", tickers: ["CDNS", "SNPS", "ANSS"] },
    },
    {
      rank: 5,
      ticker: "SPY",
      price: 544.40,
      direction: "DOWN",
      confidence: "LOW",
      premium: 3_700_000,
      contract: "$700P May 15",
      dpConf: true,
      dpRank: 1,
      dpAge: "today",
      dpPrem: 12_400_000,
      thesis: "Put selling at scale — 2 or more institutions hedging.",
      sector: "Index",
      contracts: [
        { strikeLabel: "$700P", expiryLabel: "May 15", premiumLabel: "$3.7M", rule: "Large Hedge Sweep", vOiLabel: "124.0x" },
      ],
      peers: [],
      theme: { name: "Macro hedge", totalPremiumLabel: "$10.2M", tickers: ["SPY", "QQQ", "IWM", "TLT"] },
    },
    {
      rank: 6,
      ticker: "NVDA",
      price: 872.20,
      direction: "UP",
      confidence: "HIGH",
      premium: 1_900_000,
      contract: "$900C Apr 25",
      dpConf: false,
      thesis: "Unusual activity sweep. Breaking out of range.",
      sector: "Technology",
      contracts: [
        { strikeLabel: "$900C", expiryLabel: "Apr 25", premiumLabel: "$1.9M", rule: "Unusual Activity Sweep", vOiLabel: "44.1x" },
      ],
      peers: [{ ticker: "AMD", premiumLabel: "$1.2M", direction: "UP" }],
      theme: { name: "AI/Semis", totalPremiumLabel: "$12.4M", tickers: ["NVDA", "AMD", "INTC", "SMCI"] },
    },
  ];
}

export function buildWatchesPayload(): HitListPayload {
  const hits = buildHitList();
  const sectorFlow: SectorFlow[] = [
    { sector: "Technology", netPremium: 23_600_000 },
    { sector: "Financial Ser.", netPremium: 6_500_000 },
    { sector: "Commodities", netPremium: 3_300_000 },
    { sector: "Healthcare", netPremium: 2_500_000 },
    { sector: "Industrials", netPremium: 2_400_000 },
    { sector: "Communication", netPremium: -3_000_000 },
    { sector: "Consumer D.", netPremium: -760_000 },
  ];

  return {
    sessionMeta: {
      date: "Monday, April 21",
      sentiment: "BULLISH",
      totalPremLabel: "$57.4M",
      callPutLabel: "86/14",
      leadSector: "Technology",
    },
    hits,
    sectorFlow,
  };
}
