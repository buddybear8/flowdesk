import type { Metadata } from "next";
import "./globals.css";
import { SkewRecovery } from "@/components/layout/SkewRecovery";

export const metadata: Metadata = {
  title: "Champagne Sessions",
  description: "Trading intelligence dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Apply the saved theme before content paints (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("cs-theme");if(t==="black"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}',
          }}
        />
        <SkewRecovery />
        {children}
      </body>
    </html>
  );
}
