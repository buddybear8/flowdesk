"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type Chart,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { FlowSentimentPayload, SentimentMinute, SentimentStrike, SentimentLabel } from "@/lib/types";
import { TRACKED_TICKERS } from "@/lib/tracked-tickers";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

// Focus names refresh every 5 min; the rest of the tracked corpus is polled
// hourly by the worker (see worker/src/lib/sentiment-tickers.ts). Both are
// selectable; the optgroups make the cadence difference explicit.
const HOT_TICKERS = ["SPY", "SPX", "QQQ", "TSLA", "NVDA", "AMD", "META", "AMZN", "GOOGL", "NFLX", "MSFT"];
const HOT_SET = new Set(HOT_TICKERS);
const TAIL_TICKERS = TRACKED_TICKERS.filter((t) => !HOT_SET.has(t));
const ALL_TICKERS = [...HOT_TICKERS, ...TAIL_TICKERS];
const ALL_SET = new Set(ALL_TICKERS);
const TICKER_RE = /^[A-Z]{1,5}$/;

const BUY_COLOR = "#3FB950";   // bought at ask  (green)
const SELL_COLOR = "#E5534B";  // sold at bid    (red)
const SPOT_LINE_COLOR = "#22D3EE";

type StrikeCount = "10" | "15" | "20" | "25" | "40";

// Side-accounting mode for the charts/cards:
//   all — bought-at-ask + sold-at-bid, both segments (the original view)
//   ask — bought-at-ask only; bid-side trades ignored entirely
//   net — ask minus bid per side; net buying renders green, net selling red
type SideMode = "all" | "ask" | "net";
const SIDE_MODE_KEY = "cs-sent-side-mode";

function applySideMode(strikes: SentimentStrike[], mode: SideMode): SentimentStrike[] {
  if (mode === "all") return strikes;
  if (mode === "ask") return strikes.map((s) => ({ ...s, cB: 0, pB: 0 }));
  return strikes.map((s) => {
    const cn = s.cA - s.cB, pn = s.pA - s.pB;
    return { ...s, cA: Math.max(cn, 0), cB: Math.max(-cn, 0), pA: Math.max(pn, 0), pB: Math.max(-pn, 0) };
  });
}

// Per-strike buy/sell ratio shown in the chart margins (call side left, put
// side right). NaN = no flow at that strike (label hidden).
const bsRatio = (buy: number, sell: number): number => (sell > 0 ? buy / sell : buy > 0 ? Infinity : NaN);
const fmtBS = (n: number): string => (Number.isNaN(n) ? "" : !Number.isFinite(n) ? "∞" : n >= 10 ? String(Math.round(n)) : n.toFixed(1));
const bsColor = (n: number): string => (n >= 1 ? BUY_COLOR : SELL_COLOR);

// ── helpers ──────────────────────────────────────────────────────────────────

function etDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// The last `count` weekdays (incl. today), as { date, label } — drives the
// HISTORY day tabs. Index 0 is today ("Live").
function recentWeekdays(count: number): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const cursor = new Date();
  while (out.length < count) {
    const dow = cursor.getUTCDay(); // approximate; ET weekday is close enough for labels
    const iso = etDateString(cursor);
    const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const label = new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      out.push({ date: iso, label });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    void dow;
  }
  return out;
}

// "13:35" (24h) → "1:35 PM"
function to12h(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  let h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// Centered pick on `k` (SentimentStrike uses `k`, not `.strike`).
function pickCentered(items: SentimentStrike[], spot: number, n: number): SentimentStrike[] {
  const asc = [...items].sort((a, b) => a.k - b.k);
  const below = asc.filter((s) => s.k < spot);
  const above = asc.filter((s) => s.k >= spot);
  const wantBelow = Math.floor(n / 2);
  const wantAbove = n - wantBelow;
  const takeAbove = Math.min(wantAbove + Math.max(0, wantBelow - below.length), above.length);
  const takeBelow = Math.min(wantBelow + Math.max(0, wantAbove - takeAbove), below.length);
  return [...below.slice(below.length - takeBelow), ...above.slice(0, takeAbove)];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

const SENTIMENT_STYLE: Record<SentimentLabel, { color: string; label: string }> = {
  BULLISH: { color: "#3FB950", label: "Bullish" },
  BEARISH: { color: "#E5534B", label: "Bearish" },
  NEUTRAL: { color: "#C9A55A", label: "Neutral" },
};

// ── spot line (interpolated across categorical strike axis) ──────────────────

// Draws each strike as a centered "pill" at the chart's zero line (x=0), so the
// prices sit in the middle gutter with CALLS extending left and PUTS right.
// Replaces the default edge y-axis labels (which are hidden).
const centerLabelPlugin: Plugin<"bar"> = {
  id: "centerLabels",
  afterDatasetsDraw(chart: Chart<"bar">) {
    const labels = chart.data.labels as (string | number)[] | undefined;
    if (!labels?.length) return;
    const { ctx } = chart;
    const zeroX = chart.scales.x.getPixelForValue(0);
    ctx.save();
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const h = 18;
    labels.forEach((lab, i) => {
      const yPx = chart.scales.y.getPixelForValue(i);
      const text = String(lab);
      const w = ctx.measureText(text).width + 16;
      const x = zeroX - w / 2;
      const yTop = yPx - h / 2;
      ctx.beginPath();
      if (typeof (ctx as CanvasRenderingContext2D).roundRect === "function") {
        (ctx as CanvasRenderingContext2D).roundRect(x, yTop, w, h, 5);
      } else {
        ctx.rect(x, yTop, w, h);
      }
      ctx.fillStyle = "#0d1626";
      ctx.fill();
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.stroke();
      ctx.fillStyle = "#E8EEF9";
      ctx.fillText(text, zeroX, yPx + 0.5);
    });
    ctx.restore();
  },
};

const spotLinePlugin: Plugin<"bar"> = {
  id: "spotLine",
  afterDatasetsDraw(chart: Chart<"bar">) {
    const opts = (chart.options.plugins as any)?.spotLine as
      | { spot: number; sortedStrikes: number[] }
      | undefined;
    if (!opts?.spot || !opts.sortedStrikes?.length || opts.sortedStrikes.length < 2) return;
    const { spot, sortedStrikes } = opts;
    const max = sortedStrikes[0]!;
    const min = sortedStrikes[sortedStrikes.length - 1]!;
    if (spot > max || spot < min) return;

    let yPx: number | null = null;
    for (let i = 0; i < sortedStrikes.length - 1; i++) {
      const upper = sortedStrikes[i]!;
      const lower = sortedStrikes[i + 1]!;
      if (upper >= spot && lower <= spot) {
        const range = upper - lower;
        const upperPx = chart.scales.y.getPixelForValue(i);
        const lowerPx = chart.scales.y.getPixelForValue(i + 1);
        const fraction = range === 0 ? 0 : (upper - spot) / range;
        yPx = upperPx + (lowerPx - upperPx) * fraction;
        break;
      }
    }
    if (yPx == null) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = SPOT_LINE_COLOR;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, yPx);
    ctx.lineTo(chartArea.right, yPx);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = SPOT_LINE_COLOR;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillText(`Spot $${spot.toFixed(2)}`, chartArea.left + 6, yPx - 3);
    ctx.restore();
  },
};

// Per-strike buy/sell ratios in the outer margins: call side on the left,
// put side on the right, aligned to each strike row. Drawn in the reserved
// layout padding so the bars are never crowded.
const marginRatioPlugin: Plugin<"bar"> = {
  id: "marginRatios",
  afterDatasetsDraw(chart: Chart<"bar">) {
    const opts = (chart.options.plugins as any)?.marginRatios as
      | { ratios: { c: number; p: number }[] }
      | undefined;
    if (!opts?.ratios?.length) return;
    const { ctx, chartArea } = chart;
    ctx.save();

    // Tiny column headers above the first row.
    ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#6b7c98";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "right";
    ctx.fillText("CALL B/S", chartArea.left - 6, chartArea.top - 3);
    ctx.textAlign = "left";
    ctx.fillText("PUT B/S", chartArea.right + 6, chartArea.top - 3);

    // One ratio per strike row, in the left/right gutters.
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    opts.ratios.forEach((r, i) => {
      const y = chart.scales.y.getPixelForValue(i);
      const cTxt = fmtBS(r.c);
      if (cTxt) {
        ctx.textAlign = "right";
        ctx.fillStyle = bsColor(r.c);
        ctx.fillText(cTxt, chartArea.left - 6, y);
      }
      const pTxt = fmtBS(r.p);
      if (pTxt) {
        ctx.textAlign = "left";
        ctx.fillStyle = bsColor(r.p);
        ctx.fillText(pTxt, chartArea.right + 6, y);
      }
    });
    ctx.restore();
  },
};

// ── component ────────────────────────────────────────────────────────────────

// compact: half-width embed (Daily Watches deep dive) — hides the title row
// and ticker input, tightens the grids. fixedTicker pins the ticker from the
// host instead of the URL/input.
export function FlowSentimentView({ compact = false, fixedTicker }: { compact?: boolean; fixedTicker?: string } = {}) {
  const days = useMemo(() => recentWeekdays(6), []);
  const liveDate = days[0]!.date;

  // Seed the ticker from ?ticker= (set when a row is clicked on the Market
  // dashboard); fall back to SPY.
  const urlTicker = useSearchParams().get("ticker")?.toUpperCase();
  const [ticker, setTicker] = useState(
    fixedTicker ?? (urlTicker && TICKER_RE.test(urlTicker) ? urlTicker : "SPY"),
  );
  useEffect(() => {
    if (fixedTicker) setTicker(fixedTicker);
  }, [fixedTicker]);
  const [date, setDate] = useState(liveDate);
  const [strikeCount, setStrikeCount] = useState<StrikeCount>("20");
  const [sideMode, setSideMode] = useState<SideMode>("all");
  useEffect(() => {
    try {
      const m = localStorage.getItem(SIDE_MODE_KEY);
      if (m === "ask" || m === "net" || m === "all") setSideMode(m);
    } catch { /* default */ }
  }, []);
  const changeSideMode = (m: SideMode) => {
    setSideMode(m);
    try { localStorage.setItem(SIDE_MODE_KEY, m); } catch { /* non-fatal */ }
  };
  const [data, setData] = useState<FlowSentimentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minuteIdx, setMinuteIdx] = useState(0);
  // True while the slider is parked on the latest minute — keeps a live view
  // pinned to "now" across auto-refreshes; scrubbing back unpins it.
  const followLatest = useRef(true);

  const isLive = date === liveDate;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/flow-sentiment?ticker=${ticker}&date=${date}`);
        if (cancelled) return;
        if (!res.ok) {
          setData(null);
          setError(res.status === 404 ? "No options sentiment data yet for this ticker/day." : "Failed to load.");
          return;
        }
        const payload: FlowSentimentPayload = await res.json();
        if (cancelled) return;
        setError(null);
        setData(payload);
        const lastIdx = Math.max(0, payload.minutes.length - 1);
        setMinuteIdx((prev) => (followLatest.current ? lastIdx : Math.min(prev, lastIdx)));
      } catch {
        if (!cancelled) setError("Failed to load.");
      }
    }
    load();
    // Live tab auto-refreshes; reads Postgres only (no extra UW cost).
    const id = isLive ? setInterval(load, 60_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [ticker, date, isLive]);

  // Reset to the latest minute when switching ticker/day.
  useEffect(() => {
    followLatest.current = true;
  }, [ticker, date]);

  const minutes = data?.minutes ?? [];
  const current: SentimentMinute | null = minutes[minuteIdx] ?? minutes[minutes.length - 1] ?? null;
  const spot = data?.spot ?? 0;

  const displayed = useMemo(
    () =>
      current
        ? applySideMode(pickCentered(current.strikes, spot, parseInt(strikeCount, 10)), sideMode).sort((a, b) => b.k - a.k)
        : [],
    [current, spot, strikeCount, sideMode],
  );

  // Whole-chain totals for the stat cards, in the selected mode. Net mode can
  // go negative on either side (net selling), so the ratio only renders when
  // both sides are net-bought.
  const chainTotals = useMemo(() => {
    let c = 0, p = 0;
    for (const st of current?.strikes ?? []) {
      c += sideMode === "all" ? st.cA + st.cB : sideMode === "ask" ? st.cA : st.cA - st.cB;
      p += sideMode === "all" ? st.pA + st.pB : sideMode === "ask" ? st.pA : st.pA - st.pB;
    }
    return { c, p, ratio: c > 0 && p > 0 ? c / p : null };
  }, [current, sideMode]);

  // Summary boxes — sum across the displayed strikes for the selected minute.
  const summary = useMemo(() => {
    let cBuy = 0, cSell = 0, pBuy = 0, pSell = 0;
    for (const s of displayed) {
      cBuy += s.cA; cSell += s.cB; pBuy += s.pA; pSell += s.pB;
    }
    return {
      cBuy, cSell, pBuy, pSell,
      cRatio: cSell > 0 ? cBuy / cSell : 0,
      pRatio: pSell > 0 ? pBuy / pSell : 0,
    };
  }, [displayed]);

  function onScrub(idx: number) {
    setMinuteIdx(idx);
    followLatest.current = idx >= minutes.length - 1;
  }

  return (
    <div className="flex-1 overflow-y-auto p-[14px]" style={{ background: "var(--color-background-tertiary)" }}>
      {/* Title + ticker + day tabs */}
      {!compact && (
        <div className="flex flex-wrap items-start justify-between gap-[8px]" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
              Options sentiment — per-strike buy vs sell
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
              Bought at ask <span style={{ color: BUY_COLOR }}>(green)</span> vs sold at bid{" "}
              <span style={{ color: SELL_COLOR }}>(red)</span> · cumulative through the session
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-[7px]">
            <TickerInput value={ticker} onChange={setTicker} />
          </div>
        </div>
      )}

      {/* HISTORY day tabs */}
      <div className="flex flex-wrap items-center gap-[6px]" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--color-text-tertiary)", marginRight: 4 }}>
          History
        </span>
        {days.map((d, i) => {
          const active = d.date === date;
          const isLiveTab = i === 0;
          return (
            <button
              key={d.date}
              onClick={() => setDate(d.date)}
              className="rounded-full"
              style={{
                fontSize: 11,
                padding: "4px 11px",
                cursor: "pointer",
                border: `0.5px solid ${active ? "var(--color-brand-gold, #C9A55A)" : "var(--color-border-secondary)"}`,
                background: active ? "rgba(201,165,90,0.16)" : "var(--color-background-primary)",
                color: active ? "var(--color-brand-gold, #C9A55A)" : "var(--color-text-secondary)",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}
            >
              {isLiveTab && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3FB950", display: "inline-block" }} />}
              {isLiveTab ? "Live" : d.label}
            </button>
          );
        })}
      </div>

      {error || !data || !current ? (
        <div className="flex items-center justify-center text-text-tertiary" style={{ fontSize: 12, height: 240 }}>
          {error ?? "Loading…"}
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid gap-[8px]" style={{ gridTemplateColumns: `repeat(${compact ? 2 : 4}, minmax(0, 1fr))`, marginBottom: 12 }}>
            <Mc label={sideMode === "net" ? "NET CALL VOL" : "CALL VOL"} value={fmt(chainTotals.c)} valueColor="#5AA9E6" />
            <Mc label={sideMode === "net" ? "NET PUT VOL" : "PUT VOL"} value={fmt(chainTotals.p)} valueColor="#B98AE6" />
            <Mc label="C/P RATIO" value={chainTotals.ratio !== null ? chainTotals.ratio.toFixed(2) : "—"} valueColor="#E2BF73" />
            <Mc label="SENTIMENT" value={SENTIMENT_STYLE[current.sentiment].label} valueColor={SENTIMENT_STYLE[current.sentiment].color} />
          </div>

          {/* Time slider */}
          <Card>
            <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
              <SectionLabel>{isLive ? "Replay — drag to scrub the session" : "Replay"}</SectionLabel>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)" }}>
                {to12h(current.t)} ET
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, minutes.length - 1)}
              value={minuteIdx}
              onChange={(e) => onScrub(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#C9A55A", cursor: "pointer" }}
            />
            <div className="flex justify-between" style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2 }}>
              <span>{minutes[0] ? to12h(minutes[0].t) : ""}</span>
              <span>{minutes.length} snapshots</span>
              <span>{minutes[minutes.length - 1] ? to12h(minutes[minutes.length - 1]!.t) : ""}</span>
            </div>
          </Card>

          {/* Chart + summary boxes — side column in full view, stacked below
              the chart in the compact half-width embed */}
          <div className="grid gap-[12px]" style={{ gridTemplateColumns: compact ? "1fr" : "1fr 200px", marginTop: 12 }}>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-[7px]" style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {ticker} — CALLS&nbsp;←&nbsp;&nbsp;→&nbsp;PUTS
                </div>
                <div className="flex flex-wrap items-center gap-[10px]">
                  <Legend />
                  <SideModeToggle value={sideMode} onChange={changeSideMode} />
                  <StrikeCountToggle value={strikeCount} onChange={setStrikeCount} />
                </div>
              </div>
              <div style={{ position: "relative", width: "100%", height: Math.max(320, displayed.length * 26) }}>
                <SentimentBarChart strikes={displayed} spot={spot} mode={sideMode} />
              </div>
            </Card>

            <div
              className={compact ? "grid gap-[10px]" : "flex flex-col gap-[10px]"}
              style={compact ? { gridTemplateColumns: "1fr 1fr" } : undefined}
            >
              <SummaryBox title="CALLS" buy={summary.cBuy} sell={summary.cSell} ratio={summary.cRatio} count={displayed.length} mode={sideMode} />
              <SummaryBox title="PUTS" buy={summary.pBuy} sell={summary.pSell} ratio={summary.pRatio} count={displayed.length} mode={sideMode} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── chart ────────────────────────────────────────────────────────────────────

function SentimentBarChart({ strikes, spot, mode }: { strikes: SentimentStrike[]; spot: number; mode: SideMode }) {
  const { chartData, options } = useMemo(() => {
    // Plain strike numbers — rendered as centered pills by centerLabelPlugin.
    const labels = strikes.map((s) => s.k.toLocaleString());
    // Symmetric x-range with a central gutter: a transparent spacer of `gutter`
    // sits at the base of each side, so call bars start at -gutter and put bars
    // at +gutter — leaving a clean middle column for the strike pills instead of
    // bars running under the numbers.
    const maxSide = strikes.reduce(
      (m, s) => Math.max(m, s.cA + s.cB, s.pA + s.pB),
      1,
    );
    const gutter = maxSide * 0.16;
    const axisMax = (maxSide + gutter) * 1.03;
    const bar = { stack: "stack", borderWidth: 0, categoryPercentage: 0.82, barPercentage: 0.96 } as const;
    const spacer = { ...bar, backgroundColor: "transparent" };
    // Calls render to the LEFT (negative x), puts to the RIGHT (positive x).
    // Buy (ask) and sell (bid) are stacked segments of each side's bar.
    // Order matters: within each sign Chart.js stacks in dataset order, so the
    // transparent gap must come first (nearest zero) on each side.
    const datasets: ChartData<"bar">["datasets"] = [
      { label: "_callGap", data: strikes.map(() => -gutter), ...spacer },
      { label: "Call buy", data: strikes.map((s) => -s.cA), backgroundColor: BUY_COLOR, ...bar },
      { label: "Call sell", data: strikes.map((s) => -s.cB), backgroundColor: SELL_COLOR, ...bar },
      { label: "_putGap", data: strikes.map(() => gutter), ...spacer },
      { label: "Put buy", data: strikes.map((s) => s.pA), backgroundColor: BUY_COLOR, ...bar },
      { label: "Put sell", data: strikes.map((s) => s.pB), backgroundColor: SELL_COLOR, ...bar },
    ];
    const chartData: ChartData<"bar"> = { labels, datasets };
    const sortedStrikes = strikes.map((s) => s.k);
    // Buy/sell ratio per strike, aligned to row order, for the margin labels.
    // Buy/sell ratios are only meaningful when both sides are present — in
    // ask-only and net modes the divisor is zeroed by construction, so the
    // margin labels are suppressed instead of printing a wall of infinities.
    const ratios = mode === "all" ? strikes.map((s) => ({ c: bsRatio(s.cA, s.cB), p: bsRatio(s.pA, s.pB) })) : [];
    const options: ChartOptions<"bar"> = {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // Reserve gutters for the per-strike buy/sell ratio labels + headers.
      layout: { padding: { left: 52, right: 52, top: 18 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !String(item.dataset.label).startsWith("_"),
          callbacks: {
            title: (c) => `Strike ${c[0]!.label}`,
            label: (c) => `${c.dataset.label}: ${Math.abs(Math.round(c.raw as number)).toLocaleString()}`,
          },
        },
        spotLine: { spot, sortedStrikes },
        marginRatios: { ratios },
      } as ChartOptions<"bar">["plugins"],
      scales: {
        x: {
          stacked: true,
          min: -axisMax,
          max: axisMax,
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: {
            color: "#6b7c98",
            font: { size: 9 },
            callback: (v) => Math.abs(Number(v)).toLocaleString(),
          },
        },
        y: {
          stacked: true,
          grid: { color: "rgba(255,255,255,0.04)" },
          // Strike labels are drawn centered by centerLabelPlugin — hide the
          // default edge ticks.
          ticks: { display: false },
        },
      },
    };
    return { chartData, options };
  }, [strikes, spot, mode]);

  return <Bar data={chartData} options={options} plugins={[spotLinePlugin, centerLabelPlugin, marginRatioPlugin]} />;
}

// ── small components (match GexView styling) ─────────────────────────────────

function SummaryBox({ title, buy, sell, ratio, count, mode }: { title: string; buy: number; sell: number; ratio: number; count: number; mode: SideMode }) {
  return (
    <div className="rounded-[12px] bg-bg-primary" style={{ border: "0.5px solid var(--color-border-tertiary)", padding: "0.85rem" }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 2 }}>All {count} strikes</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>{title}</div>
      {mode === "ask" ? (
        <>
          <Row label="Bought at ask" value={fmt(buy)} color={BUY_COLOR} />
          <Row label="Sold at bid" value="ignored" />
        </>
      ) : mode === "net" ? (
        <>
          <Row label="Net buying" value={fmt(buy)} color={BUY_COLOR} />
          <Row label="Net selling" value={fmt(sell)} color={SELL_COLOR} />
          <div style={{ height: 1, background: "var(--color-border-tertiary)", margin: "7px 0" }} />
          <Row label="Ratio" value={sell > 0 ? ratio.toFixed(2) : "—"} color={ratio >= 1 ? BUY_COLOR : SELL_COLOR} bold />
        </>
      ) : (
        <>
          <Row label="Buy" value={fmt(buy)} color={BUY_COLOR} />
          <Row label="Sell" value={fmt(sell)} color={SELL_COLOR} />
          <div style={{ height: 1, background: "var(--color-border-tertiary)", margin: "7px 0" }} />
          <Row label="Ratio" value={sell > 0 ? ratio.toFixed(2) : "∞"} color={ratio >= 1 ? BUY_COLOR : SELL_COLOR} bold />
        </>
      )}
    </div>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between" style={{ fontSize: 12, padding: "2px 0" }}>
      <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: color ?? "var(--color-text-primary)" }}>{value}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-[10px]" style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
      <span className="inline-flex items-center gap-[4px]">
        <span style={{ width: 9, height: 9, borderRadius: 2, background: BUY_COLOR, display: "inline-block" }} /> Buy
      </span>
      <span className="inline-flex items-center gap-[4px]">
        <span style={{ width: 9, height: 9, borderRadius: 2, background: SELL_COLOR, display: "inline-block" }} /> Sell
      </span>
    </div>
  );
}

function SideModeToggle({ value, onChange }: { value: SideMode; onChange: (m: SideMode) => void }) {
  const OPTS: { id: SideMode; label: string; title: string }[] = [
    { id: "all", label: "All", title: "Bought at ask + sold at bid (everything traded)" },
    { id: "ask", label: "Ask-only", title: "Bought-at-ask only — bid-side trades ignored" },
    { id: "net", label: "Net", title: "Ask minus bid per side — green = net buying, red = net selling" },
  ];
  return (
    <div className="inline-flex rounded-md bg-bg-secondary" style={{ padding: 2, gap: 1 }}>
      {OPTS.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.title}
          className="text-[10px]"
          style={{
            padding: "3px 8px",
            borderRadius: 5,
            background: value === o.id ? "var(--color-background-primary)" : "transparent",
            color: value === o.id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            border: value === o.id ? "0.5px solid var(--color-border-tertiary)" : "0.5px solid transparent",
            fontWeight: value === o.id ? 600 : 400,
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StrikeCountToggle({ value, onChange }: { value: StrikeCount; onChange: (c: StrikeCount) => void }) {
  return (
    <div className="inline-flex rounded-md bg-bg-secondary" style={{ padding: 2, gap: 1 }}>
      {(["10", "15", "20", "25", "40"] as StrikeCount[]).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="text-[10px]"
          style={{
            padding: "3px 8px",
            borderRadius: 5,
            background: value === c ? "var(--color-background-primary)" : "transparent",
            color: value === c ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            border: value === c ? "0.5px solid var(--color-border-tertiary)" : "0.5px solid transparent",
            cursor: "pointer",
          }}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

// Type-to-search ticker box. Any valid symbol (1–5 letters) works; the tracked
// universe shows as native autocomplete suggestions. Commits on exact match
// (incl. picking a suggestion) and on Enter/blur.
function TickerInput({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);

  const commit = (raw: string) => {
    const v = raw.trim().toUpperCase();
    if (TICKER_RE.test(v) && v !== value) onChange(v);
  };

  return (
    <>
      <input
        list="fs-ticker-list"
        value={text}
        onChange={(e) => {
          const up = e.target.value.toUpperCase();
          setText(up);
          if (ALL_SET.has(up)) commit(up); // instant on a suggestion pick / known symbol
        }}
        onKeyDown={(e) => { if (e.key === "Enter") commit(text); }}
        onBlur={() => commit(text)}
        placeholder="Ticker…"
        spellCheck={false}
        autoComplete="off"
        className="rounded-md outline-none bg-bg-primary"
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: ".02em",
          padding: "5px 9px",
          width: 96,
          textTransform: "uppercase",
          border: "0.5px solid var(--color-border-secondary)",
          color: "var(--color-text-primary)",
        }}
      />
      <datalist id="fs-ticker-list">
        {ALL_TICKERS.map((t) => <option key={t} value={t} />)}
      </datalist>
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg-primary rounded-[12px]" style={{ border: "0.5px solid var(--color-border-tertiary)", padding: "1rem" }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: ".04em" }}>
      {children}
    </div>
  );
}

function Mc({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-md bg-bg-secondary" style={{ padding: ".7rem .9rem" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: valueColor ?? "var(--color-text-primary)" }}>{value}</div>
    </div>
  );
}
