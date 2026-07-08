// Layout for the authenticated dashboard. Renders the Sidebar + Topbar chrome
// around any page under app/(modules)/*. Pages outside this group (e.g. /login)
// inherit only the bare html/body shell from app/layout.tsx.

import { Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PushRegistration } from "@/components/native/PushRegistration";

export default function ModulesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // max-md:h-dvh — on mobile the shell tracks the DYNAMIC viewport height so
    // the collapsing browser toolbar never hides the bottom of a module;
    // h-screen (100vh) stays first as the fallback for older WebKit and is
    // untouched at md+ (desktop pixel-identical).
    <div
      className="flex h-screen max-md:h-dvh w-screen overflow-hidden"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      {/* Registers the device for push when running inside the Capacitor
          native shell; renders nothing and no-ops in a plain browser. */}
      <PushRegistration />
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
