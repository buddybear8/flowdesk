// jobs/s3-darkpool-import.ts — daily at 02:00 ET.
//
// Consumes Polygon-sourced dark-pool history files from an S3 bucket and
// writes them into the dark_pool_prints table. The Polygon extraction
// pipeline that lands files in S3 is out-of-scope for this codebase
// (PRD §3.5 / ARCHITECTURE §2.1) — this job is the consumer side only.
//
// ─── Status: STUB (Phase 2 step 4d) ──────────────────────────────────────────
// The cron is scheduled and the env-var contract is documented, but the
// parsing implementation is parked until the Polygon extraction is
// producing files we can validate against. To complete:
//
//   1. Add deps: `@aws-sdk/client-s3` (list + get) and a parser matching
//      whatever format the extraction emits — `csv-parse` for streaming
//      CSV, or `parquetjs-lite` for Parquet.
//   2. List objects under DARKPOOL_S3_PREFIX. To avoid re-importing the
//      full corpus every night, either:
//        a. Filter by `LastModified > now() - 36h` (catches a 24h window
//           plus a 12h slack for missed nights), OR
//        b. Track a `last_imported_at` marker (new column on a small
//           `import_state` table — requires schema migration).
//   3. For each new file, stream-parse and filter to dark-pool prints:
//      `exchange_id = 4 AND trf_id IS NOT NULL` (the convention from
//      Polygon's trades schema; PRD §3.5).
//   4. Map to DarkPoolPrint rows. The retention sweep already handles the
//      perpetual top-100 / 30-day rolling rule uniformly across live and
//      backfilled rows. Use `prisma.darkPoolPrint.createMany({
//      skipDuplicates: true })` against `uw_id` so partial-file retries
//      don't duplicate.
//   5. Log per-file row counts and an aggregate run summary.
//
// Required env vars (also documented in ARCHITECTURE §6 phase C4):
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION              e.g. "us-east-1"
//   DARKPOOL_S3_BUCKET      e.g. "flowdesk-dp-history"
//   DARKPOOL_S3_PREFIX      e.g. "polygon/dp/" (trailing slash)
//
// All five must be set; otherwise this job logs and returns. No partial-
// configuration path — half-set creds usually mean a misconfiguration.

const ts = () => new Date().toISOString();

const REQUIRED_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "DARKPOOL_S3_BUCKET",
  "DARKPOOL_S3_PREFIX",
] as const;

export async function importDarkpoolHistory(): Promise<void> {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(
      `[s3-darkpool-import] ${ts()} not configured — missing env vars: ${missing.join(", ")}. ` +
        `Skipping. (Polygon extraction pipeline is out-of-scope per PRD §3.5; this job runs as a no-op until upstream is producing files.)`
    );
    return;
  }

  // All env vars set — but the parsing implementation is still pending.
  // Log explicitly so it's obvious in production what state we're in
  // (rather than silently skipping while the user thinks data is flowing).
  console.warn(
    `[s3-darkpool-import] ${ts()} env configured (bucket=${process.env.DARKPOOL_S3_BUCKET}, ` +
      `prefix=${process.env.DARKPOOL_S3_PREFIX}) but parsing implementation is pending — ` +
      `see worker/src/jobs/s3-darkpool-import.ts header for the completion checklist.`
  );
}
