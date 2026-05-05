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
  maxAlerts: 20,
  excludeSectors: [] as readonly string[],
  requireDp: false,
};

type ConfFilter = "HIGH" | "HIGH_MED" | "ALL";
type Confidence = "HIGH" | "MED" | "LOW";
type Direction = "UP" | "DOWN";

const DP_CONFLUENCE_HOURS = 48;

// Per-ticker aggregate built up before scoring + writing.
interface TickerAgg {
  ticker: string;
  sector: string;
  totalPremium: number;
  alertCount: number;
  bestConfidence: Confidence;
  direction: Direction;
  topAlert: Awaited<ReturnType<typeof prisma.flowAlert.findFirst>>; // highest-premium row
  contracts: Array<{
    strike: number;
    expiry: Date;
    premium: number;
    rule: string;
    type: string;
    size: number;
    oi: number;
  }>; // top 5 by premium
  execTypeCounts: Record<string, number>;
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

    // ─── 5. Score + rank + truncate ────────────────────────────────────────
    interface Scored extends TickerAgg {
      actionability: number;
      dp?: DpInfo;
    }
    const scored: Scored[] = candidates.map((agg) => ({
      ...agg,
      dp: dpByTicker.get(agg.ticker),
      actionability: computeActionability(agg, dpByTicker.get(agg.ticker)),
    }));
    scored.sort((a, b) => b.actionability - a.actionability);
    const top = scored.slice(0, criteria.maxAlerts);

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

    // ─── 7. Atomic replace today's rows ────────────────────────────────────
    const newRows: Prisma.HitListDailyCreateManyInput[] = top.map((entry, i) =>
      buildHitListRow(entry, i + 1, todayDate, allBySector, entry.dp)
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

    agg.totalPremium += premium;
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

// ─── Actionability score ─────────────────────────────────────────────────────
//
// PRD §6 doesn't lock a formula. V1 keeps premium as the dominant signal
// (matches the table's default sort) with multiplicative boosts:
//   - confidence: +50% for HIGH, +20% for MED, +0% for LOW
//   - DP confluence: +40%
//   - DP rank ≤ 10 (top of perpetual corpus): +30% additional
// Tunable. Track candidates that consistently rank too low/high in production
// and adjust the weights here.

function computeActionability(agg: TickerAgg, dp: DpInfo | undefined): number {
  const confBoost =
    agg.bestConfidence === "HIGH" ? 0.5 :
    agg.bestConfidence === "MED" ? 0.2 :
    0;
  const dpBoost = dp ? 0.4 : 0;
  const dpTopBoost = dp && dp.rank <= 10 ? 0.3 : 0;
  return agg.totalPremium * (1 + confBoost + dpBoost + dpTopBoost);
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
  dp: DpInfo | undefined
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
    contract: top.contract,
    dpConf: !!dp,
    dpRank: dp?.rank ?? null,
    dpAge: dp?.age ?? null,
    dpPrem: dp ? new Prisma.Decimal(dp.premium.toFixed(2)) : null,
    thesis: buildThesis(entry, dp),
    sector: entry.sector,
    actionabilityScore: new Prisma.Decimal(entry.actionability.toFixed(4)),
    contracts: contracts as unknown as Prisma.InputJsonValue,
    peers: peers as unknown as Prisma.InputJsonValue,
    theme: theme as unknown as Prisma.InputJsonValue,
  };
}

// ─── Thesis template ─────────────────────────────────────────────────────────
//
// V1: deterministic template based on exec mix + DP confluence. Frontend
// shows full text on hover (PRD §6 — Thesis column truncates to flex with
// hover-full). Keep concise (~80–120 chars).

function buildThesis(entry: TickerAgg, dp: DpInfo | undefined): string {
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

  if (dp) {
    parts.push(`DP confluence at rank #${dp.rank} (${dp.age})`);
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
  // "May 15" — month + day, ET-anchored to avoid UTC drift on dates near midnight.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
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
    const etTime = `${get("hour")}:${get("minute")}`;
    if (etDate === dateStrET && etTime === "00:00") {
      return candidate;
    }
  }
  throw new Error(`Could not compute ET midnight UTC for ${dateStrET}`);
}
