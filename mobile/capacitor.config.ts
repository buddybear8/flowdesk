import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Champagne Intelligence — remote-URL shell configuration.
 *
 * The native app is a thin Capacitor shell that loads the production
 * Next.js deployment directly. The local `www/` directory only contains
 * a fallback redirect page (used if the remote server config is ever
 * removed); at runtime WebView content is served from `server.url`.
 */
const config: CapacitorConfig = {
  appId: 'com.champagnesessions.intelligence',
  appName: 'Champagne Intelligence',
  webDir: 'www',
  // WebView background while the remote page loads — matches the splash and
  // the app theme so there is no white flash between splash and content.
  backgroundColor: '#0B1220',
  server: {
    url: 'https://flowdesk-puce.vercel.app',
    cleartext: false,
  },
  ios: {
    contentInset: 'always',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // Dark brand splash (#0B1220). Assets are generated with
    // `npx @capacitor/assets generate` — see README "Icons & splash screens".
    // Requires `@capacitor/splash-screen` to be installed (README); this
    // block is inert until then.
    SplashScreen: {
      backgroundColor: '#0B1220',
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: false,
    },
    // Status bar on the dark theme: Style.Dark = dark background with light
    // (white) status-bar content. backgroundColor/overlaysWebView are
    // Android-only; iOS pairs with the web app's black-translucent +
    // safe-area CSS (app/globals.css safe-area utilities).
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B1220',
      overlaysWebView: false,
    },
  },
};

export default config;
