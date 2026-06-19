"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TabBar } from "@/components/layout/TabBar";
import { TradeAlertsView } from "@/components/modules/trade-alerts/TradeAlertsView";

// Order must match Topbar's MODULES["trade-alerts"].tabs.
const TABS = [
  { id: "options", label: "Options alerts" },
  { id: "equities", label: "Equities alerts" },
];

export default function TradeAlertsPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <TradeAlertsPageInner />
    </Suspense>
  );
}

function TradeAlertsPageInner() {
  const tabIdx = Number(useSearchParams().get("tab") ?? 0);
  const assetType = tabIdx === 1 ? "equity" : "option";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar tabs={TABS} activeId={TABS[tabIdx]?.id ?? "options"} onChange={() => {}} />
      <TradeAlertsView assetType={assetType} key={assetType} />
    </div>
  );
}
