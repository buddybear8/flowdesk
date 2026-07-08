// lib/push.ts — fan-out push notifications to every registered device.
//
// Devices register their FCM tokens via POST /api/push/register (rows in
// push_devices). The send path is FCM-only, so every stored token MUST be an
// FCM registration token: Android yields one natively; iOS clients must
// exchange the raw APNs device token for an FCM token before registering
// (components/native/PushRegistration.tsx does this via the
// @capacitor-community/fcm plugin and skips registration when it can't —
// raw APNs tokens are undeliverable here and would just get pruned).
//
// Configuration: FCM_SERVICE_ACCOUNT_JSON env var containing the Firebase
// service-account key, either as raw JSON or base64-encoded JSON. When the
// var is unset, every send is a logged no-op returning 0 — jobs calling
// this must never break because push isn't configured (local dev, staging).
//
// Token hygiene: FCM reports permanently-dead tokens with
// 'messaging/registration-token-not-registered' (app uninstalled, token
// rotated) and malformed/non-FCM tokens with 'messaging/invalid-argument'
// or the legacy 'messaging/invalid-registration-token'. All of those rows
// are deleted after each send so the table converges on live devices
// (a nightly retention sweep also drops rows with stale lastSeenAt).

import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { prisma } from "./prisma.js";

// FCM caps multicast sends at 500 tokens per request.
const FCM_BATCH_SIZE = 500;

// null = initialization attempted and unavailable (env unset / bad JSON);
// undefined = not attempted yet. Initialize once per process.
let messaging: Messaging | null | undefined;

function parseServiceAccount(raw: string): object | null {
  const tryParse = (s: string): object | null => {
    try {
      const parsed = JSON.parse(s) as unknown;
      return parsed !== null && typeof parsed === "object" ? (parsed as object) : null;
    } catch {
      return null;
    }
  };
  // Raw JSON first (starts with "{" after trimming), then base64.
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return tryParse(trimmed);
  try {
    return tryParse(Buffer.from(trimmed, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function getMessagingClient(): Messaging | null {
  if (messaging !== undefined) return messaging;

  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.log("[push] FCM_SERVICE_ACCOUNT_JSON not set — push disabled");
    messaging = null;
    return messaging;
  }

  const serviceAccount = parseServiceAccount(raw);
  if (!serviceAccount) {
    console.error("[push] FCM_SERVICE_ACCOUNT_JSON is neither valid JSON nor base64-encoded JSON — push disabled");
    messaging = null;
    return messaging;
  }

  try {
    const app: App = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount as Parameters<typeof cert>[0]) });
    messaging = getMessaging(app);
  } catch (err) {
    console.error("[push] firebase-admin init failed:", err instanceof Error ? err.message : err);
    messaging = null;
  }
  return messaging;
}

/**
 * Send a notification to every registered device. Returns the number of
 * devices FCM accepted the message for (0 when push is unconfigured, no
 * devices are registered, or every send failed).
 */
export async function sendPushToAll(
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<number> {
  const client = getMessagingClient();
  if (!client) {
    console.log(`[push] skipped (not configured): "${title}"`);
    return 0;
  }

  const devices = await prisma.pushDevice.findMany({ select: { token: true } });
  if (devices.length === 0) return 0;
  const tokens = devices.map((d) => d.token);

  let sent = 0;
  const deadTokens: string[] = [];

  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    const chunk = tokens.slice(i, i + FCM_BATCH_SIZE);
    try {
      const res = await client.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        ...(data ? { data } : {}),
      });
      sent += res.successCount;
      res.responses.forEach((r, idx) => {
        // Prune permanently-dead tokens AND malformed ones. In a multicast
        // send the payload is identical across the batch, so a per-token
        // 'invalid-argument' means the token itself is malformed (e.g. a raw
        // APNs token or garbage) — it will fail on every future send too.
        const code = r.error?.code;
        if (
          !r.success &&
          (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            code === "messaging/invalid-argument")
        ) {
          deadTokens.push(chunk[idx]);
        }
      });
    } catch (err) {
      console.error("[push] batch send failed:", err instanceof Error ? err.message : err);
    }
  }

  // Prune tokens FCM says are permanently gone (uninstall / rotation).
  if (deadTokens.length > 0) {
    try {
      await prisma.pushDevice.deleteMany({ where: { token: { in: deadTokens } } });
      console.log(`[push] pruned ${deadTokens.length} dead token(s)`);
    } catch (err) {
      console.error("[push] token prune failed:", err instanceof Error ? err.message : err);
    }
  }

  console.log(`[push] "${title}" → ${sent}/${tokens.length} devices`);
  return sent;
}
