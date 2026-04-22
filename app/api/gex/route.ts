import { NextRequest, NextResponse } from "next/server";
import { buildGexPayload } from "@/lib/mock/gex-data";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") ?? "SPY").toUpperCase();
  const expiry = searchParams.get("expiry") ?? "all";
  const strikes = Number(searchParams.get("strikes") ?? 25);

  if (process.env.USE_MOCK_DATA === "true") {
    return NextResponse.json(buildGexPayload(ticker, expiry, strikes));
  }

  return NextResponse.json({ error: "Live UW API not wired yet" }, { status: 501 });
}
