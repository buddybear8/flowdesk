import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

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
    <html lang="en">
      <body>
        <div
          className="flex h-screen w-screen overflow-hidden"
          style={{ background: "var(--color-background-tertiary)" }}
        >
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <Suspense fallback={<div className="h-11 flex-shrink-0" />}>
              <Topbar />
            </Suspense>
            <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
