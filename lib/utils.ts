import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function formatUsd(value: number, opts: { compact?: boolean } = {}): string {
  const { compact = true } = opts;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (!compact) return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}:${ss}`;
}

// Seeded pseudo-random helper so mock data is stable across renders.
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// Select up to N strikes centered on `spot`. Targets floor(N/2) strikes
// strictly below spot and ceil(N/2) strikes at-or-above spot; if one side
// is short, takes more from the other so the total still hits N when data
// allows. Returned rows are sorted ascending by strike. Used by the GEX
// chart so a lopsided UW chain can't render a chart pinned entirely above
// or below spot — same selection rule is applied at the API and chart layers.
export function pickStrikesCentered<T extends { strike: number }>(
  items: readonly T[],
  spot: number,
  n: number,
): T[] {
  const asc = [...items].sort((a, b) => a.strike - b.strike);
  const below = asc.filter((s) => s.strike < spot);
  const above = asc.filter((s) => s.strike >= spot);
  const wantBelow = Math.floor(n / 2);
  const wantAbove = n - wantBelow;
  const takeAbove = Math.min(wantAbove + Math.max(0, wantBelow - below.length), above.length);
  const takeBelow = Math.min(wantBelow + Math.max(0, wantAbove - takeAbove), below.length);
  return [
    ...below.slice(below.length - takeBelow), // nearest takeBelow below spot
    ...above.slice(0, takeAbove),             // nearest takeAbove at-or-above spot
  ];
}
