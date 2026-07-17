"use client";

// Shared helpers + data hook for the GEX heatmap views. Used by both
// GexHeatmapView (single-ticker, multi-expiration) and MultiHeatmapView
// (multi-ticker, single-expiration). Keep this file free of JSX so it can be
// imported from either.

import { useEffect, useState } from "react";
import type { HeatmapCell, HeatmapPayload } from "@/lib/types";

// ─── Visual constants ─────────────────────────────────────────────────────
export const COLOR_POS_TEXT = "#A6E07A";
export const COLOR_NEG_TEXT = "#F08585";
export const COLOR_MAX_ABS_BG = "#F2A23B";
export const COLOR_MAX_ABS_TEXT = "#1A1410";
export const COLOR_SPOT = "#22D3EE";

// Power-curve scaling. Exp > 1 biases toward neutral — small-magnitude cells
// stay near-transparent so the larger cells visually stand out.
const MAX_BG_ALPHA = 0.6;
const RAMP_EXP = 1.6;

export function rampAlpha(v: number, maxAbs: number): number {
  if (!maxAbs) return 0;
  const t = Math.min(1, Math.abs(v) / maxAbs);
  return Math.pow(t, RAMP_EXP) * MAX_BG_ALPHA;
}

export function cellBg(v: number, maxAbs: number): string {
  const a = rampAlpha(v, maxAbs);
  if (v === 0) return "rgba(255,255,255,0.02)";
  return v > 0
    ? `rgba(127, 191, 82, ${a.toFixed(3)})`
    : `rgba(231, 106, 106, ${a.toFixed(3)})`;
}

// Values are in raw dollars; render in millions so a column of mixed M/B/K
// units stays visually comparable. Billions display as "$X,XXX.XXM".
export function fmtGex(v: number): string {
  const sign = v < 0 ? "−" : "";
  const m = Math.abs(v) / 1e6;
  return `${sign}$${m.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}M`;
}

export function cellKey(strike: number, exp: string): string {
  return `${strike}|${exp}`;
}

// ─── Data hook ────────────────────────────────────────────────────────────
// - Fires immediately on mount and on ticker change
// - Refetches every 60s while the tab is visible
// - Refetches immediately when the tab regains focus
// - Keeps last-good data on transient errors (don't blow away a rendered
//   heatmap because of a single failed poll)
export type HeatmapState = {
  data: HeatmapPayload | null;
  error: string | null;
  notFound: boolean;
  loading: boolean;
};

export type HeatmapHorizon = "near" | "swing";
const HORIZON_KEY = "gex-heatmap-horizon";

// Persisted expiration horizon: "near" = closest expirations (default),
// "swing" = next 5 weekly (Friday) expirations.
export function useHeatmapHorizon(): { horizon: HeatmapHorizon; setHorizon: (h: HeatmapHorizon) => void } {
  const [horizon, setHorizonState] = useState<HeatmapHorizon>("near");
  useEffect(() => {
    try {
      const h = localStorage.getItem(HORIZON_KEY);
      if (h === "swing" || h === "near") setHorizonState(h);
    } catch { /* defaults */ }
  }, []);
  const setHorizon = (h: HeatmapHorizon) => {
    setHorizonState(h);
    try { localStorage.setItem(HORIZON_KEY, h); } catch { /* non-fatal */ }
  };
  return { horizon, setHorizon };
}

export function useHeatmapData(ticker: string, enabled: boolean, horizon: HeatmapHorizon = "near", at: string | null = null): HeatmapState {
  const [state, setState] = useState<HeatmapState>({
    data: null,
    error: null,
    notFound: false,
    loading: true,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null, notFound: false }));

    const fetchOnce = async () => {
      try {
        const r = await fetch(
          `/api/gex/heatmap?ticker=${ticker}&horizon=${horizon}${at ? `&at=${encodeURIComponent(at)}` : ""}`,
          { cache: "no-store" },
        );
        if (r.status === 404) {
          if (!cancelled) setState({ data: null, error: null, notFound: true, loading: false });
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as HeatmapPayload;
        if (!cancelled) setState({ data: json, error: null, notFound: false, loading: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setState((s) => ({ ...s, error: msg, loading: false }));
      }
    };

    void fetchOnce();
    // Historical scrubs are immutable — fetch once, don't poll.
    if (at) return () => { cancelled = true; };
    const id = setInterval(() => {
      if (!document.hidden) void fetchOnce();
    }, 60_000);
    const onVis = () => {
      if (!document.hidden) void fetchOnce();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ticker, enabled, horizon, at]);

  return state;
}

// Ticks every second; used by the freshness pill so the "X sec ago" label
// updates without depending on the polling cadence.
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function freshness(ageMs: number): { label: string; short: string; color: string } {
  const sec = Math.floor(ageMs / 1000);
  if (sec < 90) return { label: `Updated ${sec}s ago`, short: `${sec}s`, color: "#7FBF52" };
  if (sec < 300) return { label: `Updated ${Math.floor(sec / 60)}m ago`, short: `${Math.floor(sec / 60)}m`, color: "#C9A55A" };
  const min = Math.floor(sec / 60);
  return { label: `Stale — ${min}m old`, short: `${min}m`, color: "#E76A6A" };
}

// Pick the N strikes closest to spot from a (descending-by-strike) array,
// re-sorted descending for top-down display. Used by MultiHeatmapView to
// compress the route's 50-strike payload to the compact ~25 the multi view
// shows. The route's payload is already centered (its pickStrikesCentered
// picks the 50 closest); this is a second pass at a smaller N.
export function pickCenteredStrikes(strikes: number[], spot: number, n: number): number[] {
  if (strikes.length <= n) return strikes;
  return [...strikes]
    .map((s) => ({ s, d: Math.abs(s - spot) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.s)
    .sort((a, b) => b - a);
}

// ── Heatmap metric (GEX | VEX) ───────────────────────────────────────────────
// VEX = net dealer vanna exposure — how dealer hedging shifts as implied vol
// moves. Same grid/pipeline as GEX; snapshots before 2026-07-09 lack vanna.

export type HeatmapMetric = "gex" | "vex";
const METRIC_KEY = "gex-heatmap-metric";

export function useHeatmapMetric(): { metric: HeatmapMetric; setMetric: (m: HeatmapMetric) => void } {
  const [metric, setMetricState] = useState<HeatmapMetric>("gex");
  useEffect(() => {
    try {
      const m = localStorage.getItem(METRIC_KEY);
      if (m === "vex" || m === "gex") setMetricState(m);
    } catch { /* defaults */ }
  }, []);
  const setMetric = (m: HeatmapMetric) => {
    setMetricState(m);
    try { localStorage.setItem(METRIC_KEY, m); } catch { /* non-fatal */ }
  };
  return { metric, setMetric };
}

// Value accessor — undefined when the snapshot predates vanna collection.
export function metricValue(c: HeatmapCell, metric: HeatmapMetric): number | undefined {
  return metric === "vex" ? c.vOI : c.netOI;
}
