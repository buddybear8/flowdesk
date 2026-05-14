"use client";

import { useEffect, useMemo, useState } from "react";
import type { DarkPoolPrint } from "@/lib/types";
import { TRACKED_TICKERS } from "@/lib/tracked-tickers";

type DPFilter = {
  onlyRanked: boolean;
  hideETF: boolean;
  intradayOnly: boolean;
  regularHour: boolean;
  extendedHour: boolean;
  ticker: string;
};

type SortKey = "time" | "rank" | "prem";

const INITIAL: DPFilter = {
  onlyRanked: true,
  hideETF: false,
  intradayOnly: false,
  regularHour: true,
  extendedHour: true,
  ticker: "",
};

const TICKER_RE = /^[A-Z]{1,5}$/;

function fmtP(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + Math.round(a / 1e3) + "K";
  return "$" + a;
}

function rankClass(rank: number): { bg: string; color: string; border: string } {
  if (rank <= 3) return { bg: "#FAEEDA", color: "#633806", border: "#C9A55A" };
  if (rank <= 10) return { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52", border: "#7FBF52" };
  if (rank <= 25) return { bg: "rgba(201, 165, 90, 0.18)", color: "#C9A55A", border: "#C9A55A" };
  if (rank <= 50) return { bg: "#EEEDFE", color: "#3C3489", border: "#7F77DD" };
  return { bg: "var(--color-background-secondary)", color: "var(--color-text-secondary)", border: "var(--color-border-secondary)" };
}

function formatTime(iso: string): string {
  // "2026-04-21T11:17:42Z" → "04/21/2026 11:17:42 AM" (12-hour clock).
  // ISO is UTC-zulu off the wire; we preserve that — display time matches
  // the executedAt timestamp the worker stored rather than reinterpreting
  // it in the browser's local zone.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, year, month, day, hh, mm, ss] = m;
  const h = Number(hh);
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${month}/${day}/${year} ${hour12}:${mm}:${ss} ${ampm}`;
}

export function DarkpoolView() {
  const [prints, setPrints] = useState<DarkPoolPrint[]>([]);
  const [filter, setFilter] = useState<DPFilter>(INITIAL);
  const [sortKey, setSortKey] = useState<SortKey>("time");

  // Refetch whenever a server-side filter changes. onlyRanked flips the
  // backend between live-feed (recent by time, all rows) and corpus mode
  // (rank 1–100 ordered ASC). Ticker filter is server-side too so a
  // ticker search can pull the full top-100 for that ticker even though
  // those rows would never fit in the live-feed's most-recent window.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filter.onlyRanked) params.set("onlyRanked", "true");
    if (filter.ticker && TICKER_RE.test(filter.ticker)) params.set("ticker", filter.ticker);
    const qs = params.toString();
    fetch(`/api/darkpool${qs ? `?${qs}` : ""}`)
      .then(r => r.json())
      .then(r => setPrints(r.prints ?? []));
  }, [filter.onlyRanked, filter.ticker]);

  const rows = useMemo(() => {
    // Rank and ticker filtering happen server-side. Client only handles
    // local-only toggles (ETF / hours) and ordering.
    let r = prints;
    if (filter.hideETF) r = r.filter(p => !p.is_etf);
    if (filter.intradayOnly) r = r.filter(p => !p.is_extended);
    if (!filter.regularHour) r = r.filter(p => p.is_extended);
    if (!filter.extendedHour) r = r.filter(p => !p.is_extended);
    if (sortKey === "rank") r = [...r].sort((a, b) => {
      // Unranked rows (0) sink to the bottom regardless of direction.
      const ar = a.all_time_rank || Infinity;
      const br = b.all_time_rank || Infinity;
      return ar - br;
    });
    else if (sortKey === "prem") r = [...r].sort((a, b) => b.premium - a.premium);
    else r = [...r].sort((a, b) => b.executed_at.localeCompare(a.executed_at));
    return r;
  }, [prints, filter.hideETF, filter.intradayOnly, filter.regularHour, filter.extendedHour, sortKey]);

  const totalPrem = rows.reduce((s, r) => s + r.premium, 0);
  const bestRank = rows.length ? Math.min(...rows.map(r => r.all_time_rank)) : "-";

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* FILTER PANEL */}
      <aside
        className="flex w-[210px] flex-shrink-0 flex-col overflow-hidden bg-bg-primary"
        style={{ borderRight: "0.5px solid var(--color-border-tertiary)" }}
      >
        <div
          className="flex items-center justify-between px-[12px] py-[9px] flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <span className="text-[12px] font-medium text-text-primary">Filters</span>
          <button
            onClick={() => setFilter(INITIAL)}
            className="cursor-pointer rounded-full"
            style={{ fontSize: 10, color: "var(--color-text-info)", padding: "2px 7px", border: "0.5px solid var(--color-border-info)" }}
          >
            Reset
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[12px] py-[10px]">
          <div className="mb-[12px]">
            <FpLabel>Ranking</FpLabel>
            <Tog
              label="Only ranked prints"
              checked={filter.onlyRanked}
              onChange={v => setFilter(f => ({ ...f, onlyRanked: v }))}
            />
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 6, lineHeight: 1.4 }}>
              {filter.onlyRanked
                ? "Top-100 per ticker, all-time. Historical Polygon corpus + live UW rolling."
                : "All dark-pool prints, most recent first."}
            </div>
          </div>
          <Divider />
          <div className="mb-[12px]">
            <FpLabel>Filters</FpLabel>
            <Tog label="Hide ETFs"      checked={filter.hideETF}      onChange={v => setFilter(f => ({ ...f, hideETF: v }))} />
            <Tog label="Intraday only"  checked={filter.intradayOnly} onChange={v => setFilter(f => ({ ...f, intradayOnly: v }))} />
            <Tog label="Regular hour"   checked={filter.regularHour}  onChange={v => setFilter(f => ({ ...f, regularHour: v }))} />
            <Tog label="Extended hour"  checked={filter.extendedHour} onChange={v => setFilter(f => ({ ...f, extendedHour: v }))} />
          </div>
        </div>
      </aside>

      {/* FEED AREA */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <div
          className="flex items-center flex-wrap px-[12px] py-[7px] flex-shrink-0 bg-bg-primary"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <StatGroup><SV color="#C9A55A">{rows.length}</SV><SL>&nbsp;PRINTS</SL></StatGroup>
          <StatGroup><SV color="#7FBF52">{fmtP(totalPrem)}</SV><SL>&nbsp;TOTAL PREMIUM</SL></StatGroup>
          <StatGroup last><SV color="#534AB7">#{bestRank}</SV><SL>&nbsp;TOP RANK</SL></StatGroup>
        </div>

        <div
          className="flex items-center gap-[7px] px-[12px] py-[6px] bg-bg-primary flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <div className="flex items-center gap-[5px]" style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
            <span className="blink" style={{ width: 7, height: 7, borderRadius: "50%", background: "#7FBF52", display: "inline-block" }} />
            Live · updating
          </div>
          <select
            value={filter.ticker}
            onChange={e => setFilter(f => ({ ...f, ticker: e.target.value }))}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 8,
              border: "0.5px solid var(--color-border-secondary)",
              background: "var(--color-background-secondary)",
              color: "var(--color-text-primary)",
              outline: "none",
              width: 130,
              cursor: "pointer",
            }}
          >
            <option value="">All tickers</option>
            {TRACKED_TICKERS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
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
            <option value="rank">Sort: Rank ↑</option>
            <option value="prem">Sort: Premium ↓</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Time</Th><Th>Ticker</Th><Th>Price</Th><Th>Size</Th><Th>Premium</Th><Th center>Trade rank</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const rc = rankClass(r.all_time_rank);
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: "0.5px solid var(--color-border-tertiary)",
                      cursor: "pointer",
                    }}
                  >
                    <Td style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
                      {formatTime(r.executed_at)}
                      {r.is_extended && (
                        <span
                          style={{
                            fontSize: 8,
                            padding: "1px 4px",
                            borderRadius: 3,
                            background: "#FAEEDA",
                            color: "#633806",
                            marginLeft: 4,
                          }}
                        >
                          EXT
                        </span>
                      )}
                    </Td>
                    <Td style={{ fontSize: 13, fontWeight: 500, color: r.is_etf ? "#534AB7" : "#C9A55A" }}>{r.ticker}</Td>
                    <Td style={{ fontSize: 12, color: "var(--color-text-primary)" }}>${r.price.toFixed(4)}</Td>
                    <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{r.size.toLocaleString()}</Td>
                    <Td style={{ fontSize: 12, fontWeight: 500, color: "#7FBF52" }}>{fmtP(r.premium)}</Td>
                    <Td center>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          fontWeight: 500,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: rc.bg,
                          color: rc.color,
                          border: `0.5px solid ${rc.border}`,
                        }}
                      >
                        #{r.all_time_rank}{r.all_time_rank <= 3 ? " 🔥" : ""}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FpLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function Tog({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="flex items-center justify-between"
      style={{ padding: "7px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}
    >
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{label}</span>
      <label style={{ position: "relative", width: 34, height: 19, flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={{ opacity: 0, width: 0, height: 0, position: "absolute" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 20,
            background: checked ? "#C9A55A" : "var(--color-background-secondary)",
            border: `0.5px solid ${checked ? "#C9A55A" : "var(--color-border-secondary)"}`,
            cursor: "pointer",
            transition: "background .2s",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: "white",
            transform: checked ? "translateX(15px)" : "translateX(0)",
            transition: "transform .2s",
            pointerEvents: "none",
          }}
        />
      </label>
    </div>
  );
}

function Divider() {
  return <div style={{ height: "0.5px", background: "var(--color-border-tertiary)", margin: "8px 0" }} />;
}

function StatGroup({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className="flex items-center gap-[4px]"
      style={{
        fontSize: 11,
        paddingRight: 12,
        marginRight: 12,
        borderRight: last ? "none" : "0.5px solid var(--color-border-tertiary)",
        marginLeft: last ? "auto" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function SV({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontWeight: 500, color }}>{children}</span>;
}

function SL({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--color-text-tertiary)", fontSize: 10 }}>{children}</span>;
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <th
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: "var(--color-background-primary)",
        padding: "6px 10px",
        textAlign: center ? "center" : "left",
        fontSize: 9,
        fontWeight: 500,
        color: "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: ".05em",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style, center }: { children: React.ReactNode; style?: React.CSSProperties; center?: boolean }) {
  return (
    <td
      style={{
        padding: "6px 10px",
        verticalAlign: "middle",
        whiteSpace: "nowrap",
        textAlign: center ? "center" : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );
}
