"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import type { MarketTideSnapshot, NetImpactSnapshot } from "@/lib/mock/market-tide-data";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Filler);

type Payload = { tide: MarketTideSnapshot; netImpact: NetImpactSnapshot };

const HEADER_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function fmtPrem(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a}`;
}

function fmtVol(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

export function MarketTideView() {
  const [data, setData] = useState<Payload | null>(null);
  const [period, setPeriod] = useState<"1D" | "4H" | "1H">("1D");

  useEffect(() => {
    fetch("/api/market-tide").then(r => r.json()).then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-tertiary text-[12px]">
        Loading market tide…
      </div>
    );
  }

  const noTide = data.tide.series.length === 0;
  const headerDate = HEADER_DATE_FMT.format(new Date(data.tide.asOf));
  // "Live" only when the latest bucket is fresh (worker writes every 5 min
  // during RTH, so 10 min covers a missed poll). Otherwise we're showing
  // a prior session's data — pill should read "Closed" with that date.
  const lastBucketAgeMs = noTide ? Infinity : Date.now() - new Date(data.tide.asOf).getTime();
  const isLive = lastBucketAgeMs < 10 * 60 * 1000;

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ padding: 16, background: "var(--color-background-tertiary)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-[8px]" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
            Market Pulse
          </h1>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {headerDate} · {data.tide.asOfLabel} · SPY price vs net call/put premium flow, updated every 5 minutes
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <span
            className="rounded-full"
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "3px 11px",
              background: isLive ? "#E6F1FB" : "#F0EFEC",
              color: isLive ? "#185FA5" : "#6E6B62",
              border: `0.5px solid ${isLive ? "#185FA5" : "#9B9890"}`,
            }}
          >
            {isLive ? "● Live" : "● Closed"}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Source: Unusual Whales · market-tide</span>
        </div>
      </div>

      {/* Stats strip */}
      <div
        className="grid gap-[10px]"
        style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 12 }}
      >
        <Mc label="Volume (5-min bucket)" value={noTide ? "—" : fmtVol(data.tide.volumeCurrent)} sub="rolling" subColor="var(--color-text-secondary)" />
        <Mc label="Net call premium" value={noTide ? "—" : fmtPrem(data.tide.netCallPremiumCurrent)} valueColor="#3B6D11" sub="cumulative today" subColor="#3B6D11" />
        <Mc label="Net put premium" value={noTide ? "—" : fmtPrem(data.tide.netPutPremiumCurrent)} valueColor="#A32D2D" sub="cumulative today" subColor="#A32D2D" />
      </div>

      {/* Market Tide chart */}
      <Card>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
              Net premium flow
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
              Green = net call premium · Red = net put premium
            </div>
          </div>
          <PeriodPills period={period} onChange={setPeriod} />
        </div>
        <div style={{ height: 320 }}>
          {noTide ? (
            <div className="flex h-full items-center justify-center text-text-tertiary text-[12px]" style={{ color: "var(--color-text-tertiary)" }}>
              No market-tide data yet · check worker status
            </div>
          ) : (
            <TideChart snapshot={data.tide} />
          )}
        </div>
      </Card>

      {/* Top Net Impact chart */}
      <div style={{ height: 12 }} />
      <Card>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
              Top Net Impact
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
              Net options premium by ticker · green = bullish flow · red = bearish flow · {data.netImpact.period} window
            </div>
          </div>
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{data.netImpact.rows.length} tickers</span>
        </div>
        <div style={{ height: Math.max(360, data.netImpact.rows.length * 22) }}>
          <NetImpactChart snapshot={data.netImpact} />
        </div>
      </Card>
    </div>
  );
}

// =====================================================
// Market Tide line chart (dual Y-axis)
// =====================================================

function TideChart({ snapshot }: { snapshot: MarketTideSnapshot }) {
  const { chartData, options } = useMemo(() => {
    const labels = snapshot.series.map(p => p.time);
    const chartData: ChartData<"line"> = {
      labels,
      datasets: [
        {
          label: "Net call premium",
          data: snapshot.series.map(p => p.netCallPremium / 1_000_000),
          borderColor: "#3B6D11",
          backgroundColor: "rgba(59, 109, 17, 0.10)",
          borderWidth: 1.8,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
        },
        {
          label: "Net put premium",
          data: snapshot.series.map(p => p.netPutPremium / 1_000_000),
          borderColor: "#E24B4A",
          backgroundColor: "rgba(226, 75, 74, 0.08)",
          borderWidth: 1.8,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    };

    const options: ChartOptions<"line"> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => {
              const v = c.raw as number;
              const sign = v >= 0 ? "+" : "";
              return `${c.dataset.label}: ${sign}${v.toFixed(0)}M`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.04)" },
          ticks: { color: "#9B9890", font: { size: 10 }, maxTicksLimit: 10, maxRotation: 0 },
        },
        y: {
          position: "left",
          grid: { color: "rgba(0,0,0,0.04)" },
          ticks: {
            color: "#9B9890",
            font: { size: 10 },
            callback: v => {
              const n = Number(v);
              return `${n >= 0 ? "+" : ""}${n}M`;
            },
          },
          title: { display: true, text: "Net premium ($)", color: "#9B9890", font: { size: 10 } },
        },
      },
    };

    return { chartData, options };
  }, [snapshot]);

  return <Line data={chartData} options={options} />;
}

// =====================================================
// Top Net Impact horizontal bar chart
// =====================================================

function NetImpactChart({ snapshot }: { snapshot: NetImpactSnapshot }) {
  const { chartData, options } = useMemo(() => {
    // Sort descending so largest positive sits at top.
    const sorted = [...snapshot.rows].sort((a, b) => b.netPremium - a.netPremium);
    const labels = sorted.map(r => r.ticker);
    const values = sorted.map(r => r.netPremium / 1_000_000);
    const colors = sorted.map(r =>
      r.netPremium >= 0 ? "rgba(59, 109, 17, 0.85)" : "rgba(226, 75, 74, 0.85)"
    );

    const chartData: ChartData<"bar"> = {
      labels,
      datasets: [
        {
          label: "Net premium ($M)",
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          barThickness: 14,
          categoryPercentage: 0.95,
          barPercentage: 1,
        },
      ],
    };

    const options: ChartOptions<"bar"> = {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => {
              const v = c.raw as number;
              const sign = v >= 0 ? "+" : "";
              return `${sign}$${v.toFixed(1)}M`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.04)" },
          ticks: {
            color: "#9B9890",
            font: { size: 10 },
            callback: v => {
              const n = Number(v);
              return `${n >= 0 ? "+" : ""}${n}M`;
            },
          },
        },
        y: {
          grid: { display: false },
          ticks: {
            color: ctx => {
              const row = snapshot.rows.find(r => r.ticker === String(ctx.tick.label));
              if (!row) return "#9B9890";
              return row.netPremium >= 0 ? "#3B6D11" : "#A32D2D";
            },
            font: { size: 11, weight: 500 },
          },
        },
      },
    };

    return { chartData, options };
  }, [snapshot]);

  return <Bar data={chartData} options={options} />;
}

// =====================================================
// UI primitives
// =====================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 12,
        padding: "1rem 1.25rem",
      }}
    >
      {children}
    </div>
  );
}

function Mc({
  label,
  value,
  valueColor,
  sub,
  subColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub: string;
  subColor: string;
}) {
  return (
    <div className="rounded-md bg-bg-secondary" style={{ padding: ".7rem .9rem" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 500, color: valueColor ?? "var(--color-text-primary)" }}>{value}</div>
      <div style={{ fontSize: 10, marginTop: 1, color: subColor }}>{sub}</div>
    </div>
  );
}

function PeriodPills({
  period,
  onChange,
}: {
  period: "1D" | "4H" | "1H";
  onChange: (p: "1D" | "4H" | "1H") => void;
}) {
  return (
    <div
      className="inline-flex rounded-md bg-bg-secondary"
      style={{ padding: 2, gap: 1 }}
    >
      {(["1H", "4H", "1D"] as const).map(p => {
        const active = period === p;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            style={{
              fontSize: 11,
              padding: "4px 12px",
              borderRadius: 5,
              background: active ? "var(--color-background-primary)" : "transparent",
              color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              border: active ? "0.5px solid var(--color-border-tertiary)" : "none",
              cursor: "pointer",
              fontWeight: active ? 500 : 400,
            }}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}
