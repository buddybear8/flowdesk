"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TabBar } from "@/components/layout/TabBar";
import { FlowSentimentView } from "@/components/modules/flow-sentiment/FlowSentimentView";
import { MarketDashboardView } from "@/components/modules/flow-sentiment/MarketDashboardView";

// Order must match Topbar's MODULES["flow-sentiment"].tabs.
// Market dashboard is the default landing tab (index 0).
const TABS = [
  { id: "market", label: "Market dashboard" },
  { id: "ticker", label: "Ticker view" },
];

export default function FlowSentimentPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <FlowSentimentPageInner />
    </Suspense>
  );
}

function FlowSentimentPageInner() {
  const tabIdx = Number(useSearchParams().get("tab") ?? 0);
  const active = TABS[tabIdx]?.id ?? "market";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar tabs={TABS} activeId={active} onChange={() => {}} />
      {active === "market" ? <MarketDashboardView /> : <FlowSentimentView />}
    </div>
  );
}
