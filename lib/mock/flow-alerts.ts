import type { FlowAlert, FlowStats } from "@/lib/types";

// 13 static FLOW_RAW entries from the mockup (time strings are display-ready).
export function buildFlowAlerts(): FlowAlert[] {
  const raw: Omit<FlowAlert, "id" | "strike" | "expiry" | "sector">[] = [
    { time: "11:17 AM", ticker: "MRVL", type: "PUT",  side: "SELL", sentiment: "BULLISH", exec: "SWEEP",  multiLeg: false, contract: "$155P May 15",  size: 1748,  oi: 49,     premium: 2_500_000, spot: 146.80,  rule: "Repeated Hits ↑",       confidence: "HIGH", isNew: true },
    { time: "11:17 AM", ticker: "META", type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "SINGLE", multiLeg: true,  contract: "$620C Jun 18",  size: 750,   oi: 1823,   premium: 3_100_000, spot: 613.66,  rule: "Repeated Hits ↑",       confidence: "HIGH", isNew: true },
    { time: "11:17 AM", ticker: "ASTS", type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "FLOOR",  multiLeg: true,  contract: "$80C May 1",    size: 1000,  oi: 134,    premium: 1_000_000, spot: 85.90,   rule: "Floor Trade Large Cap", confidence: "HIGH", isNew: true },
    { time: "11:17 AM", ticker: "FXI",  type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "FLOOR",  multiLeg: true,  contract: "$39C Jul 17",   size: 13311, oi: 2873,   premium: 1_500_000, spot: 37.59,   rule: "Floor Trade Mid Cap",   confidence: "HIGH" },
    { time: "11:17 AM", ticker: "PDD",  type: "CALL", side: "SELL", sentiment: "BEARISH", exec: "SWEEP",  multiLeg: true,  contract: "$105C May 1",   size: 5000,  oi: 439,    premium: 1_100_000, spot: 103.38,  rule: "Repeated Hits",         confidence: "HIGH" },
    { time: "11:07 AM", ticker: "DVN",  type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "FLOOR",  multiLeg: false, contract: "$45C May 15",   size: 7740,  oi: 1846,   premium: 1_000_000, spot: 43.56,   rule: "Floor Trade Large Cap", confidence: "HIGH" },
    { time: "11:07 AM", ticker: "ASML", type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "SWEEP",  multiLeg: true,  contract: "$1580C Jun 18", size: 256,   oi: 63,     premium: 1_700_000, spot: 1441.00, rule: "Repeated Hits ↓",       confidence: "HIGH" },
    { time: "11:07 AM", ticker: "GLD",  type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "SINGLE", multiLeg: false, contract: "$443C May 1",   size: 936,   oi: 95,     premium: 776_000,   spot: 442.71,  rule: "Repeated Hits ↑",       confidence: "HIGH" },
    { time: "10:52 AM", ticker: "NVDA", type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "SWEEP",  multiLeg: true,  contract: "$900C Apr 25",  size: 1200,  oi: 44100,  premium: 1_900_000, spot: 872.20,  rule: "Unusual Activity",      confidence: "HIGH" },
    { time: "10:52 AM", ticker: "SPY",  type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "SWEEP",  multiLeg: true,  contract: "$550C Apr 25",  size: 8400,  oi: 124400, premium: 4_200_000, spot: 544.40,  rule: "Block Print",           confidence: "HIGH" },
    { time: "10:45 AM", ticker: "QQQ",  type: "PUT",  side: "BUY",  sentiment: "BEARISH", exec: "SWEEP",  multiLeg: false, contract: "$440P May 2",   size: 5200,  oi: 88200,  premium: 2_800_000, spot: 462.80,  rule: "Large Hedge",           confidence: "MED" },
    { time: "10:38 AM", ticker: "TSLA", type: "CALL", side: "BUY",  sentiment: "BULLISH", exec: "SINGLE", multiLeg: true,  contract: "$270C May 15",  size: 4100,  oi: 28700,  premium: 3_400_000, spot: 247.60,  rule: "Repeated Hits ↑",       confidence: "HIGH" },
    { time: "10:22 AM", ticker: "AAPL", type: "PUT",  side: "SELL", sentiment: "BULLISH", exec: "FLOOR",  multiLeg: false, contract: "$190P May 1",   size: 2800,  oi: 9400,   premium: 1_200_000, spot: 172.40,  rule: "Floor Trade Large Cap", confidence: "HIGH" },
  ];

  return raw.map((r, i) => ({
    ...r,
    id: `alert-${i}-${r.ticker}`,
    strike: 0,
    expiry: "",
    sector: "Technology",
  }));
}

export function computeFlowStats(alerts: FlowAlert[]): FlowStats {
  const calls = alerts.filter(a => a.type === "CALL").length;
  const puts = alerts.filter(a => a.type === "PUT").length;
  const totalPrem = alerts.reduce((s, a) => s + a.premium, 0);
  const cpRatio = puts === 0 ? calls : Number((calls / puts).toFixed(2));

  const ruleCounts = new Map<string, number>();
  for (const a of alerts) ruleCounts.set(a.rule, (ruleCounts.get(a.rule) ?? 0) + 1);
  const [topRuleName, topRuleCount] = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["Unusual activity", 0];

  return {
    count: alerts.length,
    calls,
    puts,
    totalPrem,
    cpRatio,
    topRule: { name: topRuleName, pct: alerts.length ? Math.round((topRuleCount / alerts.length) * 100) : 0 },
  };
}
