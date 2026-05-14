"use client";

import { useEffect, useMemo, useState } from "react";
import type { HeatmapPayload } from "@/lib/types";

const TICKERS = ["SPY", "SPX", "QQQ", "TSLA", "NVDA", "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT"];

const COLOR_POS_TEXT = "#A6E07A";
const COLOR_NEG_TEXT = "#F08585";
const COLOR_MAX_ABS_BG = "#F2A23B";
const COLOR_MAX_ABS_TEXT = "#1A1410";
const COLOR_SPOT = "#22D3EE";

// Power-curve scaling. Exp > 1 biases toward neutral — small-magnitude cells
// stay near-transparent so the larger cells visually stand out.
const MAX_BG_ALPHA = 0.6;
const RAMP_EXP = 1.6;

function rampAlpha(v: number, maxAbs: number): number {
  if (!maxAbs) return 0;
  const t = Math.min(1, Math.abs(v) / maxAbs);
  return Math.pow(t, RAMP_EXP) * MAX_BG_ALPHA;
}

function cellBg(v: number, maxAbs: number): string {
  const a = rampAlpha(v, maxAbs);
  if (v === 0) return "rgba(255,255,255,0.02)";
  return v > 0
    ? `rgba(127, 191, 82, ${a.toFixed(3)})`
    : `rgba(231, 106, 106, ${a.toFixed(3)})`;
}

function fmtGex(v: number): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const k = abs / 1_000;
  if (k >= 1) {
    return `${sign}$${k.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

function cellKey(strike: number, exp: string): string {
  return `${strike}|${exp}`;
}

// ─── Data hook: poll /api/gex/heatmap once per minute ─────────────────────
// - Fires immediately on mount and on ticker change
// - Refetches every 60s while the tab is visible
// - Refetches immediately when the tab regains focus
// - Keeps last-good data on transient errors (don't blow away a rendered
//   heatmap because of a single failed poll)
type HeatmapState = {
  data: HeatmapPayload | null;
  error: string | null;
  notFound: boolean;
  loading: boolean;
};

function useHeatmapData(ticker: string): HeatmapState {
  const [state, setState] = useState<HeatmapState>({
    data: null,
    error: null,
    notFound: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null, notFound: false }));

    const fetchOnce = async () => {
      try {
        const r = await fetch(`/api/gex/heatmap?ticker=${ticker}`, { cache: "no-store" });
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

    fetchOnce();
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
  }, [ticker]);

  return state;
}

// Ticks every second; used by the freshness pill so the "X sec ago" label
// updates without depending on the polling cadence.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function freshness(ageMs: number): { label: string; color: string } {
  const sec = Math.floor(ageMs / 1000);
  if (sec < 90) return { label: `Updated ${sec}s ago`, color: "#7FBF52" };
  if (sec < 300) return { label: `Updated ${Math.floor(sec / 60)}m ago`, color: "#C9A55A" };
  const min = Math.floor(sec / 60);
  return { label: `Stale — ${min}m old`, color: "#E76A6A" };
}

export function GexHeatmapView() {
  const [ticker, setTicker] = useState<string>("SPY");
  const { data, error, notFound, loading } = useHeatmapData(ticker);
  const now = useNow();

  const cellMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const c of data.cells) m.set(cellKey(c.strike, c.exp), c.netOI);
    return m;
  }, [data]);

  const { maxAbs, maxAbsKey } = useMemo(() => {
    let maxAbs = 0;
    let maxAbsKey = "";
    for (const [key, v] of cellMap) {
      const abs = Math.abs(v);
      if (abs > maxAbs) {
        maxAbs = abs;
        maxAbsKey = key;
      }
    }
    return { maxAbs, maxAbsKey };
  }, [cellMap]);

  const spotRowIdx = useMemo(() => {
    if (!data) return -1;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.strikes.length; i++) {
      const d = Math.abs(data.strikes[i]! - data.spot);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }, [data]);

  const fresh = data ? freshness(now - new Date(data.capturedAt).getTime()) : null;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      {/* Title strip */}
      <div
        className="flex flex-wrap items-center gap-x-[18px] gap-y-[6px]"
        style={{ padding: "10px 14px 8px 14px" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}
            title="Net dealer GEX (OI) by strike × expiration. Background saturation = magnitude. Orange = single largest absolute cell. Green text = positive, red = negative."
          >
            Net GEX heatmap — {ticker}
          </span>
          {data && (
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
              Spot ${data.spot.toFixed(2)} · {data.strikes.length} strikes · {data.expirations.length} expirations
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-tertiary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 999,
              padding: "1px 6px",
              cursor: "help",
            }}
            title="Background saturation maps to |GEX| / global max (sqrt-scaled). Orange = single largest absolute GEX. Green text = positive (dealer long gamma here). Red text = negative (dealer short gamma)."
          >
            ?
          </span>
        </div>

        {/* Inline legend */}
        <div
          className="flex flex-wrap items-center gap-[12px]"
          style={{ fontSize: 10, color: "var(--color-text-secondary)" }}
        >
          <span className="inline-flex items-center gap-[5px]">
            <span style={{ width: 11, height: 11, borderRadius: 2, background: COLOR_MAX_ABS_BG, border: "0.5px solid rgba(0,0,0,0.2)" }} />
            Max abs
          </span>
          <span className="inline-flex items-center gap-[4px]">
            <span style={{ width: 11, height: 11, borderRadius: 2, background: "rgba(127, 191, 82, 0.62)" }} />
            <span style={{ width: 11, height: 11, borderRadius: 2, background: "rgba(127, 191, 82, 0.30)" }} />
            <span style={{ width: 11, height: 11, borderRadius: 2, background: "rgba(127, 191, 82, 0.10)" }} />
            <span style={{ color: COLOR_POS_TEXT, fontWeight: 600, marginLeft: 4 }}>+</span>
          </span>
          <span className="inline-flex items-center gap-[4px]">
            <span style={{ width: 11, height: 11, borderRadius: 2, background: "rgba(231, 106, 106, 0.10)" }} />
            <span style={{ width: 11, height: 11, borderRadius: 2, background: "rgba(231, 106, 106, 0.30)" }} />
            <span style={{ width: 11, height: 11, borderRadius: 2, background: "rgba(231, 106, 106, 0.62)" }} />
            <span style={{ color: COLOR_NEG_TEXT, fontWeight: 600, marginLeft: 4 }}>−</span>
          </span>
          <span className="inline-flex items-center gap-[5px]">
            <span style={{ display: "inline-block", width: 16, borderTop: `1.5px dashed ${COLOR_SPOT}` }} />
            Spot
          </span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {/* Freshness pill */}
          {fresh && (
            <span
              className="inline-flex items-center gap-[5px]"
              style={{ fontSize: 10, color: fresh.color }}
              title={data ? `Snapshot captured ${new Date(data.capturedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET` : undefined}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: fresh.color }} />
              {fresh.label}
            </span>
          )}
          {error && data && (
            <span style={{ fontSize: 10, color: COLOR_NEG_TEXT }} title={error}>
              ⚠ refresh failed
            </span>
          )}
          <select
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            className="rounded-md outline-none cursor-pointer bg-bg-primary"
            style={{
              fontSize: 11,
              padding: "3px 8px",
              border: "0.5px solid var(--color-border-secondary)",
              color: "var(--color-text-secondary)",
            }}
          >
            {TICKERS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Heatmap card — fills remaining height */}
      <div
        className="bg-bg-primary"
        style={{
          flex: 1,
          margin: "0 14px 14px 14px",
          borderRadius: 10,
          border: "0.5px solid var(--color-border-tertiary)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {loading && !data ? (
          <div className="flex flex-1 items-center justify-center text-text-tertiary text-[12px]">
            Loading heatmap…
          </div>
        ) : notFound ? (
          <div
            className="flex flex-1 items-center justify-center text-center"
            style={{ padding: 24 }}
          >
            <div>
              <div style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                No heatmap data yet for {ticker}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                Data populates during market hours. First snapshot lands within 60s of 9:30 ET.
              </div>
            </div>
          </div>
        ) : error && !data ? (
          <div
            className="flex flex-1 items-center justify-center text-center"
            style={{ padding: 24 }}
          >
            <div>
              <div style={{ fontSize: 14, color: COLOR_NEG_TEXT, marginBottom: 4 }}>
                Failed to load heatmap
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{error}</div>
            </div>
          </div>
        ) : !data ? null : (
          <table
            style={{
              width: "100%",
              height: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 10,
              fontVariantNumeric: "tabular-nums",
              tableLayout: "fixed",
            }}
          >
            <thead>
              <tr style={{ height: 24 }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "0 10px",
                    color: "var(--color-text-secondary)",
                    fontWeight: 500,
                    fontSize: 10,
                    background: "var(--color-background-primary)",
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    width: 90,
                  }}
                >
                  Strike
                </th>
                {data.expirations.map(exp => (
                  <th
                    key={exp.date}
                    style={{
                      padding: "0 10px",
                      textAlign: "right",
                      color: "var(--color-text-secondary)",
                      fontWeight: 500,
                      fontSize: 10,
                      whiteSpace: "nowrap",
                      background: "var(--color-background-primary)",
                      borderBottom: "0.5px solid var(--color-border-tertiary)",
                    }}
                  >
                    {exp.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.strikes.map((strike, i) => {
                const isSpotRow = i === spotRowIdx;
                return (
                  <tr key={strike}>
                    <td
                      style={{
                        padding: "0 10px",
                        color: isSpotRow ? COLOR_SPOT : "var(--color-text-primary)",
                        fontWeight: isSpotRow ? 600 : 500,
                        background: isSpotRow ? "rgba(34, 211, 238, 0.07)" : "var(--color-background-primary)",
                        whiteSpace: "nowrap",
                        borderTop: isSpotRow ? `1.5px dashed ${COLOR_SPOT}` : "0.5px solid rgba(255,255,255,0.03)",
                      }}
                    >
                      {isSpotRow && <span style={{ marginRight: 3, fontSize: 8 }}>◀</span>}
                      ${strike.toLocaleString()}
                    </td>
                    {data.expirations.map(exp => {
                      const key = cellKey(strike, exp.date);
                      const v = cellMap.get(key);
                      const hasValue = v !== undefined;
                      const val = v ?? 0;
                      const isMaxAbs = hasValue && key === maxAbsKey;
                      const pos = val >= 0;

                      const bg = isMaxAbs ? COLOR_MAX_ABS_BG : hasValue ? cellBg(val, maxAbs) : "rgba(255,255,255,0.015)";
                      const textColor = !hasValue
                        ? "var(--color-text-tertiary)"
                        : isMaxAbs
                          ? COLOR_MAX_ABS_TEXT
                          : pos
                            ? COLOR_POS_TEXT
                            : COLOR_NEG_TEXT;

                      return (
                        <td
                          key={exp.date}
                          style={{
                            padding: "0 10px",
                            textAlign: "right",
                            background: bg,
                            color: textColor,
                            fontWeight: isMaxAbs ? 700 : 500,
                            whiteSpace: "nowrap",
                            borderTop: isSpotRow ? `1.5px dashed ${COLOR_SPOT}` : "0.5px solid rgba(255,255,255,0.03)",
                          }}
                        >
                          {hasValue ? fmtGex(val) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
