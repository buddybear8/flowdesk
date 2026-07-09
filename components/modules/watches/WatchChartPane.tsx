"use client";

// Left-pane price chart for the Daily Watches deep dive. Replaces the hit
// list while open: hourly view zoomed to the recent action, with the watch's
// direction-matched Target 1/2/3 ladder pre-drawn (and the price axis
// expanded so the full ladder stays on screen).

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TIMEFRAMES, type Timeframe, type CandlesResult } from "@/lib/candles";
import type { HitListItem } from "@/lib/types";
import type { ExtraLevel } from "@/components/modules/charts/TickerPriceChart";

const TickerPriceChart = dynamic(
  () => import("@/components/modules/charts/TickerPriceChart").then((m) => m.TickerPriceChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center"
        style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
        Loading chart…
      </div>
    ),
  },
);

const GOLD = "#E2BF73", PURPLE = "#B48EE0";
// Hourly bars ≈ 7 per session — 30 bars ≈ the last week of trading.
const HOURLY_ZOOM_BARS = 30;

export function WatchChartPane({ hit, onBack }: { hit: HitListItem; onBack: () => void }) {
  const [tf, setTf] = useState<Timeframe>("1H");
  const [state, setState] = useState<{ data: CandlesResult | null; error: string | null; lastFetched: number }>({
    data: null, error: null, lastFetched: 0,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, lastFetched: 0 });
    const fetchOnce = async () => {
      try {
        const r = await fetch(`/api/candles/${hit.ticker}?tf=${tf}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as CandlesResult;
        if (!cancelled) setState({ data: json, error: null, lastFetched: Date.now() });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      }
    };
    void fetchOnce();
    const id = setInterval(() => { if (!document.hidden) void fetchOnce(); }, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [hit.ticker, tf]);

  const candles = state.data?.candles ?? [];

  // Direction-matched target ladder, same side the detail panel shows.
  const extraLevels: ExtraLevel[] = [];
  if (hit.atrTargets) {
    const t = hit.atrTargets;
    const ladder = hit.direction === "UP" ? [t.up05, t.up1, t.up2] : [t.dn05, t.dn1, t.dn2];
    ladder.forEach((price, i) => {
      if (Number.isFinite(price) && price > 0) {
        extraLevels.push({ price, title: `Target ${i + 1}`, color: PURPLE, style: "dashed" });
      }
    });
  }

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
          {hit.ticker} <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>chart</span>
        </span>
        <div style={{ display: "inline-flex", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, overflow: "hidden" }}>
          {TIMEFRAMES.map((t, i) => (
            <button key={t} onClick={() => setTf(t)}
              style={{
                padding: "3px 10px", fontSize: 10.5, fontFamily: "inherit", cursor: "pointer", border: "none",
                borderLeft: i > 0 ? "0.5px solid var(--color-border-secondary)" : "none",
                fontWeight: tf === t ? 600 : 400,
                background: tf === t ? "var(--color-background-tertiary)" : "transparent",
                color: tf === t ? GOLD : "var(--color-text-secondary)",
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {state.error && !state.data ? (
          <div className="flex h-full items-center justify-center text-center" style={{ padding: 24 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
              Failed to load chart — {state.error}
            </div>
          </div>
        ) : candles.length === 0 ? (
          <div className="flex h-full items-center justify-center" style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            {state.data ? `No price data yet for ${hit.ticker}` : "Loading chart…"}
          </div>
        ) : (
          <TickerPriceChart
            candles={candles}
            trades={[]}
            intraday={tf === "1H"}
            showBubbles={false}
            bubbleRank={0}
            showLevels={false}
            levelRank={0}
            levelSince={0}
            extraLevels={extraLevels}
            scaleToExtraLevels
            fitBars={tf === "1H" ? HOURLY_ZOOM_BARS : undefined}
            lastFetched={state.lastFetched}
          />
        )}
      </div>
    </div>
  );
}
