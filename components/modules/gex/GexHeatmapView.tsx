"use client";

import { useMemo } from "react";
import { useGexTicker } from "@/lib/use-gex-ticker";
import { useGexHeatmapMode, INDICES_TICKERS } from "@/lib/use-gex-heatmap-mode";
import {
  useHeatmapData,
  useNow,
  freshness,
  cellBg,
  fmtGex,
  cellKey,
  useHeatmapMetric,
  useHeatmapHorizon,
  metricValue,
  COLOR_POS_TEXT,
  COLOR_NEG_TEXT,
  COLOR_MAX_ABS_BG,
  COLOR_MAX_ABS_TEXT,
  COLOR_SPOT,
} from "./heatmap-shared";
import { HeatmapModeToggle, CustomTickerPicker } from "./HeatmapModeControls";
import { MultiHeatmapView } from "./MultiHeatmapView";

const TICKERS = ["SPY", "SPX", "QQQ", "TSLA", "NVDA", "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT", "AAPL", "MU", "DRAM", "SPCX"];

export function GexHeatmapView() {
  const { ticker, setTicker, restored: tickerRestored } = useGexTicker(TICKERS, "SPY");
  const { mode, setMode, customTickers, setCustomTickers, restored: modeRestored } = useGexHeatmapMode(TICKERS);
  const { metric, setMetric } = useHeatmapMetric();
  const { horizon, setHorizon } = useHeatmapHorizon();
  const METRIC_LABEL = metric === "vex" ? "VEX" : "GEX";

  // Standard mode owns its own data fetch (the existing single-ticker table
  // below). Multi modes delegate to <MultiHeatmapView/>, which fetches per-
  // strip. Disabling the fetch when not in Standard mode avoids a wasted
  // request for a hidden view.
  const standardEnabled = tickerRestored && modeRestored && mode === "standard";
  const { data, error, notFound, loading } = useHeatmapData(ticker, standardEnabled, horizon);
  const now = useNow();

  const cellMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const c of data.cells) {
      const v = metricValue(c, metric);
      if (v !== undefined) m.set(cellKey(c.strike, c.exp), v);
    }
    return m;
  }, [data, metric]);

  // maxAbsKeys flags the largest cell PER expiration column with the orange
  // standout — so every column shows its own gamma magnet, not just the
  // 0DTE one. scaleMax (the SECOND-largest absolute value across the whole
  // grid) normalizes the gradient so a single outlier cell doesn't compress
  // every other cell into near-neutral.
  const { maxAbsKeys, scaleMax } = useMemo(() => {
    const perExp = new Map<string, { key: string; abs: number }>();
    let maxAbs = 0;
    let secondMax = 0;
    if (data) {
      for (const c of data.cells) {
        const mv = metricValue(c, metric);
        if (mv === undefined) continue;
        const abs = Math.abs(mv);
        const key = cellKey(c.strike, c.exp);
        const cur = perExp.get(c.exp);
        if (!cur || abs > cur.abs) perExp.set(c.exp, { key, abs });
        if (abs > maxAbs) {
          secondMax = maxAbs;
          maxAbs = abs;
        } else if (abs > secondMax) {
          secondMax = abs;
        }
      }
    }
    const maxAbsKeys = new Set<string>();
    for (const { key } of perExp.values()) maxAbsKeys.add(key);
    return { maxAbsKeys, scaleMax: secondMax > 0 ? secondMax : maxAbs };
  }, [data, metric]);

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

  // Old snapshots (pre 2026-07-09) carry no vanna — show a friendly notice
  // instead of an all-dash grid until the next 2-min poll writes one.
  const vexPending = metric === "vex" && !!data && data.cells.length > 0 && cellMap.size === 0;

  const fresh = data && mode === "standard"
    ? freshness(now - new Date(data.capturedAt).getTime())
    : null;

  // Title label per mode.
  const titleSuffix =
    mode === "standard"
      ? ticker
      : mode === "indices"
        ? "Indices"
        : customTickers.length > 0
          ? `Custom (${customTickers.length} selected)`
          : "Custom";

  // Tickers fed to MultiHeatmapView when not in Standard mode.
  const multiTickers =
    mode === "indices" ? [...INDICES_TICKERS] : mode === "custom" ? customTickers : [];

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
            title={`Net dealer ${METRIC_LABEL} (OI) by strike × expiration. Background saturation = magnitude. Orange = largest absolute cell in each expiration column. Green text = positive, red = negative.`}
          >
            Net {METRIC_LABEL} heatmap — {titleSuffix}
          </span>
          {mode === "standard" && data && (
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
            title={`Background saturation maps to |${METRIC_LABEL}| / per-view max (sqrt-scaled). Orange = largest absolute ${METRIC_LABEL} in each expiration column. Green text = positive (dealer long gamma here). Red text = negative (dealer short gamma). In multi-ticker views, each strip is normalized independently.`}
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
          {/* Freshness pill — Standard mode only; multi-mode shows per strip */}
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
          {mode === "standard" && error && data && (
            <span style={{ fontSize: 10, color: COLOR_NEG_TEXT }} title={error}>
              ⚠ refresh failed
            </span>
          )}

          {/* Metric toggle — GEX vs VEX (vanna) */}
          <div className="inline-flex rounded-md bg-bg-secondary" style={{ padding: 2, gap: 1 }}>
            {(["gex", "vex"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                title={m === "vex" ? "Vanna exposure — dealer hedging sensitivity to implied-vol moves" : "Gamma exposure — dealer hedging sensitivity to price moves"}
                className="text-[10px] cursor-pointer"
                style={{
                  padding: "3px 9px",
                  borderRadius: 5,
                  background: metric === m ? "var(--color-background-primary)" : "transparent",
                  color: metric === m ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  border: metric === m ? "0.5px solid var(--color-border-tertiary)" : "0.5px solid transparent",
                  fontWeight: metric === m ? 600 : 400,
                }}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Horizon toggle — Near (closest expirations) vs Swing (next 5 weekly Fridays) */}
          <div className="inline-flex rounded-md bg-bg-secondary" style={{ padding: 2, gap: 1 }}>
            {(["near", "swing"] as const).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                title={h === "swing" ? "Next 5 weekly (Friday) expirations — swing-trade horizon" : "Closest expirations, including dailies where the ticker has them"}
                className="text-[10px] cursor-pointer"
                style={{
                  padding: "3px 9px",
                  borderRadius: 5,
                  background: horizon === h ? "var(--color-background-primary)" : "transparent",
                  color: horizon === h ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  border: horizon === h ? "0.5px solid var(--color-border-tertiary)" : "0.5px solid transparent",
                  fontWeight: horizon === h ? 600 : 400,
                }}
              >
                {h === "swing" ? "Swing" : "Near"}
              </button>
            ))}
          </div>

          {/* Mode toggle — always visible */}
          <HeatmapModeToggle mode={mode} onChange={setMode} />

          {/* Mode-specific control */}
          {mode === "standard" && (
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
          )}
          {mode === "custom" && (
            <CustomTickerPicker
              allTickers={TICKERS}
              selected={customTickers}
              onChange={setCustomTickers}
            />
          )}
        </div>
      </div>

      {/* Body — Standard mode keeps the existing single-ticker table; multi
          modes render the side-by-side strips. */}
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
        {mode !== "standard" ? (
          <MultiHeatmapView tickers={multiTickers} metric={metric} horizon={horizon} />
        ) : loading && !data ? (
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
        ) : !data ? null : vexPending ? (
          <div className="flex flex-1 items-center justify-center text-center" style={{ padding: 24 }}>
            <div>
              <div style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                VEX data for {ticker} arrives with the next snapshot
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                Vanna collection started 2026-07-09; snapshots refresh every ~2 minutes during market hours.
              </div>
            </div>
          </div>
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
                      const isMaxAbs = hasValue && maxAbsKeys.has(key);
                      const pos = val >= 0;

                      const bg = isMaxAbs ? COLOR_MAX_ABS_BG : hasValue ? cellBg(val, scaleMax) : "rgba(255,255,255,0.015)";
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
