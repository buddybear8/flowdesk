"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  TIMEFRAMES,
  type Timeframe, type CandlesResult, type RankedTradesResult,
} from "@/lib/candles";
import { TRACKED_TICKERS } from "@/lib/tracked-tickers";
import { TickerSearch } from "@/components/modules/charts/TickerSearch";
import type { ChartOverlaysPayload } from "@/app/api/chart-overlays/route";
import type { ExtraLevel } from "@/components/modules/charts/TickerPriceChart";

// Chart wraps the imperative Lightweight Charts lib — client-only, no SSR.
const TickerPriceChart = dynamic(
  () => import("@/components/modules/charts/TickerPriceChart").then((m) => m.TickerPriceChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center"
        style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
        Loading chart…
      </div>
    ),
  },
);

const NAMES: Record<string, string> = {
  SPY: "SPDR S&P 500 ETF", QQQ: "Invesco QQQ Trust", TSLA: "Tesla Inc", NVDA: "NVIDIA Corp",
  AMD: "Advanced Micro Devices", META: "Meta Platforms", AMZN: "Amazon.com Inc",
  GOOGL: "Alphabet Inc", NFLX: "Netflix Inc", MSFT: "Microsoft Corp",
};

const GREEN = "#7FBF52", RED = "#E76A6A", GOLD = "#E2BF73";
const BLUE = "#6AA8E7", PURPLE = "#B48EE0";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── tiny polling fetch hook — 60s, visibility-aware ──────────────────────
function usePolled<T>(url: string): { data: T | null; error: string | null; lastFetched: number } {
  const [state, setState] = useState<{ data: T | null; error: string | null; lastFetched: number }>({
    data: null, error: null, lastFetched: 0,
  });
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as T;
        if (!cancelled) setState({ data: json, error: null, lastFetched: Date.now() });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      }
    };
    void fetchOnce();
    const id = setInterval(() => { if (!document.hidden) void fetchOnce(); }, 60_000);
    const onVis = () => { if (!document.hidden) void fetchOnce(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [url]);
  return state;
}

export default function ChartsPage() {
  const [ticker, setTicker] = useState<string>("SPY");
  const [tf, setTf] = useState<Timeframe>("1D");

  // ranked-trade overlay state
  const [showBubbles, setShowBubbles] = useState(true);
  const [bubbleRank, setBubbleRank] = useState(20);
  const [showLevels, setShowLevels] = useState(false);
  const [levelRank, setLevelRank] = useState(10);
  const [showGex, setShowGex] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [levelSinceStr, setLevelSinceStr] = useState(
    () => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10),
  );

  const candlesState = usePolled<CandlesResult>(`/api/candles/${ticker}?tf=${tf}`);
  const tradesState = usePolled<RankedTradesResult>(`/api/ranked-trades/${ticker}`);
  const overlaysState = usePolled<ChartOverlaysPayload>(`/api/chart-overlays?ticker=${ticker}`);

  const candles = candlesState.data?.candles ?? [];
  const trades = tradesState.data?.trades ?? [];
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const high52w = candlesState.data?.stats.high52w ?? null;

  const levelSince = levelSinceStr ? Math.floor(new Date(levelSinceStr).getTime() / 1000) : 0;
  const change = last && prev ? last.close - prev.close : 0;
  const pct = last && prev && prev.close ? (change / prev.close) * 100 : 0;
  const up = change >= 0;
  const pctFromHigh = high52w && last ? ((high52w - last.close) / high52w) * 100 : null;

  const hasData = candles.length > 0;
  const loadError = candlesState.error && !candlesState.data;

  // GEX levels + Daily Watch targets → generic price lines for the chart.
  const gex = overlaysState.data?.gex ?? null;
  const watch = overlaysState.data?.watch ?? null;
  const extraLevels: ExtraLevel[] = [];
  if (showGex && gex) {
    extraLevels.push(
      { price: gex.callWall, title: "Call wall", color: GREEN, style: "solid" },
      { price: gex.putWall, title: "Put wall", color: RED, style: "solid" },
      { price: gex.gammaFlip, title: "Gamma flip", color: GOLD, style: "dashed" },
      ...gex.nodes.map((n) => ({
        price: n.price, title: `GEX #${n.rank}`, color: BLUE, style: "dotted" as const,
      })),
    );
  }
  if (showWatch && watch) {
    extraLevels.push(
      ...watch.targets.map((t) => ({
        price: t.price,
        title: `Target ${t.n} · ${watch.dateLabel}`,
        color: PURPLE,
        style: "dashed" as const,
      })),
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--color-background-tertiary)" }}>
      {/* ── header ── */}
      <div className="flex flex-wrap items-start gap-x-[18px] gap-y-[8px]" style={{ padding: "10px 14px 8px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 21, fontWeight: 600, color: "var(--color-text-primary)" }}>{ticker}</span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{NAMES[ticker] ?? ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 3 }}>
            <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
              {last ? `$${fmt(last.close)}` : "—"}
            </span>
            {last && prev && (
              <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: up ? GREEN : RED }}>
                {up ? "▲ +" : "▼ "}{fmt(change)}  ({up ? "+" : ""}{pct.toFixed(2)}%)
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 3 }}>
            last {tf} bar
            {pctFromHigh != null && (
              <>
                {"  ·  "}
                <span style={{ color: pctFromHigh >= 0 ? RED : GREEN }}>
                  {pctFromHigh >= 0
                    ? `${pctFromHigh.toFixed(1)}% below`
                    : `${Math.abs(pctFromHigh).toFixed(1)}% above`} 52w high
                </span>
              </>
            )}
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "inline-flex", border: "0.5px solid var(--color-border-secondary)", borderRadius: 7, overflow: "hidden" }}>
            {TIMEFRAMES.map((t, i) => (
              <button key={t} onClick={() => setTf(t)}
                style={{
                  padding: "4px 13px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", border: "none",
                  borderLeft: i > 0 ? "0.5px solid var(--color-border-secondary)" : "none",
                  fontWeight: tf === t ? 600 : 400,
                  background: tf === t ? "var(--color-background-tertiary)" : "transparent",
                  color: tf === t ? GOLD : "var(--color-text-secondary)",
                }}>
                {t}
              </button>
            ))}
          </div>
          <TickerSearch value={ticker} tickers={TRACKED_TICKERS} onChange={setTicker} />
        </div>
      </div>

      {/* ── ranked-trade overlay controls ── */}
      <div className="flex flex-wrap items-center gap-[13px]"
        style={{ margin: "0 14px 8px", padding: "8px 12px", background: "var(--color-background-primary)",
                 border: "0.5px solid var(--color-border-tertiary)", borderRadius: 9 }}>
        <span style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--color-text-tertiary)" }}>
          Overlays
        </span>
        <div className="flex items-center gap-[9px]">
          <Toggle on={showBubbles} label="Trade bubbles" onClick={() => setShowBubbles((v) => !v)} />
          <Filter dim={!showBubbles}>
            rank ≤ <NumInput value={bubbleRank} onChange={setBubbleRank} />
          </Filter>
        </div>
        <span style={{ width: ".5px", height: 20, background: "var(--color-border-tertiary)" }} />
        <div className="flex items-center gap-[9px]">
          <Toggle on={showLevels} label="Horizontal levels" onClick={() => setShowLevels((v) => !v)} />
          <Filter dim={!showLevels}>
            rank ≤ <NumInput value={levelRank} onChange={setLevelRank} />
            {"  show dates since "}
            <input type="date" value={levelSinceStr} onChange={(e) => setLevelSinceStr(e.target.value)}
              style={{ fontFamily: "inherit", fontSize: 11, padding: "3px 6px", colorScheme: "dark", width: 134,
                       background: "var(--color-background-tertiary)", color: "var(--color-text-primary)",
                       border: "0.5px solid var(--color-border-secondary)", borderRadius: 5, outline: "none" }} />
          </Filter>
        </div>
        <span style={{ width: ".5px", height: 20, background: "var(--color-border-tertiary)" }} />
        <div className="flex items-center gap-[9px]">
          <Toggle on={showGex} label="GEX levels" onClick={() => setShowGex((v) => !v)} />
          {showGex && !gex && (
            <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)" }}>
              no GEX data for {ticker}
            </span>
          )}
        </div>
        <div className="flex items-center gap-[9px]">
          <Toggle on={showWatch} label="Watch targets" onClick={() => setShowWatch((v) => !v)} />
          {showWatch && !watch && (
            <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)" }}>
              {ticker} hasn't appeared in Daily Watches
            </span>
          )}
          {showWatch && watch && (
            <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)" }}>
              {watch.contract} · alerted {watch.dateLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── chart card ── */}
      <div style={{
        flex: 1, margin: "0 14px 14px", borderRadius: 10, position: "relative", minHeight: 0,
        border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden",
        background: "var(--color-background-primary)",
      }}>
        {loadError ? (
          <div className="flex h-full items-center justify-center text-center" style={{ padding: 24 }}>
            <div>
              <div style={{ fontSize: 14, color: RED, marginBottom: 4 }}>Failed to load chart</div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{candlesState.error}</div>
            </div>
          </div>
        ) : !hasData ? (
          <div className="flex h-full items-center justify-center text-center" style={{ padding: 24 }}>
            <div>
              <div style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                No price data yet for {ticker}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                Candles populate from the worker's first poll during market hours.
              </div>
            </div>
          </div>
        ) : (
          <TickerPriceChart
            candles={candles}
            trades={trades}
            intraday={tf === "1H"}
            showBubbles={showBubbles}
            bubbleRank={bubbleRank}
            showLevels={showLevels}
            levelRank={levelRank}
            levelSince={levelSince}
            extraLevels={extraLevels}
            lastFetched={candlesState.lastFetched}
          />
        )}
      </div>
    </div>
  );
}

// ── small control primitives ─────────────────────────────────────────────
function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 11px", fontSize: 11,
        fontWeight: 500, fontFamily: "inherit", borderRadius: 999, cursor: "pointer", userSelect: "none",
        border: `0.5px solid ${on ? "rgba(226,191,115,.5)" : "var(--color-border-secondary)"}`,
        background: on ? "rgba(226,191,115,.15)" : "var(--color-background-tertiary)",
        color: on ? "#E2BF73" : "var(--color-text-secondary)",
      }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#E2BF73" : "var(--color-text-tertiary)" }} />
      {label}
    </button>
  );
}

function Filter({ dim, children }: { dim: boolean; children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--color-text-tertiary)",
      opacity: dim ? 0.32 : 1, pointerEvents: dim ? "none" : "auto",
    }}>
      {children}
    </span>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input type="number" min={1} value={value}
      onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
      style={{
        width: 48, fontFamily: "inherit", fontSize: 11, padding: "3px 6px", fontVariantNumeric: "tabular-nums",
        background: "var(--color-background-tertiary)", color: "var(--color-text-primary)",
        border: "0.5px solid var(--color-border-secondary)", borderRadius: 5, outline: "none",
      }} />
  );
}
