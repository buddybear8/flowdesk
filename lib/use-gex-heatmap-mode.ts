"use client";

// View-mode + custom-ticker persistence for the GEX heatmap. Independent of
// the single-ticker `useGexTicker` hook (which still drives Standard mode);
// this hook only manages the multi-mode state.

import { useEffect, useState } from "react";

export type HeatmapMode = "standard" | "indices" | "custom";

const MODE_KEY = "gex:heatmap-mode";
const CUSTOM_KEY = "gex:heatmap-custom";
const VALID_MODES: HeatmapMode[] = ["standard", "indices", "custom"];

// Indices mode is locked to this order. SPX, SPY, QQQ as requested.
export const INDICES_TICKERS = ["SPX", "SPY", "QQQ"] as const;

export const MAX_CUSTOM_TICKERS = 5;

export function useGexHeatmapMode(allTickers: readonly string[]) {
  const [mode, setModeState] = useState<HeatmapMode>("standard");
  const [customTickers, setCustomTickersState] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);

  // Hydrate from localStorage once on mount. Failures are non-fatal —
  // SSR / private browsing / quota-exceeded all just leave defaults.
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m && VALID_MODES.includes(m as HeatmapMode)) {
        setModeState(m as HeatmapMode);
      }
      const c = localStorage.getItem(CUSTOM_KEY);
      if (c) {
        const parsed: unknown = JSON.parse(c);
        if (Array.isArray(parsed)) {
          const filtered = parsed
            .filter((t): t is string => typeof t === "string" && allTickers.includes(t))
            .slice(0, MAX_CUSTOM_TICKERS);
          setCustomTickersState(filtered);
        }
      }
    } catch {
      /* ignore */
    }
    setRestored(true);
    // allTickers is a stable constant in practice; intentionally not in deps
    // to avoid re-hydrating on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMode = (m: HeatmapMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const setCustomTickers = (tickers: string[]) => {
    const filtered = tickers
      .filter((t) => allTickers.includes(t))
      .slice(0, MAX_CUSTOM_TICKERS);
    setCustomTickersState(filtered);
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(filtered));
    } catch {
      /* ignore */
    }
  };

  return { mode, setMode, customTickers, setCustomTickers, restored };
}
