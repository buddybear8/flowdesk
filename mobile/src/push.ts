/**
 * ⚠️ REFERENCE ONLY — NOT EXECUTED.
 *
 * This shell is a remote-URL WebView with no local web build step (www/ is
 * just a redirect page), so nothing here is ever bundled or loaded. The
 * LIVE push-registration flow ships inside the Next.js app itself:
 * components/native/PushRegistration.tsx (mounted in app/(modules)/layout.tsx)
 * detects the injected Capacitor bridge (window.Capacitor), requests
 * permission, registers with FCM, and POSTs { token, platform } to
 * /api/push/register with the session cookie.
 *
 * Note also that on iOS the 'registration' event below yields a RAW APNs
 * token — the server sends via FCM only, so an APNs→FCM token exchange
 * (@capacitor-community/fcm) is required; the live component handles that.
 *
 * Kept as a reference for a future locally-bundled shell entry point.
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

const API_BASE = 'https://flowdesk-puce.vercel.app';
const REGISTER_ENDPOINT = `${API_BASE}/api/push/register`;

export async function initPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // No-op in a plain browser context.
    return;
  }

  // Ask the OS for permission (prompts the user on first call).
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') {
    console.warn('[push] permission not granted:', permission.receive);
    return;
  }

  // Fired with the APNs (iOS) or FCM (Android) device token.
  await PushNotifications.addListener('registration', async ({ value: token }) => {
    try {
      const res = await fetch(REGISTER_ENDPOINT, {
        method: 'POST',
        credentials: 'include', // send session cookies so the server knows the user
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          platform: Capacitor.getPlatform(), // 'ios' | 'android'
        }),
      });
      if (!res.ok) {
        console.error('[push] token registration failed:', res.status, await res.text());
      }
    } catch (err) {
      console.error('[push] token registration request error:', err);
    }
  });

  await PushNotifications.addListener('registrationError', (err) => {
    console.error('[push] native registration error:', err.error);
  });

  // Optional: log notifications received while the app is in the foreground.
  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('[push] received in foreground:', notification.title ?? '', notification.id);
  });

  // Kick off native registration (triggers the 'registration' listener above).
  await PushNotifications.register();
}
