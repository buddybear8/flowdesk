"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { TradeAlertsPayload, TradeAlertRow } from "@/lib/types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const GAIN = "#3FB950";
const LOSS = "#E5534B";
const pct = (v: number | null, dp = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`);
const col = (v: number | null) => (v == null ? "var(--color-text-tertiary)" : v >= 0 ? GAIN : LOSS);

function contractLabel(r: TradeAlertRow): string {
  if (r.assetType === "equity") return `${r.ticker}`;
  return `${r.ticker} ${r.strike}${r.side === "PUT" ? "P" : "C"}`;
}

export function TradeAlertsView({ assetType }: { assetType: "option" | "equity" }) {
  const [data, setData] = useState<TradeAlertsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/trade-alerts?type=${assetType}`)
        .then((r) => r.json())
        .then((p: TradeAlertsPayload) => { if (!cancelled) { setData(p); setError(null); } })
        .catch(() => { if (!cancelled) setError("Failed to load."); });
    load();
    const id = setInterval(load, 60_000); // open positions re-mark server-side; refresh view
    return () => { cancelled = true; clearInterval(id); };
  }, [assetType]);

  if (error) return <Centered>{error}</Centered>;
  if (!data) return <Centered>Loading…</Centered>;

  if (!data.available) {
    return (
      <Centered>
        <div style={{ textAlign: "center", maxWidth: 460 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 6 }}>
            Equities alerts — awaiting channel access
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            Grant the alert bot <b>View Channel</b> + <b>Read Message History</b> on the equities
            channel, and these will populate on the next ingest.
          </div>
        </div>
      </Centered>
    );
  }

  const s = data.stats;
  return (
    <div className="flex-1 overflow-y-auto p-[14px]" style={{ background: "var(--color-background-tertiary)" }}>
      {/* Title + aggregate stats */}
      <div className="flex flex-wrap items-start justify-between gap-[8px]" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
            {assetType === "option" ? "Options" : "Equities"} alerts
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Live by expiration · realized from posted exits · P/L is {assetType === "option" ? "option-premium" : "share"} % from entries/exits
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          Open book <b style={{ color: col(s.openBookPct) }}>{pct(s.openBookPct, 1)}</b> · raw{" "}
          <b style={{ color: col(s.rawPct) }}>{pct(s.rawPct, 1)}</b>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-[8px]" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))", marginBottom: 12 }}>
        <Mc label="OPEN NOW" value={String(s.openCount)} />
        <Mc label="WIN RATE (closed)" value={`${(100 * s.winRate).toFixed(0)}%`} valueColor="#E2BF73" />
        <Mc label="OPEN BOOK" value={pct(s.openBookPct, 1)} valueColor={col(s.openBookPct)} />
        <Mc label="CLOSED" value={String(s.closedCount)} />
      </div>

      {/* Open Now */}
      <Card>
        <SectionTitle count={data.open.length} live>Open Now</SectionTitle>
        <AlertsTable rows={data.open} live />
      </Card>

      {/* Equity curve */}
      {data.equityCurve.length > 1 && (
        <Card style={{ marginTop: 12 }}>
          <SectionTitle>Equity curve · cumulative size-weighted book</SectionTitle>
          <div style={{ position: "relative", height: 160 }}>
            <EquityCurve points={data.equityCurve} />
          </div>
        </Card>
      )}

      {/* Track record (closed) */}
      <Card style={{ marginTop: 12 }}>
        <SectionTitle count={data.closed.length}>Track record · closed</SectionTitle>
        <AlertsTable rows={data.closed.slice(0, 100)} live={false} />
      </Card>
    </div>
  );
}

function AlertsTable({ rows, live }: { rows: TradeAlertRow[]; live: boolean }) {
  if (!rows.length) {
    return <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "16px 4px" }}>No {live ? "open" : "closed"} positions.</div>;
  }
  const head = ["CONTRACT", "EXP", "SIZE", "REMAINING", "ENTRY", live ? "MID" : "EXIT", live ? "LIVE P/L" : "RESULT", "BOOK Δ", "REALIZED", "ALERTED BY"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 || i === head.length - 1 ? "left" : "right", padding: "6px 10px", color: "var(--color-text-tertiary)", fontSize: 10, fontWeight: 500, letterSpacing: ".04em", borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const result = live ? r.livePct : (r.realizedPct ?? r.livePct);
            return (
              <tr key={r.id} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <Td left><span style={{ color: GAIN, fontWeight: 600 }}>{contractLabel(r)}</span></Td>
                <Td>{r.expiryLabel ? `${r.expiryLabel}${r.dte != null ? ` · ${r.dte}d` : ""}` : "—"}</Td>
                <Td><SizePill size={r.sizeLabel} /></Td>
                <Td><Remaining frac={r.remainingFrac} /></Td>
                <Td>{r.entryPrice.toFixed(2)}</Td>
                <Td>{r.lastMark != null ? r.lastMark.toFixed(2) : "—"}</Td>
                <Td bold color={col(result)}>{pct(result)}</Td>
                <Td color={col(r.bookDelta)}>{pct(r.bookDelta, 2)}</Td>
                <Td color={col(r.realizedPct)}>{pct(r.realizedPct)}</Td>
                <Td left><span style={{ color: "var(--color-text-secondary)" }}>{r.moderator}</span></Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Td({ children, left, bold, color }: { children: React.ReactNode; left?: boolean; bold?: boolean; color?: string }) {
  return (
    <td style={{ textAlign: left ? "left" : "right", padding: "7px 10px", whiteSpace: "nowrap", fontWeight: bold ? 600 : 400, color: color ?? "var(--color-text-primary)" }}>
      {children}
    </td>
  );
}

function SizePill({ size }: { size: string }) {
  const letter = size === "Lotto" ? "Lo" : size[0];
  return (
    <span style={{ display: "inline-block", minWidth: 20, textAlign: "center", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
      {letter}
    </span>
  );
}

function Remaining({ frac }: { frac: number }) {
  const p = Math.round(frac * 100);
  const c = p >= 100 ? GAIN : p >= 50 ? "#E2BF73" : LOSS;
  return (
    <div className="inline-flex items-center gap-[6px]" style={{ justifyContent: "flex-end" }}>
      <div style={{ width: 44, height: 5, borderRadius: 3, background: "var(--color-background-secondary)", overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: c }} />
      </div>
      <span style={{ color: c, fontSize: 11, minWidth: 30, textAlign: "right" }}>{p}%</span>
    </div>
  );
}

function EquityCurve({ points }: { points: { t: string; cum: number }[] }) {
  const { chartData, options } = useMemo(() => {
    const up = (points[points.length - 1]?.cum ?? 0) >= 0;
    const chartData: ChartData<"line"> = {
      labels: points.map((p) => p.t.slice(0, 10)),
      datasets: [{
        data: points.map((p) => p.cum),
        borderColor: up ? GAIN : LOSS,
        backgroundColor: up ? "rgba(63,185,80,0.12)" : "rgba(229,83,75,0.12)",
        fill: true, borderWidth: 1.5, pointRadius: 0, tension: 0.15,
      }],
    };
    const options: ChartOptions<"line"> = {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${(c.raw as number) >= 0 ? "+" : ""}${(c.raw as number).toFixed(2)}%` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#6b7c98", font: { size: 9 }, maxTicksLimit: 6 } },
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6b7c98", font: { size: 9 }, callback: (v) => `${Number(v).toFixed(1)}%` } },
      },
    };
    return { chartData, options };
  }, [points]);
  return <Line data={chartData} options={options} />;
}

// ── small layout helpers (platform template) ────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center text-text-tertiary" style={{ fontSize: 12, padding: 24, background: "var(--color-background-tertiary)" }}>{children}</div>;
}
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="bg-bg-primary rounded-[12px]" style={{ border: "0.5px solid var(--color-border-tertiary)", padding: "1rem", ...style }}>{children}</div>;
}
function SectionTitle({ children, count, live }: { children: React.ReactNode; count?: number; live?: boolean }) {
  return (
    <div className="flex items-center gap-[8px]" style={{ marginBottom: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{children}</span>
      {count != null && <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 20, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" }}>{count}</span>}
      {live && <span style={{ fontSize: 10, color: GAIN }}>● live by expiration</span>}
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
