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
  COLOR_POS_TEXT,
  COLOR_NEG_TEXT,
  COLOR_MAX_ABS_BG,
  COLOR_MAX_ABS_TEXT,
  COLOR_SPOT,
} from "./heatmap-shared";
import { HeatmapModeToggle, CustomTickerPicker } from "./HeatmapModeControls";
import { MultiHeatmapView } from "./MultiHeatmapView";

const TICKERS = ["SPY", "SPX", "QQQ", "TSLA", "NVDA", "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT"];

export function GexHeatmapView() {
  const { ticker, setTicker, restored: tickerRestored } = useGexTicker(TICKERS, "SPY");
  const { mode, setMode, customTickers, setCustomTickers, restored: modeRestored } = useGexHeatmapMode(TICKERS);

  // Standard mode owns its own data fetch (the existing single-ticker table
  // below). Multi modes delegate to <MultiHeatmapView/>, which fetches per-
  // strip. Disabling the fetch when not in Standard mode avoids a wasted
  // request for a hidden view.
  const standardEnabled = tickerRestored && modeRestored && mode === "standard";
  const { data, error, notFound, loading } = useHeatmapData(ticker, standardEnabled);
  const now = useNow();

  const cellMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const c of data.cells) m.set(cellKey(c.strike, c.exp), c.netOI);
    return m;
  }, [data]);

  // maxAbs flags the single largest cell with the orange standout; scaleMax
  // (the SECOND-largest absolute value) normalizes the gradient so a single
  // outlier cell (often the 0DTE gamma magnet) doesn't compress every other
  // cell into near-neutral.
  const { maxAbsKey, scaleMax } = useMemo(() => {
    let maxAbs = 0;
    let secondMax = 0;
    let maxAbsKey = "";
    for (const [key, v] of cellMap) {
      const abs = Math.abs(v);
      if (abs > maxAbs) {
        secondMax = maxAbs;
        maxAbs = abs;
        maxAbsKey = key;
      } else if (abs > secondMax) {
        secondMax = abs;
      }
    }
    return { maxAbsKey, scaleMax: secondMax > 0 ? secondMax : maxAbs };
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
            title="Net dealer GEX (OI) by strike × expiration. Background saturation = magnitude. Orange = single largest absolute cell. Green text = positive, red = negative."
          >
            Net GEX heatmap — {titleSuffix}
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
            title="Background saturation maps to |GEX| / per-view max (sqrt-scaled). Orange = single largest absolute GEX. Green text = positive (dealer long gamma here). Red text = negative (dealer short gamma). In multi-ticker views, each strip is normalized independently."
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
          <MultiHeatmapView tickers={multiTickers} />
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
