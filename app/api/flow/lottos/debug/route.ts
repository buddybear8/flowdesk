import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Diagnostic endpoint for the Lottos preset. Walks the WHERE clause one
// predicate at a time and reports how many rows survive each step, so we
// can pinpoint where data is being lost. Also returns a sample row to
// verify mapFlowAlert is populating the new v1.3 fields.
//
// Hit it at /api/flow/lottos/debug — no auth in front of /api/* yet.
// Remove this file once the diagnosis is settled.

export async function GET(_req: NextRequest) {
  const ASK_TOLERANCE_USD = 1;
  const MIN_OTM = 0.2;
  const MAX_OTM = 1.0;
  const MIN_DTE = 0;
  const MAX_DTE = 14;
  const MIN_PREMIUM = 1000;

  // Each step is a query against flow_alerts with one additional predicate.
  // We restrict every step to the last 24h to keep the totals meaningful.
  const lastDay = Prisma.sql`time >= NOW() - INTERVAL '24 hours'`;

  const counts: Record<string, number> = {};
  const cnt = async (label: string, where: Prisma.Sql) => {
    const r = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM flow_alerts WHERE ${where}`;
    counts[label] = Number(r[0]?.c ?? 0);
  };

  // Mirrors the chain in app/api/flow/lottos/route.ts after the all_opening
  // filter was relaxed. Each step adds one predicate so we can see attrition.
  await cnt("0_total_24h", lastDay);
  await cnt(
    "1_issue_type_common_stock",
    Prisma.sql`${lastDay} AND issue_type = 'Common Stock'`
  );
  await cnt(
    "2_+multi_leg_false",
    Prisma.sql`${lastDay} AND issue_type = 'Common Stock' AND multi_leg = FALSE`
  );
  await cnt(
    "3_+premium_gte_1000",
    Prisma.sql`${lastDay} AND issue_type = 'Common Stock' AND multi_leg = FALSE AND premium >= ${MIN_PREMIUM}`
  );
  await cnt(
    "4_+size_gt_oi",
    Prisma.sql`${lastDay} AND issue_type = 'Common Stock' AND multi_leg = FALSE AND premium >= ${MIN_PREMIUM} AND size > oi`
  );
  await cnt(
    "5_+ask_side_default_toggle",
    Prisma.sql`${lastDay} AND issue_type = 'Common Stock' AND multi_leg = FALSE AND premium >= ${MIN_PREMIUM} AND size > oi AND ask_prem >= bid_prem AND ask_prem > 0`
  );
  await cnt(
    "6_+dte_0_14",
    Prisma.sql`${lastDay} AND issue_type = 'Common Stock' AND multi_leg = FALSE AND premium >= ${MIN_PREMIUM} AND size > oi AND ask_prem >= bid_prem AND ask_prem > 0 AND (expiry - (time AT TIME ZONE 'America/New_York')::date) BETWEEN ${MIN_DTE} AND ${MAX_DTE}`
  );
  await cnt(
    "7_+expiry_not_passed",
    Prisma.sql`${lastDay} AND issue_type = 'Common Stock' AND multi_leg = FALSE AND premium >= ${MIN_PREMIUM} AND size > oi AND ask_prem >= bid_prem AND ask_prem > 0 AND (expiry - (time AT TIME ZONE 'America/New_York')::date) BETWEEN ${MIN_DTE} AND ${MAX_DTE} AND expiry >= (NOW() AT TIME ZONE 'America/New_York')::date`
  );
  await cnt(
    "8_+otm_window_20_100__final_route_count",
    Prisma.sql`
      ${lastDay}
      AND issue_type = 'Common Stock'
      AND multi_leg = FALSE
      AND premium >= ${MIN_PREMIUM}
      AND size > oi
      AND ask_prem >= bid_prem AND ask_prem > 0
      AND (expiry - (time AT TIME ZONE 'America/New_York')::date) BETWEEN ${MIN_DTE} AND ${MAX_DTE}
      AND expiry >= (NOW() AT TIME ZONE 'America/New_York')::date
      AND (
        (type = 'CALL' AND strike > spot AND (strike - spot) / spot BETWEEN ${MIN_OTM} AND ${MAX_OTM})
        OR
        (type = 'PUT'  AND strike < spot AND (spot - strike) / spot BETWEEN ${MIN_OTM} AND ${MAX_OTM})
      )
    `
  );

  // Also show what would land if we relax `size > oi` and the OTM window
  // separately, so we can see which constraint is doing the most cutting.
  await cnt(
    "alt_no_size_gt_oi",
    Prisma.sql`
      ${lastDay}
      AND issue_type = 'Common Stock'
      AND multi_leg = FALSE
      AND premium >= ${MIN_PREMIUM}
      AND ask_prem >= bid_prem AND ask_prem > 0
      AND (expiry - (time AT TIME ZONE 'America/New_York')::date) BETWEEN ${MIN_DTE} AND ${MAX_DTE}
      AND expiry >= (NOW() AT TIME ZONE 'America/New_York')::date
      AND (
        (type = 'CALL' AND strike > spot AND (strike - spot) / spot BETWEEN ${MIN_OTM} AND ${MAX_OTM})
        OR
        (type = 'PUT'  AND strike < spot AND (spot - strike) / spot BETWEEN ${MIN_OTM} AND ${MAX_OTM})
      )
    `
  );
  await cnt(
    "alt_no_otm_window",
    Prisma.sql`
      ${lastDay}
      AND issue_type = 'Common Stock'
      AND multi_leg = FALSE
      AND premium >= ${MIN_PREMIUM}
      AND size > oi
      AND ask_prem >= bid_prem AND ask_prem > 0
      AND (expiry - (time AT TIME ZONE 'America/New_York')::date) BETWEEN ${MIN_DTE} AND ${MAX_DTE}
      AND expiry >= (NOW() AT TIME ZONE 'America/New_York')::date
    `
  );

  // How many rows have the new v1.3 fields populated vs NULL? Tells us
  // whether mapFlowAlert is capturing them and whether old rows still
  // dominate the table (skipDuplicates would mask backfill).
  const fieldFill = await prisma.$queryRaw<
    { populated: bigint; null_fields: bigint }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE issue_type IS NOT NULL)::bigint AS populated,
      COUNT(*) FILTER (WHERE issue_type IS NULL)::bigint     AS null_fields
    FROM flow_alerts
    WHERE time >= NOW() - INTERVAL '24 hours'
  `;

  // Latest 5 rows with the new fields populated, lightly redacted.
  const samples = await prisma.$queryRaw<any[]>`
    SELECT id, ticker, type, side, exec, strike, spot, size, oi, premium,
           expiry, ask_prem, bid_prem, all_opening, issue_type,
           has_floor, has_single_leg
    FROM flow_alerts
    WHERE issue_type IS NOT NULL
      AND time >= NOW() - INTERVAL '24 hours'
    ORDER BY time DESC
    LIMIT 5
  `;

  // Cast bigints to numbers for JSON serialization.
  const sample_rows = samples.map((r) => ({
    ...r,
    strike: r.strike != null ? Number(r.strike) : null,
    spot: r.spot != null ? Number(r.spot) : null,
    premium: r.premium != null ? Number(r.premium) : null,
    ask_prem: r.ask_prem != null ? Number(r.ask_prem) : null,
    bid_prem: r.bid_prem != null ? Number(r.bid_prem) : null,
  }));

  return NextResponse.json({
    counts,
    field_fill: {
      populated_24h: Number(fieldFill[0]?.populated ?? 0),
      null_24h: Number(fieldFill[0]?.null_fields ?? 0),
    },
    sample_rows,
  });
}
