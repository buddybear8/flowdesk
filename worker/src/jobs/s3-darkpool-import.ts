// jobs/s3-darkpool-import.ts — daily at 02:00 ET.
//
// Consumes the Polygon top-200-by-notional dark-pool corpus from S3 and
// loads it into dark_pool_prints. The corpus is the all-time largest 200
// FINRA TRF prints per ticker over 2023-01-01..2026-05-04 (see
// ~/polygon-pull-project/resume.md for how it was produced).
//
// S3 layout produced by polygon-pull-project/filter_top200.py:
//   s3://<bucket>/<prefix><TICKER>/top200.parquet
//   200 rows per ticker (or fewer if the ticker had <200 trades over the
//   coverage window). Columns: Polygon's trade fields plus `notional`
//   (price × size) and `rank` (1 = largest).
//
// Behavior:
//   • Lists every <TICKER>/top200.parquet under the prefix.
//   • Downloads, parses, maps each row to a DarkPoolPrint with
//     uwId = `polygon:${ticker}:${id}` so it never collides with a real
//     UW print id.
//   • Inserts via createMany({ skipDuplicates: true }) so the job is
//     idempotent — re-runs are near-no-ops.
//   • Deletes any UW-sourced print with executedAt <= POLYGON_COVERAGE_END
//     so Polygon's corpus is the canonical source for the historical
//     window (overlap with UW polls in the last days of the range gets
//     replaced by Polygon data). Idempotent: the predicate only matches
//     UW rows, so it's a no-op after the first run.
//
// Required env vars:
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION              e.g. "us-east-1"
//   DARKPOOL_S3_BUCKET      e.g. "polygon-dark-pool-stefan-760944857401-us-east-1-an"
//   DARKPOOL_S3_PREFIX      e.g. "polygon-dark-pool/" (trailing slash)
//
// All five must be set; otherwise this job logs and returns.

import { Prisma } from "@prisma/client";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import parquet from "@dsnp/parquetjs";
import { prisma } from "../lib/prisma.js";
import { rerankDarkPool } from "../lib/rerank-darkpool.js";

const ts = () => new Date().toISOString();

const REQUIRED_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "DARKPOOL_S3_BUCKET",
  "DARKPOOL_S3_PREFIX",
] as const;

// Last trading day covered by the Polygon pull (resume.md). 2026-05-04
// itself errored, but the top-200 corpus can contain prints up to and
// including that date for tickers where the pull caught it before failing.
// End-of-day UTC is the safe cutoff for the overlap delete.
const POLYGON_COVERAGE_END_UTC = new Date("2026-05-04T23:59:59.999Z");

export async function importDarkpoolHistory(): Promise<void> {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(
      `[s3-darkpool-import] ${ts()} not configured — missing env vars: ${missing.join(", ")}. Skipping.`
    );
    return;
  }

  const bucket = process.env.DARKPOOL_S3_BUCKET!;
  const prefix = process.env.DARKPOOL_S3_PREFIX!;
  const region = process.env.AWS_REGION!;

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  // 1. Enumerate <TICKER>/top200.parquet keys.
  const topKeys = await listTopKeys(s3, bucket, prefix);
  if (topKeys.length === 0) {
    console.warn(`[s3-darkpool-import] ${ts()} no top200.parquet keys found under s3://${bucket}/${prefix} — skipping.`);
    return;
  }
  console.log(`[s3-darkpool-import] ${ts()} found ${topKeys.length} ticker corpora`);

  // 2. Overlap cleanup. Polygon owns 2023..2026-05-04; UW prints in that
  //    window (from the few-day overlap when polling started before the
  //    pull finished) are dropped so re-rank operates on a clean per-
  //    ticker corpus. Idempotent — predicate only matches UW rows.
  const overlapCleared = await prisma.$executeRawUnsafe(
    `DELETE FROM dark_pool_prints WHERE executed_at <= $1 AND (uw_id IS NULL OR uw_id NOT LIKE 'polygon:%')`,
    POLYGON_COVERAGE_END_UTC,
  );
  if (overlapCleared > 0) {
    console.log(`[s3-darkpool-import] ${ts()} cleared ${overlapCleared} UW-sourced rows in Polygon coverage window`);
  }

  // 3. Process each ticker corpus. Only tickers that ACTUALLY received new
  //    rows are queued for re-rank — on a no-op re-run nothing gets queued
  //    and the rerank pass below is skipped entirely. Inter-ticker delay
  //    keeps Postgres WAL from spiking the way the initial unthrottled
  //    backfill did (which filled a 500 MB volume mid-recovery).
  const INTER_TICKER_DELAY_MS = 50;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrored = 0;
  const dirtyTickers: string[] = [];
  for (let i = 0; i < topKeys.length; i++) {
    if (i > 0) await sleep(INTER_TICKER_DELAY_MS);
    const key = topKeys[i]!;
    const ticker = extractTicker(key, prefix);
    try {
      const rows = await downloadAndParse(s3, bucket, key);
      if (rows.length === 0) {
        console.warn(`[s3-darkpool-import] ${ticker}: empty parquet, skipping`);
        continue;
      }
      const records = rows
        .map((r) => mapPolygonRow(ticker, r))
        .filter((r): r is Prisma.DarkPoolPrintCreateManyInput => r !== null);
      const inserted = await prisma.darkPoolPrint.createMany({
        data: records,
        skipDuplicates: true,
      });
      totalInserted += inserted.count;
      totalSkipped += records.length - inserted.count;
      if (inserted.count > 0) dirtyTickers.push(ticker);
    } catch (err) {
      totalErrored++;
      console.error(`[s3-darkpool-import] ${ticker}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `[s3-darkpool-import] ${ts()} loaded ${totalInserted} new, ${totalSkipped} dup, ${totalErrored} err of ${topKeys.length} tickers`
  );

  // 4. Re-rank only tickers that received new rows. On an idempotent re-run
  //    this is a no-op — no inserts means no rerank work.
  if (dirtyTickers.length === 0) {
    console.log(`[s3-darkpool-import] ${ts()} no new rows — re-rank skipped`);
    return;
  }
  let rerankedTickers = 0;
  let rerankedRowsTouched = 0;
  for (let i = 0; i < dirtyTickers.length; i++) {
    if (i > 0) await sleep(INTER_TICKER_DELAY_MS);
    const ticker = dirtyTickers[i]!;
    try {
      const n = await rerankDarkPool(ticker);
      rerankedTickers++;
      rerankedRowsTouched += n;
    } catch (err) {
      console.error(`[s3-darkpool-import] re-rank ${ticker} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(
    `[s3-darkpool-import] ${ts()} re-ranked ${rerankedTickers} tickers (${rerankedRowsTouched} rows updated)`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listTopKeys(s3: S3Client, bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith("/top200.parquet")) {
        keys.push(obj.Key);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

function extractTicker(key: string, prefix: string): string {
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return (rest.split("/")[0] ?? "").toUpperCase();
}

async function downloadAndParse(s3: S3Client, bucket: string, key: string): Promise<any[]> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) return [];
  // Files are ~21 KB; buffering is fine and simpler than streaming.
  const buf = await streamToBuffer(obj.Body as NodeJS.ReadableStream);
  const reader = await parquet.ParquetReader.openBuffer(buf);
  const cursor = reader.getCursor();
  const rows: any[] = [];
  let row: any;
  while ((row = await cursor.next())) rows.push(row);
  await reader.close();
  return rows;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

// True if a Date falls inside RTH (09:30–15:59 ET) on a weekday.
function isIntradayET(date: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;
  if (wd === "Sat" || wd === "Sun") return false;
  if (hour < 9 || hour >= 16) return false;
  if (hour === 9 && minute < 30) return false;
  return true;
}

function mapPolygonRow(ticker: string, raw: any): Prisma.DarkPoolPrintCreateManyInput | null {
  // sip_timestamp is INT64 nanoseconds since epoch — comes back as BigInt
  // from @dsnp/parquetjs. Convert to ms before constructing the Date.
  const sipNs = raw.sip_timestamp;
  if (sipNs == null) return null;
  const nanos = typeof sipNs === "bigint" ? sipNs : BigInt(sipNs);
  const executedAt = new Date(Number(nanos / 1_000_000n));
  if (Number.isNaN(executedAt.getTime())) return null;

  const price = Number(raw.price);
  const sizeRaw = raw.size;
  const size = typeof sizeRaw === "bigint" ? Number(sizeRaw) : Math.trunc(Number(sizeRaw));
  if (!Number.isFinite(price) || !Number.isFinite(size)) return null;

  const notional = raw.notional != null ? Number(raw.notional) : price * size;
  const rankRaw = raw.rank;
  const rank =
    rankRaw != null
      ? typeof rankRaw === "bigint"
        ? Number(rankRaw)
        : Math.trunc(Number(rankRaw))
      : null;

  const tradeId = String(raw.id ?? "");
  if (!tradeId) return null;

  return {
    uwId: `polygon:${ticker}:${tradeId}`,
    executedAt,
    ticker,
    price: new Prisma.Decimal(price),
    size,
    premium: new Prisma.Decimal(notional),
    volume: null,
    exchangeId: raw.exchange != null ? Math.trunc(Number(raw.exchange)) : null,
    trfId: raw.trf_id != null ? Math.trunc(Number(raw.trf_id)) : null,
    isEtf: false, // separate ticker_metadata enrichment pass owns this
    isExtended: !isIntradayET(executedAt),
    isIntraday: isIntradayET(executedAt),
    rank,
    // percentile: top trade (rank=1) = 100.0, rank=200 = 0.5
    percentile: rank != null ? new Prisma.Decimal((201 - rank) / 2) : null,
  };
}
