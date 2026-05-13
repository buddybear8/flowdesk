// script-backfill-polygon.ts — one-shot backfill for the date gap between
// the historical pull's end (2026-05-04) and the new daily job's first run.
//
// Invokes the daily-flatfile job once per weekday in the range. Skips
// weekends automatically. Idempotent via uwId unique constraint.
//
// Run locally with:
//   cd worker
//   DATABASE_URL="$(railway variables --service Postgres --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-)" \
//     POLYGON_ACCESS_KEY=... POLYGON_SECRET_KEY=... \
//     npx tsx src/script-backfill-polygon.ts 2026-05-05 2026-05-12
//
// Args: <start-date YYYY-MM-DD> <end-date YYYY-MM-DD>
// End-date is inclusive.

import { importPolygonDailyFlatFile } from "./jobs/polygon-daily-flatfile.js";
import { disconnectPrisma } from "./lib/prisma.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error("usage: tsx src/script-backfill-polygon.ts <YYYY-MM-DD> <YYYY-MM-DD>");
    process.exit(1);
  }
  const start = parseDate(args[0]!);
  const end = parseDate(args[1]!);
  if (end < start) {
    console.error("end date is before start date");
    process.exit(1);
  }

  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  console.log(`Backfill: ${days.length} weekdays in [${args[0]}, ${args[1]}]`);

  for (const d of days) {
    const label = d.toISOString().slice(0, 10);
    console.log(`\n=== ${label} ===`);
    try {
      await importPolygonDailyFlatFile(d);
    } catch (err) {
      console.error(`[backfill] ${label} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  await disconnectPrisma();
  console.log("\nBackfill complete.");
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) {
    console.error(`bad date: ${s}`);
    process.exit(1);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
