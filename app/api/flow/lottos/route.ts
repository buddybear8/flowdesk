import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  FlowAlert,
  FlowStats,
  OptionType,
  Side,
  Direction,
  ExecType,
  Confidence,
  Sector,
} from "@/lib/types";

// "Lottos" preset — backend-locked filters. The only client-controllable
// params are ?date= (historical trading day) and ?exact= (execution-match
// strictness). All other criteria are intentionally hidden from the UI;
// they're the product's secret-sauce screen.
//
// PRESET (locked):
//   • Calls + puts
//   • issue_type = 'Common Stock'   (skips ETFs / ADRs / indices)
//   • all_opening = TRUE                       (no closing flow)
//   • multi_leg = FALSE                        (single-leg only)
//   • size > oi                                (volume > OI)
//   • expiry ≥ today (ET)                      (hide expired)
//   • DTE ∈ [0, 14]
//   • |strike − spot| / spot ∈ [0.20, 1.00], directional with type
//   • premium ≥ $1,000
//
// EXECUTION MATCH (?exact=1 toggles strictness):
//   • exact = 0 (default) — ask-side or above-ask: ask_prem ≥ bid_prem AND
//     ask_prem > 0. Includes alerts with some mid trades, as long as the
//     bulk of premium hit (or pushed through) the ask.
//   • exact = 1            — every trade at ask: bid_prem = 0 AND
//     ask_prem ≥ premium − $1 (cent-rounding tolerance).
//
// NOT ENFORCED (UW's public flow-alerts endpoint does not expose tags for
// these; UW's UI applies them via internal stock tagging the API doesn't
// return — revisit if results look noisy):
//   • Show China / Volatility, Hide Dividend
//   • "Cross" flag type (UW UI label, no public API equivalent)

const MAX_ROWS = 200;

const TIME_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const DATE_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

const ISO_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function etMidnightUTC(dateStr: string): Date {
  const edt = new Date(`${dateStr}T00:00:00-04:00`);
  if (ISO_DATE_FMT.format(edt) === dateStr) return edt;
  return new Date(`${dateStr}T00:00:00-05:00`);
}

function nextETDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const d0 = new Date(Date.UTC(y!, m! - 1, d!));
  d0.setUTCDate(d0.getUTCDate() + 1);
  return `${d0.getUTCFullYear()}-${String(d0.getUTCMonth() + 1).padStart(2, "0")}-${String(d0.getUTCDate()).padStart(2, "0")}`;
}

// Raw row shape returned from $queryRaw — Prisma decimal/bigint columns come
// back as strings or BigInts depending on driver, so coerce defensively at
// the boundary.
type RawLottoRow = {
  id: string;
  time: Date;
  ticker: string;
  type: string;
  side: string;
  sentiment: string;
  exec: string;
  multi_leg: boolean;
  contract: string;
  strike: Prisma.Decimal | string;
  expiry: Date;
  size: number;
  oi: number;
  premium: Prisma.Decimal | string;
  spot: Prisma.Decimal | string;
  rule: string;
  confidence: string;
  sector: string;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (date != null && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const exactAtAsk = searchParams.get("exact") === "1";

  // Trading-day window — defaults to "any time" (no lower bound) so the most
  // recent matching alerts always surface, regardless of poll cadence. When
  // a specific ET date is supplied we scope to that 24h window.
  let timeStart: Date | null = null;
  let timeEnd: Date | null = null;
  if (date) {
    timeStart = etMidnightUTC(date);
    timeEnd = etMidnightUTC(nextETDate(date));
  }

  // Tolerance for the strict "exactly at ask" path: trade premium can include
  // fractional cents that get summed across many fills, so allow $1 of drift.
  const ASK_TOLERANCE_USD = 1;

  // % OTM band — fractional, not percent. 0.20 = 20% OTM, 1.00 = 100% OTM.
  // Direction-aware: CALL OTM = strike > spot; PUT OTM = strike < spot.
  const MIN_OTM = 0.2;
  const MAX_OTM = 1.0;

  const MIN_DTE = 0;
  const MAX_DTE = 14;
  const MIN_PREMIUM = 1000;

  // Execution-match clause swaps based on the toggle:
  //   exact=0 (default) → ask-side or above-ask: ask_prem ≥ bid_prem AND ask_prem > 0
  //   exact=1           → only at the ask: bid_prem = 0 AND ask_prem ≈ premium
  const execMatch = exactAtAsk
    ? Prisma.sql`bid_prem = 0 AND ask_prem >= (premium - ${ASK_TOLERANCE_USD})`
    : Prisma.sql`ask_prem >= bid_prem AND ask_prem > 0`;

  const rows = await prisma.$queryRaw<RawLottoRow[]>`
    SELECT
      id, time, ticker, type, side, sentiment, exec, multi_leg, contract,
      strike, expiry, size, oi, premium, spot, rule, confidence, sector
    FROM flow_alerts
    WHERE
      type IN ('CALL', 'PUT')
      AND issue_type = 'Common Stock'
      AND all_opening = TRUE
      AND multi_leg = FALSE
      AND premium >= ${MIN_PREMIUM}
      AND size > oi
      AND ${execMatch}
      AND (expiry - (time AT TIME ZONE 'America/New_York')::date) BETWEEN ${MIN_DTE} AND ${MAX_DTE}
      AND expiry >= (NOW() AT TIME ZONE 'America/New_York')::date
      AND (
        (type = 'CALL' AND strike > spot AND (strike - spot) / spot BETWEEN ${MIN_OTM} AND ${MAX_OTM})
        OR
        (type = 'PUT'  AND strike < spot AND (spot - strike) / spot BETWEEN ${MIN_OTM} AND ${MAX_OTM})
      )
      ${timeStart && timeEnd ? Prisma.sql`AND time >= ${timeStart} AND time < ${timeEnd}` : Prisma.empty}
    ORDER BY time DESC
    LIMIT ${MAX_ROWS}
  `;

  const alerts: FlowAlert[] = rows.map((r) => ({
    id: r.id,
    date: DATE_LABEL_FMT.format(r.time),
    time: TIME_LABEL_FMT.format(r.time),
    ticker: r.ticker,
    type: r.type as OptionType,
    side: r.side as Side,
    sentiment: r.sentiment as Direction,
    exec: r.exec as ExecType,
    multiLeg: r.multi_leg,
    contract: r.contract,
    strike: Number(r.strike),
    expiry: ISO_DATE_FMT.format(r.expiry),
    size: r.size,
    oi: r.oi,
    premium: Number(r.premium),
    spot: Number(r.spot),
    rule: r.rule,
    confidence: r.confidence as Confidence,
    sector: r.sector as Sector,
  }));

  return NextResponse.json({ alerts, stats: computeFlowStats(alerts) });
}

function computeFlowStats(alerts: FlowAlert[]): FlowStats {
  const calls = alerts.filter((a) => a.type === "CALL").length;
  const puts = alerts.filter((a) => a.type === "PUT").length;
  const totalPrem = alerts.reduce((sum, a) => sum + a.premium, 0);
  const cpRatio = puts === 0 ? (calls === 0 ? 0 : Infinity) : calls / puts;

  const ruleCount = new Map<string, number>();
  for (const a of alerts) ruleCount.set(a.rule, (ruleCount.get(a.rule) ?? 0) + 1);
  const sorted = [...ruleCount.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  const topRule = top
    ? { name: top[0], pct: Math.round((top[1] / alerts.length) * 100) }
    : { name: "—", pct: 0 };

  return { count: alerts.length, calls, puts, totalPrem, cpRatio, topRule };
}
