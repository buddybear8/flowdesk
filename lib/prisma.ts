// Next.js Prisma singleton.
//
// Prevents the dev server from spinning up a new PrismaClient on every hot
// reload (each new client opens its own ~10-connection pool — left
// unchecked, that exhausts Postgres's connection limit within a few edits).
// In production this is a no-op; the module is imported once per worker.
//
// Pattern is the standard Next.js + Prisma recommendation.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
