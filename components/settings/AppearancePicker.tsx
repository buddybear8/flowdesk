"use client";

import { useEffect, useState } from "react";

// Theme picker — three schemes driven by [data-theme] on <html>:
//   blue  (default) — champagne navy, the original look (no attribute)
//   black           — true black, OLED-friendly
//   light           — champagne paper, warm cream
// Persisted in localStorage("cs-theme"); a pre-hydration script in
// app/layout.tsx applies it before first paint so there's no flash.

export type ThemeId = "blue" | "black" | "light";
const STORAGE_KEY = "cs-theme";

const THEMES: { id: ThemeId; icon: string; name: string; desc: string }[] = [
  { id: "blue", icon: "🌌", name: "Blue", desc: "Champagne navy — the original look." },
  { id: "black", icon: "🌑", name: "Black", desc: "True black — max contrast, OLED-friendly." },
  { id: "light", icon: "☀️", name: "Light", desc: "Champagne paper — warm cream for daylight." },
];

// Mini preview swatches per theme (thumbnail bars).
const THUMB: Record<ThemeId, { page: string; chrome: string; border: string; gold: string; row: string }> = {
  blue: { page: "#0A1A33", chrome: "#0F2040", border: "rgba(255,255,255,0.10)", gold: "#C9A55A", row: "#162947" },
  black: { page: "#000000", chrome: "#101014", border: "#26262C", gold: "#D4AB5A", row: "#1A1A20" },
  light: { page: "#F5F3ED", chrome: "#FFFFFF", border: "#DDD6C6", gold: "#A07C33", row: "#ECE8DD" },
};

export function applyTheme(t: ThemeId): void {
  if (t === "blue") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* private mode etc. — theme still applies for the session */
  }
}

export function AppearancePicker() {
  const [theme, setTheme] = useState<ThemeId>("blue");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "black" || saved === "light") setTheme(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const pick = (t: ThemeId) => {
    setTheme(t);
    applyTheme(t);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
      {THEMES.map((t) => {
        const sel = theme === t.id;
        const c = THUMB[t.id];
        return (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            aria-pressed={sel}
            className="cursor-pointer text-left"
            style={{
              background: "transparent",
              border: `2px solid ${sel ? "var(--color-text-info)" : "var(--color-border-secondary)"}`,
              borderRadius: 12,
              padding: 10,
              ...(sel ? { background: "var(--color-background-info)" } : {}),
            }}
          >
            {/* thumbnail */}
            <div style={{ height: 52, borderRadius: 8, overflow: "hidden", display: "flex", border: `1px solid ${c.border}`, background: c.page, marginBottom: 8 }}>
              <div style={{ width: 18, background: c.chrome, borderRight: `1px solid ${c.border}` }} />
              <div style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ height: 5, width: "68%", borderRadius: 2, background: c.gold }} />
                <div style={{ height: 5, width: "90%", borderRadius: 2, background: c.row }} />
                <div style={{ height: 5, width: "55%", borderRadius: 2, background: c.row }} />
              </div>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-primary)" }}>
              {t.icon} {t.name}
              {sel && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-text-info)" }}>✓ active</span>}
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.45 }}>{t.desc}</div>
          </button>
        );
      })}
    </div>
  );
}
