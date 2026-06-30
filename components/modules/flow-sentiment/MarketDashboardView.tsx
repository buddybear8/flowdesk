"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketSentimentPayload, MarketSentimentTicker } from "@/lib/types";

const BULL = "#3FB950";
const BEAR = "#E5534B";
const NEUTRAL = "var(--color-text-secondary)";

const fmtVol = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` : String(Math.round(n)));
const fmtRatio = (n: number) => (n >= 99 ? "99+" : n.toFixed(2));

// C/P ratio: bullish (>1) green, bearish (<1) red.
const cpColor = (v: number) => (v >= 1 ? BULL : BEAR);
// Call buy/sell pressure: buying calls is bullish → green when >1.
const callColor = (v: number) => (v >= 1 ? BULL : NEUTRAL);
// Put buy/sell pressure: buying puts is bearish → red when >1.
const putColor = (v: number) => (v >= 1 ? BEAR : NEUTRAL);

export function MarketDashboardView() {
  const [data, setData] = useState<MarketSentimentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/flow-sentiment/market")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((p: MarketSentimentPayload) => { if (!cancelled) { setData(p); setError(null); } })
        .catch(() => { if (!cancelled) setError("No market sentiment data yet."); });
    load();
    const id = setInterval(load, 60_000); // Postgres-only refresh (no UW cost)
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (error) return <Centered>{error}</Centered>;
  if (!data) return <Centered>Loading…</Centered>;

  const captured = new Date(data.capturedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

  return (
    <div className="flex-1 overflow-y-auto p-[14px]" style={{ background: "var(--color-background-tertiary)" }}>
      {/* Title */}
      <div className="flex flex-wrap items-start justify-between gap-[8px]" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
            Market sentiment dashboard
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Call/put + buy-vs-sell pressure across the tracked universe · {data.tradingDate} · updated {captured} ET
          </div>
        </div>
        <Key />
      </div>

      {/* Indices + mega caps */}
      <div className="grid gap-[12px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", marginBottom: 12 }}>
        <Card>
          <SectionTitle>Major indices</SectionTitle>
          <SummaryTable rows={data.indices} />
        </Card>
        <Card>
          <SectionTitle>Mega caps</SectionTitle>
          <SummaryTable rows={data.megaCaps} />
        </Card>
      </div>

      {/* Bullish / bearish leaders */}
      <div className="grid gap-[12px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
        <Card>
          <SectionTitle count={data.topBullish.length} accent={BULL}>
            Top bullish sentiment <Thin>C/P &gt; {2.0}</Thin>
          </SectionTitle>
          <LeaderTable rows={data.topBullish} empty="No tickers above 2.0 C/P right now." />
        </Card>
        <Card>
          <SectionTitle count={data.topBearish.length} accent={BEAR}>
            Top bearish sentiment <Thin>C/P &lt; {0.5}</Thin>
          </SectionTitle>
          <LeaderTable rows={data.topBearish} empty="No tickers below 0.5 C/P right now." />
        </Card>
      </div>

      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 10, lineHeight: 1.6 }}>
        Leaderboards require ≥ {data.minVolume.toLocaleString("en-US")} near-the-money contracts so thin names don’t skew on a
        meaningless ratio. C/P = call ÷ put volume; B/S = bought-at-ask ÷ sold-at-bid.
      </div>
    </div>
  );
}

// ── sorting (per-table, independent) ─────────────────────────────────────────

type SortKey = "ticker" | "cpRatio" | "callVol" | "putVol" | "callBuyRatio" | "putBuyRatio";
interface ColDef { key: SortKey; label: string; numeric: boolean }
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

// Each table owns its own sort state, so sorting one never touches the others.
// `null` keeps the server-provided order (fixed index order / ranked leaders).
function useSort(rows: MarketSentimentTicker[]) {
  const [sort, setSort] = useState<SortState>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    const m = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      // No-data rows (e.g. an untracked symbol) always sink to the bottom.
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
      if (key === "ticker") return m * a.ticker.localeCompare(b.ticker);
      return m * ((a[key] as number) - (b[key] as number));
    });
  }, [rows, sort]);
  const toggle = (key: SortKey, numeric: boolean) =>
    setSort((p) => (p?.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));
  return { sorted, sort, toggle };
}

function SortHead({ cols, sort, onToggle }: { cols: ColDef[]; sort: SortState; onToggle: (k: SortKey, numeric: boolean) => void }) {
  return (
    <thead>
      <tr>
        {cols.map((c, i) => {
          const active = sort?.key === c.key;
          return (
            <th
              key={c.key}
              onClick={() => onToggle(c.key, c.numeric)}
              title={`Sort by ${c.label}`}
              style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 10px", color: active ? "var(--color-text-secondary)" : "var(--color-text-tertiary)", fontSize: 10, fontWeight: 500, letterSpacing: ".04em", borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
            >
              {c.label}
              <span style={{ opacity: active ? 1 : 0.25 }}>{active ? (sort!.dir === "asc" ? " ▲" : " ▼") : " ↕"}</span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

// ── tables ───────────────────────────────────────────────────────────────────

const SUMMARY_COLS: ColDef[] = [
  { key: "ticker", label: "TICKER", numeric: false },
  { key: "cpRatio", label: "C/P", numeric: true },
  { key: "callVol", label: "CALL VOL", numeric: true },
  { key: "putVol", label: "PUT VOL", numeric: true },
  { key: "callBuyRatio", label: "CALL B/S", numeric: true },
  { key: "putBuyRatio", label: "PUT B/S", numeric: true },
];

const LEADER_COLS: ColDef[] = [
  { key: "ticker", label: "TICKER", numeric: false },
  { key: "cpRatio", label: "C/P RATIO", numeric: true },
  { key: "callBuyRatio", label: "CALL RATIO", numeric: true },
  { key: "putBuyRatio", label: "PUT RATIO", numeric: true },
];

// Indices / mega caps: full per-ticker breakdown incl. volumes.
function SummaryTable({ rows }: { rows: MarketSentimentTicker[] }) {
  const { sorted, sort, toggle } = useSort(rows);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <SortHead cols={SUMMARY_COLS} sort={sort} onToggle={toggle} />
        <tbody>
          {sorted.map((r) => (
            <tr key={r.ticker} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <Td left><span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{r.ticker}</span></Td>
              {r.hasData ? (
                <>
                  <Td bold color={cpColor(r.cpRatio)}>{fmtRatio(r.cpRatio)}</Td>
                  <Td color="var(--color-text-secondary)">{fmtVol(r.callVol)}</Td>
                  <Td color="var(--color-text-secondary)">{fmtVol(r.putVol)}</Td>
                  <Td color={callColor(r.callBuyRatio)}>{fmtRatio(r.callBuyRatio)}</Td>
                  <Td color={putColor(r.putBuyRatio)}>{fmtRatio(r.putBuyRatio)}</Td>
                </>
              ) : (
                <td colSpan={5} style={{ textAlign: "right", padding: "7px 10px", color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
                  no options data
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Leaderboards: the three ratios the spec calls for.
function LeaderTable({ rows, empty }: { rows: MarketSentimentTicker[]; empty: string }) {
  const { sorted, sort, toggle } = useSort(rows);
  if (!rows.length) {
    return <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "14px 4px" }}>{empty}</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <SortHead cols={LEADER_COLS} sort={sort} onToggle={toggle} />
        <tbody>
          {sorted.map((r) => (
            <tr key={r.ticker} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <Td left><span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{r.ticker}</span></Td>
              <Td bold color={cpColor(r.cpRatio)}>{fmtRatio(r.cpRatio)}</Td>
              <Td color={callColor(r.callBuyRatio)}>{fmtRatio(r.callBuyRatio)}</Td>
              <Td color={putColor(r.putBuyRatio)}>{fmtRatio(r.putBuyRatio)}</Td>
            </tr>
          ))}
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

// ── layout helpers (match platform template) ─────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center text-text-tertiary" style={{ fontSize: 12, padding: 24, background: "var(--color-background-tertiary)" }}>{children}</div>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-bg-primary rounded-[12px]" style={{ border: "0.5px solid var(--color-border-tertiary)", padding: "1rem" }}>{children}</div>;
}
function Thin({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-tertiary)" }}>{children}</span>;
}
function SectionTitle({ children, count, accent }: { children: React.ReactNode; count?: number; accent?: string }) {
  return (
    <div className="flex items-center gap-[8px]" style={{ marginBottom: 8 }}>
      {accent && <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent, display: "inline-block" }} />}
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{children}</span>
      {count != null && <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 20, background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" }}>{count}</span>}
    </div>
  );
}
function Key() {
  return (
    <div className="flex items-center gap-[12px]" style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
      <span className="inline-flex items-center gap-[4px]"><span style={{ width: 9, height: 9, borderRadius: 2, background: BULL, display: "inline-block" }} /> Bullish</span>
      <span className="inline-flex items-center gap-[4px]"><span style={{ width: 9, height: 9, borderRadius: 2, background: BEAR, display: "inline-block" }} /> Bearish</span>
    </div>
  );
}
