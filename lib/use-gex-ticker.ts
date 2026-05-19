"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "gex:ticker";

// Persists the GEX ticker selection across page refreshes — and across the
// Overview / Heatmap tabs, since both share this storage key.
//
// localStorage is read in an effect rather than a lazy useState initializer
// so the server and client first render agree (a lazy initializer reading
// localStorage would render a different <select value> on the client and
// trip a hydration mismatch). `restored` lets callers defer their data
// fetch until the persisted ticker has been applied, avoiding a wasted
// fetch + flash of the fallback ticker's data.
export function useGexTicker(valid: readonly string[], fallback: string) {
  const [ticker, setTickerState] = useState(fallback);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && valid.includes(saved)) setTickerState(saved);
    } catch {
      /* localStorage unavailable (private mode) — keep the fallback */
    }
    setRestored(true);
    // valid + fallback are module-level constants — read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTicker = useCallback((t: string) => {
    setTickerState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  return { ticker, setTicker, restored };
}
