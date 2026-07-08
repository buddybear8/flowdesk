"use client";

// Native push-notification registration for the Capacitor mobile shell.
//
// The shell (mobile/) is a remote-URL WebView: it loads this Next.js
// deployment directly and injects the Capacitor bridge (window.Capacitor)
// into the page, so plugin access happens HERE, not in a local mobile
// bundle (mobile/www is only a redirect page and has no build step).
//
// Mounted inside app/(modules)/layout.tsx — i.e. only for authenticated
// users — this component runs once per app launch:
//   1. No-ops unless window.Capacitor reports a native platform.
//   2. Requests push permission from the OS.
//   3. Registers with FCM and POSTs { token, platform } to
//      /api/push/register (same-origin, session cookie included) so the
//      server can associate the device with the logged-in user. Repeating
//      this on every launch keeps the row's lastSeenAt fresh, which the
//      worker's retention sweep uses to drop stale devices.
//
// iOS note: @capacitor/push-notifications' 'registration' event yields the
// RAW APNs token on iOS, which the worker's FCM-only send path cannot use.
// On iOS we therefore exchange it for an FCM registration token via the
// @capacitor-community/fcm plugin; if that plugin is absent we skip
// registration entirely rather than pollute push_devices with undeliverable
// APNs tokens. See mobile/README.md → "Push notifications setup".

import { useEffect } from "react";

interface PermissionStatus {
  receive: "prompt" | "prompt-with-rationale" | "granted" | "denied";
}

interface PushNotificationsPlugin {
  checkPermissions(): Promise<PermissionStatus>;
  requestPermissions(): Promise<PermissionStatus>;
  register(): Promise<void>;
  addListener(event: "registration", cb: (token: { value: string }) => void): Promise<unknown>;
  addListener(event: "registrationError", cb: (err: { error: string }) => void): Promise<unknown>;
}

interface FcmPlugin {
  getToken(): Promise<{ token: string }>;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    PushNotifications?: PushNotificationsPlugin;
    FCM?: FcmPlugin;
  };
}

declare global {
  interface Window {
    Capacitor?: CapacitorBridge;
  }
}

async function registerToken(token: string, platform: string): Promise<void> {
  try {
    const res = await fetch("/api/push/register", {
      method: "POST",
      credentials: "same-origin", // session cookie identifies the user
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform }),
    });
    if (!res.ok) {
      console.error("[push] token registration failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[push] token registration request error:", err);
  }
}

async function initPushNotifications(): Promise<void> {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return; // plain browser — no-op

  const push = cap.Plugins?.PushNotifications;
  if (!push) {
    console.warn("[push] PushNotifications plugin not available in this shell");
    return;
  }
  const platform = cap.getPlatform?.() ?? "android";

  let permission = await push.checkPermissions();
  if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
    permission = await push.requestPermissions();
  }
  if (permission.receive !== "granted") {
    console.warn("[push] permission not granted:", permission.receive);
    return;
  }

  await push.addListener("registration", ({ value }) => {
    void (async () => {
      let token = value;
      if (platform === "ios") {
        // 'value' is the raw APNs token on iOS — exchange it for an FCM
        // registration token (worker sends via FCM only).
        const fcm = cap.Plugins?.FCM;
        if (!fcm) {
          console.warn("[push] iOS shell lacks the FCM plugin — skipping registration (APNs tokens are not deliverable via the FCM send path)");
          return;
        }
        try {
          token = (await fcm.getToken()).token;
        } catch (err) {
          console.error("[push] APNs→FCM token exchange failed:", err);
          return;
        }
      }
      await registerToken(token, platform);
    })();
  });

  await push.addListener("registrationError", (err) => {
    console.error("[push] native registration error:", err.error);
  });

  await push.register();
}

// Renders nothing; exists purely for the mount effect.
export function PushRegistration() {
  useEffect(() => {
    initPushNotifications().catch((err) => console.error("[push] init failed:", err));
  }, []);
  return null;
}
