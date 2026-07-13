"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TabBar } from "@/components/layout/TabBar";
import { EarningsView } from "@/components/modules/earnings/EarningsView";

// Order must match Topbar's MODULES.earnings.tabs.
const TABS = [
  { id: "calendar", label: "Calendar" },
  { id: "screener", label: "Screener" },
  { id: "deepdive", label: "Deep dive" },
];

export default function EarningsPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <EarningsPageInner />
    </Suspense>
  );
}

function EarningsPageInner() {
  const tabIdx = Number(useSearchParams().get("tab") ?? 0);
  const activeId = (TABS[tabIdx]?.id ?? "calendar") as "calendar" | "screener" | "deepdive";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar tabs={TABS} activeId={activeId} onChange={() => {}} />
      <EarningsView tab={activeId} />
    </div>
  );
}
