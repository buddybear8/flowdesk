"use client";

// Left-pane options-sentiment embed for the Daily Watches deep dive — the
// per-strike buy/sell dashboard pinned to the selected watch ticker, in the
// FlowSentimentView's compact layout.

import { Suspense } from "react";
import type { HitListItem } from "@/lib/types";
import { FlowSentimentView } from "@/components/modules/flow-sentiment/FlowSentimentView";

export function WatchSentimentPane({ hit, onBack }: { hit: HitListItem; onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg-primary">
      <div
        className="flex items-center justify-between px-[14px] py-[7px] flex-shrink-0"
        style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
      >
        <button
          onClick={onBack}
          className="cursor-pointer text-[11px] text-text-secondary hover:text-text-primary"
          style={{ background: "transparent", border: "none", padding: 0 }}
        >
          « Hit list
        </button>
        <span className="text-[12px] font-medium text-text-primary">
          {hit.ticker} <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>options sentiment</span>
        </span>
        <span style={{ width: 52 }} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* FlowSentimentView reads useSearchParams (ignored when fixedTicker
            is set) — Suspense keeps Next's CSR bailout happy. */}
        <Suspense fallback={null}>
          <FlowSentimentView compact fixedTicker={hit.ticker} />
        </Suspense>
      </div>
    </div>
  );
}
