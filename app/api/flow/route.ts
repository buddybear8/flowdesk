import { NextRequest, NextResponse } from "next/server";
import { buildFlowAlerts, computeFlowStats } from "@/lib/mock/flow-alerts";
import type { FlowAlert } from "@/lib/types";

const ALLOWED_TYPES = ["ALL", "CALL", "PUT"] as const;
const ALLOWED_SIDES = ["ALL", "BUY", "SELL"] as const;
const ALLOWED_EXECS = ["ALL", "SWEEP", "FLOOR", "BLOCK", "SINGLE"] as const;
const ALLOWED_CONFS = ["ALL", "HIGH", "MED", "LOW"] as const;

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
  if (process.env.USE_MOCK_DATA === "true") {
    let alerts: FlowAlert[] = buildFlowAlerts();
    if (type !== "ALL") alerts = alerts.filter(a => a.type === type);
    if (side !== "ALL") alerts = alerts.filter(a => a.side === side);
    if (exec !== "ALL") alerts = alerts.filter(a => a.exec === exec);
    if (minPrem) alerts = alerts.filter(a => a.premium >= minPrem);
    if (conf !== "ALL") alerts = alerts.filter(a => a.confidence === conf);
    return NextResponse.json({ alerts, stats: computeFlowStats(alerts) });
  }

  return NextResponse.json({ error: "Live UW API not wired yet" }, { status: 501 });
}
