"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TabBar } from "@/components/layout/TabBar";
import { FlowView } from "@/components/modules/flow/FlowView";
import { LottosView } from "@/components/modules/flow/LottosView";

// Order must match Topbar's MODULES.flow.tabs. The placeholder entries
// (Sweep / 0DTE / Unusual) are kept here so the topbar breadcrumb and the
// TabBar share one source of truth; they fall back to FlowView until built.
const TABS = [
  { id: "live", label: "Live feed" },
  { id: "lottos", label: "Lottos" },
  { id: "sweep", label: "Sweep scanner" },
  { id: "zdte", label: "0DTE flow" },
  { id: "unusual", label: "Unusual activity" },
];

// useSearchParams forces CSR bailout up to the nearest Suspense boundary
// (Next.js requirement when a client component reads URL state during static
// prerender). The page-level Suspense lets `next build` succeed; the runtime
// hydration is unaffected.
export default function FlowPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <FlowPageInner />
    </Suspense>
  );
}

function FlowPageInner() {
  const tabIdx = Number(useSearchParams().get("tab") ?? 0);
  const activeId = TABS[tabIdx]?.id ?? "live";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar tabs={TABS} activeId={activeId} onChange={() => {}} />
      {activeId === "lottos" ? <LottosView /> : <FlowView />}
    </div>
  );
}
