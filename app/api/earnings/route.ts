import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { EarningsCalendarPayload } from "@/lib/types";
import { eventToRow } from "@/lib/earnings-mapper";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function etToday(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const from = fromRaw && DATE_RE.test(fromRaw) ? fromRaw : etToday(-1);
  const to = toRaw && DATE_RE.test(toRaw) ? toRaw : etToday(13);

  const rows = await prisma.earningsEvent.findMany({
    where: {
      reportDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    orderBy: [{ reportDate: "asc" }, { marketcap: "desc" }],
  });

  const updatedAt = rows.reduce<Date | null>(
    (m, r) => (m === null || r.updatedAt > m ? r.updatedAt : m),
    null,
  );

  const payload: EarningsCalendarPayload = {
    from,
    to,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    events: rows.map(eventToRow),
  };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" },
  });
}
