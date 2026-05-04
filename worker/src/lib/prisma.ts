// Shared PrismaClient singleton for the worker.
//
// Every job file imports `prisma` from here so we have ONE connection pool
// across the entire worker process (each `new PrismaClient()` spins up its
// own pool of ~10 connections — at 6+ jobs that's 60+ idle connections
// against Railway's Postgres connection limit).

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
