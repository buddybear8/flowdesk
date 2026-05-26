// Next.js Prisma singleton.
//
// Pool capped at 3 per Vercel function instance — Railway Postgres has
// max_connections=100 shared across the worker + many Vercel instances +
// ad-hoc tooling. Each Vercel instance opens its own pool, so an uncapped
// default (~10/instance) saturates fast under any concurrency. 3 is plenty
// for our short read-only route queries (findFirst, findMany, aggregate).
//
// The global singleton dance keeps the dev server from churning clients
// across hot reloads.

import { PrismaClient } from "@prisma/client";

function withConnectionLimit(url: string | undefined, limit: number): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url;
  return url.includes("?") ? `${url}&connection_limit=${limit}` : `${url}?connection_limit=${limit}`;
}

const limitedUrl = withConnectionLimit(process.env.DATABASE_URL, 3);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  (limitedUrl
    ? new PrismaClient({ datasourceUrl: limitedUrl, log: ["error", "warn"] })
    : new PrismaClient({ log: ["error", "warn"] }));

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
