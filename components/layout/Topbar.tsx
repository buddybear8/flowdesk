"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MobileNavDrawer } from "@/components/layout/MobileNavDrawer";

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
  gex:          { label: "Options GEX",       tabs: ["GEX overview", "Heatmap"] },
  "flow-sentiment": { label: "Options sentiment", tabs: ["Market dashboard", "Ticker view"] },
  "trade-alerts": { label: "Trade alerts",      tabs: ["Options alerts", "Equities alerts"] },
  charts:     { label: "Charts",            tabs: [] },
  flow:       { label: "Flow alerts",       tabs: ["Live feed", "Lottos", "Opening Sweeps"] },
  darkpool:   { label: "Dark pools",        tabs: ["Ranked feed", "DP levels"] },
  settings:   { label: "Settings",          tabs: [] },
  "user-guide": { label: "User Guide",       tabs: [] },
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

  // Mobile-only nav drawer (<768px). The hamburger is hidden at md+ so the
  // desktop Topbar renders exactly as before.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <header
      className="flex h-11 items-center gap-[10px] bg-bg-primary px-[14px] flex-shrink-0"
      style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
    >
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setNavOpen(true)}
        // box-content + p + negative margins: 28px visual square with a 40px
        // touch target, occupying the same layout space (button is md:hidden,
        // so desktop is untouched).
        className="md:hidden box-content p-[6px] -my-[6px] -mr-[6px] -ml-[10px] flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-secondary"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M2 3.75h11M2 7.5h11M2 11.25h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex items-center gap-[5px] text-[12px] max-md:min-w-0 max-md:overflow-hidden">
        <span className="text-text-secondary max-md:truncate">{mod.label}</span>
        {mod.tabs.length > 0 && (
          <>
            <span className="text-text-tertiary">/</span>
            <span className="font-medium text-text-primary max-md:truncate">{subLabel}</span>
          </>
        )}
      </div>
      <div className="ml-auto flex items-center gap-[7px] max-md:flex-shrink-0">
        {key === "charts" && (
          <span
            className="text-[10px] font-medium rounded-full"
            style={{
              padding: "2px 8px",
              border: "0.5px solid rgba(201, 165, 90, 0.32)",
              color: "#C9A55A",
            }}
          >
            15-min delayed data
          </span>
        )}
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
