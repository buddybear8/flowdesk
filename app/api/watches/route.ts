import { NextResponse } from "next/server";
import { buildWatchesPayload } from "@/lib/mock/watches-data";

export async function GET() {
  if (process.env.USE_MOCK_DATA === "true") {
    return NextResponse.json(buildWatchesPayload());
  }
  return NextResponse.json({ error: "Live hit list pipeline not wired yet" }, { status: 501 });
}
