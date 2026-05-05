// /api/admin/criteria — load + save WatchesCriteria (PRD §6).
//
// V1 scope: GET returns the current criteria; POST validates + upserts the
// single row (id=1). Same-day hit list rebuild is deferred — the next 07:30
// ET cron picks up the saved criteria.
//
// Why deferred: PRD §6 specifies "POST triggers an immediate hit list
// rebuild for the current trading day". The rebuild logic lives in
// worker/src/jobs/hit-list-compute.ts; the worker package isn't set up to
// be imported from the Next.js root, so calling it inline requires either
// (a) extracting hit-list-compute to a shared package consumable by both
// sides, or (b) duplicating ~480 lines into this route. The criteria
// config form (PRD §6) isn't built yet either, so no UI currently calls
// this endpoint — when that lands, the cleaner fix is path (a). Tracked
// as post-V1 polish.
//
// No auth gate yet — auth lands in Phase F (Auth.js + Whop OAuth).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Defaults reproduced from prisma/schema.prisma. When no row exists yet,
// GET returns these so the form renders correctly on a fresh deploy.
const DEFAULTS = {
  minPremium: 700_000,
  confFilter: "HIGH_MED" as const,
  execTypes: ["SWEEP", "FLOOR", "BLOCK", "SINGLE"] as readonly string[],
  maxAlerts: 20,
  excludeSectors: [] as readonly string[],
  requireDp: false,
};

const ALLOWED_CONF_FILTERS = ["HIGH", "HIGH_MED", "ALL"] as const;
const ALLOWED_EXEC_TYPES = ["SWEEP", "FLOOR", "BLOCK", "SINGLE"] as const;
const VALID_SECTORS = [
  "Technology", "Communication", "Consumer Discretionary", "Consumer Staples",
  "Energy", "Financials", "Health Care", "Industrials", "Materials",
  "Real Estate", "Utilities", "Index", "Commodities", "Bonds", "Volatility",
] as const;

const MAX_PREMIUM = 1_000_000_000;
const MAX_ALERTS_CEILING = 20;

interface CriteriaBody {
  minPremium?: number;
  confFilter?: string;
  execTypes?: string[];
  maxAlerts?: number;
  excludeSectors?: string[];
  requireDp?: boolean;
}

export async function GET() {
  const row = await prisma.watchesCriteria.findUnique({ where: { id: 1 } });
  if (!row) {
    return NextResponse.json({
      minPremium: DEFAULTS.minPremium,
      confFilter: DEFAULTS.confFilter,
      execTypes: [...DEFAULTS.execTypes],
      maxAlerts: DEFAULTS.maxAlerts,
      excludeSectors: [...DEFAULTS.excludeSectors],
      requireDp: DEFAULTS.requireDp,
    });
  }
  return NextResponse.json({
    minPremium: row.minPremium,
    confFilter: row.confFilter,
    execTypes: row.execTypes,
    maxAlerts: row.maxAlerts,
    excludeSectors: row.excludeSectors,
    requireDp: row.requireDp,
  });
}

export async function POST(req: NextRequest) {
  let body: CriteriaBody;
  try {
    body = (await req.json()) as CriteriaBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validation. Each path returns 400 with a specific message so the
  // criteria-config form can highlight the offending field.
  const minPremium = body.minPremium ?? DEFAULTS.minPremium;
  if (typeof minPremium !== "number" || !Number.isFinite(minPremium) || minPremium < 0 || minPremium > MAX_PREMIUM) {
    return NextResponse.json({ error: `minPremium must be 0..${MAX_PREMIUM}` }, { status: 400 });
  }

  const confFilter = body.confFilter ?? DEFAULTS.confFilter;
  if (!ALLOWED_CONF_FILTERS.includes(confFilter as typeof ALLOWED_CONF_FILTERS[number])) {
    return NextResponse.json({ error: `confFilter must be one of: ${ALLOWED_CONF_FILTERS.join(", ")}` }, { status: 400 });
  }

  const execTypes = body.execTypes ?? [...DEFAULTS.execTypes];
  if (
    !Array.isArray(execTypes) ||
    execTypes.length === 0 ||
    !execTypes.every((t) => typeof t === "string" && ALLOWED_EXEC_TYPES.includes(t as typeof ALLOWED_EXEC_TYPES[number]))
  ) {
    return NextResponse.json(
      { error: `execTypes must be a non-empty subset of: ${ALLOWED_EXEC_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const maxAlerts = body.maxAlerts ?? DEFAULTS.maxAlerts;
  if (typeof maxAlerts !== "number" || !Number.isInteger(maxAlerts) || maxAlerts < 1 || maxAlerts > MAX_ALERTS_CEILING) {
    return NextResponse.json({ error: `maxAlerts must be an integer 1..${MAX_ALERTS_CEILING}` }, { status: 400 });
  }

  const excludeSectors = body.excludeSectors ?? [...DEFAULTS.excludeSectors];
  if (
    !Array.isArray(excludeSectors) ||
    !excludeSectors.every((s) => typeof s === "string" && VALID_SECTORS.includes(s as typeof VALID_SECTORS[number]))
  ) {
    return NextResponse.json(
      { error: `excludeSectors entries must be one of: ${VALID_SECTORS.join(", ")}` },
      { status: 400 }
    );
  }

  const requireDp = body.requireDp ?? DEFAULTS.requireDp;
  if (typeof requireDp !== "boolean") {
    return NextResponse.json({ error: "requireDp must be a boolean" }, { status: 400 });
  }

  const data = { minPremium, confFilter, execTypes, maxAlerts, excludeSectors, requireDp };
  const saved = await prisma.watchesCriteria.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  return NextResponse.json({
    saved: {
      minPremium: saved.minPremium,
      confFilter: saved.confFilter,
      execTypes: saved.execTypes,
      maxAlerts: saved.maxAlerts,
      excludeSectors: saved.excludeSectors,
      requireDp: saved.requireDp,
    },
    rebuildScheduled: "next 07:30 ET cron",
  });
}
