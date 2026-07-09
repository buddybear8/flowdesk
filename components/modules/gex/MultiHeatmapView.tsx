"use client";

// Multi-ticker GEX heatmap view — renders one vertical strip per ticker,
// each showing that ticker's closest expiration. Used by Indices and Custom
// modes. Each strip self-fetches via useHeatmapData so a slow/failing ticker
// doesn't block its neighbors.

import { useMemo } from "react";
import {
  useHeatmapData,
  useNow,
  freshness,
  cellBg,
  fmtGex,
  pickCenteredStrikes,
  metricValue,
  type HeatmapMetric,
  type HeatmapHorizon,
  COLOR_POS_TEXT,
  COLOR_NEG_TEXT,
  COLOR_MAX_ABS_BG,
  COLOR_MAX_ABS_TEXT,
  COLOR_SPOT,
} from "./heatmap-shared";

const STRIKES_PER_STRIP = 25;

export function MultiHeatmapView({ tickers, metric = "gex", horizon = "near" }: { tickers: string[]; metric?: HeatmapMetric; horizon?: HeatmapHorizon }) {
  if (tickers.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 4 }}>
            Pick up to 5 tickers
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            Each ticker&apos;s closest expiration is shown side by side.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex"
      style={{
        flex: 1,
        gap: 1,
        background: "var(--color-border-tertiary)",
        minHeight: 0,
        overflow: "auto",
      }}
    >
      {tickers.map((t) => (
        <TickerStrip key={t} ticker={t} metric={metric} horizon={horizon} />
      ))}
    </div>
  );
}

function TickerStrip({ ticker, metric, horizon }: { ticker: string; metric: HeatmapMetric; horizon: HeatmapHorizon }) {
  const { data, error, notFound, loading } = useHeatmapData(ticker, true, horizon);
  const now = useNow();

  const strip = useMemo(() => {
    if (!data) return null;
    if (data.expirations.length === 0 || data.strikes.length === 0) return null;
    const exp = data.expirations[0]!; // closest expiration (route sorts ascending DTE)
    const strikes = pickCenteredStrikes(data.strikes, data.spot, STRIKES_PER_STRIP);

    // Cell value map for this strip's expiration only.
    const cellMap = new Map<number, number>();
    for (const c of data.cells) {
      if (c.exp !== exp.date) continue;
      const v = metricValue(c, metric);
      if (v !== undefined) cellMap.set(c.strike, v);
    }

    // Per-strip color normalization — same "2nd-largest abs" rule the single
    // view uses, but scoped to this strip's visible cells. Keeps SPX's
    // dollar-gamma magnitudes from drowning out SPY's column.
    let maxAbs = 0;
    let secondMax = 0;
    let maxAbsStrike: number | null = null;
    for (const s of strikes) {
      const v = cellMap.get(s);
      if (v === undefined) continue;
      const abs = Math.abs(v);
      if (abs > maxAbs) {
        secondMax = maxAbs;
        maxAbs = abs;
        maxAbsStrike = s;
      } else if (abs > secondMax) {
        secondMax = abs;
      }
    }
    const scaleMax = secondMax > 0 ? secondMax : maxAbs;

    // Spot row index = strike closest to spot (within the picked subset).
    let spotRowIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < strikes.length; i++) {
      const d = Math.abs(strikes[i]! - data.spot);
      if (d < bestDist) {
        bestDist = d;
        spotRowIdx = i;
      }
    }

    return { exp, strikes, cellMap, maxAbsStrike, scaleMax, spotRowIdx };
  }, [data, metric]);

  const fresh = data ? freshness(now - new Date(data.capturedAt).getTime()) : null;

  return (
    <div
      className="flex flex-col"
      style={{
        flex: 1,
        minWidth: 140,
        maxWidth: 240,
        background: "var(--color-background-primary)",
        overflow: "hidden",
      }}
    >
      {/* Strip header */}
      <div
        style={{
          padding: "8px 10px 6px 10px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {ticker}
          </span>
          {fresh && (
            <span
              className="inline-flex items-center gap-[4px]"
              style={{ fontSize: 9, color: fresh.color }}
              title={
                fresh.label +
                (data
                  ? ` · captured ${new Date(data.capturedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET`
                  : "")
              }
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: fresh.color }} />
              {fresh.short}
            </span>
          )}
        </div>
        <div style={{ marginTop: 2, fontSize: 10, color: "var(--color-text-secondary)" }}>
          {strip ? strip.exp.label : data ? "no expirations" : "—"}
        </div>
        {data && (
          <div style={{ marginTop: 1, fontSize: 9, color: "var(--color-text-tertiary)" }}>
            Spot ${data.spot.toFixed(2)}
          </div>
        )}
      </div>

      {/* Strip body */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {loading && !data ? (
          <StripPlaceholder text="Loading…" />
        ) : notFound ? (
          <StripPlaceholder text={`No data for ${ticker}`} subtle />
        ) : error && !data ? (
          <StripPlaceholder text="Failed to load" color={COLOR_NEG_TEXT} />
        ) : !strip ? (
          <StripPlaceholder text="No cells" subtle />
        ) : metric === "vex" && strip.cellMap.size === 0 ? (
          <StripPlaceholder text="VEX arrives with the next snapshot" subtle />
        ) : (
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
            <tbody>
              {strip.strikes.map((s, i) => {
                const v = strip.cellMap.get(s);
                const hasValue = v !== undefined;
                const val = v ?? 0;
                const isMaxAbs = hasValue && s === strip.maxAbsStrike;
                const isSpotRow = i === strip.spotRowIdx;
                const pos = val >= 0;
                const bg = isMaxAbs
                  ? COLOR_MAX_ABS_BG
                  : hasValue
                    ? cellBg(val, strip.scaleMax)
                    : "rgba(255,255,255,0.015)";
                const textColor = !hasValue
                  ? "var(--color-text-tertiary)"
                  : isMaxAbs
                    ? COLOR_MAX_ABS_TEXT
                    : pos
                      ? COLOR_POS_TEXT
                      : COLOR_NEG_TEXT;
                const rowBorder = isSpotRow
                  ? `1.5px dashed ${COLOR_SPOT}`
                  : "0.5px solid rgba(255,255,255,0.03)";
                return (
                  <tr key={s}>
                    <td
                      style={{
                        padding: "0 8px",
                        color: isSpotRow ? COLOR_SPOT : "var(--color-text-primary)",
                        fontWeight: isSpotRow ? 600 : 500,
                        background: isSpotRow ? "rgba(34, 211, 238, 0.07)" : "var(--color-background-primary)",
                        whiteSpace: "nowrap",
                        borderTop: rowBorder,
                        width: 60,
                        fontSize: 10,
                      }}
                    >
                      {isSpotRow && <span style={{ marginRight: 2, fontSize: 7 }}>◀</span>}
                      ${s.toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: "0 8px",
                        textAlign: "right",
                        background: bg,
                        color: textColor,
                        fontWeight: isMaxAbs ? 700 : 500,
                        whiteSpace: "nowrap",
                        borderTop: rowBorder,
                        fontSize: 10,
                      }}
                    >
                      {hasValue ? fmtGex(val) : "—"}
                    </td>
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

function StripPlaceholder({ text, color, subtle }: { text: string; color?: string; subtle?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center" style={{ padding: 16 }}>
      <span
        style={{
          fontSize: 10,
          color: color ?? (subtle ? "var(--color-text-tertiary)" : "var(--color-text-secondary)"),
          textAlign: "center",
        }}
      >
        {text}
      </span>
    </div>
  );
}
