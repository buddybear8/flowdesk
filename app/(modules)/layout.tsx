// Layout for the authenticated dashboard. Renders the Sidebar + Topbar chrome
// around any page under app/(modules)/*. Pages outside this group (e.g. /login)
// inherit only the bare html/body shell from app/layout.tsx.

import { Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export default function ModulesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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
  );
}
