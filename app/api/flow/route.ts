import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FlowAlert, FlowStats, OptionType, Side, Direction, ExecType, Confidence, Sector } from "@/lib/types";

const ALLOWED_TYPES = ["ALL", "CALL", "PUT"] as const;
const ALLOWED_SIDES = ["ALL", "BUY", "SELL"] as const;
const ALLOWED_EXECS = ["ALL", "SWEEP", "FLOOR", "BLOCK", "SINGLE"] as const;
const ALLOWED_CONFS = ["ALL", "HIGH", "MED", "LOW"] as const;

// Cap response size — module renders top N most recent alerts per filter set.
const MAX_ROWS = 200;

const TIME_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const ISO_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
});

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

  const where: Prisma.FlowAlertWhereInput = {};
  if (type !== "ALL") where.type = type;
  if (side !== "ALL") where.side = side;
  if (exec !== "ALL") where.exec = exec;
  if (conf !== "ALL") where.confidence = conf;
  if (minPrem > 0) where.premium = { gte: minPrem };

  const rows = await prisma.flowAlert.findMany({
    where,
    orderBy: { time: "desc" },
    take: MAX_ROWS,
  });

  const alerts: FlowAlert[] = rows.map((r) => ({
    id: r.id,
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
