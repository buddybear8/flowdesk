import { NextResponse } from "next/server";
import { buildMarketTide, buildNetImpact } from "@/lib/mock/market-tide-data";

export async function GET() {
  if (process.env.USE_MOCK_DATA === "true") {
    return NextResponse.json({
      tide: buildMarketTide(),
      netImpact: buildNetImpact(),
    });
  }
  return NextResponse.json(
    { error: "Live UW market-tide + net-impact endpoints not wired yet" },
    { status: 501 }
  );
}
