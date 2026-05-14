"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Regular US equity session, ET. DST is handled automatically because we
// derive ET wallclock via Intl with timeZone="America/New_York".
// US market holidays are NOT yet handled — known gap (resume.md punch list).
function isMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const dow = parts.find((p) => p.type === "weekday")?.value ?? "";
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? -1);
  if (h < 0 || m < 0) return false;
  if (dow === "Sat" || dow === "Sun") return false;
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

const MODULES: Record<string, { label: string; tabs: string[] }> = {
  watches:      { label: "Daily watches",     tabs: ["Hit list", "Criteria config"] },
  sentiment:    { label: "Sentiment tracker", tabs: ["Overview", "Analyst intelligence"] },
  "market-tide":{ label: "Market Pulse",       tabs: [] },
  gex:          { label: "Options GEX",       tabs: ["GEX overview", "Heatmap", "By strike", "By expiry", "Vanna & charm", "Key levels"] },
  flow:       { label: "Flow alerts",       tabs: ["Live feed", "Lottos", "Opening Sweeps"] },
  darkpool:   { label: "Dark pools",        tabs: ["Ranked feed", "DP levels"] },
  settings:   { label: "Settings",          tabs: [] },
};

export function Topbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = pathname.split("/").filter(Boolean)[0] ?? "watches";
  const mod = MODULES[key] ?? MODULES.watches!;
  const tabIdx = Math.max(0, Math.min(mod.tabs.length - 1, Number(searchParams.get("tab") ?? 0)));
  const subLabel = mod.tabs[tabIdx] ?? mod.label;

  // null = pre-mount; rendering the badge is deferred until we know the answer
  // (avoids an SSR/hydration mismatch and a visual flash from a hardcoded fallback).
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const tick = () => setMarketOpen(isMarketOpen());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

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
        {marketOpen !== null && (
          <span
            className="text-[10px] font-medium rounded-full"
            style={{
              padding: "2px 8px",
              background: marketOpen ? "rgba(127, 191, 82, 0.14)" : "rgba(168, 164, 150, 0.18)",
              color: marketOpen ? "#7FBF52" : "#A8A496",
            }}
          >
            ● {marketOpen ? "Market open" : "Market closed"}
          </span>
        )}
      </div>
    </header>
  );
}
