import type {
  SentimentOverview,
  AnalystIntelligence,
  SentimentTicker,
  SectorSentiment,
  DivergenceAlert,
  NotablePost,
  NewEntrantFlip,
  AnalystProfile,
} from "@/lib/types";

// =====================================================
// Overview-tab display data (match Sentiment Analysis.html)
// =====================================================

export interface SentimentDisplayRow {
  ticker: string;
  name: string;
  velocityPctLabel: string;       // width for progress bar, e.g. "100%"
  barColor: string;
  velocityChangeLabel: string;    // "+340%"
  pill: "bull" | "bear" | "mix";
}

export interface SectorDisplayRow {
  name: string;
  pctLabel: string;
  color: string;
  tone: "up" | "dn" | "neu";
}

export function buildSentimentDisplayRows(): SentimentDisplayRow[] {
  return [
    { ticker: "PLTR", name: "Palantir",    velocityPctLabel: "100%", barColor: "#185FA5", velocityChangeLabel: "+340%", pill: "bull" },
    { ticker: "NVDA", name: "Nvidia",      velocityPctLabel: "82%",  barColor: "#185FA5", velocityChangeLabel: "+210%", pill: "bull" },
    { ticker: "META", name: "Meta",        velocityPctLabel: "68%",  barColor: "#E24B4A", velocityChangeLabel: "+178%", pill: "bear" },
    { ticker: "TSLA", name: "Tesla",       velocityPctLabel: "55%",  barColor: "#EF9F27", velocityChangeLabel: "+142%", pill: "mix" },
    { ticker: "AAPL", name: "Apple",       velocityPctLabel: "44%",  barColor: "#185FA5", velocityChangeLabel: "+115%", pill: "bull" },
    { ticker: "AMD",  name: "AMD",         velocityPctLabel: "38%",  barColor: "#185FA5", velocityChangeLabel: "+98%",  pill: "bull" },
    { ticker: "SPY",  name: "S&P 500 ETF", velocityPctLabel: "30%",  barColor: "#EF9F27", velocityChangeLabel: "+78%",  pill: "mix" },
    { ticker: "SMCI", name: "Super Micro", velocityPctLabel: "26%",  barColor: "#185FA5", velocityChangeLabel: "+67%",  pill: "bull" },
  ];
}

export function buildSectorDisplayRows(): SectorDisplayRow[] {
  return [
    { name: "Semis",      pctLabel: "88%", color: "#639922", tone: "up" },
    { name: "AI/Cloud",   pctLabel: "76%", color: "#639922", tone: "up" },
    { name: "Financials", pctLabel: "61%", color: "#639922", tone: "up" },
    { name: "EV/Auto",    pctLabel: "52%", color: "#B4B2A9", tone: "neu" },
    { name: "Social",     pctLabel: "31%", color: "#E24B4A", tone: "dn" },
    { name: "Energy",     pctLabel: "27%", color: "#E24B4A", tone: "dn" },
  ];
}

// =====================================================
// Analyst-tab display data (8 analyst chips, custom colors per analyst)
// =====================================================

export interface AnalystDisplayRow {
  initials: string;
  displayName: string;       // name shown on chip, no @
  handle: string;            // "@KobeissiLetter"
  bio: string;
  followersLabel: string;    // "1.66M"
  bullBearLabel: string;     // "72% bull"
  postsPerDay: string;       // "8.4"
  accuracy30dLabel: string;  // "68%"
  callsTracked: string;      // "142"
  bias: "Bullish" | "Bearish" | "Mixed";
  biasBg: string;
  biasText: string;
  avatarBg: string;
  avatarText: string;
}

export function buildAnalystDisplayRows(): AnalystDisplayRow[] {
  return [
    { initials: "KB", displayName: "KobeissiLetter", handle: "@KobeissiLetter", bio: "Capital markets newsletter · Macro & equity · 1.66M followers", followersLabel: "1.66M", bullBearLabel: "72% bull", postsPerDay: "8.4", accuracy30dLabel: "68%", callsTracked: "142", bias: "Bullish", biasBg: "#EAF3DE", biasText: "#3B6D11", avatarBg: "#E6F1FB", avatarText: "#185FA5" },
    { initials: "SJ", displayName: "SJosephBurns",   handle: "@SJosephBurns",   bio: "Macro strategist · Multi-asset · 778K followers",                  followersLabel: "778K",  bullBearLabel: "54% bull", postsPerDay: "5.1", accuracy30dLabel: "57%", callsTracked: "98",  bias: "Mixed",   biasBg: "#FAEEDA", biasText: "#854F0B", avatarBg: "#EAF3DE", avatarText: "#3B6D11" },
    { initials: "CB", displayName: "charliebilello", handle: "@charliebilello", bio: "Research Director · Creative Planning · 748K followers",          followersLabel: "748K",  bullBearLabel: "68% bull", postsPerDay: "6.8", accuracy30dLabel: "64%", callsTracked: "118", bias: "Bullish", biasBg: "#EAF3DE", biasText: "#3B6D11", avatarBg: "#FAECE7", avatarText: "#993C1D" },
    { initials: "MM", displayName: "markminer_",     handle: "@markminer_",     bio: "Macro trader · Fixed income · 612K followers",                     followersLabel: "612K",  bullBearLabel: "38% bull", postsPerDay: "4.2", accuracy30dLabel: "52%", callsTracked: "76",  bias: "Bearish", biasBg: "#FCEBEB", biasText: "#A32D2D", avatarBg: "#EEEDFE", avatarText: "#534AB7" },
    { initials: "GB", displayName: "garyblack00",    handle: "@garyblack00",    bio: "Portfolio manager · EV specialist · 584K followers",               followersLabel: "584K",  bullBearLabel: "71% bull", postsPerDay: "7.2", accuracy30dLabel: "61%", callsTracked: "104", bias: "Bullish", biasBg: "#EAF3DE", biasText: "#3B6D11", avatarBg: "#E1F5EE", avatarText: "#0F6E56" },
    { initials: "WF", displayName: "WOLF_Financial", handle: "@WOLF_Financial", bio: "Derivatives trader · Macro bear · 498K followers",                  followersLabel: "498K",  bullBearLabel: "32% bull", postsPerDay: "9.1", accuracy30dLabel: "41%", callsTracked: "134", bias: "Bearish", biasBg: "#FCEBEB", biasText: "#A32D2D", avatarBg: "#FBEAF0", avatarText: "#993556" },
    { initials: "TS", displayName: "traderstewie",   handle: "@traderstewie",   bio: "Swing trader · Technicals · 442K followers",                        followersLabel: "442K",  bullBearLabel: "66% bull", postsPerDay: "5.4", accuracy30dLabel: "58%", callsTracked: "91",  bias: "Bullish", biasBg: "#EAF3DE", biasText: "#3B6D11", avatarBg: "#E6F1FB", avatarText: "#185FA5" },
    { initials: "R",  displayName: "ripster47",      handle: "@ripster47",      bio: "EMA cloud · Education · 456K followers",                            followersLabel: "456K",  bullBearLabel: "63% bull", postsPerDay: "6.1", accuracy30dLabel: "59%", callsTracked: "108", bias: "Bullish", biasBg: "#EAF3DE", biasText: "#3B6D11", avatarBg: "#EAF3DE", avatarText: "#3B6D11" },
  ];
}

// Aggregate view lists (exact from mockup)
export interface MentionedRow { ticker: string; name: string; analystCount: string; pill: "bull" | "bear" | "mix"; }
export const MENTIONED_ROWS: MentionedRow[] = [
  { ticker: "NVDA", name: "Nvidia",        analystCount: "18 analysts", pill: "bull" },
  { ticker: "META", name: "Meta",          analystCount: "14 analysts", pill: "bear" },
  { ticker: "NBIS", name: "Nebius Group",  analystCount: "11 analysts", pill: "bull" },
  { ticker: "TSLA", name: "Tesla",         analystCount: "10 analysts", pill: "mix" },
  { ticker: "AAPL", name: "Apple",         analystCount: "9 analysts",  pill: "bull" },
  { ticker: "AMD",  name: "AMD",           analystCount: "8 analysts",  pill: "bull" },
  { ticker: "PLTR", name: "Palantir",      analystCount: "8 analysts",  pill: "bull" },
  { ticker: "SPY",  name: "S&P ETF",       analystCount: "7 analysts",  pill: "mix" },
];

export interface AccuracyLeader { handle: string; pctLabel: string; pct: number; barColor: string; tone: "up" | "warn" | "dn"; }
export const ACCURACY_LEADERS: AccuracyLeader[] = [
  { handle: "@KobeissiLetter", pctLabel: "68%", pct: 68, barColor: "#639922", tone: "up" },
  { handle: "@charliebilello", pctLabel: "64%", pct: 64, barColor: "#639922", tone: "up" },
  { handle: "@garyblack00",    pctLabel: "61%", pct: 61, barColor: "#639922", tone: "up" },
  { handle: "@ripster47",      pctLabel: "59%", pct: 59, barColor: "#639922", tone: "up" },
  { handle: "@markminer_",     pctLabel: "52%", pct: 52, barColor: "#EF9F27", tone: "warn" },
  { handle: "@WOLF_Financial", pctLabel: "41%", pct: 41, barColor: "#E24B4A", tone: "dn" },
];

export interface BuySellRow { ticker: string; name: string; pctLabel: string; direction: "up" | "dn"; pill: "bull" | "bear"; }
export const TOP_BUYS: BuySellRow[] = [
  { ticker: "AAOI", name: "Applied Optoelectronics", pctLabel: "+20.3%", direction: "up", pill: "bull" },
  { ticker: "LUNR", name: "Intuitive Machines",       pctLabel: "+18.5%", direction: "up", pill: "bull" },
  { ticker: "LITE", name: "Lumentum Holdings",        pctLabel: "+8.1%",  direction: "up", pill: "bull" },
  { ticker: "NVDA", name: "Nvidia Corp",              pctLabel: "+2.1%",  direction: "up", pill: "bull" },
  { ticker: "PLTR", name: "Palantir Technologies",    pctLabel: "+1.4%",  direction: "up", pill: "bull" },
];
export const TOP_SELLS: BuySellRow[] = [
  { ticker: "META", name: "Meta Platforms",    pctLabel: "-0.8%", direction: "dn", pill: "bear" },
  { ticker: "FSLY", name: "Fastly Inc",        pctLabel: "+3.5%", direction: "up", pill: "bear" },
  { ticker: "GDX",  name: "Gold Miners ETF",   pctLabel: "+0.1%", direction: "up", pill: "bear" },
  { ticker: "TLT",  name: "iShares 20Y Bond",  pctLabel: "-0.4%", direction: "dn", pill: "bear" },
  { ticker: "SLNO", name: "Soleno Therapeutics", pctLabel: "+6.8%", direction: "up", pill: "bear" },
];

// Individual view static examples (shared across analysts in the mockup)
export interface PortfolioRow { ticker: string; name: string; addedDate: string; pctLabel: string; side: "bull" | "bear"; }
export const PORTFOLIO_ROWS: PortfolioRow[] = [
  { ticker: "NVDA", name: "Nvidia",    addedDate: "Mar 4",  pctLabel: "+18.4%", side: "bull" },
  { ticker: "PLTR", name: "Palantir",  addedDate: "Feb 12", pctLabel: "+34.2%", side: "bull" },
  { ticker: "AAPL", name: "Apple",     addedDate: "Jan 8",  pctLabel: "+9.1%",  side: "bull" },
  { ticker: "TLT",  name: "20Y Bond",  addedDate: "Apr 1",  pctLabel: "-2.8%",  side: "bear" },
  { ticker: "SPY",  name: "S&P ETF",   addedDate: "Mar 20", pctLabel: "+4.6%",  side: "bull" },
];

export interface RecentCallRow { dotColor: string; title: string; thesis: string; outcome: string; time: string; }
export const RECENT_CALLS_ROWS: RecentCallRow[] = [
  { dotColor: "#639922", title: "$NVDA bullish at $812",  thesis: "AI capex supercycle thesis",       outcome: "Correct · +8.4% in 5d",    time: "Apr 15" },
  { dotColor: "#639922", title: "$PLTR bullish at $21.40", thesis: "Gov contract pipeline underpriced", outcome: "Correct · +12.1% in 5d",   time: "Apr 12" },
  { dotColor: "#E24B4A", title: "$META bullish at $524",  thesis: "Ad revenue beat expected Q1",       outcome: "Incorrect · -4.2% in 5d",  time: "Apr 10" },
  { dotColor: "#639922", title: "$SPY bullish at $539",   thesis: "Fed pivot signals ahead",           outcome: "Correct · +2.1% in 5d",    time: "Apr 8" },
  { dotColor: "#EF9F27", title: "$TSLA bearish at $248",  thesis: "Delivery miss risk into Thursday",  outcome: "Pending · active call",    time: "Apr 19" },
];

export interface TickerAccRow { ticker: string; name: string; pctLabel: string; pct: number; barColor: string; tone: "up" | "warn" | "dn"; }
export const TICKER_ACC_ROWS: TickerAccRow[] = [
  { ticker: "NVDA", name: "Nvidia",   pctLabel: "84%", pct: 84, barColor: "#639922", tone: "up" },
  { ticker: "PLTR", name: "Palantir", pctLabel: "78%", pct: 78, barColor: "#639922", tone: "up" },
  { ticker: "SPY",  name: "S&P ETF",  pctLabel: "61%", pct: 61, barColor: "#639922", tone: "up" },
  { ticker: "TSLA", name: "Tesla",    pctLabel: "54%", pct: 54, barColor: "#EF9F27", tone: "warn" },
  { ticker: "META", name: "Meta",     pctLabel: "42%", pct: 42, barColor: "#E24B4A", tone: "dn" },
];

export interface RecentAnalystPost { body: string; time: string; pill: "bull" | "bear" | "mix"; likes: string; }
export const RECENT_ANALYST_POSTS: RecentAnalystPost[] = [
  { body: `Fed balance sheet contracted $1.9T. <span class="cashtag">$SPY</span> <span class="cashtag">$QQQ</span> holding up remarkably.`, time: "7:14 AM", pill: "bull", likes: "8.2K likes" },
  { body: `BREAKING: Institutional inflows into <span class="cashtag">$NVDA</span> hit 3-month high. Watch $880 as key level.`,               time: "5:42 AM", pill: "bull", likes: "6.4K likes" },
];

// =====================================================
// Typed payloads used by /api/sentiment (kept for contract stability)
// =====================================================

export function buildSentimentOverview(): SentimentOverview {
  const topTickers: SentimentTicker[] = buildSentimentDisplayRows().map(r => ({
    ticker: r.ticker,
    velocityPct: Number(r.velocityChangeLabel.replace(/[+%]/g, "")),
    sentiment: r.pill === "bull" ? "BULL" : r.pill === "bear" ? "BEAR" : "MIX",
    mentions: 0,
  }));

  const sectorSentiment: SectorSentiment[] = buildSectorDisplayRows().map(s => ({
    sector: "Technology",
    bullPct: Number(s.pctLabel.replace("%", "")),
    bearPct: 100 - Number(s.pctLabel.replace("%", "")),
    neutralPct: 0,
  }));

  const divergenceAlerts: DivergenceAlert[] = [
    { ticker: "META", sentimentDir: "BEARISH", priceDir: "BULLISH", description: "Sentiment -41pts, price +0.8%",      time: "7:31 AM", severity: "red" },
    { ticker: "PLTR", sentimentDir: "BULLISH", priceDir: "BULLISH", description: "+340% mentions, price flat pre-mkt", time: "6:12 AM", severity: "green" },
    { ticker: "TSLA", sentimentDir: "BULLISH", priceDir: "BEARISH", description: "49/51 split, elevated volume",        time: "5:44 AM", severity: "amber" },
  ];

  const notablePosts: NotablePost[] = [
    { id: "p1", handle: "@KobeissiLetter",  initials: "KB", followers: 312_000, body: "Massive institutional buying on $PLTR. Options flow screaming calls.", cashtags: ["PLTR"], likes: 4_200, sentiment: "BULL", time: "6:04 AM" },
    { id: "p2", handle: "@TechWatcher",     initials: "TW", followers: 188_000, body: "$META earnings whisper below consensus. Preparing for gap down.",     cashtags: ["META"], likes: 2_800, sentiment: "BEAR", time: "7:18 AM" },
    { id: "p3", handle: "@MarketVigilante", initials: "MV", followers: 245_000, body: "$TSLA delivery numbers Thursday. Bulls and bears loaded.",            cashtags: ["TSLA"], likes: 1_900, sentiment: "MIX",  time: "8:02 AM" },
  ];

  const newEntrantsFlips: NewEntrantFlip[] = [
    { ticker: "SMCI", kind: "NEW",  currentSentiment: "BULL", label: "Super Micro" },
    { ticker: "COIN", kind: "NEW",  currentSentiment: "BULL", label: "Coinbase" },
    { ticker: "HOOD", kind: "NEW",  currentSentiment: "BULL", label: "Robinhood" },
    { ticker: "META", kind: "FLIP", currentSentiment: "BEAR", previousSentiment: "BULL", label: "Bull → Bear",          deltaPts: -41 },
    { ticker: "PLTR", kind: "FLIP", currentSentiment: "BULL", previousSentiment: "MIX",  label: "Bear → Bull",          deltaPts: +38 },
    { ticker: "NVDA", kind: "FLIP", currentSentiment: "BULL", previousSentiment: "MIX",  label: "Momentum building",     deltaPts: +22 },
  ];

  return {
    overall: { sentiment: "BULLISH", score: 68, label: "Moderately bullish", bullPct: 54, neutralPct: 22, bearPct: 24, trendVsYesterday: +4 },
    postsAnalyzed: 41_820,
    topVelocityMover: { ticker: "PLTR", pct: 340 },
    divergenceAlertsCount: 3,
    topTickers,
    sectorSentiment,
    divergenceAlerts,
    notablePosts,
    newEntrantsFlips,
    aiSummary: {
      body: "Pre-market tone is cautiously bullish. Semis and AI names dominating positive flow with NVDA and PLTR leading velocity. META is the primary outlier — sharp bearish flip on earnings leak concerns. PLTR volume spike stands out as the session's primary catalyst watch. Overall market sentiment at 68/100 trending up from 64 yesterday.",
      generatedAt: "2026-04-21T08:47:00-04:00",
    },
  };
}

export function buildAnalystIntelligence(): AnalystIntelligence {
  const rows = buildAnalystDisplayRows();
  // In production this pulls everyone meeting the 100K+ follower criteria via X API.
  // We display the top 8 carousel chips but surface "Tracking 24 analysts" as the aggregate population.
  const analysts: AnalystProfile[] = rows.map(r => ({
    handle: r.handle,
    initials: r.initials,
    followers: parseFollowerCount(r.followersLabel),
    bio: r.bio,
    bias: r.bias === "Bullish" ? "BULLISH" : r.bias === "Bearish" ? "BEARISH" : "NEUTRAL",
    accuracy30d: Number(r.accuracy30dLabel.replace("%", "")),
    bullBearRatio: Number(r.bullBearLabel.replace(/[^0-9.]/g, "")) / 50,
    postsPerDay: Number(r.postsPerDay),
    callsTracked: Number(r.callsTracked),
    portfolio: PORTFOLIO_ROWS.map(p => ({ ticker: p.ticker, returnSinceCall: Number(p.pctLabel.replace(/[+%]/g, "")) })),
    recentCalls: RECENT_CALLS_ROWS.map(c => ({
      ticker: c.title.match(/\$([A-Z]+)/)?.[1] ?? "",
      direction: c.title.includes("bullish") ? "BULLISH" : "BEARISH",
      outcome: c.outcome.startsWith("Correct") ? "CORRECT" : c.outcome.startsWith("Incorrect") ? "INCORRECT" : "PENDING",
      calledAt: c.time,
    })),
    accuracyByTicker: TICKER_ACC_ROWS.map(t => ({ ticker: t.ticker, accuracy: t.pct })),
  }));

  return {
    analysts,
    aggregate: {
      analystsTracked: 24,
      aggregateBias: "BULLISH",
      mostMentionedTicker: "NVDA",
      topAccuracy: { handle: "@KobeissiLetter", pct: 68 },
    },
    topMentioned: MENTIONED_ROWS.map(r => ({
      ticker: r.ticker,
      mentions: Number(r.analystCount.replace(/\D/g, "")),
      sentiment: r.pill === "bull" ? "BULL" : r.pill === "bear" ? "BEAR" : "MIX",
    })),
    accuracyLeaderboard: ACCURACY_LEADERS.map(l => ({ handle: l.handle, accuracy: l.pct })),
    topBuys: TOP_BUYS.map(b => ({ ticker: b.ticker, analysts: 0, dayChangePct: Number(b.pctLabel.replace(/[+%]/g, "")) })),
    topSells: TOP_SELLS.map(s => ({ ticker: s.ticker, analysts: 0, dayChangePct: Number(s.pctLabel.replace(/[+%]/g, "")) })),
  };
}

function parseFollowerCount(label: string): number {
  const n = Number(label.replace(/[^0-9.]/g, ""));
  if (label.includes("M")) return Math.round(n * 1_000_000);
  if (label.includes("K")) return Math.round(n * 1_000);
  return n;
}
