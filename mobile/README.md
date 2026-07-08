# Champagne Intelligence — Native Mobile Shell

Capacitor-based native shell for iOS and Android. The app is a **remote-URL shell**:
the WebView loads the production deployment at `https://flowdesk-puce.vercel.app`
directly (see `server.url` in `capacitor.config.ts`). The local `www/` directory only
contains a redirect fallback page. There is no web build step — deploying the Next.js
app updates the mobile app content instantly.

- **App ID:** `com.champagnesessions.intelligence`
- **App name:** Champagne Intelligence
- **Push token registration:** lives in the *web app*, not this shell —
  `components/native/PushRegistration.tsx` (mounted in the authenticated layout)
  detects the injected Capacitor bridge and POSTs `{ token, platform }` to
  `/api/push/register` with the session cookie. `src/push.ts` here is
  reference-only and never executed (remote-URL shell, no local bundle).

## Prerequisites

- Node 20+
- **iOS:** macOS with Xcode 16+, CocoaPods (`brew install cocoapods`), an Apple
  Developer Program membership ($99/yr)
- **Android:** Android Studio (Ladybug or newer), JDK 17+, a Google Play Console
  account ($25 one-time)

## Setup

```bash
cd mobile
npm install

# Android platform is already scaffolded in ./android
# iOS platform must be added once CocoaPods is installed:
npx cap add ios

# After any config or plugin change:
npx cap sync
```

> **Note:** `npx cap add ios` was NOT run in this scaffold because CocoaPods is not
> installed on the machine that generated it. Install CocoaPods, then run it — the
> `ios/` directory will be generated from `capacitor.config.ts` automatically.
> `npx cap add android` succeeded; `./android` is checked in.

## Build & run

### iOS

```bash
npx cap sync ios
npx cap open ios     # opens Xcode
```

In Xcode:
1. Select the `App` target → *Signing & Capabilities* → set your Team, keep the
   bundle ID `com.champagnesessions.intelligence`.
2. Add the **Push Notifications** capability and the **Background Modes →
   Remote notifications** capability.
3. Run on a real device (push notifications do not work in the simulator).

### Android

```bash
npx cap sync android
npx cap open android   # opens Android Studio
```

In Android Studio: let Gradle sync, then Run on a device/emulator with Google Play
services.

## Push notifications setup

Because this is a remote-URL shell, the registration code runs inside the
deployed Next.js app: `components/native/PushRegistration.tsx` (mounted in
`app/(modules)/layout.tsx`, i.e. only for signed-in users) detects
`window.Capacitor`, requests permission, registers, and POSTs the device token
to `/api/push/register` as JSON `{ token, platform }` (same-origin, session
cookie included) on every app launch — the launch-time re-register keeps the
row's `lastSeenAt` fresh so the worker's staleness sweep can prune dead devices.

The worker sends **exclusively via FCM** (`worker/src/lib/push.ts`,
`sendEachForMulticast`), so every registered token must be an FCM registration
token — on both platforms.

### iOS (FCM via APNs — required, raw APNs tokens will NOT work)

On iOS, `@capacitor/push-notifications` returns the **raw APNs device token**,
which the FCM-only send path cannot deliver to. The iOS shell must therefore
integrate Firebase Messaging so the token can be exchanged:

1. Create/extend the Firebase project → add an **iOS app** with bundle ID
   `com.champagnesessions.intelligence`; download `GoogleService-Info.plist`
   into the Xcode project.
2. In the [Apple Developer portal](https://developer.apple.com/account) → *Keys*,
   create an **APNs Auth Key** (.p8) and upload it to Firebase → Project
   settings → Cloud Messaging (this lets FCM deliver to iOS via APNs).
3. Add the `@capacitor-community/fcm` plugin (and Firebase iOS SDK via its pod)
   to the shell. `PushRegistration.tsx` calls `FCM.getToken()` on iOS to
   exchange the APNs token for an FCM registration token; if the plugin is
   missing it deliberately skips registration rather than upload an
   undeliverable APNs token.
4. Ensure the Push Notifications capability is enabled on the App ID
   (`com.champagnesessions.intelligence`) in *Identifiers* and in Xcode
   (*Signing & Capabilities*).

### FCM (Android)

1. Create a Firebase project → add an Android app with package
   `com.champagnesessions.intelligence`.
2. Download `google-services.json` into `android/app/`.
3. In `android/build.gradle` / `android/app/build.gradle`, ensure the
   `com.google.gms.google-services` plugin is applied (Capacitor docs:
   https://capacitorjs.com/docs/apis/push-notifications#android).
4. Server-side sending: use a Firebase Admin SDK service-account JSON (worker env
   var) and the FCM HTTP v1 API.

## Icons & splash screens

Web-app (PWA) icon assets already exist in the repo's `public/`:

- `icon-192.png` / `icon-512.png` — manifest icons, `purpose: "any"` (full-bleed).
- `icon-192-maskable.png` / `icon-512-maskable.png` — manifest icons,
  `purpose: "maskable"`: artwork inset to the central 80% safe zone on the
  `#0B1220` brand background, fully opaque (regenerate the same way if the
  artwork changes: resize source to 80%, composite centered on `#0B1220`).
- `apple-touch-icon.png` — 180x180 full-bleed (NOT maskable-padded), alpha
  flattened onto `#0B1220`; referenced from `app/layout.tsx` metadata.

Native (store) assets are generated with
[`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets):

```bash
cd mobile

# Splash fade-out is configured in capacitor.config.ts (SplashScreen block);
# the plugin must be installed for it to take effect:
npm install @capacitor/splash-screen

# Masters — create an assets/ folder containing:
#   assets/icon.png    1024x1024, NO alpha (iOS requirement), artwork inset
#                      ~80% on #0B1220 (same safe-zone rule as the maskable
#                      PWA icons; Android adaptive icons crop harder)
#   assets/splash.png       2732x2732, centered logo on #0B1220
#   assets/splash-dark.png  same file (app is dark-only)

npx @capacitor/assets generate \
  --iconBackgroundColor '#0B1220' --iconBackgroundColorDark '#0B1220' \
  --splashBackgroundColor '#0B1220' --splashBackgroundColorDark '#0B1220'

npx cap sync
```

This writes the full icon set (including Android adaptive foreground/background
layers) and all splash densities into `android/` — and `ios/` once
`npx cap add ios` has been run. Colors match `capacitor.config.ts`
(`backgroundColor` + `SplashScreen.backgroundColor` = `#0B1220`) so
splash → WebView → page paint is one seamless dark surface.

## Safe-area insets (iOS notch / home indicator)

The web app ships mobile-only utility classes (appended at the end of
`app/globals.css`) that consume `env(safe-area-inset-*)`; they activate under
`viewport-fit=cover` (set via the `viewport` export in `app/layout.tsx`) plus
`black-translucent` status bar, and are no-ops on desktop and non-notch
devices:

- `cs-safe-area-topbar` — pads the top bar below the status bar and grows its
  `h-11` (44px) height by the inset. **Apply to** the root `<header>` row in
  `components/layout/Topbar.tsx` (and mirror the height on the `h-11` Suspense
  fallback in `app/(modules)/layout.tsx` to avoid layout shift).
- `cs-safe-area-drawer` — pads the drawer panel clear of the status bar, home
  indicator, and left landscape inset. **Apply to** the panel `<div>`
  (`absolute left-0 top-0 … w-[240px]`) in
  `components/layout/MobileNavDrawer.tsx`.

The classes are defined but **not yet applied** — `Topbar.tsx`,
`MobileNavDrawer.tsx`, and `app/(modules)/layout.tsx` are owned by the
responsive-UI workstream; apply them there (one `className` addition each).

## Store submission

### iOS (App Store)

1. In App Store Connect, create the app record with bundle ID
   `com.champagnesessions.intelligence`.
2. Xcode → *Product → Archive* → *Distribute App* → App Store Connect.
3. Fill in privacy nutrition labels (account data, analytics), age rating, and
   screenshots (6.7" and 6.5" iPhone required).
4. Submit for review with the **reviewer demo account** (see below).

### Android (Play Store)

1. Android Studio → *Build → Generate Signed App Bundle* (create/upload a keystore;
   back it up).
2. Upload the `.aab` in Play Console → set up the store listing, content rating
   questionnaire, and data-safety form.
3. Roll out to internal testing first, then production.

## App Store guideline mitigations

- **Guideline 4.2 (Minimum Functionality):** Apple rejects apps that are "just a
  website in a wrapper." Mitigations built into this shell: native **push
  notifications** (APNs registration + server-driven trading alerts) and native
  status-bar/app lifecycle integration via `@capacitor/app` and
  `@capacitor/status-bar`. Emphasize the push-driven alerting experience in the
  review notes. Consider adding further native touches (haptics, biometric app
  lock) if 4.2 pushback occurs.
- **Guideline 3.1 (In-App Purchase):** Never mention subscription pricing,
  payment links, or "purchase on our website" anywhere reachable in-app. The web
  app must not render pricing/upgrade CTAs when loaded inside the native shell
  (detect via Capacitor user agent or `Capacitor.isNativePlatform()` bridge).
  Accounts must appear fully provisioned; treat the app as a companion for
  existing customers (reader-app style).
- **Reviewer demo account:** Provide a fully-featured demo login (email +
  password) in the App Review notes with seeded trading data so the reviewer never
  hits an empty state or a signup/pay wall. Keep this account active for every
  review cycle, including updates.

## Store checklist status

- [x] PWA maskable icons (`public/icon-192-maskable.png`, `public/icon-512-maskable.png`)
      wired into `app/manifest.ts` with `purpose: "maskable"`.
- [x] `apple-touch-icon.png` (180x180) + iOS web-app metadata
      (`appleWebApp` capable / `black-translucent` / title "Champagne") and
      `themeColor #0B1220` + `viewport-fit=cover` in `app/layout.tsx`.
- [x] Splash + StatusBar config in `capacitor.config.ts`
      (`#0B1220` background, StatusBar `style: 'DARK'`, WebView
      `backgroundColor` matched).
- [x] Safe-area utility classes defined in `app/globals.css`
      (`cs-safe-area-topbar`, `cs-safe-area-drawer`).
- [ ] Apply the safe-area classes in `Topbar.tsx` / `MobileNavDrawer.tsx`
      (responsive-UI workstream — see "Safe-area insets" above).
- [ ] Install `@capacitor/splash-screen`; create `assets/icon.png` (1024x1024,
      no alpha) + `assets/splash.png` (2732x2732) masters and run
      `npx @capacitor/assets generate` (see "Icons & splash screens" above).
- [ ] Run `npx cap add ios` after installing CocoaPods.
- [ ] Add `google-services.json` (Android) and APNs key/capability (iOS).
- [ ] iOS: integrate Firebase Messaging + `@capacitor-community/fcm` for the
      APNs→FCM token exchange (see "Push notifications setup" above).
- [x] Implement `/api/push/register` persistence + a worker job that sends pushes.
- [ ] Hide pricing/upgrade UI in the web app when running inside the native shell.
- [ ] App Store Connect record, privacy labels, screenshots, reviewer demo
      account (see "Store submission" / "App Store guideline mitigations").
- [ ] Play Console listing, signed `.aab`, content rating, data-safety form.
