import { NextRequest, NextResponse } from "next/server";
import { buildSentimentOverview, buildAnalystIntelligence } from "@/lib/mock/sentiment-data";

const ALLOWED_VIEWS = ["overview", "analysts"] as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawView = searchParams.get("view") ?? "overview";
  const view = ALLOWED_VIEWS.includes(rawView as typeof ALLOWED_VIEWS[number]) ? rawView : "overview";

  if (process.env.USE_MOCK_DATA === "true") {
    return NextResponse.json(
      view === "analysts" ? buildAnalystIntelligence() : buildSentimentOverview()
    );
  }
  return NextResponse.json({ error: "Live xAI/X sentiment pipeline not wired yet" }, { status: 501 });
}
