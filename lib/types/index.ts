// ==============================================================
// FlowDesk shared types
// Six primary data shapes per spec:
//   FlowAlert · DarkPoolPrint · GEXLevel ·
//   HitListItem · SentimentTicker · AnalystProfile
// Supporting types (payload wrappers, enums) live below them.
// ==============================================================

// ---------- Enums / primitive aliases ----------

export type Direction = "BULLISH" | "BEARISH";
export type Confidence = "HIGH" | "MED" | "LOW";
export type OptionType = "CALL" | "PUT";
export type Side = "BUY" | "SELL";
export type ExecType = "SWEEP" | "FLOOR" | "SINGLE" | "BLOCK";
export type SentimentPill = "BULL" | "BEAR" | "MIX";
export type GammaRegime = "POSITIVE" | "NEGATIVE";

// 11 GICS sectors (for equities) + 4 ETF asset classes (for non-equity tickers
// like SPY / GLD / TLT / UVXY). Locked v1.2.2.
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

// ---------- 1. FlowAlert (Module 4) ----------

export interface FlowAlert {
  id: string;
  date: string;           // display-ready "MMM d" (ET, e.g. "May 4")
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

// ---------- 3c. Options Sentiment (Module: per-strike buy/sell) ----------
//
// Per-strike call/put aggressor-side volume from UW /flow-per-strike, snapshotted
// each poll. `cA`/`cB` = call volume bought-at-ask (Buy) / sold-at-bid (Sell);
// `pA`/`pB` the put equivalents; `cP`/`pP` net call / put premium for the strike.
export interface SentimentStrike {
  k: number;   // strike
  cA: number;  // call volume, ask side (bought)  → green
  cB: number;  // call volume, bid side (sold)    → red
  pA: number;  // put volume, ask side (bought)
  pB: number;  // put volume, bid side (sold)
  cP: number;  // net call premium ($)
  pP: number;  // net put premium ($)
}

export type SentimentLabel = "BULLISH" | "BEARISH" | "NEUTRAL";

// One cumulative snapshot of the whole chain at a moment in the session.
export interface SentimentMinute {
  t: string;                   // "HH:MM" ET
  callVol: number;             // Σ call volume across strikes
  putVol: number;              // Σ put volume across strikes
  cpRatio: number;             // callVol / putVol
  sentiment: SentimentLabel;
  strikes: SentimentStrike[];
}

export interface FlowSentimentPayload {
  ticker: string;
  tradingDate: string;         // YYYY-MM-DD (ET session)
  capturedAt: string;          // ISO — last poll
  spot: number;                // reference price for the spot line
  minutes: SentimentMinute[];  // chronological; last = latest
}

// Market-wide sentiment dashboard — one summary row per ticker for the latest
// session, derived from each ticker's latest cumulative snapshot.
export interface MarketSentimentTicker {
  ticker: string;
  hasData: boolean;
  callVol: number;             // Σ call volume (near-the-money chain)
  putVol: number;              // Σ put volume
  cpRatio: number;             // callVol / putVol (capped at RATIO_CAP)
  callBuyRatio: number;        // call bought-at-ask / sold-at-bid
  putBuyRatio: number;         // put bought-at-ask / sold-at-bid
}

export interface MarketSentimentPayload {
  tradingDate: string;         // YYYY-MM-DD (ET session) the dashboard covers
  capturedAt: string;          // ISO — most recent poll across tickers
  minVolume: number;           // contract floor applied to the bull/bear lists
  indices: MarketSentimentTicker[];   // SPY/SPX/QQQ/IWM/DIA, fixed order
  megaCaps: MarketSentimentTicker[];  // mega-cap set, fixed order
  topBullish: MarketSentimentTicker[]; // cpRatio > 1.75, desc
  topBearish: MarketSentimentTicker[]; // cpRatio < 0.5, asc
}

// ---------- 3d. Trade Alerts (Discord alert tracking) ----------

export interface TradeAlertRow {
  id: string;
  assetType: "option" | "equity";
  ticker: string;
  side: "CALL" | "PUT" | "LONG";
  strike: number | null;
  expiryLabel: string | null;
  dte: number | null;            // days to expiry from now (options)
  moderator: string;            // "Alerted by"
  sizeLabel: "Small" | "Medium" | "Large" | "Lotto";
  entryPrice: number;
  entryAt: string;              // ISO
  status: "OPEN" | "CLOSED";
  remainingFrac: number;        // 0..1
  realizedPct: number | null;   // blended return on the closed slice
  livePct: number | null;       // live return on the open slice
  lastMark: number | null;      // current option mid / share price
  bookDelta: number;            // size-weighted net result (%)
}

export interface TradeAlertsPayload {
  assetType: "option" | "equity";
  available: boolean;           // false → channel access not yet granted
  open: TradeAlertRow[];
  closed: TradeAlertRow[];
  stats: {
    openBookPct: number;        // Σ size-weighted live book on open positions
    rawPct: number;             // unweighted avg live P/L on open positions
    winRate: number;            // closed positions with positive net result
    openCount: number;
    closedCount: number;
  };
  equityCurve: { t: string; cum: number }[]; // cumulative size-weighted book Δ over time
}

// ---------- 3b. Heatmap payload (Module 3 → Heatmap tab) ----------

export interface HeatmapExpiration {
  date: string;       // ISO YYYY-MM-DD
  label: string;      // "MM/DD (0DTE)" or "MM/DD (Nd)"
  dte: number;        // 0..N
}

export interface HeatmapCell {
  strike: number;
  exp: string;        // matches HeatmapExpiration.date
  netOI: number;      // $ gamma per 1% move, OI-based
  netDV: number;      // $ gamma per 1% move, directionalized volume
}

export interface HeatmapPayload {
  ticker: string;
  asOf: string;
  capturedAt: string;
  spot: number;
  expirations: HeatmapExpiration[];
  strikes: number[];  // descending, 50 closest to spot
  cells: HeatmapCell[];
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

// Confluence engine (v2) — which signal categories fired + score breakdown.
export interface HitListSignals {
  flow: { pts: number; premium: number; alerts: number };
  sentiment?: { pts: number; cpRatio: number; side: "UP" | "DOWN" };
  darkpool?: { pts: number; rank: number };
  persistence?: { pts: number; days: number; of: number };
  agree?: boolean;
  total: number;
}

// Weekly-ATR target ladder: spot ± 0.5 / 1 / 2 × ATR(weekly).
export interface HitListAtrTargets {
  atrW: number;
  up05: number; up1: number; up2: number;
  dn05: number; dn1: number; dn2: number;
}

// Live open trade alert on a hit-list ticker (joined from trade_alerts at
// request time, so it stays current as trades are alerted).
export interface HitListOpenAlert {
  contract: string;             // "$200C Jul 30" style label
  side: "CALL" | "PUT" | "LONG";
  livePct: number | null;
  moderator: string;
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
  sector: Sector;
  contracts: HitListContract[];
  peers: HitListPeer[];
  theme: HitListTheme;
  signals?: HitListSignals;
  atrTargets?: HitListAtrTargets;
  score?: number;               // confluence score (actionabilityScore)
  aiSummary?: string;           // Claude-generated news/signals/price brief
  openAlerts?: HitListOpenAlert[];
}

export interface SectorFlow {
  sector: Sector;
  netPremium: number;
}

export interface HitListPayload {
  sessionMeta: {
    date: string;
    sentiment: Direction;
    totalPremLabel: string;     // "$57.4M"
    callPutLabel: string;       // "86/14"
    leadSector: Sector;
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
