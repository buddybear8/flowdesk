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
  },
};

export default config;
