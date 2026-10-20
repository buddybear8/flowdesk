"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TabBar } from "@/components/layout/TabBar";
import { GexView } from "@/components/modules/gex/GexView";
import { GexHeatmapView } from "@/components/modules/gex/GexHeatmapView";
import { GexChartView } from "@/components/modules/gex/GexChartView";

// Order must match Topbar's MODULES.gex.tabs.
const TABS = [
  { id: "overview", label: "GEX overview" },
  { id: "heatmap", label: "Heatmap" },
  { id: "chart", label: "GEX Chart" },
];

export default function GexPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <GexPageInner />
    </Suspense>
  );
}

function GexPageInner() {
  const tabIdx = Number(useSearchParams().get("tab") ?? 0);
  const activeId = TABS[tabIdx]?.id ?? "overview";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar tabs={TABS} activeId={activeId} onChange={() => {}} />
      {activeId === "heatmap" ? <GexHeatmapView /> : activeId === "chart" ? <GexChartView /> : <GexView />}
    </div>
  );
}
