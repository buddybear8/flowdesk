// jobs/archive.ts — nightly S3 archive of retention-swept tables.
//
// WHY: the retention sweeps (jobs/retention.ts, 03:00 ET) permanently delete
// rows that the ta_pipeline ML workstream needs as training data — flow_alerts
// at 60d, flow_sentiment_days / gex_heatmap_snapshots at 30d. This job copies
// each UTC day's rows to S3 *long* before they age out, so the training corpus
// grows instead of rolling. gex_snapshots and dark_pool_prints are archived
// too (no sweep yet / unranked-30d respectively).
//
// Layout:  s3://$DARKPOOL_S3_BUCKET/archive/<table>/<YYYY-MM-DD>.jsonl.gz
//   • one gzipped JSONL file per table per UTC day (BigInt → string,
//     Decimal/Date via their toJSON — pandas reads this directly)
//   • idempotent: a day is skipped if its key already exists, so re-runs and
//     the daily job + backfill script never duplicate
//   • only COMPLETE days (strictly before today UTC) are archived
//
// Cadence: daily 02:00 ET (worker/src/index.ts) with a 10-day lookback, so a
// few failed nights self-heal. Full-history backfill: script-backfill-archive.ts.

import { gzipSync } from "node:zlib";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../lib/prisma.js";

export { disconnectPrisma } from "../lib/prisma.js";

const ts = () => new Date().toISOString();
const PAGE = 5_000;
const LOOKBACK_DAYS = 10;

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  return _s3;
}
const bucket = () => process.env.DARKPOOL_S3_BUCKET ?? "";

// One archivable table: how to page through a UTC day's rows.
interface TableSpec {
  name: string;
  fetchDay: (dayStart: Date, dayEnd: Date, cursor: bigint | null) => Promise<{ id: bigint | string }[]>;
}

// Each fetch pages by ascending id with a cursor so big days stay bounded.
const TABLES: TableSpec[] = [
  {
    name: "flow_alerts",
    // String PK — page by capturedAt window with id tiebreak via skip-free
    // cursor on (capturedAt,id) is overkill here; volumes are a few K/day, so
    // a single windowed fetch with a generous cap is fine.
    fetchDay: async (a, b, cursor) =>
      prisma.flowAlert.findMany({
        where: { capturedAt: { gte: a, lt: b }, ...(cursor ? { id: { gt: String(cursor) } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE,
      }) as unknown as Promise<{ id: string }[]>,
  },
  {
    name: "flow_sentiment_days",
    fetchDay: async (a, b, cursor) =>
      prisma.flowSentimentDay.findMany({
        where: { tradingDate: { gte: a, lt: b }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE,
      }),
  },
  {
    name: "gex_snapshots",
    fetchDay: async (a, b, cursor) =>
      prisma.gexSnapshot.findMany({
        where: { capturedAt: { gte: a, lt: b }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE,
      }),
  },
  {
    name: "gex_heatmap_snapshots",
    fetchDay: async (a, b, cursor) =>
      prisma.gexHeatmapSnapshot.findMany({
        where: { capturedAt: { gte: a, lt: b }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE,
      }),
  },
  {
    name: "dark_pool_prints",
    fetchDay: async (a, b, cursor) =>
      prisma.darkPoolPrint.findMany({
        where: { executedAt: { gte: a, lt: b }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE,
      }),
  },
];

const jsonReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function keyExists(Key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key }));
    return true;
  } catch {
    return false;
  }
}

// Archive one (table, UTC day). Returns rows written, or -1 if skipped.
export async function archiveTableDay(spec: TableSpec, day: string): Promise<number> {
  const Key = `archive/${spec.name}/${day}.jsonl.gz`;
  if (await keyExists(Key)) return -1;

  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const lines: string[] = [];
  let cursor: bigint | string | null = null;
  for (;;) {
    const rows = await spec.fetchDay(dayStart, dayEnd, cursor as bigint | null);
    for (const r of rows) lines.push(JSON.stringify(r, jsonReplacer));
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1]!.id;
  }
  if (lines.length === 0) return 0;

  const Body = gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8"));
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key, Body, ContentType: "application/gzip" }));
  return lines.length;
}

// Daily entry point — sweep the last LOOKBACK_DAYS complete UTC days.
export async function runArchiveSweep(lookbackDays: number = LOOKBACK_DAYS): Promise<void> {
  if (!bucket()) {
    console.error("[archive] DARKPOOL_S3_BUCKET not set — skipping");
    return;
  }
  const today = utcDayString(new Date());
  let wrote = 0;
  let skipped = 0;
  for (let back = 1; back <= lookbackDays; back++) {
    const day = utcDayString(new Date(Date.now() - back * 24 * 60 * 60 * 1000));
    if (day >= today) continue;
    for (const spec of TABLES) {
      try {
        const n = await archiveTableDay(spec, day);
        if (n === -1) skipped++;
        else if (n > 0) {
          wrote++;
          console.log(`[archive] ${ts()} ${spec.name}/${day} → ${n} rows`);
        }
      } catch (err) {
        console.error(`[archive] ${spec.name}/${day} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  console.log(`[archive] ${ts()} sweep done — ${wrote} files written, ${skipped} already archived`);
}

export { TABLES };
