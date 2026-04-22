import { NextRequest, NextResponse } from "next/server";
import { buildFlowAlerts, computeFlowStats } from "@/lib/mock/flow-alerts";
import type { FlowAlert } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const side = searchParams.get("side");
  const minPrem = Number(searchParams.get("minPrem") ?? 0);
  const conf = searchParams.get("conf");
  if (process.env.USE_MOCK_DATA === "true") {
    let alerts: FlowAlert[] = buildFlowAlerts();
    if (type && type !== "ALL") alerts = alerts.filter(a => a.type === type);
    if (side && side !== "ALL") alerts = alerts.filter(a => a.side === side);
    if (minPrem) alerts = alerts.filter(a => a.premium >= minPrem);
    if (conf && conf !== "ALL") alerts = alerts.filter(a => a.confidence === conf);
    return NextResponse.json({ alerts, stats: computeFlowStats(alerts) });
  }

  return NextResponse.json({ error: "Live UW API not wired yet" }, { status: 501 });
}
