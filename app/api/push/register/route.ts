// /api/push/register — register a device token for push notifications.
//
// POST { token, platform } → upserts a PushDevice row keyed by token.
// Re-registering an existing token bumps lastSeenAt (@updatedAt) so stale
// devices can be distinguished from active ones. The worker fans pushes
// out to every registered token (worker/src/lib/push.ts) and prunes rows
// FCM reports as dead; a nightly retention sweep also drops rows whose
// lastSeenAt is stale (the native shell re-registers on every launch).
//
// Auth: proxy.ts already 401s unauthenticated /api/* requests, so only
// signed-in (Whop-verified) users reach this handler. We additionally read
// the session here to stamp userId on the row (entitlement tracking) and
// cap how many device rows any single user can accumulate.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// Real FCM registration tokens are ~150-300 chars. 1024 is a generous
// ceiling that still rejects garbage and stays far below Postgres's
// btree unique-index row limit (~2704 bytes) on push_devices.token.
const MAX_TOKEN_LENGTH = 1024;
const ALLOWED_PLATFORMS = ["ios", "android", "web"] as const;

// Hard cap on device rows per user — prevents one account from inserting
// unbounded junk rows. Oldest-seen rows are evicted to make room.
const MAX_DEVICES_PER_USER = 10;

interface RegisterBody {
  token?: unknown;
  platform?: unknown;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    // Defense in depth — proxy.ts should have 401'd already.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id ?? null;

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return NextResponse.json(
      { error: `token must be a non-empty string of at most ${MAX_TOKEN_LENGTH} characters` },
      { status: 400 }
    );
  }

  const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
  if (!ALLOWED_PLATFORMS.includes(platform as (typeof ALLOWED_PLATFORMS)[number])) {
    return NextResponse.json(
      { error: `platform must be one of: ${ALLOWED_PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    // Per-user row cap: if this is a NEW token and the user is at the cap,
    // evict their oldest-seen device rows to make room.
    if (userId) {
      const existing = await prisma.pushDevice.findUnique({ where: { token }, select: { id: true } });
      if (!existing) {
        const owned = await prisma.pushDevice.findMany({
          where: { userId },
          orderBy: { lastSeenAt: "asc" },
          select: { id: true },
        });
        if (owned.length >= MAX_DEVICES_PER_USER) {
          const evict = owned.slice(0, owned.length - MAX_DEVICES_PER_USER + 1).map((d) => d.id);
          await prisma.pushDevice.deleteMany({ where: { id: { in: evict } } });
        }
      }
    }

    // lastSeenAt is @updatedAt, so the update branch bumps it automatically.
    const device = await prisma.pushDevice.upsert({
      where: { token },
      create: { token, platform, userId },
      update: { platform, userId },
      select: { platform: true, createdAt: true, lastSeenAt: true },
    });

    return NextResponse.json({ ok: true, platform: device.platform });
  } catch (err) {
    console.error("[push/register] upsert failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to register device" }, { status: 500 });
  }
}
