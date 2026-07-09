"use client";

// Lightweight Charts candlestick component for the /charts page. Wraps the
// imperative chart library: the chart instance is created once and updated
// imperatively from refs as props change. Renders the candle + volume series,
// the ranked-trade overlays (numbered bubbles + labeled price lines), a
// crosshair OHLC readout, a freshness pill, and the required TradingView
// attribution.

import { useEffect, useRef } from "react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  type MouseEventParams,
} from "lightweight-charts";
import type { Candle, RankedTrade } from "@/lib/candles";

// Generic horizontal level drawn by the page layer (GEX levels, Daily Watch
// targets) — the chart just renders whatever it's handed.
export interface ExtraLevel {
  price: number;
  title: string;
  color: string;
  style: "solid" | "dashed" | "dotted";
}

interface Props {
  candles: Candle[];
  trades: RankedTrade[];
  intraday: boolean; // 1H → show time on the axis
  showBubbles: boolean;
  bubbleRank: number;
  showLevels: boolean;
  levelRank: number;
  levelSince: number; // unix seconds
  extraLevels: ExtraLevel[]; // already filtered by the page's toggles
  // Expand the price autoscale so every extraLevel stays on screen (used by
  // the Watches chart so the full target ladder is visible).
  scaleToExtraLevels?: boolean;
  // Initial zoom: show only the last N bars instead of fitting all candles.
  fitBars?: number;
  lastFetched: number; // ms — drives the freshness pill
}

const UP = "#7FBF52";
const DOWN = "#E76A6A";
const GOLD = "#E2BF73";
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtVol = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
const fmtNot = (n: number) =>
  n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : "$" + (n / 1e6).toFixed(0) + "M";
const dstr = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

export function TickerPriceChart(props: Props) {
  const chartElRef = useRef<HTMLDivElement>(null);
  const bubbleLayerRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const freshRef = useRef<HTMLSpanElement>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const levelLinesRef = useRef<IPriceLine[]>([]);
  const extraLinesRef = useRef<IPriceLine[]>([]);
  const bubblesRef = useRef<{ el: HTMLDivElement; price: number; barTime: number }[]>([]);

  // Latest props/data, mirrored into refs so the imperative helpers (and the
  // rAF loop, which captures render-0's closures) always read current values.
  const propsRef = useRef(props);
  propsRef.current = props;

  function nearestBarTime(time: number): number | null {
    const bars = propsRef.current.candles;
    if (bars.length === 0) return null;
    let best = bars[0]!.time, bd = Infinity;
    for (const b of bars) {
      const d = Math.abs(b.time - time);
      if (d < bd) { bd = d; best = b.time; }
    }
    return best;
  }

  function updateReadout(c: Candle | null) {
    const el = readoutRef.current;
    if (!el) return;
    if (!c) { el.innerHTML = ""; return; }
    const cls = c.close >= c.open ? UP : DOWN;
    el.innerHTML =
      `<span>O <b>${fmt(c.open)}</b></span><span>H <b>${fmt(c.high)}</b></span>` +
      `<span>L <b>${fmt(c.low)}</b></span><span>C <b style="color:${cls}">${fmt(c.close)}</b></span>` +
      `<span>Vol <b>${fmtVol(c.volume)}</b></span>`;
  }

  function positionBubbles() {
    const chart = chartRef.current, cs = candleSeriesRef.current;
    if (!chart || !cs) return;
    const ts = chart.timeScale();
    for (const b of bubblesRef.current) {
      const x = ts.timeToCoordinate(b.barTime as UTCTimestamp);
      const y = cs.priceToCoordinate(b.price);
      if (x == null || y == null) { b.el.style.display = "none"; continue; }
      b.el.style.display = "flex";
      b.el.style.left = `${x}px`;
      b.el.style.top = `${y}px`;
    }
  }

  function drawBubbles() {
    const layer = bubbleLayerRef.current;
    if (!layer) return;
    layer.innerHTML = "";
    bubblesRef.current = [];
    const p = propsRef.current;
    if (!p.showBubbles || p.candles.length === 0) return;
    const first = p.candles[0]!.time, last = p.candles[p.candles.length - 1]!.time;
    for (const t of p.trades) {
      if (t.rank > p.bubbleRank) continue;
      if (t.time < first || t.time > last) continue; // outside this timeframe's window
      const barTime = nearestBarTime(t.time);
      if (barTime == null) continue;
      const el = document.createElement("div");
      el.textContent = String(t.rank);
      el.title = `Rank #${t.rank}  ·  ${fmtNot(t.notional)}  ·  $${fmt(t.price)}  ·  ${dstr(t.time)}`;
      el.style.cssText =
        "position:absolute;width:23px;height:23px;margin:-11.5px 0 0 -11.5px;border-radius:50%;" +
        "display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;" +
        "font-variant-numeric:tabular-nums;background:rgba(226,191,115,.92);color:#1a1410;" +
        "border:1px solid #f2dca4;box-shadow:0 1px 5px rgba(0,0,0,.55);pointer-events:auto;cursor:help;";
      layer.appendChild(el);
      bubblesRef.current.push({ el, price: t.price, barTime });
    }
    positionBubbles();
  }

  function drawLevels() {
    const cs = candleSeriesRef.current;
    if (!cs) return;
    for (const l of levelLinesRef.current) cs.removePriceLine(l);
    levelLinesRef.current = [];
    const p = propsRef.current;
    if (!p.showLevels) return;
    for (const t of p.trades) {
      if (t.rank > p.levelRank) continue;
      if (t.time < p.levelSince) continue;
      levelLinesRef.current.push(
        cs.createPriceLine({
          price: t.price,
          color: GOLD,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `#${t.rank}  ${fmtNot(t.notional)}`,
        }),
      );
    }
  }

  // ── create the chart once ─────────────────────────────────────────────
  useEffect(() => {
    if (!chartElRef.current) return;
    const chart = createChart(chartElRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#94a1b8",
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,.035)" },
        horzLines: { color: "rgba(255,255,255,.035)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(226,191,115,.4)", labelBackgroundColor: "#c9a55a" },
        horzLine: { color: "rgba(226,191,115,.4)", labelBackgroundColor: "#c9a55a" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,.08)" },
      timeScale: { borderColor: "rgba(255,255,255,.08)", timeVisible: false, secondsVisible: false },
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
      priceLineColor: GOLD, priceLineStyle: LineStyle.Dashed, priceLineWidth: 1,
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const res = original();
        const p = propsRef.current;
        if (!res?.priceRange || !p.scaleToExtraLevels || p.extraLevels.length === 0) return res;
        let { minValue, maxValue } = res.priceRange;
        for (const l of p.extraLevels) {
          if (l.price < minValue) minValue = l.price;
          if (l.price > maxValue) maxValue = l.price;
        }
        return { ...res, priceRange: { minValue, maxValue } };
      },
    });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.27 } });
    const volSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;

    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      const bars = propsRef.current.candles;
      if (!param.time) { updateReadout(bars[bars.length - 1] ?? null); return; }
      const hit = bars.find((b) => b.time === (param.time as unknown as number));
      if (hit) updateReadout(hit);
    });

    let raf = 0;
    const loop = () => { positionBubbles(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      levelLinesRef.current = [];
      extraLinesRef.current = [];
      bubblesRef.current = [];
    };
  }, []);

  // ── candle data ───────────────────────────────────────────────────────
  useEffect(() => {
    const cs = candleSeriesRef.current, vs = volSeriesRef.current, chart = chartRef.current;
    if (!cs || !vs || !chart) return;
    cs.setData(
      props.candles.map((c) => ({
        time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
      })),
    );
    vs.setData(
      props.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(127,191,82,.32)" : "rgba(231,106,106,.32)",
      })),
    );
    chart.applyOptions({ timeScale: { timeVisible: props.intraday } });
    if (props.fitBars && props.candles.length > props.fitBars) {
      chart.timeScale().setVisibleLogicalRange({
        from: props.candles.length - props.fitBars,
        to: props.candles.length + 2,
      });
    } else {
      chart.timeScale().fitContent();
    }
    updateReadout(props.candles[props.candles.length - 1] ?? null);
    drawBubbles();
    drawLevels();
    drawExtraLevels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.candles, props.intraday]);

  function drawExtraLevels() {
    const cs = candleSeriesRef.current;
    if (!cs) return;
    for (const l of extraLinesRef.current) cs.removePriceLine(l);
    extraLinesRef.current = [];
    for (const lv of propsRef.current.extraLevels) {
      extraLinesRef.current.push(
        cs.createPriceLine({
          price: lv.price,
          color: lv.color,
          lineWidth: 1,
          lineStyle: lv.style === "solid" ? LineStyle.Solid : lv.style === "dashed" ? LineStyle.Dashed : LineStyle.Dotted,
          axisLabelVisible: true,
          title: lv.title,
        }),
      );
    }
  }

  // ── overlays redraw on trade / filter changes ─────────────────────────
  useEffect(() => {
    drawBubbles();
    drawLevels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.trades, props.showBubbles, props.bubbleRank, props.showLevels, props.levelRank, props.levelSince]);

  // ── GEX / watch-target levels ─────────────────────────────────────────
  useEffect(() => {
    drawExtraLevels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.extraLevels]);

  // ── freshness pill ────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      if (!freshRef.current) return;
      const sec = Math.max(0, Math.floor((Date.now() - props.lastFetched) / 1000));
      freshRef.current.textContent =
        props.lastFetched === 0 ? "—"
        : sec < 90 ? `Updated ${sec}s ago`
        : `Updated ${Math.floor(sec / 60)}m ago`;
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [props.lastFetched]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={chartElRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={bubbleLayerRef}
        style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 4 }} />
      <div ref={readoutRef}
        style={{
          position: "absolute", top: 9, left: 12, zIndex: 6, display: "flex", gap: 13,
          fontSize: 11, color: "var(--color-text-secondary)", pointerEvents: "none",
          fontVariantNumeric: "tabular-nums",
        }} />
      <div style={{
        position: "absolute", bottom: 9, right: 13, zIndex: 6, display: "flex", alignItems: "center",
        gap: 6, fontSize: 10, color: UP, background: "rgba(8,13,24,.72)", padding: "3px 8px",
        borderRadius: 999, pointerEvents: "none",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: UP }} />
        <span ref={freshRef}>—</span>
      </div>
      <div style={{
        position: "absolute", bottom: 9, left: 12, zIndex: 6, fontSize: 9.5,
        color: "var(--color-text-tertiary)", pointerEvents: "none",
      }}>
        data: Polygon · charts by{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--color-text-tertiary)", textDecoration: "underline", pointerEvents: "auto" }}>
          TradingView Lightweight Charts
        </a>
      </div>
    </div>
  );
}
