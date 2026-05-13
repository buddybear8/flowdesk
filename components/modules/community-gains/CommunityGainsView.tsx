"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
);

// Palette mirrors the Champagne Sessions brand and the matplotlib export.
const GOLD = "#C9A55A";
const MINT = "#5FD29C";
const NAVY_PANEL = "#0F2040";
const TEXT_PRIMARY = "#F1ECDF";
const TEXT_MUTED = "#A8A496";
const GRID = "rgba(255, 255, 255, 0.06)";

type MonthlyPoint = {
  month: string;       // "YYYY-MM"
  monthly: number;     // dollars added this month
  cumulative: number;  // running total through this month
};

type CommunityGainsPayload = {
  lifetime_total: number;
  screenshot_count: number;
  date_range: { start: string | null; end: string | null };
  updated_at: string;
  monthly: MonthlyPoint[];
};

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatMonth(ym: string): string {
  // "2024-08" -> "Aug 2024"
  const [y, m] = ym.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function axisTickMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

export function CommunityGainsView() {
  const [data, setData] = useState<CommunityGainsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/community-gains.json", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message ?? String(e)));
  }, []);

  const cumulativeChart: ChartData<"line"> | null = useMemo(() => {
    if (!data) return null;
    return {
      labels: data.monthly.map((p) => p.month),
      datasets: [
        {
          label: "Cumulative",
          data: data.monthly.map((p) => p.cumulative),
          borderColor: MINT,
          backgroundColor: "rgba(95, 210, 156, 0.14)",
          pointBackgroundColor: MINT,
          pointBorderColor: MINT,
          pointRadius: 3,
          pointHoverRadius: 6,
          tension: 0.18,
          fill: true,
          borderWidth: 2,
        },
      ],
    };
  }, [data]);

  const monthlyChart: ChartData<"bar"> | null = useMemo(() => {
    if (!data) return null;
    return {
      labels: data.monthly.map((p) => p.month),
      datasets: [
        {
          label: "Monthly",
          data: data.monthly.map((p) => p.monthly),
          backgroundColor: "rgba(95, 210, 156, 0.78)",
          borderColor: MINT,
          borderWidth: 0,
          borderRadius: 2,
        },
      ],
    };
  }, [data]);

  const cumulativeOptions: ChartOptions<"line"> = useMemo(() => {
    const monthlyByLabel = new Map(data?.monthly.map((p) => [p.month, p]) ?? []);
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: {
          backgroundColor: "#162947",
          borderColor: "rgba(201, 165, 90, 0.45)",
          borderWidth: 1,
          padding: 10,
          titleColor: GOLD,
          bodyColor: TEXT_PRIMARY,
          displayColors: false,
          callbacks: {
            title: (items) => formatMonth(String(items[0]?.label ?? "")),
            label: (item) => {
              const point = monthlyByLabel.get(String(item.label));
              const cumulative = point?.cumulative ?? 0;
              const monthly = point?.monthly ?? 0;
              return [
                `Cumulative: ${formatMoney(cumulative)}`,
                `This month:  ${monthly >= 0 ? "+" : ""}${formatMoney(monthly)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: TEXT_MUTED,
            callback: (_, idx) => {
              const ym = data?.monthly[idx]?.month;
              if (!ym) return "";
              const month = Number(ym.split("-")[1]);
              return [1, 4, 7, 10].includes(month) ? formatMonth(ym) : "";
            },
            maxRotation: 0,
            autoSkip: false,
          },
          grid: { color: GRID },
        },
        y: {
          beginAtZero: true,
          ticks: { color: TEXT_MUTED, callback: (v) => axisTickMoney(Number(v)) },
          grid: { color: GRID },
        },
      },
    };
  }, [data]);

  const monthlyOptions: ChartOptions<"bar"> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        backgroundColor: "#162947",
        borderColor: "rgba(201, 165, 90, 0.45)",
        borderWidth: 1,
        padding: 10,
        titleColor: GOLD,
        bodyColor: TEXT_PRIMARY,
        displayColors: false,
        callbacks: {
          title: (items) => formatMonth(String(items[0]?.label ?? "")),
          label: (item) => {
            const y = (item.parsed.y as number) ?? 0;
            return `${y >= 0 ? "+" : ""}${formatMoney(y)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: TEXT_MUTED,
          callback: (_, idx) => {
            const ym = data?.monthly[idx]?.month;
            if (!ym) return "";
            const month = Number(ym.split("-")[1]);
            return [1, 4, 7, 10].includes(month) ? formatMonth(ym) : "";
          },
          maxRotation: 0,
          autoSkip: false,
        },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: TEXT_MUTED, callback: (v) => axisTickMoney(Number(v)) },
        grid: { color: GRID },
      },
    },
  }), [data]);

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6">
      <header className="mb-4 flex items-baseline gap-4">
        <h1 className="text-[22px] font-semibold" style={{ color: GOLD, letterSpacing: "0.01em" }}>
          Champagne Sessions Verified Community Gains
        </h1>
        {data && (
          <span className="text-[11px]" style={{ color: TEXT_MUTED }}>
            Updated {new Date(data.updated_at).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        )}
      </header>

      {error && (
        <div
          className="mb-4 rounded-md p-4 text-[12px]"
          style={{ background: "rgba(231, 106, 106, 0.10)", color: "#E76A6A" }}
        >
          Failed to load /community-gains.json: {error}
        </div>
      )}

      {!data && !error && (
        <div className="text-[12px]" style={{ color: TEXT_MUTED }}>
          Loading…
        </div>
      )}

      {data && (
        <>
          <section className="mb-4 grid grid-cols-2 gap-3">
            <StatCard
              label="Lifetime verified"
              value={formatMoney(data.lifetime_total)}
              accent
            />
            <StatCard
              label="Date range"
              value={
                data.date_range.start && data.date_range.end
                  ? `${formatMonth(data.date_range.start)} – ${formatMonth(data.date_range.end)}`
                  : "—"
              }
            />
          </section>

          <section
            className="mb-3 rounded-lg p-4"
            style={{ background: NAVY_PANEL, border: "0.5px solid var(--color-border-tertiary)" }}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-[12px]" style={{ color: TEXT_MUTED }}>Cumulative</div>
              <div className="text-[10px]" style={{ color: TEXT_MUTED }}>Hover for monthly details</div>
            </div>
            <div style={{ height: 360 }}>
              {cumulativeChart && <Line data={cumulativeChart} options={cumulativeOptions} />}
            </div>
          </section>

          <section
            className="rounded-lg p-4"
            style={{ background: NAVY_PANEL, border: "0.5px solid var(--color-border-tertiary)" }}
          >
            <div className="mb-2 text-[12px]" style={{ color: TEXT_MUTED }}>Monthly contribution</div>
            <div style={{ height: 180 }}>
              {monthlyChart && <Bar data={monthlyChart} options={monthlyOptions} />}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: NAVY_PANEL,
        border: "0.5px solid var(--color-border-tertiary)",
      }}
    >
      <div className="text-[10px] uppercase tracking-wide" style={{ color: TEXT_MUTED, letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div
        className="mt-1 text-[20px] font-semibold"
        style={{ color: accent ? GOLD : TEXT_PRIMARY }}
      >
        {value}
      </div>
    </div>
  );
}
