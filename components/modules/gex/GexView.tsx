"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { clsx } from "clsx";
import type { GEXPayload } from "@/lib/types";
import { gexLabels } from "@/lib/mock/gex-data";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

type StrikeCount = "5" | "10" | "15" | "20" | "25" | "40" | "50";

// Vanna and Charm tabs were hidden from the production UI — UW Basic doesn't
// expose those endpoints. Reactivation: add Greek state + the tab pill group
// back, restore the explainer map (see git history) once data is wired.
const GEX_EXPLAINER = "Gamma Exposure (GEX) shows dealer hedging pressure per 1% move. Positive = dealers long gamma (vol suppressor). Negative = dealers short gamma (vol amplifier).";

const TICKERS = ["SPY", "QQQ", "SPX", "NVDA", "TSLA"];

// Pick the actual strike nearest to spot from the API's strike array.
// Falls back to rounded spot when no strikes were returned (e.g. UW gave
// us a snapshot with nothing in the ±10% window).
function atmStrike(data: GEXPayload): number {
  const spot = data.keyLevels.spot;
  if (!data.strikes.length) return Math.round(spot);
  return data.strikes.reduce((best, s) =>
    Math.abs(s.strike - spot) < Math.abs(best.strike - spot) ? s : best
  ).strike;
}

export function GexView() {
  const [ticker, setTicker] = useState<string>("SPY");
  const [showDV, setShowDV] = useState(true);
  const [showOI, setShowOI] = useState(true);
  const [strikeCount, setStrikeCount] = useState<StrikeCount>("25");
  const [data, setData] = useState<GEXPayload | null>(null);

  useEffect(() => {
    fetch(`/api/gex?ticker=${ticker}`)
      .then(r => r.json())
      .then(setData);
  }, [ticker]);

  const labels = gexLabels(ticker);

  if (!data) {
    return <div className="flex flex-1 items-center justify-center text-text-tertiary text-[12px]">Loading GEX…</div>;
  }

  const pos = data.gammaRegime === "POSITIVE";

  return (
    <div
      className="flex-1 overflow-y-auto p-[14px]"
      style={{ background: "var(--color-background-tertiary)" }}
    >
      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-[8px]" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
            Spot gamma exposure — GEX overview
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Via Unusual Whales API · Real-time · Apr 21, 2026
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-[7px]">
          <Select value={ticker} options={TICKERS.map(t => ({ id: t, label: t }))} onChange={setTicker} />
          <Select value="all" options={[{ id: "all", label: "All expirations" }, { id: "0dte", label: "0DTE only" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }]} onChange={() => {}} />
        </div>
      </div>

      {/* Explainer bar */}
      <div
        style={{
          borderRadius: "0 8px 8px 0",
          padding: "7px 11px",
          marginBottom: 10,
          fontSize: 11,
          color: "var(--color-text-secondary)",
          lineHeight: 1.55,
          borderLeft: `3px solid #C9A55A`,
          background: "var(--color-background-secondary)",
        }}
      >
        {GEX_EXPLAINER}
      </div>

      {/* 5 metric cards */}
      <div className="grid gap-[8px]" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 12 }}>
        <Mc label="Net GEX (OI)" value={labels.o1} valueColor={pos ? "#7FBF52" : "#E76A6A"} sub={`${pos ? "Positive" : "Negative"} regime`} subColor={pos ? "#7FBF52" : "#E76A6A"} />
        <Mc label="Gamma flip" value={`$${data.keyLevels.gammaFlip.toLocaleString()}`} valueColor="#E2BF73" sub={`${Math.abs(data.keyLevels.spot - data.keyLevels.gammaFlip).toFixed(0)}pts ${data.keyLevels.spot > data.keyLevels.gammaFlip ? "below" : "above"} spot`} subColor="#E2BF73" />
        <Mc label="Call wall" value={`$${data.keyLevels.callWall.toLocaleString()}`} valueColor="#7FBF52" sub="Resistance" subColor="var(--color-text-secondary)" />
        <Mc label="Put wall" value={`$${data.keyLevels.putWall.toLocaleString()}`} valueColor="#E76A6A" sub="Support" subColor="var(--color-text-secondary)" />
        <Mc label="Max pain" value={`$${data.keyLevels.maxPain.toLocaleString()}`} sub="Pinning target" subColor="var(--color-text-secondary)" />
      </div>

      {/* Chart + details */}
      <div className="grid gap-[12px]" style={{ gridTemplateColumns: "1fr 240px" }}>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-[7px]" style={{ marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                Net GEX by strike — {ticker}
              </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
                    Positive = dealer long · Negative = dealer short
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-[7px]">
                  <StrikeCountToggle value={strikeCount} onChange={setStrikeCount} />
                  <SeriesButton active={showDV} onClick={() => { if (!(showOI || !showDV)) return; setShowDV(v => !v); }} activeClass="on-dv" color="#378ADD" label="Dir. volume" />
                  <SeriesButton active={showOI} onClick={() => { if (!(showDV || !showOI)) return; setShowOI(v => !v); }} activeClass="on-oi" color="#7F77DD" label="Open interest" />
                </div>
              </div>
              <div style={{ position: "relative", width: "100%", height: 340 }}>
                <GexBarChart data={data} showDV={showDV} showOI={showOI} strikeCount={strikeCount} />
              </div>
            </Card>

            <Card>
          <SectionLabel>Details</SectionLabel>
          <DlRows rows={[["Ticker", ticker], ["ATM strike", `~$${atmStrike(data).toLocaleString()}`], ["Spot", `$${data.keyLevels.spot.toFixed(2)}`]]} />
          <SectionLabel>Open interest</SectionLabel>
          <DlRows
            rows={[["Gamma per 1% move", labels.o1], ["Net GEX", labels.o2]]}
            valueColor={pos ? "#7FBF52" : "#E76A6A"}
          />
          <SectionLabel>Gamma regime</SectionLabel>
          <div
            className="inline-flex items-center gap-[5px] font-medium"
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 20,
              marginBottom: 7,
              background: pos ? "rgba(127, 191, 82, 0.14)" : "rgba(231, 106, 106, 0.14)",
              color: pos ? "#7FBF52" : "#E76A6A",
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: pos ? "#7FBF52" : "#E76A6A" }} />
            {pos ? "Positive gamma" : "Negative gamma"}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.55, marginBottom: 10 }}>
            {pos
              ? "Dealers net long gamma. Expect vol suppression near high-GEX strikes."
              : "Dealers net short gamma. Hedging amplifies moves and widens ranges."}
          </div>
          <SectionLabel>Key levels</SectionLabel>
          {[
            { name: "Call wall", px: data.keyLevels.callWall, color: "#7FBF52", bg: "rgba(127, 191, 82, 0.14)", text: "#7FBF52" },
            { name: "Spot", px: data.keyLevels.spot, color: "#378ADD", bg: "rgba(201, 165, 90, 0.18)", text: "#C9A55A" },
            { name: "Gamma flip", px: data.keyLevels.gammaFlip, color: "#C9A55A", bg: "#FAEEDA", text: "#633806" },
            { name: "Max pain", px: data.keyLevels.maxPain, color: "#888780", bg: "#F1EFE8", text: "#A8A496" },
            { name: "Put wall", px: data.keyLevels.putWall, color: "#E76A6A", bg: "rgba(231, 106, 106, 0.14)", text: "#E76A6A" },
          ]
            .sort((a, b) => b.px - a.px)
            .map(l => (
              <div
                key={l.name}
                className="flex items-center gap-[7px] rounded-md"
                style={{ padding: "4px 7px", marginBottom: 3, background: l.bg }}
              >
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 500, color: l.text, fontSize: 11 }}>{l.name}</span>
                <span style={{ fontWeight: 500, fontSize: 12, color: l.text }}>
                  ${l.px.toLocaleString()}
                </span>
              </div>
            ))}
        </Card>
      </div>
    </div>
  );
}

function StrikeCountToggle({ value, onChange }: { value: StrikeCount; onChange: (c: StrikeCount) => void }) {
  return (
    <div className="inline-flex rounded-md bg-bg-secondary" style={{ padding: 2, gap: 1 }}>
      {(["5", "10", "15", "20", "25", "40", "50"] as StrikeCount[]).map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={clsx("text-[10px]", value === c ? "font-medium" : "")}
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

function GexBarChart({ data, showDV, showOI, strikeCount }: { data: GEXPayload; showDV: boolean; showOI: boolean; strikeCount: StrikeCount }) {
  const { chartData, options } = useMemo(() => {
    // Keep the N strikes nearest spot — that's where the action is — then
    // re-sort descending so the highest strike sits at the top of the bar chart.
    const n = parseInt(strikeCount, 10);
    const spot = data.keyLevels.spot;
    const rows = [...data.strikes]
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, n)
      .sort((a, b) => b.strike - a.strike);
    const labels = rows.map(r => `$${r.strike.toLocaleString()}`);
    const datasets: ChartData<"bar">["datasets"] = [];
    if (showDV) {
      datasets.push({
        label: "Dir. volume",
        data: rows.map(r => r.netDV / 1_000_000),
        backgroundColor: rows.map(r => (r.netDV >= 0 ? "rgba(55,138,221,0.65)" : "rgba(127,119,221,0.5)")),
        borderColor: rows.map(r => (r.netDV >= 0 ? "#378ADD" : "#AFA9EC")),
        borderWidth: 1,
        borderRadius: 2,
        borderSkipped: false,
      });
    }
    if (showOI) {
      datasets.push({
        label: "Open interest",
        data: rows.map(r => r.netOI / 1_000_000),
        backgroundColor: rows.map(r => (r.netOI >= 0 ? "rgba(99,153,34,0.75)" : "rgba(226,75,74,0.7)")),
        borderColor: rows.map(r => (r.netOI >= 0 ? "#7FBF52" : "#E76A6A")),
        borderWidth: 1,
        borderRadius: 2,
        borderSkipped: false,
      });
    }
    const chartData: ChartData<"bar"> = { labels, datasets };
    const options: ChartOptions<"bar"> = {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: c => `Strike ${c[0]!.label}`,
            label: c => `${c.dataset.label}: ${(c.raw as number) >= 0 ? "+" : ""}${Math.round(c.raw as number)}M`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#888780", font: { size: 9 }, callback: v => Math.abs(Math.round(Number(v))) + "M" },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#888780", font: { size: 9 } },
        },
      },
    };
    return { chartData, options };
  }, [data, showDV, showOI, strikeCount]);

  return <Bar data={chartData} options={options} />;
}

function Select({ value, options, onChange }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-md outline-none cursor-pointer bg-bg-primary"
      style={{
        fontSize: 11,
        padding: "4px 8px",
        border: "0.5px solid var(--color-border-secondary)",
        color: "var(--color-text-secondary)",
      }}
    >
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

function SeriesButton({
  active,
  onClick,
  color,
  label,
}: {
  active: boolean;
  onClick: () => void;
  activeClass: string;
  color: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-[5px] rounded-full cursor-pointer"
      style={{
        padding: "4px 11px",
        fontSize: 11,
        border: `0.5px solid ${active ? color : "var(--color-border-secondary)"}`,
        background: active
          ? color === "#378ADD" ? "rgba(201, 165, 90, 0.18)" : "#EEEDFE"
          : "var(--color-background-primary)",
        color: active
          ? color === "#378ADD" ? "#C9A55A" : "#3C3489"
          : "var(--color-text-secondary)",
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 2, background: active ? color : "#888780", display: "inline-block", flexShrink: 0 }} />
      {label}
    </button>
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
    <div
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: "var(--color-text-secondary)",
        textTransform: "uppercase",
        letterSpacing: ".04em",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Mc({ label, value, valueColor, sub, subColor }: { label: string; value: string; valueColor?: string; sub: string; subColor: string }) {
  return (
    <div className="rounded-md bg-bg-secondary" style={{ padding: ".7rem .9rem" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 500, color: valueColor ?? "var(--color-text-primary)" }}>{value}</div>
      <div style={{ fontSize: 10, marginTop: 1, color: subColor }}>{sub}</div>
    </div>
  );
}

function DlRows({ rows, valueColor }: { rows: [string, string][]; valueColor?: string }) {
  return (
    <div style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
      {rows.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "3px 0",
            borderBottom: "0.5px solid var(--color-border-tertiary)",
          }}
        >
          <span style={{ color: "var(--color-text-secondary)" }}>{k}</span>
          <span style={{ fontWeight: 500, color: valueColor ?? "var(--color-text-primary)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
