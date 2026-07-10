"use client";

// User-selectable display timezone (US zones only for now). ALL market
// logic — session boundaries, cron schedules, data filtering — stays in ET;
// this only changes how timestamps are RENDERED. Selection persists in
// localStorage and broadcasts a window event so every mounted view updates
// live when Settings changes it.

import { useEffect, useState } from "react";

export const US_TIMEZONES = [
  { id: "America/New_York", label: "Eastern", abbr: "ET" },
  { id: "America/Chicago", label: "Central", abbr: "CT" },
  { id: "America/Denver", label: "Mountain", abbr: "MT" },
  { id: "America/Phoenix", label: "Arizona", abbr: "MST" },
  { id: "America/Los_Angeles", label: "Pacific", abbr: "PT" },
  { id: "America/Anchorage", label: "Alaska", abbr: "AKT" },
  { id: "Pacific/Honolulu", label: "Hawaii", abbr: "HT" },
] as const;

export type UsTimeZoneId = (typeof US_TIMEZONES)[number]["id"];

const KEY = "cs-timezone";
const EVT = "cs-timezone-changed";
const DEFAULT_TZ: UsTimeZoneId = "America/New_York";

export function tzAbbr(tz: string): string {
  return US_TIMEZONES.find((z) => z.id === tz)?.abbr ?? "ET";
}

export function useTimeZone(): { tz: string; abbr: string; setTz: (id: UsTimeZoneId) => void } {
  const [tz, setState] = useState<string>(DEFAULT_TZ);
  useEffect(() => {
    const read = () => {
      try {
        const v = localStorage.getItem(KEY);
        setState(v && US_TIMEZONES.some((z) => z.id === v) ? v : DEFAULT_TZ);
      } catch { /* default */ }
    };
    read();
    window.addEventListener(EVT, read);
    return () => window.removeEventListener(EVT, read);
  }, []);
  const setTz = (id: UsTimeZoneId) => {
    try { localStorage.setItem(KEY, id); } catch { /* non-fatal */ }
    window.dispatchEvent(new Event(EVT));
  };
  return { tz, abbr: tzAbbr(tz), setTz };
}

// Zone wall-clock minus UTC, in seconds, at the given instant (DST-aware).
export function tzOffsetSec(tz: string, at: Date): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  const h = g("hour") === 24 ? 0 : g("hour"); // ICU midnight quirk
  const wall = Date.UTC(g("year"), g("month") - 1, g("day"), h, g("minute"), g("second"));
  return Math.round((wall - at.getTime()) / 1000);
}

// Interpret a naive wall-clock time ("HH:MM" or "HH:MM:SS") on dateStr
// (YYYY-MM-DD) in fromTz, returning the real UTC instant. Two-pass offset
// resolution handles DST edges.
export function wallToDate(dateStr: string, hms: string, fromTz = "America/New_York"): Date {
  const full = hms.length === 5 ? `${hms}:00` : hms;
  const naive = Date.parse(`${dateStr}T${full}Z`);
  let t = naive;
  for (let i = 0; i < 2; i++) t = naive - tzOffsetSec(fromTz, new Date(t)) * 1000;
  return new Date(t);
}

// "h:mm AM" in the display zone (no zone suffix — callers append the abbr).
export function fmtClock(d: Date, tz: string, withSeconds = false): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    timeZone: tz,
  });
}

// "Jul 10" in the display zone.
export function fmtDateShort(d: Date, tz: string): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
}
