// ==============================================================
// FlowDesk shared types
// Six primary data shapes per spec:
//   FlowAlert · DarkPoolPrint · GEXLevel ·
//   HitListItem · SentimentTicker · AnalystProfile
// Supporting types (payload wrappers, enums) live below them.
// ==============================================================

// ---------- Enums / primitive aliases ----------

export type Direction = "BULLISH" | "BEARISH";
export type Confidence = "HIGH" | "MED" | "MOD" | "LOW";
export type OptionType = "CALL" | "PUT";
export type Side = "BUY" | "SELL";
export type ExecType = "SWEEP" | "FLOOR" | "SINGLE" | "BLOCK";
export type SentimentPill = "BULL" | "BEAR" | "MIX";
export type GammaRegime = "POSITIVE" | "NEGATIVE";

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
  | "Utilities";

// ---------- 1. FlowAlert (Module 4) ----------

export interface FlowAlert {
  id: string;
  time: string;           // display-ready "HH:MM AM/PM"
  ticker: string;
  type: OptionType;
  side: Side;
  sentiment: Direction;
  exec: ExecType;
  multiLeg: boolean;
  contract: string;       // e.g. "$145P May 15"
  strike: number;
  expiry: string;         // ISO date (YYYY-MM-DD)
  size: number;           // contracts
  oi: number;
  premium: number;        // USD
  spot: number;
  rule: string;
  confidence: Confidence;
  sector: Sector;
  isNew?: boolean;        // new rows flash blue
}

export interface FlowStats {
  count: number;
  calls: number;
  puts: number;
  totalPrem: number;
  cpRatio: number;
  topRule: { name: string; pct: number };
}

// ---------- 2. DarkPoolPrint (Module 5) ----------

export interface DarkPoolPrint {
  id: number;
  executed_at: string;    // ISO
  ticker: string;
  price: number;
  size: number;
  premium: number;
  volume: number;
  exchange_id: number;    // 4 = dark pool (per PRD §3.2)
  trf_id: number | null;
  is_etf: boolean;
  is_extended: boolean;
  all_time_rank: number;  // 1 = largest ever for this ticker
  percentile: number;     // 0–100
}

// ---------- 3. GEXLevel (Module 3) ----------

export interface GEXLevel {
  strike: number;
  call_gamma_oi: number;
  put_gamma_oi: number;
  call_gamma_bid: number;
  call_gamma_ask: number;
  put_gamma_bid: number;
  put_gamma_ask: number;
  netDV: number;          // (call_ask - call_bid) - (put_ask - put_bid)
  netOI: number;          // call_gamma_oi - put_gamma_oi
  combined: number;       // netOI + netDV
}

export interface KeyLevels {
  callWall: number;
  putWall: number;
  gammaFlip: number;
  maxPain: number;
  spot: number;
}

export interface GEXPayload {
  ticker: string;
  asOf: string;
  strikes: GEXLevel[];
  keyLevels: KeyLevels;
  netGexOI: number;
  netGexDV: number;
  gammaRegime: GammaRegime;
}

// ---------- 4. HitListItem (Module 1) ----------

export interface HitListContract {
  strikeLabel: string;    // "$145P"
  expiryLabel: string;    // "May 15"
  premiumLabel: string;   // "$1.9M"
  rule: string;
  vOiLabel: string;       // "80.7x" or "—"
}

export interface HitListTheme {
  name: string;
  totalPremiumLabel: string; // "$15.1M"
  tickers: string[];
}

export interface HitListPeer {
  ticker: string;
  premiumLabel: string;   // "$1.6M"
  direction: "UP" | "DOWN";
  highlighted?: boolean;
}

export interface HitListItem {
  rank: number;
  ticker: string;
  price: number;
  direction: "UP" | "DOWN";
  confidence: Confidence;
  premium: number;
  contract: string;
  dpConf: boolean;
  dpRank?: number;
  dpAge?: "today" | "yesterday";
  dpPrem?: number;
  thesis: string;
  sector: string;
  contracts: HitListContract[];
  peers: HitListPeer[];
  theme: HitListTheme;
}

export interface SectorFlow {
  sector: string;
  netPremium: number;
}

export interface HitListPayload {
  sessionMeta: {
    date: string;
    sentiment: Direction;
    totalPremLabel: string;     // "$57.4M"
    callPutLabel: string;       // "86/14"
    leadSector: string;
  };
  hits: HitListItem[];
  sectorFlow: SectorFlow[];
}

// ---------- 5. SentimentTicker (Module 2) ----------

export interface SentimentTicker {
  ticker: string;
  velocityPct: number;    // % above 7-day avg
  sentiment: SentimentPill;
  mentions: number;
}

export interface SectorSentiment {
  sector: Sector;
  bullPct: number;
  bearPct: number;
  neutralPct: number;
}

export interface DivergenceAlert {
  ticker: string;
  sentimentDir: Direction;
  priceDir: Direction;
  description: string;
  time: string;
  severity: "red" | "amber" | "green";
}

export interface NotablePost {
  id: string;
  handle: string;
  initials: string;       // e.g. "KB" for avatar
  followers: number;
  body: string;
  cashtags: string[];
  likes: number;
  sentiment: SentimentPill;
  time: string;
}

export interface NewEntrantFlip {
  ticker: string;
  kind: "NEW" | "FLIP";
  previousSentiment?: SentimentPill;
  currentSentiment: SentimentPill;
  label: string;          // truncated descriptor ("Bull...", "Mod.")
  deltaPts?: number;      // e.g. -41, +38 for flips
}

export interface SentimentOverview {
  overall: {
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    score: number;        // 0-100
    label: string;
    bullPct: number;
    neutralPct: number;
    bearPct: number;
    trendVsYesterday: number;
  };
  postsAnalyzed: number;
  topVelocityMover: { ticker: string; pct: number };
  divergenceAlertsCount: number;
  topTickers: SentimentTicker[];
  sectorSentiment: SectorSentiment[];
  divergenceAlerts: DivergenceAlert[];
  notablePosts: NotablePost[];
  newEntrantsFlips: NewEntrantFlip[];
  aiSummary: { body: string; generatedAt: string };
}

// ---------- 6. AnalystProfile (Module 2 · analyst intelligence) ----------

export interface AnalystCall {
  ticker: string;
  direction: Direction;
  outcome: "CORRECT" | "INCORRECT" | "PENDING";
  calledAt: string;
}

export interface AnalystProfile {
  handle: string;
  initials: string;
  followers: number;
  bio: string;
  bias: Direction | "NEUTRAL";
  accuracy30d: number;
  bullBearRatio: number;
  postsPerDay: number;
  callsTracked: number;
  portfolio: { ticker: string; returnSinceCall: number }[];
  recentCalls: AnalystCall[];
  accuracyByTicker: { ticker: string; accuracy: number }[];
}

export interface AnalystIntelligence {
  analysts: AnalystProfile[];
  aggregate: {
    analystsTracked: number;
    aggregateBias: Direction | "NEUTRAL";
    mostMentionedTicker: string;
    topAccuracy: { handle: string; pct: number };
  };
  topMentioned: { ticker: string; mentions: number; sentiment: SentimentPill }[];
  accuracyLeaderboard: { handle: string; accuracy: number }[];
  topBuys: { ticker: string; analysts: number; dayChangePct: number }[];
  topSells: { ticker: string; analysts: number; dayChangePct: number }[];
}
