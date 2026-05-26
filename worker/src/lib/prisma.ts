// Shared PrismaClient singleton for the worker.
//
// Every job file imports `prisma` from here so we have ONE connection pool
// across the entire worker process — and that pool is explicitly capped at
// 5 connections. Railway Postgres has max_connections=100, shared across
// the worker + Vercel functions + ad-hoc tooling; without explicit caps,
// Prisma's default pool (~cpus*2+1, often 10+) saturates the server. 5 is
// plenty for the worker's job mix (sequential cron jobs, small fan-out).

import { PrismaClient } from "@prisma/client";

function withConnectionLimit(url: string | undefined, limit: number): string | undefined {
  if (!url) return url;
  if (/[?&]connection_limit=/.test(url)) return url; // already set
  return url.includes("?") ? `${url}&connection_limit=${limit}` : `${url}?connection_limit=${limit}`;
}

const limitedUrl = withConnectionLimit(process.env.DATABASE_URL, 5);

export const prisma = limitedUrl
  ? new PrismaClient({ datasourceUrl: limitedUrl })
  : new PrismaClient();

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
