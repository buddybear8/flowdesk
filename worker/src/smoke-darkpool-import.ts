// One-shot smoke for the Polygon S3 dark-pool backfill. Mirrors smoke-gex.ts
// in shape — invokes the job once, then disconnects Prisma.
//
// Run with:
//   cd worker
//   PUBLIC_DB=$(railway variables --service Postgres --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-)
//   AWS_REGION=us-east-1 \
//     AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
//     DARKPOOL_S3_BUCKET=polygon-dark-pool-stefan-760944857401-us-east-1-an \
//     DARKPOOL_S3_PREFIX=polygon-dark-pool/ \
//     DATABASE_URL="$PUBLIC_DB" \
//     npx tsx src/smoke-darkpool-import.ts

import { importDarkpoolHistory } from "./jobs/s3-darkpool-import.js";
import { disconnectPrisma } from "./lib/prisma.js";

async function main() {
  console.log("──────── s3-darkpool-import ────────");
  await importDarkpoolHistory();
  console.log("──────── done ────────");
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("smoke-darkpool-import failed:", err);
  process.exit(1);
});
