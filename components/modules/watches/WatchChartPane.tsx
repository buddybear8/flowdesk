"use client";

// Left-pane price chart for the Daily Watches deep dive. Replaces the hit
// list while open: hourly view zoomed to the recent action, with the watch's
// direction-matched Target 1/2/3 ladder pre-drawn (and the price axis
// expanded so the full ladder stays on screen).

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TIMEFRAMES, type Timeframe, type CandlesResult, type RankedTradesResult } from "@/lib/candles";
import type { HitListItem } from "@/lib/types";
import type { ExtraLevel } from "@/components/modules/charts/TickerPriceChart";
import type { ChartOverlaysPayload } from "@/app/api/chart-overlays/route";

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

const GOLD = "#E2BF73", PURPLE = "#B48EE0", GREEN = "#7FBF52", RED = "#E76A6A", BLUE = "#6AA8E7";
const WEEK_SEC = 7 * 86_400;

export function WatchChartPane({ hit, onBack }: { hit: HitListItem; onBack: () => void }) {
  const [tf, setTf] = useState<Timeframe>("1H");
  const [state, setState] = useState<{ data: CandlesResult | null; error: string | null; lastFetched: number }>({
    data: null, error: null, lastFetched: 0,
  });
  const [showTargets, setShowTargets] = useState(true);
  const [showGex, setShowGex] = useState(false);
  const [showDp, setShowDp] = useState(false);
  const [overlays, setOverlays] = useState<ChartOverlaysPayload | null>(null);
  const [trades, setTrades] = useState<RankedTradesResult | null>(null);

  // GEX levels / ranked dark-pool trades load lazily on first toggle.
  useEffect(() => {
    setOverlays(null);
    setTrades(null);
  }, [hit.ticker]);
  useEffect(() => {
    if (!showGex || overlays) return;
    let cancelled = false;
    fetch(`/api/chart-overlays?ticker=${hit.ticker}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setOverlays(j as ChartOverlaysPayload); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showGex, overlays, hit.ticker]);
  useEffect(() => {
    if (!showDp || trades) return;
    let cancelled = false;
    fetch(`/api/ranked-trades/${hit.ticker}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setTrades(j as RankedTradesResult); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showDp, trades, hit.ticker]);

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

  // Default hourly zoom: exactly one week of candles, counted from the data
  // itself so holidays/half-days don't skew the window.
  const lastTime = candles.length > 0 ? candles[candles.length - 1]!.time : 0;
  const weekBars = candles.reduce((n, c) => n + (c.time >= lastTime - WEEK_SEC ? 1 : 0), 0);

  // Direction-matched target ladder, same side the detail panel shows.
  const extraLevels: ExtraLevel[] = [];
  if (showTargets && hit.atrTargets) {
    const t = hit.atrTargets;
    const ladder = hit.direction === "UP" ? [t.up05, t.up1, t.up2] : [t.dn05, t.dn1, t.dn2];
    ladder.forEach((price, i) => {
      if (Number.isFinite(price) && price > 0) {
        extraLevels.push({ price, title: `Target ${i + 1}`, color: PURPLE, style: "dashed" });
      }
    });
  }
  const gex = overlays?.gex ?? null;
  if (showGex && gex) {
    extraLevels.push(
      { price: gex.callWall, title: "Call wall", color: GREEN, style: "solid" },
      { price: gex.putWall, title: "Put wall", color: RED, style: "solid" },
      { price: gex.gammaFlip, title: "Gamma flip", color: GOLD, style: "dashed" },
      ...gex.nodes.map((n) => ({
        price: n.price, title: `GEX #${n.rank}`, color: BLUE, style: "dotted" as const,
      })),
    );
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

      <div
        className="flex items-center gap-[7px] px-[14px] py-[6px] flex-shrink-0"
        style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
      >
        <MiniToggle on={showTargets} label="Targets" onClick={() => setShowTargets((v) => !v)} />
        <MiniToggle on={showGex} label="GEX levels" onClick={() => setShowGex((v) => !v)} />
        <MiniToggle on={showDp} label="Dark pool trades" onClick={() => setShowDp((v) => !v)} />
        {showGex && overlays && !gex && (
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>no GEX data for {hit.ticker}</span>
        )}
        {showDp && trades && trades.trades.length === 0 && (
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>no ranked trades for {hit.ticker}</span>
        )}
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
            trades={showDp ? (trades?.trades ?? []) : []}
            intraday={tf === "1H"}
            showBubbles={showDp}
            bubbleRank={20}
            showLevels={false}
            levelRank={0}
            levelSince={0}
            extraLevels={extraLevels}
            scaleToExtraLevels
            fitBars={tf === "1H" && weekBars > 0 ? weekBars : undefined}
            lastFetched={state.lastFetched}
          />
        )}
      </div>
    </div>
  );
}

function MiniToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", fontSize: 10.5,
        fontWeight: 500, fontFamily: "inherit", borderRadius: 999, cursor: "pointer", userSelect: "none",
        border: `0.5px solid ${on ? "rgba(226,191,115,.5)" : "var(--color-border-secondary)"}`,
        background: on ? "rgba(226,191,115,.15)" : "var(--color-background-tertiary)",
        color: on ? GOLD : "var(--color-text-secondary)",
      }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: on ? GOLD : "var(--color-text-tertiary)" }} />
      {label}
    </button>
  );
}
