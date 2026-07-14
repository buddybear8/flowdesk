import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { EarningsDeepDivePayload, EarningsHistoryRow } from "@/lib/types";
import { eventToRow } from "@/lib/earnings-mapper";

const TICKER_RE = /^[A-Z][A-Z.]{0,7}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: raw } = await params;
  const ticker = (raw ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const today = new Date(`${todayET}T00:00:00.000Z`);

  // Next upcoming report; fall back to the most recent past one.
  const upcoming = await prisma.earningsEvent.findFirst({
    where: { ticker, reportDate: { gte: today } },
    orderBy: { reportDate: "asc" },
  });
  const event =
    upcoming ??
    (await prisma.earningsEvent.findFirst({ where: { ticker }, orderBy: { reportDate: "desc" } }));

  const history = await prisma.earningsHistory.findMany({
    where: { ticker, OR: [{ actualEps: { not: null } }, { move1dPct: { not: null } }] },
    orderBy: { reportDate: "desc" },
    take: 16,
  });

  // Latest AI briefs for this report: pre-earnings preview + post-earnings results.
  let aiSummary: EarningsDeepDivePayload["aiSummary"] = null;
  let resultsSummary: EarningsDeepDivePayload["resultsSummary"] = null;
  if (event) {
    const dateKey = event.reportDate.toISOString().slice(0, 10);
    const [pre, post] = await Promise.all([
      prisma.aiSummary.findFirst({ where: { kind: `earnings-${ticker}-${dateKey}` }, orderBy: { generatedAt: "desc" } }),
      prisma.aiSummary.findFirst({ where: { kind: `earnings-results-${ticker}-${dateKey}` }, orderBy: { generatedAt: "desc" } }),
    ]);
    if (pre) aiSummary = { body: pre.body, generatedAt: pre.generatedAt.toISOString() };
    if (post) resultsSummary = { body: post.body, generatedAt: post.generatedAt.toISOString() };
  }

  const n = (v: unknown) => (v == null ? null : Number(v));
  const payload: EarningsDeepDivePayload = {
    ticker,
    event: event ? eventToRow(event) : null,
    history: history.map((h): EarningsHistoryRow => ({
      reportDate: h.reportDate.toISOString().slice(0, 10),
      fiscalQuarter: h.fiscalQuarter,
      epsEstimate: n(h.epsEstimate),
      actualEps: n(h.actualEps),
      expectedMovePct: n(h.expectedMovePct),
      move1dPct: n(h.move1dPct),
      move1wPct: n(h.move1wPct),
    })),
    aiSummary,
    resultsSummary,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
