"use client";

// Type-in ticker selector for /charts — an autocomplete over the full
// tracked-ticker corpus (~229). Prefix matches rank above substring matches;
// keyboard navigable (↑/↓/Enter/Esc); closes on outside-click. Invalid input
// is discarded on close — the field reverts to the last valid ticker.

import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  value: string;
  tickers: readonly string[];
  onChange: (ticker: string) => void;
}

const MAX_RESULTS = 60;

export function TickerSearch({ value, tickers, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return tickers.slice(0, MAX_RESULTS);
    const prefix: string[] = [];
    const sub: string[] = [];
    for (const t of tickers) {
      if (t.startsWith(q)) prefix.push(t);
      else if (t.includes(q)) sub.push(t);
    }
    return [...prefix, ...sub].slice(0, MAX_RESULTS);
  }, [query, tickers]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(t: string) {
    onChange(t);
    setOpen(false);
    setQuery("");
    setHighlight(0);
    inputRef.current?.blur();
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={open ? query : value}
        placeholder={open ? value : "Ticker"}
        spellCheck={false}
        onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const m = matches[highlight];
            if (m) pick(m);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
            inputRef.current?.blur();
          }
        }}
        style={{
          width: 116, fontSize: 12, padding: "4px 9px", fontFamily: "inherit",
          textTransform: "uppercase", outline: "none",
          background: "var(--color-background-primary)", color: "var(--color-text-primary)",
          border: "0.5px solid var(--color-border-secondary)", borderRadius: 6,
        }}
      />
      {open && matches.length > 0 && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30,
            width: 150, maxHeight: 280, overflowY: "auto",
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)", borderRadius: 8,
            boxShadow: "0 6px 18px rgba(0,0,0,0.4)", padding: 4,
          }}
        >
          {matches.map((t, i) => (
            <div
              key={t}
              onMouseDown={(e) => { e.preventDefault(); pick(t); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: "4px 8px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                fontVariantNumeric: "tabular-nums",
                background: i === highlight ? "var(--color-background-tertiary)" : "transparent",
                color: i === highlight ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
