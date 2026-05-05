"use client";

import { usePathname, useSearchParams } from "next/navigation";

const MODULES: Record<string, { label: string; tabs: string[] }> = {
  watches:      { label: "Daily watches",     tabs: ["Hit list", "Criteria config"] },
  sentiment:    { label: "Sentiment tracker", tabs: ["Overview", "Analyst intelligence"] },
  "market-tide":{ label: "Market Pulse",       tabs: [] },
  gex:          { label: "Options GEX",       tabs: ["GEX overview", "By strike", "By expiry", "Vanna & charm", "Key levels"] },
  flow:       { label: "Flow alerts",       tabs: ["Live feed", "Sweep scanner", "0DTE flow", "Unusual activity"] },
  darkpool:   { label: "Dark pools",        tabs: ["Ranked feed", "DP levels"] },
  watchlists: { label: "Watchlists",        tabs: [] },
  alerts:     { label: "Alerts",            tabs: [] },
  settings:   { label: "Settings",          tabs: [] },
};

export function Topbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = pathname.split("/").filter(Boolean)[0] ?? "watches";
  const mod = MODULES[key] ?? MODULES.watches!;
  const tabIdx = Math.max(0, Math.min(mod.tabs.length - 1, Number(searchParams.get("tab") ?? 0)));
  const subLabel = mod.tabs[tabIdx] ?? mod.label;

  return (
    <header
      className="flex h-11 items-center gap-[10px] bg-bg-primary px-[14px] flex-shrink-0"
      style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
    >
      <div className="flex items-center gap-[5px] text-[12px]">
        <span className="text-text-secondary">{mod.label}</span>
        {mod.tabs.length > 0 && (
          <>
            <span className="text-text-tertiary">/</span>
            <span className="font-medium text-text-primary">{subLabel}</span>
          </>
        )}
      </div>
      <div className="ml-auto flex items-center gap-[7px]">
        <span
          className="text-[10px] font-medium rounded-full"
          style={{ padding: "2px 8px", background: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" }}
        >
          ● Market open
        </span>
      </div>
    </header>
  );
}
