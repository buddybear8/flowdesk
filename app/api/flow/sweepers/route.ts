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

// "Opening Sweepers" preset — second backend-locked screen alongside Lottos.
// Filters mirror the named criteria saved in UW (per the screenshot the user
// shipped 2026-05-06).
//
// PRESET (locked):
//   • Calls + puts
//   • issue_type = 'Common Stock'   (skips ETFs / ADRs / indices)
//   • multi_leg = FALSE                        (single-leg only)
//   • exec = 'SWEEP'                           (sweep execution required)
//   • size > oi  AND  size ≥ 3 × oi            (Size > OI + Min Vol/OI ratio = 3)
//   • premium ≥ $100,000
//   • spot ≤ $13                               (Max underlying price)
//   • ask_prem / premium ∈ [0.73, 1.00]        (Min/Max Ask % execution)
//   • DTE ∈ [0, 14]
//   • |strike − spot| / spot ∈ [0, 0.12], directional with type
//
// NOTE on "Opening trades" / `all_opening`: same caveat as Lottos. UW's
// response field `all_opening_trades` is rare; pollSweeperAlerts asks UW
// with `all_opening=true` (loose server-side match) but we don't re-filter
// the DB rows on the strict response field. Revisit if non-opening alerts
// noticeably leak through.

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

type RawSweeperRow = {
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

  let timeStart: Date | null = null;
  let timeEnd: Date | null = null;
  if (date) {
    timeStart = etMidnightUTC(date);
    timeEnd = etMidnightUTC(nextETDate(date));
  }

  // Fixed bounds matching the screen filters.
  const MIN_OTM = 0;
  const MAX_OTM = 0.12;
  const MIN_DTE = 0;
  const MAX_DTE = 14;
  const MIN_PREMIUM = 100_000;
  const MAX_SPOT = 13;
  const MIN_VOL_OI_RATIO = 3;
  const MIN_ASK_PCT = 0.73;
  const MAX_ASK_PCT = 1.0;

  const rows = await prisma.$queryRaw<RawSweeperRow[]>`
    SELECT
      id, time, ticker, type, side, sentiment, exec, multi_leg, contract,
      strike, expiry, size, oi, premium, spot, rule, confidence, sector
    FROM flow_alerts
    WHERE
      type IN ('CALL', 'PUT')
      AND issue_type = 'Common Stock'
      AND multi_leg = FALSE
      AND exec = 'SWEEP'
      AND premium >= ${MIN_PREMIUM}
      AND spot <= ${MAX_SPOT}
      AND oi > 0
      AND size::numeric >= ${MIN_VOL_OI_RATIO} * oi
      AND premium > 0
      AND ask_prem IS NOT NULL
      AND (ask_prem / premium) BETWEEN ${MIN_ASK_PCT} AND ${MAX_ASK_PCT}
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
