import { NextRequest, NextResponse } from "next/server";
import { buildSentimentOverview, buildAnalystIntelligence } from "@/lib/mock/sentiment-data";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") ?? "overview";

  if (process.env.USE_MOCK_DATA === "true") {
    return NextResponse.json(
      view === "analysts" ? buildAnalystIntelligence() : buildSentimentOverview()
    );
  }
  return NextResponse.json({ error: "Live xAI/X sentiment pipeline not wired yet" }, { status: 501 });
}
