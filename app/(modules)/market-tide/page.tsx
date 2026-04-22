import { Suspense } from "react";
import { MarketTideView } from "@/components/modules/market-tide/MarketTideView";

export default function MarketTidePage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <MarketTideView />
    </Suspense>
  );
}
