"use client";

// GEX Chart — intraday candles with GEX nodes drawn on the price panel as
// dots-through-time (per capture bucket, intensity ∝ |net GEX|), current-node
// bands + right-edge labels, call/put wall + flip lines, and a live GEX-spot
// tail bridging Polygon's 15-min candle delay. Skylit-style "Atlas" view.
//
// Data: /api/gex/chart (10s poll) — candle_bars 1m (websocket-streamed,
// aggregated to 5m/10m server-side) or 1H, gex_node_days buckets, live spot.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTimeZone, tzOffsetSec } from "@/lib/timezone";

const TICKERS = ["AAPL", "AMD", "AMZN", "APP", "ARM", "ASTS", "AVGO", "BABA", "BE", "COIN", "CRWD", "CVNA", "DDOG", "DELL", "DIA", "DRAM", "ENPH", "GDX", "GLD", "GOOGL", "HOOD", "INTC", "IREN", "IWM", "META", "MRVL", "MSFT", "MU", "NBIS", "NFLX", "NOW", "NVDA", "ORCL", "PANW", "PDD", "PLTR", "QCOM", "QQQ", "RDDT", "SLV", "SMCI", "SMH", "SNDK", "SNOW", "SOXX", "SPCX", "SPX", "SPY", "TSLA", "USO", "VALE", "VIX"];
const TFS = ["1m", "5m", "10m", "1h"] as const;
type Tf = (typeof TFS)[number];

const UP = "#7FBF52", DOWN = "#E76A6A", GOLD = "#C9A55A", GOLD2 = "#E2BF73", PURPLE = "#B98AE6";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Node = { k: number; g: number };
type Bucket = { t: string; ts: number; s: number; front: Node[]; all: Node[]; cw: number | null; pw: number | null; fl: number | null };
type Payload = {
  ticker: string; tf: Tf; candles: Candle[];
  nodeDays: { date: string; buckets: Bucket[] }[];
  liveSpot: { t: number; p: number }[];
  asOf: number;
};

function useChartData(ticker: string, tf: Tf) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    const load = () =>
      fetch(`/api/gex/chart?ticker=${ticker}&tf=${tf}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((p: Payload) => { if (!cancelled) { setData(p); setError(false); } })
        .catch(() => { if (!cancelled) setError(true); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ticker, tf]);
  return { data, error };
}

export function GexChartView() {
  const [ticker, setTicker] = useState("SPY");
  const [tf, setTf] = useState<Tf>("5m");
  const [scope, setScope] = useState<"front" | "all">("front"); // expiry scope (Skylit "Expirations: Front")
  const [showNodes, setShowNodes] = useState(true);
  const [dense, setDense] = useState(false); // false = top 4 strikes (strong), true = all 12
  // Live-tick telemetry shown in the toolbar: proves the 1s loop is running
  // and which source feeds it ("worker" stream / "snap" snapshot / "none").
  const [tick, setTick] = useState<{ p: number; at: number; src: string } | null>(null);
  const { data, error } = useChartData(ticker, tf);
  const { tz } = useTimeZone();

  const chartElRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const spotSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const wallLinesRef = useRef<IPriceLine[]>([]);
  const stateRef = useRef<{ buckets: Bucket[]; scope: "front" | "all"; showNodes: boolean; dense: boolean; tzOff: number; lastCandleT: number; bucketMs: number }>({
    buckets: [], scope: "front", showNodes: true, dense: false, tzOff: 0, lastCandleT: 0, bucketMs: 300_000,
  });

  // Flatten buckets across days; thin for 1h so a month of dots stays light.
  const buckets = useMemo(() => {
    if (!data) return [];
    const all = data.nodeDays.flatMap((d) => d.buckets ?? []);
    return tf === "1h" ? all.filter((_, i) => i % 8 === 0) : all;
  }, [data, tf]);

  // ── chart lifecycle ──
  useEffect(() => {
    const el = chartElRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: { background: { color: "transparent" }, textColor: "#94A1B8", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "rgba(255,255,255,0.1)" },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      autoSize: true,
    });
    const candles = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
      // Expand autoscale so the current top nodes stay on screen (within ±6%
      // of spot — TSLA's 385/400 walls were being clipped by candle-only
      // autoscale and the node bands never showed).
      autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const base = orig();
        const st = stateRef.current;
        if (!base || !st.showNodes || !st.buckets.length) return base;
        const last = st.buckets[st.buckets.length - 1];
        const spot = last.s;
        const ks = [...last[st.scope]]
          .sort((a, z) => Math.abs(z.g) - Math.abs(a.g))
          .slice(0, st.dense ? 12 : 4)
          .map((n) => n.k)
          .filter((k) => spot > 0 && Math.abs(k / spot - 1) <= 0.06);
        if (!ks.length) return base;
        return {
          ...base,
          priceRange: {
            minValue: Math.min(base.priceRange.minValue, ...ks),
            maxValue: Math.max(base.priceRange.maxValue, ...ks),
          },
        };
      },
    });
    const spot = chart.addLineSeries({
      color: GOLD2, lineWidth: 1, lineStyle: LineStyle.Dotted,
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    candleSeriesRef.current = candles;
    spotSeriesRef.current = spot;

    // Node painter: absolutely-positioned canvas, repainted every frame from
    // stateRef (same pattern as the ranked-trade bubbles on /charts).
    let raf = 0;
    const paint = () => {
      raf = requestAnimationFrame(paint);
      const cv = canvasRef.current;
      if (!cv || !chartRef.current || !candleSeriesRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const st = stateRef.current;
      if (!st.showNodes || st.buckets.length === 0) return;
      const tsApi = chartRef.current.timeScale();
      const series = candleSeriesRef.current;
      const priceW = 62; // keep dots off the price axis
      const plotW = w - priceW;

      // normalize dot intensity against the day's max |g|
      let maxG = 0;
      for (const b of st.buckets) for (const n of b[st.scope]) maxG = Math.max(maxG, Math.abs(n.g));
      if (maxG === 0) return;

      const topK = st.dense ? 12 : 4;
      // One crisp dot per (bar, strike): buckets land between bars (2-min
      // captures vs 5m bars), so aggregate each bar's strongest reading per
      // strike first — overlapping translucent dots read as smears otherwise.
      const cells = new Map<string, { barT: number; k: number; g: number }>();
      for (const b of st.buckets) {
        // Snap to the containing bar: timeToCoordinate only maps bar times.
        const barT = Math.min(Math.floor(b.ts / st.bucketMs) * st.bucketMs, st.lastCandleT);
        const nodes = [...b[st.scope]].sort((a, z) => Math.abs(z.g) - Math.abs(a.g)).slice(0, topK);
        for (const n of nodes) {
          const key = `${barT}|${n.k}`;
          const cur = cells.get(key);
          if (!cur || Math.abs(n.g) > Math.abs(cur.g)) cells.set(key, { barT, k: n.k, g: n.g });
        }
      }
      const xCache = new Map<number, number | null>();
      for (const cell of cells.values()) {
        let x = xCache.get(cell.barT);
        if (x === undefined) {
          const coord = tsApi.timeToCoordinate(((cell.barT / 1000) + st.tzOff) as UTCTimestamp);
          x = coord == null ? null : coord;
          xCache.set(cell.barT, x);
        }
        if (x == null || x < 0 || x > plotW) continue;
        const y = series.priceToCoordinate(cell.k);
        if (y == null || y < 0 || y > h) continue;
        const mag = Math.abs(cell.g) / maxG;
        const col = cell.g >= 0 ? "201,165,90" : "185,138,230";
        // Skylit-style beads: size + opacity + glow all carry strength.
        const r = 2.5 + 4.5 * Math.pow(mag, 0.7);
        ctx.save();
        ctx.shadowColor = `rgba(${col},${0.5 * mag})`;
        ctx.shadowBlur = 10 * mag;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},${0.35 + 0.6 * mag})`;
        ctx.fill();
        ctx.restore();
      }

      // current nodes: band + right-edge label pill, crown on the strongest
      const last = st.buckets[st.buckets.length - 1];
      const cur = [...last[st.scope]].sort((a, z) => Math.abs(z.g) - Math.abs(a.g)).slice(0, topK);
      const kingK = cur.length ? cur[0].k : null;
      ctx.font = "600 9px ui-monospace, monospace";
      for (const n of cur) {
        const y = series.priceToCoordinate(n.k);
        if (y == null || y < 4 || y > h - 4) continue;
        const mag = Math.abs(n.g) / maxG;
        const col = n.g >= 0 ? GOLD : PURPLE;
        const grad = ctx.createLinearGradient(0, 0, plotW, 0);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, n.g >= 0 ? `rgba(201,165,90,${0.10 + 0.25 * mag})` : `rgba(185,138,230,${0.10 + 0.25 * mag})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y - 2.5, plotW, 5);
        // pill
        const side = n.k >= last.s ? "NODE" : "NODE · SUP";
        const label = `${n.k === kingK ? "♛ " : ""}${n.k} ${side}`;
        const tw = ctx.measureText(label).width + 10;
        // Mid-chart placement (Skylit-style) — right-edge pills collide with
        // the axis labels for walls/flip at the same price.
        const px = Math.max(10, plotW * 0.55 - tw / 2);
        ctx.fillStyle = "rgba(10,20,36,0.92)";
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px, y - 8, tw, 15, 4);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillText(label, px + 5, y + 3.5);
      }
    };
    raf = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      spotSeriesRef.current = null;
    };
  }, []);

  // ── data → series ──
  useEffect(() => {
    if (!data || !candleSeriesRef.current || !chartRef.current) return;
    const off = (t: number) => t / 1000 + tzOffsetSec(tz, new Date(t));
    candleSeriesRef.current.setData(
      data.candles.map((c) => ({ time: off(c.t) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })),
    );
    spotSeriesRef.current?.setData(data.liveSpot.map((p) => ({ time: off(p.t) as UTCTimestamp, value: p.p })));

    // walls / flip from the latest bucket
    for (const l of wallLinesRef.current) candleSeriesRef.current.removePriceLine(l);
    wallLinesRef.current = [];
    const lastBucket = buckets[buckets.length - 1];
    if (lastBucket) {
      const mk = (price: number | null, title: string, color: string) => {
        if (price == null || !Number.isFinite(price) || price <= 0) return;
        wallLinesRef.current.push(candleSeriesRef.current!.createPriceLine({
          price, title, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
        }));
      };
      mk(lastBucket.cw, "Call wall", UP);
      mk(lastBucket.pw, "Put wall", DOWN);
      mk(lastBucket.fl, "Flip", "#5AA9E6");
    }

    // Default zoom (~one RTH session) applies ONCE per ticker/tf selection —
    // never on the 10s refreshes, which would stomp the user's pan/zoom.
    // Double-clicking an axis restores the library's auto fit (built-in).
    const fitKey = `${ticker}|${tf}|${tz}`;
    if (fitDoneRef.current !== fitKey) {
      fitDoneRef.current = fitKey;
      const fitBars = tf === "1m" ? 390 : tf === "5m" ? 78 : tf === "10m" ? 39 : 0;
      if (fitBars > 0 && data.candles.length > fitBars) {
        const from = off(data.candles[data.candles.length - fitBars].t);
        const to = off(data.candles[data.candles.length - 1].t) + 1800;
        chartRef.current.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
      } else {
        chartRef.current.timeScale().fitContent();
      }
    }
  }, [data, tz, tf, ticker, buckets]);

  // mirror paint inputs
  useEffect(() => {
    stateRef.current = {
      buckets, scope, showNodes, dense,
      tzOff: tzOffsetSec(tz, new Date()),
      lastCandleT: data?.candles.length ? data.candles[data.candles.length - 1].t : 0,
      bucketMs: (tf === "1h" ? 60 : tf === "1m" ? 1 : tf === "5m" ? 5 : 10) * 60_000,
    };
  }, [buckets, scope, showNodes, dense, tz, data, tf]);

  // ── live forming bar: 1s poll of /api/gex/live ──
  // Source A ("worker"): true per-second forming 1m OHLCV + recent ring.
  // Source B ("snap"): Polygon snapshot — lastTrade ticks each second; we
  // accumulate them into a client-held forming bar. Either way the current
  // TF bucket is rebuilt from {server candles ∪ live 1m bars ∪ forming} and
  // series.update()d, so the candle grows tick-by-tick like TradingView.
  const fitDoneRef = useRef(""); // "ticker|tf|tz" that last received the default zoom
  const accRef = useRef<Candle | null>(null); // snapshot-mode forming accumulator
  useEffect(() => { accRef.current = null; }, [ticker, tf]); // keep across 10s data refetches
  useEffect(() => {
    if (!data) return;
    const tfMin = tf === "1h" ? 60 : tf === "1m" ? 1 : tf === "5m" ? 5 : 10;
    const bucketMs = tfMin * 60_000;
    let cancelled = false;

    const tick = async () => {
      if (document.hidden || cancelled) return;
      try {
        const r = await fetch(`/api/gex/live?ticker=${ticker}`);
        if (!r.ok) return;
        const live: { src: string; forming: Candle | null; recent: Candle[]; last: { p: number; t: number } | null } = await r.json();
        if (cancelled || !candleSeriesRef.current) return;
        if (live.src === "none") { setTick({ p: 0, at: Date.now(), src: "none" }); return; }

        let oneMin: Candle[] = [...(live.recent ?? [])];
        if (live.forming) {
          oneMin.push(live.forming);
        } else if (live.last) {
          // accumulate ticks into a forming bar (snapshot mode)
          const minute = Math.floor(live.last.t / 60_000) * 60_000;
          const acc = accRef.current;
          if (!acc || acc.t !== minute) {
            accRef.current = { t: minute, o: live.last.p, h: live.last.p, l: live.last.p, c: live.last.p, v: 0 };
          } else {
            acc.h = Math.max(acc.h, live.last.p);
            acc.l = Math.min(acc.l, live.last.p);
            acc.c = live.last.p;
          }
          oneMin.push({ ...accRef.current! });
        }
        if (!oneMin.length) return;

        const curBucket = Math.floor(oneMin[oneMin.length - 1].t / bucketMs) * bucketMs;
        // merge: server candles in this bucket + live 1m bars (live wins on dup minutes)
        const byMinute = new Map<number, Candle>();
        if (tf === "1m") {
          for (const b of oneMin) byMinute.set(b.t, b);
        } else {
          for (const c of data.candles) {
            // server candles are TF-aggregated; only the 1m-equivalent case matters
            if (Math.floor(c.t / bucketMs) * bucketMs === curBucket) byMinute.set(c.t, c);
          }
          for (const b of oneMin) if (Math.floor(b.t / bucketMs) * bucketMs === curBucket) byMinute.set(b.t, b);
        }
        const parts = [...byMinute.values()].filter((b) => Math.floor(b.t / bucketMs) * bucketMs === curBucket).sort((a, b) => a.t - b.t);
        if (!parts.length) return;
        const agg = parts.reduce((acc, b) => acc
          ? { t: acc.t, o: acc.o, h: Math.max(acc.h, b.h), l: Math.min(acc.l, b.l), c: b.c, v: acc.v + b.v }
          : { t: curBucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }, null as Candle | null)!;
        const time = (agg.t / 1000 + tzOffsetSec(tz, new Date(agg.t))) as UTCTimestamp;
        // never update() earlier than the last set() bar — lightweight-charts throws
        const lastT = data.candles.length ? data.candles[data.candles.length - 1].t : 0;
        if (agg.t >= Math.floor(lastT / bucketMs) * bucketMs) {
          candleSeriesRef.current.update({ time, open: agg.o, high: agg.h, low: agg.l, close: agg.c });
          setTick({ p: agg.c, at: Date.now(), src: live.src });
        }
      } catch { /* transient — the 10s poll still updates */ }
    };
    const id = setInterval(tick, 1_000);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [data, ticker, tf, tz]);

  const stale = data && Date.now() - data.asOf > 60_000;

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-[14px]" style={{ background: "var(--color-background-tertiary)" }}>
      <div className="flex flex-wrap items-center gap-[8px]" style={{ marginBottom: 10 }}>
        <select
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          className="rounded-md bg-bg-secondary px-[8px] py-[4px] text-[12px] text-text-primary outline-none"
          style={{ border: "0.5px solid var(--color-border-secondary)" }}
        >
          {TICKERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Seg options={TFS as unknown as string[]} value={tf} onChange={(v) => setTf(v as Tf)} />
        <Seg options={["front", "all"]} labels={["Front expiry", "All expiries"]} value={scope} onChange={(v) => setScope(v as "front" | "all")} />
        <Pill active={showNodes} onClick={() => setShowNodes(!showNodes)}>Nodes</Pill>
        <Pill active={dense} onClick={() => setDense(!dense)}>Dense</Pill>
        <span className="text-[10px]" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {tick && tick.src !== "none" && (
            <span style={{ color: GOLD2, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              <span style={{
                display: "inline-block", width: 6, height: 6, borderRadius: 3, marginRight: 5,
                background: Date.now() - tick.at < 4_000 ? UP : DOWN,
              }} />
              LIVE {tick.src} · {tick.p.toFixed(2)}
            </span>
          )}
          {tick?.src === "none" && <span style={{ color: DOWN, fontWeight: 600 }}>NO LIVE SOURCE</span>}
          <span className="text-text-tertiary">
            Tape delayed 15 min, ticking live · dotted tail = true-now spot
            {stale ? " · STALE" : ""}
          </span>
        </span>
      </div>
      <div className="relative flex-1 overflow-hidden rounded-md" style={{ border: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-primary)" }}>
        {error && <div className="absolute inset-0 z-10 flex items-center justify-center text-[12px] text-text-tertiary">Chart data unavailable</div>}
        {!data && !error && <div className="absolute inset-0 z-10 flex items-center justify-center text-[12px] text-text-tertiary">Loading…</div>}
        <div ref={chartElRef} className="absolute inset-0" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}

function Seg({ options, labels, value, onChange }: { options: string[]; labels?: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md" style={{ border: "0.5px solid var(--color-border-secondary)" }}>
      {options.map((o, i) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className="px-[9px] py-[4px] text-[11px] cursor-pointer"
          style={{
            background: o === value ? "rgba(201,165,90,0.16)" : "var(--color-background-secondary)",
            color: o === value ? GOLD2 : "var(--color-text-secondary)",
            fontWeight: o === value ? 600 : 400,
          }}
        >
          {labels?.[i] ?? o}
        </button>
      ))}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-[9px] py-[4px] text-[11px] cursor-pointer"
      style={{
        border: `0.5px solid ${active ? GOLD : "var(--color-border-secondary)"}`,
        background: active ? "rgba(201,165,90,0.16)" : "var(--color-background-secondary)",
        color: active ? GOLD2 : "var(--color-text-secondary)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
