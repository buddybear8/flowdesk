import { NextRequest, NextResponse } from "next/server";
import { buildGexPayload } from "@/lib/mock/gex-data";

const TICKER_RE = /^[A-Z]{1,5}$/;
const ALLOWED_EXPIRIES = ["all", "weekly", "monthly"] as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") ?? "SPY").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const rawExpiry = searchParams.get("expiry") ?? "all";
  const expiry = ALLOWED_EXPIRIES.includes(rawExpiry as typeof ALLOWED_EXPIRIES[number]) ? rawExpiry : "all";
  const strikes = Math.max(1, Math.min(100, Number(searchParams.get("strikes") ?? 25)));
  if (isNaN(strikes)) {
    return NextResponse.json({ error: "Invalid strikes" }, { status: 400 });
  }

  if (process.env.USE_MOCK_DATA === "true") {
    return NextResponse.json(buildGexPayload(ticker, expiry, strikes));
  }

  return NextResponse.json({ error: "Live UW API not wired yet" }, { status: 501 });
}
