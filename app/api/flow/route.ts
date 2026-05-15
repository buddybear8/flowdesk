import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FlowAlert, FlowStats, OptionType, Side, Direction, ExecType, Confidence, Sector } from "@/lib/types";

const ALLOWED_TYPES = ["ALL", "CALL", "PUT"] as const;
const ALLOWED_SIDES = ["ALL", "BUY", "SELL"] as const;
const ALLOWED_EXECS = ["ALL", "SWEEP", "FLOOR", "BLOCK", "SINGLE"] as const;
const ALLOWED_CONFS = ["ALL", "HIGH", "MED", "LOW"] as const;

// No row cap by design — we want the Live feed to surface every flow alert
// the DB has for the user's filter set (the 60-day retention sweep is the
// only ceiling). With ticker + date filters applied, typical results are
// tens to low hundreds of rows; an unfiltered day query may return ~12K
// rows on a busy session. The frontend table is non-virtualized, so very
// large unfiltered loads take ~1-2s to render — acceptable today, virtualize
// if it becomes painful.

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

// Parse YYYY-MM-DD as midnight in America/New_York, returned as a UTC Date.
// DST-safe: tries the EDT offset first; if that re-formats back to the same
// ET date we're correct, otherwise it's an EST day so use -05:00.
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawType = searchParams.get("type") ?? "ALL";
  const type = ALLOWED_TYPES.includes(rawType as typeof ALLOWED_TYPES[number]) ? rawType : "ALL";
  const rawSide = searchParams.get("side") ?? "ALL";
  const side = ALLOWED_SIDES.includes(rawSide as typeof ALLOWED_SIDES[number]) ? rawSide : "ALL";
  const rawExec = searchParams.get("exec") ?? "ALL";
  const exec = ALLOWED_EXECS.includes(rawExec as typeof ALLOWED_EXECS[number]) ? rawExec : "ALL";
  const minPrem = Math.max(0, Math.min(1_000_000_000, Number(searchParams.get("minPrem") ?? 0)));
  if (isNaN(minPrem)) {
    return NextResponse.json({ error: "Invalid minPrem" }, { status: 400 });
  }
  const rawConf = searchParams.get("conf") ?? "ALL";
  const conf = ALLOWED_CONFS.includes(rawConf as typeof ALLOWED_CONFS[number]) ? rawConf : "ALL";

  const date = searchParams.get("date");
  if (date != null && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }

  // Ticker filter — uppercase, allow 1-5 letters (covers SPXW etc.).
  const rawTicker = searchParams.get("ticker");
  let ticker: string | null = null;
  if (rawTicker) {
    const t = rawTicker.trim().toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(t)) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }
    ticker = t;
  }

  // Sector filter — matches the Sector union; "ALL" is a no-op.
  const rawSector = searchParams.get("sector");
  const sector = rawSector && rawSector !== "ALL" ? rawSector : null;

  const where: Prisma.FlowAlertWhereInput = {};
  if (type !== "ALL") where.type = type;
  if (side !== "ALL") where.side = side;
  if (exec !== "ALL") where.exec = exec;
  if (conf !== "ALL") where.confidence = conf;
  if (minPrem > 0) where.premium = { gte: minPrem };
  if (ticker) where.ticker = ticker;
  if (sector) where.sector = sector;
  if (date) {
    const start = etMidnightUTC(date);
    const end = etMidnightUTC(nextETDate(date));
    where.time = { gte: start, lt: end };
  }

  const rows = await prisma.flowAlert.findMany({
    where,
    orderBy: { time: "desc" },
  });

  const alerts: FlowAlert[] = rows.map((r) => ({
    id: r.id,
    date: DATE_LABEL_FMT.format(r.time),
    time: TIME_LABEL_FMT.format(r.time),
    ticker: r.ticker,
    type: r.type as OptionType,
    side: r.side as Side,
    sentiment: r.sentiment as Direction,
    exec: r.exec as ExecType,
    multiLeg: r.multiLeg,
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
