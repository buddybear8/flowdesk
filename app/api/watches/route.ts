import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type {
  HitListPayload,
  HitListItem,
  HitListContract,
  HitListPeer,
  HitListTheme,
  SectorFlow,
  Confidence,
  Direction,
  Sector,
} from "@/lib/types";

// Format the presentation date for the session-meta header. Mock returns
// "Monday, April 21" — match that style.
const HEADER_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
});

const ISO_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
});

export async function GET() {
  // 1. Latest hit list. The worker writes today's row at 07:30 ET; if today
  // hasn't been computed yet (e.g. the dashboard is opened over the weekend),
  // fall back to the most recent available date so the page isn't empty.
  const todayDate = new Date(ISO_DATE_FMT.format(new Date()));
  let hits = await prisma.hitListDaily.findMany({
    where: { date: todayDate },
    orderBy: { rank: "asc" },
  });
  let presentationDate = todayDate;

  if (hits.length === 0) {
    const latest = await prisma.hitListDaily.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (latest) {
      presentationDate = latest.date;
      hits = await prisma.hitListDaily.findMany({
        where: { date: presentationDate },
        orderBy: { rank: "asc" },
      });
    }
  }

  if (hits.length === 0) {
    // No hit list has been computed yet (fresh deploy or weekend before
    // the first cron firing). Return an empty-but-well-formed payload so
    // the frontend renders its "no data" state cleanly.
    return NextResponse.json<HitListPayload>({
      sessionMeta: {
        date: HEADER_DATE_FMT.format(new Date()),
        sentiment: "BULLISH",
        totalPremLabel: "$0",
        callPutLabel: "0/0",
        leadSector: "Technology",
      },
      hits: [],
      sectorFlow: [],
    });
  }

  // 2. Map hit list rows to HitListItem.
  const items: HitListItem[] = hits.map((r) => ({
    rank: r.rank,
    ticker: r.ticker,
    price: Number(r.price),
    direction: r.direction as "UP" | "DOWN",
    confidence: r.confidence as Confidence,
    premium: Number(r.premium),
    contract: r.contract,
    dpConf: r.dpConf,
    ...(r.dpRank != null ? { dpRank: r.dpRank } : {}),
    ...(r.dpAge ? { dpAge: r.dpAge as "today" | "yesterday" } : {}),
    ...(r.dpPrem != null ? { dpPrem: Number(r.dpPrem) } : {}),
    thesis: r.thesis,
    sector: r.sector as Sector,
    contracts: r.contracts as unknown as HitListContract[],
    peers: r.peers as unknown as HitListPeer[],
    theme: r.theme as unknown as HitListTheme,
  }));

  // 3. sectorFlow + callPutLabel: aggregate flow_alerts on the prior trading
  // day (the data the hit list was computed from). Signed-by-sentiment net
  // premium per sector — bullish adds, bearish subtracts. callPutLabel is
  // the call/put count split across the same window.
  const priorDay = priorTradingDay(presentationDate);
  const priorStart = etMidnightUTC(priorDay);
  const priorEnd = new Date(priorStart.getTime() + 24 * 60 * 60 * 1000);

  const priorAlerts = await prisma.flowAlert.findMany({
    where: { time: { gte: priorStart, lt: priorEnd } },
    select: { sector: true, sentiment: true, premium: true, type: true },
  });

  const sectorNet = new Map<string, number>();
  let callCount = 0;
  let putCount = 0;
  for (const a of priorAlerts) {
    const signed = a.sentiment === "BEARISH" ? -Number(a.premium) : Number(a.premium);
    sectorNet.set(a.sector, (sectorNet.get(a.sector) ?? 0) + signed);
    if (a.type === "CALL") callCount += 1;
    else if (a.type === "PUT") putCount += 1;
  }
  const sectorFlow: SectorFlow[] = [...sectorNet.entries()]
    .map(([sector, netPremium]) => ({ sector: sector as Sector, netPremium }))
    .sort((a, b) => b.netPremium - a.netPremium);

  // 4. sessionMeta — derive from hits + prior-day call/put counts.
  const totalPrem = items.reduce((sum, h) => sum + h.premium, 0);
  const upPrem = items.filter((h) => h.direction === "UP").reduce((s, h) => s + h.premium, 0);
  const sentiment: Direction = upPrem >= totalPrem - upPrem ? "BULLISH" : "BEARISH";
  const callPutLabel = callPutPctLabel(callCount, putCount);
  const leadSector = leadSectorByPremium(items);

  return NextResponse.json<HitListPayload>({
    sessionMeta: {
      date: HEADER_DATE_FMT.format(presentationDate),
      sentiment,
      totalPremLabel: formatMoney(totalPrem),
      callPutLabel,
      leadSector,
    },
    hits: items,
    sectorFlow,
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function callPutPctLabel(calls: number, puts: number): string {
  const total = calls + puts;
  if (total === 0) return "0/0";
  const callPct = Math.round((calls / total) * 100);
  return `${callPct}/${100 - callPct}`;
}

function leadSectorByPremium(items: HitListItem[]): Sector {
  const bySector = new Map<string, number>();
  for (const h of items) {
    bySector.set(h.sector, (bySector.get(h.sector) ?? 0) + h.premium);
  }
  const top = [...bySector.entries()].sort((a, b) => b[1] - a[1])[0];
  return (top?.[0] as Sector) ?? "Technology";
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Walk back 1 day from `date`, skipping Sat/Sun in ET. No US holiday
// calendar in V1 — see worker/src/jobs/hit-list-compute.ts for the same
// caveat. When extracting these to a shared lib post-V1, both sites move.
function priorTradingDay(date: Date): string {
  let d = new Date(date.getTime());
  for (let i = 0; i < 7; i++) {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    const dayName = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(d);
    if (dayName !== "Sat" && dayName !== "Sun") {
      return ISO_DATE_FMT.format(d);
    }
  }
  return ISO_DATE_FMT.format(date); // safety net (unreachable in practice)
}

// UTC instant equivalent to 00:00:00 ET on the given YYYY-MM-DD. EDT (-4)
// or EST (-5) — probe both candidates and pick the one that maps to
// midnight ET on the requested date.
function etMidnightUTC(dateStrET: string): Date {
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(`${dateStrET}T${String(offsetHours).padStart(2, "0")}:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const etDate = `${get("year")}-${get("month")}-${get("day")}`;
    const etTime = `${get("hour")}:${get("minute")}`;
    if (etDate === dateStrET && etTime === "00:00") {
      return candidate;
    }
  }
  throw new Error(`Could not compute ET midnight UTC for ${dateStrET}`);
}
