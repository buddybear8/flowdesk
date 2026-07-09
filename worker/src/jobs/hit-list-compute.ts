// jobs/hit-list-compute.ts — daily at 07:30 ET.
//
// Materializes the Daily Watches hit list (PRD §6) by:
//   1. Loading WatchesCriteria from DB (or PRD defaults if no row).
//   2. Selecting flow alerts from the PRIOR TRADING DAY in ET that pass the
//      criteria filters (premium / confidence / exec type / excluded sectors).
//   3. Aggregating by ticker — sum premium, best confidence, majority
//      direction, top contract.
//   4. Joining dark-pool confluence: best ranked DP print per ticker in the
//      last 48h.
//   5. Optionally filtering to tickers with DP confluence (criteria.requireDp).
//   6. Scoring by actionability and taking the top maxAlerts (default 20).
//   7. Building per-row peers / theme / thesis (V1 templates — see notes
//      below for refinement candidates).
//   8. Atomic delete-and-insert for today's date so /api/watches never sees
//      a partial table.
//
// Same-day rebuild: this function is exported so a future
// POST /api/admin/criteria handler can call it inline after saving criteria
// (PRD §6 — criteria saves apply same-day, not waiting for next 07:30 ET).
//
// Idempotent — re-running for the same day deletes and re-inserts.

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const ts = () => new Date().toISOString();

// PRD §6 defaults — used when no WatchesCriteria row exists yet.
// Schema field defaults match these, but the row may not exist on first run.
const DEFAULT_CRITERIA = {
  minPremium: 700_000,
  confFilter: "HIGH_MED" as ConfFilter,
  execTypes: ["SWEEP", "FLOOR", "BLOCK", "SINGLE"] as readonly string[],
  maxAlerts: 10,
  excludeSectors: [] as readonly string[],
  requireDp: false,
};

type ConfFilter = "HIGH" | "HIGH_MED" | "ALL";
type Confidence = "HIGH" | "MED" | "LOW";
type Direction = "UP" | "DOWN";

const DP_CONFLUENCE_HOURS = 48;

// ─── Confluence engine (v2) constants ────────────────────────────────────────
// Score = flow (0-40, premium percentile × confidence) + sentiment (0-25, C/P
// extremity) + dark pool (10 or 15) + persistence (5/day, max 20), with a +10%
// bonus when flow direction and sentiment side agree. Signals JSON stores the
// full breakdown so the UI can explain each pick.
const SENT_BULL_CP = 2.0;   // same thresholds as the sentiment dashboard
const SENT_BEAR_CP = 0.5;
const SENT_MIN_VOL = 5_000;

// Moneyness weighting for the flow score — OTM strikes carry more directional
// conviction than ITM, so their premium counts more toward the flow points
// (and the suggested-contract pick). ATM band is ±2.5% of spot. Raw premium is
// still what's displayed; only the scoring uses the weighted sum.
const FLOW_WEIGHT_OTM = 1.5;
const FLOW_WEIGHT_ATM = 1.0;
const FLOW_WEIGHT_ITM = 0.75;
const ATM_BAND = 0.025;
const PERSIST_LOOKBACK_DAYS = 5;   // trading days
const PERSIST_PTS_PER_DAY = 5;
const PERSIST_MAX_PTS = 20;
const CONTRACT_MAX_DTE = 92;       // "no more than 3 months out"
const ATR_WEEKS = 14;              // Wilder ATR period on weekly bars

// Per-ticker aggregate built up before scoring + writing.
interface TickerAgg {
  ticker: string;
  sector: string;
  totalPremium: number;
  weightedPremium: number; // moneyness-weighted (OTM > ATM > ITM) — drives the flow score
  alertCount: number;
  bestConfidence: Confidence;
  direction: Direction;
  topAlert: Awaited<ReturnType<typeof prisma.flowAlert.findFirst>>; // highest-premium row
  contracts: Array<{
    strike: number;
    expiry: Date;
    premium: number;
    wPremium: number; // moneyness-weighted premium (contract pick ordering)
    rule: string;
    type: string;
    size: number;
    oi: number;
  }>; // top 5 by premium
  execTypeCounts: Record<string, number>;
}

// Moneyness weight for one alert: OTM = strike beyond spot in the option's
// direction (calls above / puts below), ITM the reverse, ATM within ±ATM_BAND.
function moneynessWeight(type: string, strike: number, spot: number): number {
  if (!(spot > 0) || !(strike > 0)) return FLOW_WEIGHT_ATM;
  const dist = (strike - spot) / spot; // >0 = above spot
  if (Math.abs(dist) <= ATM_BAND) return FLOW_WEIGHT_ATM;
  const otm = type === "CALL" ? dist > 0 : dist < 0;
  return otm ? FLOW_WEIGHT_OTM : FLOW_WEIGHT_ITM;
}

// Result of joining DP confluence per ticker.
interface DpInfo {
  rank: number;
  age: "today" | "yesterday";
  premium: number;
}

export async function computeHitList(): Promise<void> {
  try {
    const todayET = todayDateET();
    const priorDayET = priorTradingDayET(todayET);

    const criteria = await loadCriteria();
    const priorStart = etMidnightUTC(priorDayET);
    const priorEnd = new Date(priorStart.getTime() + 24 * 60 * 60 * 1000);

    // ─── 1. Pull qualifying flow alerts from the prior trading day ─────────
    const confSet =
      criteria.confFilter === "HIGH" ? ["HIGH"] :
      criteria.confFilter === "HIGH_MED" ? ["HIGH", "MED"] :
      ["HIGH", "MED", "LOW"];

    const alerts = await prisma.flowAlert.findMany({
      where: {
        time: { gte: priorStart, lt: priorEnd },
        premium: { gte: criteria.minPremium },
        confidence: { in: confSet },
        exec: { in: [...criteria.execTypes] },
        // Ask-side only: calls and puts BOUGHT at the ask. Bid-side (sold)
        // contracts are closing/premium-selling flow, not directional
        // conviction — they're excluded from the confluence inputs entirely.
        side: "BUY",
        ...(criteria.excludeSectors.length > 0
          ? { sector: { notIn: [...criteria.excludeSectors] } }
          : {}),
      },
      orderBy: { premium: "desc" },
    });

    const todayDate = etMidnightUTC(todayET);
    if (alerts.length === 0) {
      // Clear today's hit list rather than leave stale rows. The /api/watches
      // route will return an empty list for today, which is the correct
      // signal ("no qualifying flow yesterday").
      const cleared = await prisma.hitListDaily.deleteMany({ where: { date: todayDate } });
      console.log(
        `[hit-list-compute] ${ts()} no qualifying alerts for ${priorDayET} — cleared ${cleared.count} rows for ${todayET}`
      );
      return;
    }

    // ─── 2. Aggregate by ticker ────────────────────────────────────────────
    const byTicker = aggregateByTicker(alerts);

    // ─── 3. DP confluence (last 48h, ranked prints only) ───────────────────
    const dpCutoff = new Date(Date.now() - DP_CONFLUENCE_HOURS * 60 * 60 * 1000);
    const tickers = Array.from(byTicker.keys());
    const dpRows = await prisma.darkPoolPrint.findMany({
      where: {
        ticker: { in: tickers },
        executedAt: { gte: dpCutoff },
        rank: { not: null },
      },
      orderBy: [{ ticker: "asc" }, { rank: "asc" }],
    });
    const dpByTicker = new Map<string, DpInfo>();
    for (const row of dpRows) {
      if (dpByTicker.has(row.ticker)) continue; // first per ticker = best rank
      dpByTicker.set(row.ticker, {
        rank: row.rank!,
        age: classifyDpAge(row.executedAt),
        premium: Number(row.premium),
      });
    }

    // ─── 4. Optional DP requirement ────────────────────────────────────────
    let candidates = Array.from(byTicker.values());
    if (criteria.requireDp) {
      candidates = candidates.filter((c) => dpByTicker.has(c.ticker));
    }

    if (candidates.length === 0) {
      const cleared = await prisma.hitListDaily.deleteMany({ where: { date: todayDate } });
      console.log(
        `[hit-list-compute] ${ts()} 0 candidates after requireDp filter — cleared ${cleared.count} rows for ${todayET}`
      );
      return;
    }

    // ─── 5. Confluence signals: sentiment + persistence ────────────────────
    const sentByTicker = await latestSentimentByTicker();
    const persistByTicker = await persistenceByTicker(priorDayET, criteria.minPremium);

    // ─── 6. Score + rank + truncate (confluence v2) ────────────────────────
    interface Scored extends TickerAgg {
      actionability: number;
      dp?: DpInfo;
      signals: SignalsJson;
    }
    // Moneyness-weighted premium percentile within today's qualifying set
    // drives the flow points (OTM-heavy flow ranks above equal-dollar ITM flow).
    const premiums = candidates.map((c) => c.weightedPremium).sort((a, b) => a - b);
    const pctl = (v: number) => (premiums.length <= 1 ? 1 : premiums.filter((p) => p <= v).length / premiums.length);

    const scored: Scored[] = candidates.map((agg) => {
      const dp = dpByTicker.get(agg.ticker);
      const sent = sentByTicker.get(agg.ticker);
      const persistDays = persistByTicker.get(agg.ticker) ?? 0;
      const { total, signals } = computeConfluence(agg, pctl(agg.weightedPremium), dp, sent, persistDays);
      return { ...agg, dp, signals, actionability: total };
    });
    scored.sort((a, b) => b.actionability - a.actionability);
    const top = scored.slice(0, criteria.maxAlerts);

    // ─── 7. Weekly-ATR targets + contract pick for the winners only ────────
    const atrByTicker = new Map<string, AtrTargets | null>();
    for (const t of top) {
      atrByTicker.set(t.ticker, await weeklyAtrTargets(t.ticker, Number(t.topAlert!.spot)));
    }

    // ─── 6. Build peers + theme map (per-sector, computed across all ──────
    // qualifying tickers — peers can include candidates that didn't make
    // the top list, which gives the user lateral context).
    const allBySector = new Map<string, TickerAgg[]>();
    for (const c of candidates) {
      const list = allBySector.get(c.sector) ?? [];
      list.push(c);
      allBySector.set(c.sector, list);
    }
    for (const [sector, list] of allBySector) {
      list.sort((a, b) => b.totalPremium - a.totalPremium);
      allBySector.set(sector, list);
    }

    // ─── 8. Atomic replace today's rows ────────────────────────────────────
    const newRows: Prisma.HitListDailyCreateManyInput[] = top.map((entry, i) =>
      buildHitListRow(entry, i + 1, todayDate, allBySector, entry.dp, entry.signals, atrByTicker.get(entry.ticker) ?? null)
    );

    await prisma.$transaction([
      prisma.hitListDaily.deleteMany({ where: { date: todayDate } }),
      prisma.hitListDaily.createMany({ data: newRows }),
    ]);

    console.log(
      `[hit-list-compute] ${ts()} wrote ${top.length} rows for ${todayET} ` +
        `(from ${alerts.length} alerts on ${priorDayET}, ${candidates.length} candidates, ${dpByTicker.size} with DP confluence)`
    );
  } catch (err) {
    console.error(
      "[hit-list-compute] failed:",
      err instanceof Error ? err.message : err
    );
  }
}

// ─── Criteria loader ─────────────────────────────────────────────────────────

async function loadCriteria(): Promise<typeof DEFAULT_CRITERIA & { confFilter: ConfFilter }> {
  const row = await prisma.watchesCriteria.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_CRITERIA;
  return {
    minPremium: row.minPremium,
    confFilter: row.confFilter as ConfFilter,
    execTypes: row.execTypes,
    maxAlerts: row.maxAlerts,
    excludeSectors: row.excludeSectors,
    requireDp: row.requireDp,
  };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

function aggregateByTicker(
  alerts: Awaited<ReturnType<typeof prisma.flowAlert.findMany>>
): Map<string, TickerAgg> {
  const out = new Map<string, TickerAgg>();
  // Track sentiment counts to derive direction from majority.
  const sentimentCounts = new Map<string, { bull: number; bear: number }>();

  for (const a of alerts) {
    const ticker = a.ticker.toUpperCase();
    const premium = Number(a.premium);
    let agg = out.get(ticker);
    if (!agg) {
      agg = {
        ticker,
        sector: a.sector,
        totalPremium: 0,
        weightedPremium: 0,
        alertCount: 0,
        bestConfidence: a.confidence as Confidence,
        direction: "UP",
        topAlert: a,
        contracts: [],
        execTypeCounts: {},
      };
      out.set(ticker, agg);
      sentimentCounts.set(ticker, { bull: 0, bear: 0 });
    }

    const w = moneynessWeight(a.type, Number(a.strike), Number(a.spot));
    agg.totalPremium += premium;
    agg.weightedPremium += premium * w;
    agg.alertCount += 1;
    if (rankConfidence(a.confidence as Confidence) > rankConfidence(agg.bestConfidence)) {
      agg.bestConfidence = a.confidence as Confidence;
    }
    if (premium > Number(agg.topAlert!.premium)) {
      agg.topAlert = a;
    }
    agg.execTypeCounts[a.exec] = (agg.execTypeCounts[a.exec] ?? 0) + 1;
    const sc = sentimentCounts.get(ticker)!;
    if (a.sentiment === "BULLISH") sc.bull += 1;
    else if (a.sentiment === "BEARISH") sc.bear += 1;

    // Top 5 contracts by premium — alerts are pre-sorted desc, so first 5 win.
    if (agg.contracts.length < 5) {
      agg.contracts.push({
        strike: Number(a.strike),
        expiry: a.expiry,
        premium,
        wPremium: premium * w,
        rule: a.rule,
        type: a.type,
        size: a.size,
        oi: a.oi,
      });
    }
  }

  for (const [ticker, sc] of sentimentCounts) {
    const agg = out.get(ticker)!;
    agg.direction = sc.bear > sc.bull ? "DOWN" : "UP";
  }

  return out;
}

function rankConfidence(c: Confidence): number {
  return c === "HIGH" ? 3 : c === "MED" ? 2 : 1;
}

// ─── Confluence score (v2) ───────────────────────────────────────────────────
//
// Additive points across independent signal categories, so a name that shows
// up in several places outranks a one-signal wonder even at lower premium:
//   flow        0–40  premium percentile among the day's qualifiers × confidence
//   sentiment   0–25  C/P-ratio extremity from the chain-flow dashboard
//   dark pool   10/15 ranked print ≤48h (15 if corpus rank ≤10)
//   persistence 5/day fired on prior sessions (max 20, 5-day lookback)
//   agreement   +10%  flow direction and sentiment side concur
// The full breakdown is persisted in `signals` so the UI can explain the pick.

interface SentInfo {
  cpRatio: number;
  side: Direction;      // UP for bullish C/P, DOWN for bearish
  volume: number;
}

interface SignalsJson {
  flow: { pts: number; premium: number; alerts: number };
  sentiment?: { pts: number; cpRatio: number; side: Direction };
  darkpool?: { pts: number; rank: number };
  persistence?: { pts: number; days: number; of: number };
  agree?: boolean;
  total: number;
}

function computeConfluence(
  agg: TickerAgg,
  premiumPctl: number,
  dp: DpInfo | undefined,
  sent: SentInfo | undefined,
  persistDays: number,
): { total: number; signals: SignalsJson } {
  const confMult = agg.bestConfidence === "HIGH" ? 1 : agg.bestConfidence === "MED" ? 0.8 : 0.6;
  const flowPts = 40 * premiumPctl * confMult;

  let sentPts = 0;
  let sentSignal: SignalsJson["sentiment"];
  if (sent && (sent.cpRatio >= SENT_BULL_CP || sent.cpRatio <= SENT_BEAR_CP)) {
    // Extremity: 2.0→~8pts scaling to 25 at C/P≥6; bearish mirrors via 1/cp.
    const ext = sent.cpRatio >= SENT_BULL_CP ? sent.cpRatio : 1 / Math.max(sent.cpRatio, 0.01);
    sentPts = Math.min(25, 25 * (ext - 1.5) / 4.5);
    sentPts = Math.max(sentPts, 6); // fired at all = worth something
    sentSignal = { pts: round1(sentPts), cpRatio: round2(sent.cpRatio), side: sent.side };
  }

  const dpPts = dp ? (dp.rank <= 10 ? 15 : 10) : 0;
  const persistPts = Math.min(PERSIST_MAX_PTS, persistDays * PERSIST_PTS_PER_DAY);

  const agree = !!sentSignal && sentSignal.side === agg.direction;
  let total = flowPts + sentPts + dpPts + persistPts;
  if (agree) total *= 1.1;

  const signals: SignalsJson = {
    flow: { pts: round1(flowPts), premium: Math.round(agg.totalPremium), alerts: agg.alertCount },
    ...(sentSignal ? { sentiment: sentSignal } : {}),
    ...(dp ? { darkpool: { pts: dpPts, rank: dp.rank } } : {}),
    ...(persistDays > 0 ? { persistence: { pts: persistPts, days: persistDays, of: PERSIST_LOOKBACK_DAYS } } : {}),
    ...(sentSignal ? { agree } : {}),
    total: round1(total),
  };
  return { total, signals };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Sentiment signal ────────────────────────────────────────────────────────
//
// Latest chain-flow snapshot per ticker (same source as the Options-sentiment
// market dashboard): final cumulative minute of the most recent trading day.
// At the 07:30 ET run this is the prior session's close — same day the flow
// candidates come from.

async function latestSentimentByTicker(): Promise<Map<string, SentInfo>> {
  const out = new Map<string, SentInfo>();
  try {
    const latest = await prisma.flowSentimentDay.findFirst({
      orderBy: { tradingDate: "desc" },
      select: { tradingDate: true },
    });
    if (!latest) return out;
    const rows = await prisma.$queryRaw<{ ticker: string; last: { callVol?: number; putVol?: number } | null }[]>`
      SELECT ticker, minutes -> (jsonb_array_length(minutes) - 1) AS last
      FROM flow_sentiment_days
      WHERE trading_date = ${latest.tradingDate}`;
    for (const r of rows) {
      const callVol = Number(r.last?.callVol ?? 0);
      const putVol = Number(r.last?.putVol ?? 0);
      const vol = callVol + putVol;
      if (vol < SENT_MIN_VOL || putVol <= 0) continue;
      const cp = callVol / putVol;
      out.set(r.ticker, { cpRatio: cp, side: cp >= 1 ? "UP" : "DOWN", volume: vol });
    }
  } catch (err) {
    console.error("[hit-list-compute] sentiment signal failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

// ─── Persistence signal ──────────────────────────────────────────────────────
//
// How many of the PERSIST_LOOKBACK_DAYS trading days BEFORE the flow day did
// this ticker already fire a signal (qualifying flow premium OR extreme C/P)?
// Repeated appearance is the "keeps showing up" part of confluence.

async function persistenceByTicker(
  flowDayET: string,
  minPremium: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    // Lookback window: 9 calendar days ≥ 5 trading days.
    const end = etMidnightUTC(flowDayET); // exclusive — the flow day itself doesn't count
    const start = new Date(end.getTime() - 9 * 24 * 60 * 60 * 1000);

    // Flow leg: days where the ticker's summed qualifying premium cleared the bar.
    const flowDays = await prisma.$queryRaw<{ ticker: string; d: string }[]>`
      SELECT ticker, DATE(time AT TIME ZONE 'America/New_York')::text AS d
      FROM flow_alerts
      WHERE time >= ${start} AND time < ${end}
      GROUP BY 1, 2
      HAVING SUM(premium) >= ${minPremium}`;

    // Sentiment leg: days with an extreme C/P on adequate volume.
    const sentDays = await prisma.$queryRaw<{ ticker: string; d: string; last: { callVol?: number; putVol?: number } | null }[]>`
      SELECT ticker, trading_date::text AS d, minutes -> (jsonb_array_length(minutes) - 1) AS last
      FROM flow_sentiment_days
      WHERE trading_date >= ${start} AND trading_date < ${end}`;

    const daysByTicker = new Map<string, Set<string>>();
    const add = (ticker: string, d: string) => {
      const s = daysByTicker.get(ticker) ?? new Set<string>();
      s.add(d);
      daysByTicker.set(ticker, s);
    };
    for (const r of flowDays) add(r.ticker, r.d);
    for (const r of sentDays) {
      const callVol = Number(r.last?.callVol ?? 0);
      const putVol = Number(r.last?.putVol ?? 0);
      if (callVol + putVol < SENT_MIN_VOL || putVol <= 0) continue;
      const cp = callVol / putVol;
      if (cp >= SENT_BULL_CP || cp <= SENT_BEAR_CP) add(r.ticker, r.d.slice(0, 10));
    }
    for (const [ticker, days] of daysByTicker) {
      out.set(ticker, Math.min(days.size, PERSIST_LOOKBACK_DAYS));
    }
  } catch (err) {
    console.error("[hit-list-compute] persistence signal failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

// ─── Weekly-ATR targets ──────────────────────────────────────────────────────
//
// Daily candles → W-FRI weekly bars → Wilder ATR over ATR_WEEKS completed
// weeks → target ladder at spot ± 0.5 / 1 / 2 ATR (both sides — the user
// validates direction themselves).

export interface AtrTargets {
  atrW: number;
  up05: number; up1: number; up2: number;
  dn05: number; dn1: number; dn2: number;
}

async function weeklyAtrTargets(ticker: string, spot: number): Promise<AtrTargets | null> {
  try {
    if (!(spot > 0)) return null;
    // candle_bars stores native 1W bars (bar-start UTC, current week included).
    const weeks = await prisma.candleBar.findMany({
      where: { ticker, timeframe: "1W" },
      orderBy: { barTime: "desc" },
      take: ATR_WEEKS + 2, // period + prior close + in-progress week
      select: { high: true, low: true, close: true },
    });
    if (weeks.length < 8) return null;
    weeks.reverse();
    weeks.pop(); // drop the in-progress current week; TRs need completed weeks

    const trs: number[] = [];
    for (let i = 1; i < weeks.length; i++) {
      const w = weeks[i]!, prev = weeks[i - 1]!;
      const h = Number(w.high), l = Number(w.low), pc = Number(prev.close);
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const period = Math.min(ATR_WEEKS, trs.length);
    const recent = trs.slice(-period);
    // Wilder smoothing seeded with the simple mean of the first half.
    const seedLen = Math.ceil(period / 2);
    let atr = recent.slice(0, seedLen).reduce((s, v) => s + v, 0) / seedLen;
    for (const tr of recent.slice(seedLen)) {
      atr = (atr * (period - 1) + tr) / period;
    }
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      atrW: r(atr),
      up05: r(spot + 0.5 * atr), up1: r(spot + atr), up2: r(spot + 2 * atr),
      dn05: r(spot - 0.5 * atr), dn1: r(spot - atr), dn2: r(spot - 2 * atr),
    };
  } catch (err) {
    console.error(`[hit-list-compute] ATR failed for ${ticker}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Contract pick ───────────────────────────────────────────────────────────
//
// "A top options contract to watch": highest-premium contract among the
// ticker's qualifying alerts whose expiry is ≤3 months out and whose side
// matches the confluence direction (calls for UP, puts for DOWN); falls back
// to any side ≤3 months, then to the raw top alert's contract label.

function pickWatchContract(agg: TickerAgg): string {
  const now = Date.now();
  const maxExp = now + CONTRACT_MAX_DTE * 24 * 60 * 60 * 1000;
  const inWindow = agg.contracts.filter((c) => c.expiry.getTime() > now && c.expiry.getTime() <= maxExp);
  const wantType = agg.direction === "UP" ? "CALL" : "PUT";
  const directional = inWindow.filter((c) => c.type === wantType);
  const pool = directional.length ? directional : inWindow;
  if (!pool.length) return agg.topAlert!.contract;
  const best = pool.reduce((a, b) => (b.wPremium > a.wPremium ? b : a));
  return `$${best.strike}${best.type === "CALL" ? "C" : "P"} ${shortDateLabel(best.expiry)}`;
}

// ─── DP age classifier ───────────────────────────────────────────────────────

function classifyDpAge(executedAt: Date): "today" | "yesterday" {
  // Consider any print within the last calendar day in ET as "today".
  const todayStart = etMidnightUTC(todayDateET());
  return executedAt >= todayStart ? "today" : "yesterday";
}

// ─── Row builder ─────────────────────────────────────────────────────────────

function buildHitListRow(
  entry: TickerAgg & { actionability: number; dp?: DpInfo },
  rank: number,
  todayDate: Date,
  allBySector: Map<string, TickerAgg[]>,
  dp: DpInfo | undefined,
  signals: SignalsJson | null = null,
  atrTargets: AtrTargets | null = null
): Prisma.HitListDailyCreateManyInput {
  const top = entry.topAlert!;
  const contracts = entry.contracts.map((c) => ({
    strikeLabel: `$${c.strike}${c.type === "CALL" ? "C" : "P"}`,
    expiryLabel: shortDateLabel(c.expiry),
    premiumLabel: formatMoney(c.premium),
    rule: c.rule,
    vOiLabel: c.oi > 0 ? `${(c.size / c.oi).toFixed(1)}x` : "—",
  }));

  // Peers: same-sector tickers (excluding self), ordered by premium, take 3.
  const sectorList = allBySector.get(entry.sector) ?? [];
  const peers = sectorList
    .filter((p) => p.ticker !== entry.ticker)
    .slice(0, 3)
    .map((p) => ({
      ticker: p.ticker,
      premiumLabel: formatMoney(p.totalPremium),
      direction: p.direction,
    }));

  // Theme: sector-as-theme placeholder for V1. A future iteration could
  // detect sub-themes (e.g. "Semiconductors" within Technology).
  const themeTickers = sectorList.slice(0, 6).map((p) => p.ticker);
  const themePremium = sectorList.reduce((sum, p) => sum + p.totalPremium, 0);
  const theme = {
    name: entry.sector,
    totalPremiumLabel: formatMoney(themePremium),
    tickers: themeTickers,
  };

  return {
    date: todayDate,
    rank,
    ticker: entry.ticker,
    price: new Prisma.Decimal(Number(top.spot).toFixed(4)),
    direction: entry.direction,
    confidence: entry.bestConfidence,
    premium: new Prisma.Decimal(entry.totalPremium.toFixed(2)),
    contract: pickWatchContract(entry),
    dpConf: !!dp,
    dpRank: dp?.rank ?? null,
    dpAge: dp?.age ?? null,
    dpPrem: dp ? new Prisma.Decimal(dp.premium.toFixed(2)) : null,
    thesis: buildThesis(entry, dp, signals),
    sector: entry.sector,
    actionabilityScore: new Prisma.Decimal(entry.actionability.toFixed(4)),
    contracts: contracts as unknown as Prisma.InputJsonValue,
    peers: peers as unknown as Prisma.InputJsonValue,
    theme: theme as unknown as Prisma.InputJsonValue,
    signals: (signals ?? undefined) as unknown as Prisma.InputJsonValue,
    atrTargets: (atrTargets ?? undefined) as unknown as Prisma.InputJsonValue,
  };
}

// ─── Thesis template ─────────────────────────────────────────────────────────
//
// V1: deterministic template based on exec mix + DP confluence. Frontend
// shows full text on hover (PRD §6 — Thesis column truncates to flex with
// hover-full). Keep concise (~80–120 chars).

function buildThesis(entry: TickerAgg, dp: DpInfo | undefined, signals: SignalsJson | null = null): string {
  const parts: string[] = [];

  const counts = entry.execTypeCounts;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominant === "SWEEP") {
    parts.push(`Sweep activity across ${entry.alertCount} alert${entry.alertCount === 1 ? "" : "s"}`);
  } else if (dominant === "BLOCK") {
    parts.push(`Block trade${entry.alertCount > 1 ? ` (${entry.alertCount} alerts)` : ""}`);
  } else if (dominant === "FLOOR") {
    parts.push(`Floor activity (${entry.alertCount} alert${entry.alertCount === 1 ? "" : "s"})`);
  } else {
    parts.push(`${entry.alertCount} alert${entry.alertCount === 1 ? "" : "s"}, ${entry.bestConfidence.toLowerCase()} confidence`);
  }

  if (signals?.sentiment) {
    const s = signals.sentiment;
    parts.push(`C/P ${s.cpRatio.toFixed(2)} ${s.side === "UP" ? "bullish" : "bearish"}${signals.agree ? " — confirms flow" : ""}`);
  }
  if (dp) {
    parts.push(`DP confluence at rank #${dp.rank} (${dp.age})`);
  }
  if (signals?.persistence) {
    parts.push(`Signaled ${signals.persistence.days} of last ${signals.persistence.of} sessions`);
  }

  return parts.join(". ") + ".";
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function shortDateLabel(d: Date): string {
  // "May 15" — month + day. Expiry is a @db.Date (UTC midnight), so format in
  // UTC: rendering in ET lands on the previous evening and shifts every label
  // back one day (2026-07-08 bug: "$1560C Jul 16" for a Jul 17 Friday expiry).
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
}

// ─── ET date helpers ─────────────────────────────────────────────────────────

// Today's date in ET as YYYY-MM-DD.
function todayDateET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// Walk back to the prior trading day in ET. Skips Sat/Sun. No US holiday
// calendar in V1 — Memorial Day, Thanksgiving, etc. will pull from a holiday
// rather than the previous trading day, producing a degenerate (likely empty)
// hit list. Add a holiday list before any post-V1 holiday.
function priorTradingDayET(todayStrET: string): string {
  let d = parseDateET(todayStrET);
  for (let i = 0; i < 7; i++) {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    const dayName = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(d);
    if (dayName !== "Sat" && dayName !== "Sun") {
      return formatDateET(d);
    }
  }
  // Safety net — should never hit, since 7 days always include weekdays.
  return todayStrET;
}

function parseDateET(s: string): Date {
  // Parse "YYYY-MM-DD" as midnight ET (returns the equivalent UTC instant).
  return etMidnightUTC(s);
}

function formatDateET(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

// Compute the UTC instant that is 00:00:00 ET on the given YYYY-MM-DD.
// ET is UTC-4 (EDT) or UTC-5 (EST) depending on DST. Probe both candidates
// and return the one that maps to midnight ET on the requested date.
function etMidnightUTC(dateStrET: string): Date {
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(`${dateStrET}T${String(offsetHours).padStart(2, "0")}:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const etDate = `${get("year")}-${get("month")}-${get("day")}`;
    // Some ICU/Node versions format midnight as "24:00" under hour12:false —
    // normalize before comparing (2026-07-09 incident: the 07:30 cron threw
    // here on a rebuilt container and no hit list was written).
    const hh = get("hour") === "24" ? "00" : get("hour");
    const etTime = `${hh}:${get("minute")}`;
    if (etDate === dateStrET && etTime === "00:00") {
      return candidate;
    }
  }
  throw new Error(`Could not compute ET midnight UTC for ${dateStrET}`);
}
