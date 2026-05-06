"use client";

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

export default function FlowPage() {
  const tabIdx = Number(useSearchParams().get("tab") ?? 0);
  const activeId = TABS[tabIdx]?.id ?? "live";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar tabs={TABS} activeId={activeId} onChange={() => {}} />
      {activeId === "lottos" ? <LottosView /> : <FlowView />}
    </div>
  );
}
