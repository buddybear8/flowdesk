// Layout for the authenticated dashboard. Renders the Sidebar + Topbar chrome
// around any page under app/(modules)/*. Pages outside this group (e.g. /login)
// inherit only the bare html/body shell from app/layout.tsx.

import { Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { getWhopUser, requireAccess } from "@/lib/whop-auth";

export default async function ModulesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getWhopUser();
  if (!user) return <NotInIframe />;
  const access = await requireAccess(user);
  if (!access.hasAccess) return <NoAccessPass />;

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

function NotInIframe() {
  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center px-6"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{
          background: "var(--color-background-primary)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <h1
          className="text-2xl font-semibold mb-3"
          style={{ color: "var(--color-text-primary, #F5EFD9)" }}
        >
          Champagne Sessions
        </h1>
        <p
          className="text-sm"
          style={{ color: "var(--color-text-secondary, #B8C5D6)" }}
        >
          Open Champagne Sessions from inside The Champagne Room hub on Whop.
        </p>
      </div>
    </div>
  );
}

function NoAccessPass() {
  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center px-6"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{
          background: "var(--color-background-primary)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <h1
          className="text-2xl font-semibold mb-3"
          style={{ color: "var(--color-text-primary, #F5EFD9)" }}
        >
          Access required
        </h1>
        <p
          className="text-sm mb-4"
          style={{ color: "var(--color-text-secondary, #B8C5D6)" }}
        >
          You need the Champagne Sessions Intelligence access pass to view this
          app. Join the free product on Whop and return here.
        </p>
        <a
          href="https://whop.com/the-champagne-room/champagne-sessions-intelligenc/"
          target="_top"
          className="inline-block rounded-lg px-4 py-2 font-medium"
          style={{
            background: "var(--color-brand-gold, #C9A55A)",
            color: "#0F2040",
          }}
        >
          Join the free product
        </a>
      </div>
    </div>
  );
}
