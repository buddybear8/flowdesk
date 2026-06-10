// One-shot S3 archive backfill over an inclusive UTC date range. Idempotent —
// days already in S3 are skipped — so it can be re-run safely.
//
//   railway run -- npx tsx src/script-backfill-archive.ts 2026-04-01 2026-06-07
//   (no args: last 70 days, covering the longest retention window)

import { archiveTableDay, TABLES, disconnectPrisma } from "./jobs/archive.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const today = dayStr(new Date());
  const start = process.argv[2] ?? dayStr(new Date(Date.now() - 70 * DAY_MS));
  const end = process.argv[3] ?? dayStr(new Date(Date.now() - DAY_MS));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    console.error("usage: script-backfill-archive.ts [YYYY-MM-DD start] [YYYY-MM-DD end]");
    process.exit(1);
  }

  console.log(`archiving ${start} .. ${end} (complete UTC days only)`);
  let files = 0;
  let rows = 0;
  let skipped = 0;
  for (let t = new Date(`${start}T00:00:00Z`).getTime(); ; t += DAY_MS) {
    const day = dayStr(new Date(t));
    if (day > end) break;
    if (day >= today) break;
    for (const spec of TABLES) {
      const n = await archiveTableDay(spec, day);
      if (n === -1) skipped++;
      else if (n > 0) {
        files++;
        rows += n;
        console.log(`  ${spec.name}/${day} → ${n} rows`);
      }
    }
  }
  console.log(`\ndone — ${files} files written (${rows.toLocaleString()} rows), ${skipped} already archived`);
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("backfill-archive failed:", err);
  process.exit(1);
});
