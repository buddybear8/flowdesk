"use client";

// Header controls for the GEX heatmap view-mode toggle:
//  - 3-way segmented control (Standard / Indices / Custom)
//  - Multi-select popover for Custom mode (max 5 tickers)

import { useEffect, useRef, useState } from "react";
import type { HeatmapMode } from "@/lib/use-gex-heatmap-mode";
import { MAX_CUSTOM_TICKERS } from "@/lib/use-gex-heatmap-mode";

const MODE_OPTIONS: { id: HeatmapMode; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "indices", label: "Indices" },
  { id: "custom", label: "Custom" },
];

export function HeatmapModeToggle({
  mode,
  onChange,
}: {
  mode: HeatmapMode;
  onChange: (m: HeatmapMode) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        borderRadius: 6,
        border: "0.5px solid var(--color-border-secondary)",
        overflow: "hidden",
        background: "var(--color-background-primary)",
      }}
    >
      {MODE_OPTIONS.map((o, idx) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              background: active ? "var(--color-background-tertiary)" : "transparent",
              color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              border: "none",
              borderLeft: idx > 0 ? "0.5px solid var(--color-border-secondary)" : "none",
              cursor: "pointer",
              fontWeight: active ? 600 : 400,
              fontFamily: "inherit",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function CustomTickerPicker({
  allTickers,
  selected,
  onChange,
}: {
  allTickers: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — standard popover behavior.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const max = MAX_CUSTOM_TICKERS;
  const atCap = selected.length >= max;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md cursor-pointer bg-bg-primary"
        style={{
          fontSize: 11,
          padding: "3px 8px",
          border: "0.5px solid var(--color-border-secondary)",
          color: "var(--color-text-secondary)",
          fontFamily: "inherit",
        }}
      >
        Tickers ({selected.length}/{max}) ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 20,
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: 8,
            padding: 8,
            minWidth: 170,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "var(--color-text-tertiary)",
              marginBottom: 6,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Pick up to {max}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 300, overflowY: "auto" }}>
            {allTickers.map((t) => {
              const checked = selected.includes(t);
              const disabled = !checked && atCap;
              return (
                <label
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11,
                    padding: "3px 4px",
                    borderRadius: 4,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                    color: "var(--color-text-primary)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, t]
                        : selected.filter((x) => x !== t);
                      onChange(next);
                    }}
                    style={{ cursor: disabled ? "not-allowed" : "pointer", margin: 0 }}
                  />
                  {t}
                </label>
              );
            })}
          </div>
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              style={{
                marginTop: 8,
                width: "100%",
                fontSize: 10,
                padding: "3px 6px",
                background: "transparent",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: 4,
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
