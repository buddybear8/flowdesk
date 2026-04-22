import { NextRequest, NextResponse } from "next/server";
import { buildDarkPoolPrints } from "@/lib/mock/dark-pool-prints";
import type { DarkPoolPrint } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rankMin = Number(searchParams.get("rankMin") ?? 1);
  const rankMax = Number(searchParams.get("rankMax") ?? 100);
  const hideETF = searchParams.get("hideETF") === "true";
  const regularHour = searchParams.get("regularHour") !== "false";
  const extendedHour = searchParams.get("extendedHour") !== "false";

  if (process.env.USE_MOCK_DATA === "true") {
    let prints: DarkPoolPrint[] = buildDarkPoolPrints();
    prints = prints.filter(p => p.all_time_rank >= rankMin && p.all_time_rank <= rankMax);
    if (hideETF) prints = prints.filter(p => !p.is_etf);
    if (!regularHour) prints = prints.filter(p => p.is_extended);
    if (!extendedHour) prints = prints.filter(p => !p.is_extended);
    return NextResponse.json({ prints });
  }

  return NextResponse.json({ error: "Live Polygon feed not wired yet" }, { status: 501 });
}
