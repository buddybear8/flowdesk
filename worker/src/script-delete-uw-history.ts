// script-delete-uw-history.ts — one-shot destructive cleanup.
//
// Deletes all rows in dark_pool_prints whose uw_id does NOT start with
// "polygon:" — i.e., the historical UW real-time prints. Polygon corpus
// stays untouched.
//
// Run locally with:
//   cd worker
//   DATABASE_URL="$(railway variables --service Postgres --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-)" \
//     npx tsx src/script-delete-uw-history.ts

import { prisma, disconnectPrisma } from "./lib/prisma.js";

async function main() {
  const before: any = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM dark_pool_prints`;
  const uwBefore: any = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM dark_pool_prints WHERE uw_id IS NULL OR uw_id NOT LIKE 'polygon:%'`;
  const polyBefore: any = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM dark_pool_prints WHERE uw_id LIKE 'polygon:%'`;
  console.log(`Before: ${before[0].n} total, ${uwBefore[0].n} UW-sourced (to delete), ${polyBefore[0].n} polygon (preserved)`);

  const result = await prisma.$executeRaw`DELETE FROM dark_pool_prints WHERE uw_id IS NULL OR uw_id NOT LIKE 'polygon:%'`;
  console.log(`DELETE affected ${result} rows`);

  const after: any = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM dark_pool_prints`;
  const uwAfter: any = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM dark_pool_prints WHERE uw_id IS NULL OR uw_id NOT LIKE 'polygon:%'`;
  const polyAfter: any = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM dark_pool_prints WHERE uw_id LIKE 'polygon:%'`;
  console.log(`After:  ${after[0].n} total, ${uwAfter[0].n} non-polygon, ${polyAfter[0].n} polygon`);

  if (uwAfter[0].n !== 0) {
    console.error("ERROR: non-polygon rows remain after delete");
    process.exit(1);
  }
  if (polyAfter[0].n !== polyBefore[0].n) {
    console.error("ERROR: polygon rows changed — DELETE was too broad");
    process.exit(1);
  }
  console.log("OK");
  await disconnectPrisma();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
