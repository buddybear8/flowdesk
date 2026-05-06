"use client";

import { useEffect, useMemo, useState } from "react";
import type { FlowAlert } from "@/lib/types";
import {
  Badge,
  ConfBadge,
  fmtP,
  SL,
  StatGroup,
  SV,
  Td,
  Th,
} from "./shared";

type SortKey = "time" | "prem" | "size";

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const todayET = () => ET_DATE_FMT.format(new Date());

// Server-locked preset — these strings drive the read-only banner. The actual
// filter logic lives in app/api/flow/lottos/route.ts; this is documentation,
// not configuration. Edit both if filter rules change.
const LOTTO_CRITERIA: { label: string; value: string }[] = [
  { label: "Issue type", value: "Common Stock only" },
  { label: "Side execution", value: "Exactly at ask (no mid / above ask)" },
  { label: "DTE", value: "0 – 14" },
  { label: "% OTM", value: "20% – 100%" },
  { label: "Premium", value: "≥ $1,000" },
  { label: "Volume / OI", value: "Volume > Open Interest" },
  { label: "Trade flag", value: "Opening trades, single-leg" },
];

export function LottosView() {
  const [alerts, setAlerts] = useState<FlowAlert[]>([]);
  const [date, setDate] = useState<string>(() => todayET());
  const [ticker, setTicker] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/flow/lottos?date=${date}`)
      .then((r) => r.json())
      .then((r) => setAlerts(r.alerts ?? []))
      .finally(() => setLoading(false));
  }, [date]);

  const rows = useMemo(() => {
    let r = alerts;
    if (ticker) r = r.filter((x) => x.ticker.startsWith(ticker));
    if (sortKey === "prem") r = [...r].sort((a, b) => b.premium - a.premium);
    else if (sortKey === "size") r = [...r].sort((a, b) => b.size - a.size);
    return r;
  }, [alerts, ticker, sortKey]);

  const calls = rows.filter((r) => r.type === "CALL").length;
  const puts = rows.filter((r) => r.type === "PUT").length;
  const totalPrem = rows.reduce((s, r) => s + r.premium, 0);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT SIDE — locked criteria panel (replaces the editable FilterPanel) */}
      <aside
        className="flex w-[210px] flex-shrink-0 flex-col overflow-hidden bg-bg-primary"
        style={{ borderRight: "0.5px solid var(--color-border-tertiary)" }}
      >
        <div
          className="flex items-center justify-between px-[12px] py-[9px] flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <span className="text-[12px] font-medium text-text-primary">Preset · Lottos</span>
          <span
            className="rounded-full"
            style={{
              fontSize: 9,
              padding: "2px 7px",
              border: "0.5px solid var(--color-border-info)",
              color: "var(--color-text-info)",
              letterSpacing: "0.04em",
            }}
          >
            LOCKED
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-[12px] py-[10px]">
          <div className="mb-[12px]">
            <div
              style={{
                fontSize: 9,
                fontWeight: 500,
                color: "var(--color-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: ".06em",
                marginBottom: 5,
              }}
            >
              Trading day
            </div>
            <div className="flex items-center gap-[5px]" style={{ marginTop: 4 }}>
              <input
                type="date"
                value={date}
                max={todayET()}
                onChange={(e) => setDate(e.target.value || todayET())}
                style={{
                  flex: 1,
                  fontSize: 11,
                  padding: "4px 7px",
                  borderRadius: 8,
                  border: "0.5px solid var(--color-border-secondary)",
                  background: "var(--color-background-secondary)",
                  color: "var(--color-text-primary)",
                  outline: "none",
                  colorScheme: "dark",
                }}
              />
              {date !== todayET() && (
                <button
                  onClick={() => setDate(todayET())}
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    borderRadius: 6,
                    border: "0.5px solid var(--color-border-info)",
                    background: "transparent",
                    color: "var(--color-text-info)",
                    cursor: "pointer",
                  }}
                >
                  Today
                </button>
              )}
            </div>
          </div>
          <div style={{ height: "0.5px", background: "var(--color-border-tertiary)", margin: "8px 0" }} />
          <div
            style={{
              fontSize: 10,
              color: "var(--color-text-tertiary)",
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          >
            Criteria are backend-controlled and cannot be changed from the UI.
          </div>
          {LOTTO_CRITERIA.map((c) => (
            <div key={c.label} style={{ marginBottom: 9 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: "var(--color-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: 2,
                }}
              >
                {c.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{c.value}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* FEED AREA */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Stats bar */}
        <div
          className="flex items-center flex-wrap px-[12px] py-[7px] flex-shrink-0 bg-bg-primary"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <StatGroup>
            <SV color="#C9A55A">{rows.length}</SV>
            <SL>&nbsp;LOTTOS</SL>
          </StatGroup>
          <StatGroup>
            <SV color="#7FBF52">{calls}</SV>
            <SL>&nbsp;CALLS</SL>
            <SV color="#E76A6A" style={{ marginLeft: 4 }}>
              {puts}
            </SV>
            <SL>&nbsp;PUTS</SL>
          </StatGroup>
          <StatGroup>
            <SV color="#C9A55A">{fmtP(totalPrem)}</SV>
            <SL>&nbsp;PREMIUM</SL>
          </StatGroup>
          <StatGroup last>
            <SV color="#E2BF73">{puts > 0 ? (calls / puts).toFixed(2) : "—"}</SV>
            <SL>&nbsp;C/P RATIO</SL>
          </StatGroup>
        </div>

        {/* Toolbar */}
        <div
          className="flex items-center gap-[7px] px-[12px] py-[6px] bg-bg-primary flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <input
            placeholder="Filter ticker..."
            onInput={(e) => setTicker((e.target as HTMLInputElement).value.toUpperCase())}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 8,
              border: "0.5px solid var(--color-border-secondary)",
              background: "var(--color-background-secondary)",
              color: "var(--color-text-primary)",
              outline: "none",
              width: 130,
            }}
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            style={{
              fontSize: 10,
              padding: "3px 6px",
              borderRadius: 8,
              border: "0.5px solid var(--color-border-secondary)",
              background: "var(--color-background-primary)",
              color: "var(--color-text-secondary)",
              outline: "none",
              marginLeft: "auto",
              cursor: "pointer",
            }}
          >
            <option value="time">Sort: Time ↓</option>
            <option value="prem">Sort: Premium ↓</option>
            <option value="size">Sort: Volume ↓</option>
          </select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Date",
                  "Time",
                  "Ticker",
                  "Type",
                  "Exec",
                  "Contract",
                  "DTE",
                  "% OTM",
                  "Volume",
                  "OI",
                  "Premium",
                  "Spot",
                  "Rule",
                  "Conf.",
                ].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dte = daysBetween(r.expiry, todayET());
                const otmPct = otmPercent(r);
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: "0.5px solid var(--color-border-tertiary)",
                      cursor: "pointer",
                    }}
                  >
                    <Td style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{r.date}</Td>
                    <Td style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{r.time}</Td>
                    <Td style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)" }}>
                      {r.ticker}
                    </Td>
                    <Td>
                      <Badge type={r.type === "CALL" ? "call" : "put"}>{r.type}</Badge>
                    </Td>
                    <Td>
                      <Badge
                        type={
                          r.exec === "SWEEP"
                            ? "sweep"
                            : r.exec === "FLOOR"
                              ? "floor"
                              : r.exec === "BLOCK"
                                ? "block"
                                : "single"
                        }
                      >
                        {r.exec}
                      </Badge>
                    </Td>
                    <Td style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>
                      {r.contract}
                    </Td>
                    <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{dte}</Td>
                    <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      {otmPct == null ? "—" : `${(otmPct * 100).toFixed(0)}%`}
                    </Td>
                    <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      {r.size.toLocaleString()}
                    </Td>
                    <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      {r.oi.toLocaleString()}
                    </Td>
                    <Td style={{ fontSize: 12, fontWeight: 500, color: "#7FBF52" }}>{fmtP(r.premium)}</Td>
                    <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      ${r.spot.toFixed(2)}
                    </Td>
                    <Td style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{r.rule}</Td>
                    <Td>
                      <ConfBadge conf={r.confidence} />
                    </Td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={14}
                    style={{
                      padding: "30px 12px",
                      textAlign: "center",
                      fontSize: 11,
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    No alerts match the Lottos preset for {date}.
                    <br />
                    <span style={{ fontSize: 10 }}>
                      Older rows may not have the required UW fields populated yet — the Lottos preset
                      only matches data ingested after the v1.3 schema migration.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Whole-day count from an ISO date (YYYY-MM-DD) to a reference ET date.
function daysBetween(expiryIso: string, refIso: string): number {
  const a = Date.parse(`${expiryIso}T00:00:00Z`);
  const b = Date.parse(`${refIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

function otmPercent(r: FlowAlert): number | null {
  if (!r.spot) return null;
  if (r.type === "CALL") return (r.strike - r.spot) / r.spot;
  if (r.type === "PUT") return (r.spot - r.strike) / r.spot;
  return null;
}
