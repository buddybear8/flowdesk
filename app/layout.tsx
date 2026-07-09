import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Champagne Sessions",
  description: "Trading intelligence dashboard",
  // iOS home-screen web-app (PWA) chrome. black-translucent lets the app
  // paint under the status bar; pair with viewportFit "cover" below and the
  // env(safe-area-inset-*) utilities in globals.css.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Champagne",
  },
  icons: {
    // Full-bleed 180x180, alpha flattened onto #0B1220 (iOS ignores alpha).
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B1220",
  // Extend the layout viewport into the iPhone notch/home-indicator areas;
  // safe-area padding is opted into per-element via env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* max-md:overflow-x-hidden — mobile-only guard against body-level
          horizontal scroll; desktop (md+) body is untouched. */}
      <body className="max-md:overflow-x-hidden">
        {/* Apply the saved theme before content paints (no flash). Kept as a
            parser-blocking inline script on purpose; suppressHydrationWarning
            on <html> covers the pre-React data-theme attribute. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("cs-theme");if(t==="black"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}',
          }}
        />
        {children}
      </body>
    </html>
  );
}
