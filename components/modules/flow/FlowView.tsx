"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/types";

type FilterState = {
  type: "ALL" | "CALL" | "PUT";
  side: "ALL" | "BUY" | "SELL";
  sent: "ALL" | "BULLISH" | "BEARISH";
  exec: "ALL" | "SWEEP" | "FLOOR" | "SINGLE" | "BLOCK";
  prem: "ALL" | "500K" | "1M" | "5M";
  conf: "ALL" | "HIGH" | "MED";
  rule: string;
  ticker: string;
  sweepOnly: boolean;
  otmOnly: boolean;
  sizeOverOi: boolean;
  premMin: string;
  premMax: string;
  dte: string;
  sector: string; // "ALL" or a Sector union value
  date: string; // YYYY-MM-DD in ET; controls the dataset (server-side filter)
};

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const todayET = () => ET_DATE_FMT.format(new Date());

// `date` is filled in by the component using todayET() so the default tracks
// the actual day, not the server-render time of this module.
const INITIAL_FILTER: Omit<FilterState, "date"> = {
  type: "ALL", side: "ALL", sent: "ALL", exec: "ALL", prem: "ALL", conf: "ALL",
  rule: "ALL", ticker: "", sweepOnly: false, otmOnly: false, sizeOverOi: false,
  premMin: "", premMax: "", dte: "ALL", sector: "ALL",
};

export const SECTOR_OPTIONS = [
  "ALL",
  "Technology",
  "Communication",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Materials",
  "Real Estate",
  "Utilities",
  "Index",
  "Commodities",
  "Bonds",
  "Volatility",
] as const;

type SortKey = "time" | "prem" | "size";

function fmtP(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "K";
  return s + "$" + a;
}

export function FlowView() {
  const [alerts, setAlerts] = useState<FlowAlert[]>([]);
  const [filter, setFilter] = useState<FilterState>(() => ({ ...INITIAL_FILTER, date: todayET() }));
  const [sortKey, setSortKey] = useState<SortKey>("time");

  useEffect(() => {
    const params = new URLSearchParams({ date: filter.date });
    const t = filter.ticker.trim().toUpperCase();
    if (t) params.set("ticker", t);
    if (filter.sector !== "ALL") params.set("sector", filter.sector);
    fetch(`/api/flow?${params.toString()}`)
      .then((r) => r.json())
      .then((r) => setAlerts(r.alerts ?? []));
  }, [filter.date, filter.ticker, filter.sector]);

  const rows = useMemo(() => {
    let r = [...alerts];
    if (filter.type !== "ALL") r = r.filter(x => x.type === filter.type);
    if (filter.side !== "ALL") r = r.filter(x => x.side === filter.side);
    if (filter.sent !== "ALL") r = r.filter(x => x.sentiment === filter.sent);
    if (filter.exec !== "ALL") r = r.filter(x => x.exec === filter.exec);
    if (filter.conf !== "ALL") r = r.filter(x => x.confidence === filter.conf);
    if (filter.prem === "500K") r = r.filter(x => x.premium >= 500_000);
    if (filter.prem === "1M") r = r.filter(x => x.premium >= 1_000_000);
    if (filter.prem === "5M") r = r.filter(x => x.premium >= 5_000_000);
    if (filter.sweepOnly) r = r.filter(x => x.exec === "SWEEP");
    if (filter.otmOnly) r = r.filter(x => x.type === "CALL" ? x.strike > x.spot : x.strike < x.spot);
    if (filter.sizeOverOi) r = r.filter(x => x.size > x.oi);
    const premMin = Number(filter.premMin);
    if (filter.premMin && Number.isFinite(premMin)) r = r.filter(x => x.premium >= premMin);
    const premMax = Number(filter.premMax);
    if (filter.premMax && Number.isFinite(premMax)) r = r.filter(x => x.premium <= premMax);
    if (filter.rule !== "ALL") r = r.filter(x => x.rule.startsWith(filter.rule));
    // ticker + sector are applied server-side now (URL params on the /api/flow
    // fetch). Without that, the route's MAX_ROWS=200 global cap would starve
    // any single ticker that doesn't dominate the most-recent window.
    if (sortKey === "prem") r.sort((a, b) => b.premium - a.premium);
    else if (sortKey === "size") r.sort((a, b) => b.size - a.size);
    return r;
  }, [alerts, filter, sortKey]);

  const calls = rows.filter(r => r.type === "CALL").length;
  const puts = rows.filter(r => r.type === "PUT").length;
  const totalPrem = rows.reduce((s, r) => s + r.premium, 0);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT FILTER PANEL */}
      <FilterPanel filter={filter} setFilter={setFilter} />

      {/* FEED AREA */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Stats bar */}
        <div
          className="flex items-center flex-wrap px-[12px] py-[7px] flex-shrink-0 bg-bg-primary"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <StatGroup><SV color="#C9A55A">{rows.length}</SV><SL>&nbsp;ALERTS</SL></StatGroup>
          <StatGroup><SV color="#7FBF52">{calls}</SV><SL>&nbsp;CALLS</SL><SV color="#E76A6A" style={{ marginLeft: 4 }}>{puts}</SV><SL>&nbsp;PUTS</SL></StatGroup>
          <StatGroup><SV color="#C9A55A">{fmtP(totalPrem)}</SV><SL>&nbsp;PREMIUM</SL></StatGroup>
          <StatGroup last><SV color="#E2BF73">{puts > 0 ? (calls / puts).toFixed(2) : "—"}</SV><SL>&nbsp;C/P RATIO</SL></StatGroup>
        </div>

        {/* Toolbar */}
        <div
          className="flex items-center gap-[7px] px-[12px] py-[6px] bg-bg-primary flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <input
            placeholder="Filter ticker..."
            onInput={e => setFilter(f => ({ ...f, ticker: (e.target as HTMLInputElement).value.toUpperCase() }))}
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
            <option value="prem">Sort: Premium ↓</option>
            <option value="size">Sort: Volume ↓</option>
          </select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Time", "Ticker", "Type", "Side", "Sentiment", "Exec", "Contract", "Volume", "OI", "Premium", "Spot", "Rule", "Conf."].map(h => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  className={r.isNew ? "row-flash" : ""}
                  style={{
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    cursor: "pointer",
                  }}
                >
                  <Td style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{r.date}</Td>
                  <Td style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{r.time}</Td>
                  <Td style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)" }}>{r.ticker}</Td>
                  <Td><Badge type={r.type === "CALL" ? "call" : "put"}>{r.type}</Badge></Td>
                  <Td><Badge type={r.side === "BUY" ? "buy" : "sell"}>{r.side}</Badge></Td>
                  <Td><span style={{ fontSize: 10, fontWeight: 500, color: r.sentiment === "BULLISH" ? "#7FBF52" : "#E76A6A" }}>{r.sentiment}</span></Td>
                  <Td>
                    <Badge
                      type={
                        r.exec === "SWEEP" ? "sweep"
                        : r.exec === "FLOOR" ? "floor"
                        : r.exec === "BLOCK" ? "block"
                        : "single"
                      }
                    >
                      {r.exec}
                    </Badge>
                    {r.multiLeg && (
                      <span
                        style={{
                          fontSize: 8,
                          padding: "1px 4px",
                          borderRadius: 3,
                          background: "#C9A55A",
                          color: "white",
                          marginLeft: 3,
                        }}
                      >
                        ML
                      </span>
                    )}
                  </Td>
                  <Td style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>{r.contract}</Td>
                  <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {r.size.toLocaleString()}
                  </Td>
                  <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{r.oi.toLocaleString()}</Td>
                  <Td
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: r.sentiment === "BEARISH" && r.side === "SELL" ? "#E76A6A" : "#7FBF52",
                    }}
                  >
                    {fmtP(r.premium)}
                  </Td>
                  <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>${r.spot.toFixed(2)}</Td>
                  <Td style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{r.rule}</Td>
                  <Td><ConfBadge conf={r.confidence} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Left filter panel ----------

function FilterPanel({ filter, setFilter }: { filter: FilterState; setFilter: React.Dispatch<React.SetStateAction<FilterState>> }) {
  return (
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
          onClick={() => setFilter(f => ({ ...INITIAL_FILTER, date: f.date }))}
          className="cursor-pointer rounded-full"
          style={{
            fontSize: 10,
            color: "var(--color-text-info)",
            padding: "2px 7px",
            border: "0.5px solid var(--color-border-info)",
          }}
        >
          Reset
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-[12px] py-[10px]">
        <div className="mb-[12px]">
          <FpLabel>Trading day</FpLabel>
          <div className="flex items-center gap-[5px]" style={{ marginTop: 4 }}>
            <input
              type="date"
              value={filter.date}
              max={todayET()}
              onChange={e => setFilter(f => ({ ...f, date: e.target.value || todayET() }))}
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
            {filter.date !== todayET() && (
              <button
                onClick={() => setFilter(f => ({ ...f, date: todayET() }))}
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
        <Divider />
        <ChipSec label="Type" value={filter.type} onChange={v => setFilter(f => ({ ...f, type: v as FilterState["type"] }))}
          opts={[["ALL", "All types", "sel"], ["CALL", "Calls", "sel-g"], ["PUT", "Puts", "sel-r"]]} />
        <ChipSec label="Side" value={filter.side} onChange={v => setFilter(f => ({ ...f, side: v as FilterState["side"] }))}
          opts={[["ALL", "All", "sel"], ["BUY", "Buy", "sel-g"], ["SELL", "Sell", "sel-r"]]} />
        <ChipSec label="Sentiment" value={filter.sent} onChange={v => setFilter(f => ({ ...f, sent: v as FilterState["sent"] }))}
          opts={[["ALL", "All", "sel"], ["BULLISH", "Bullish", "sel-g"], ["BEARISH", "Bearish", "sel-r"]]} />
        <ChipSec label="Execution" value={filter.exec} onChange={v => setFilter(f => ({ ...f, exec: v as FilterState["exec"] }))}
          opts={[["ALL", "All", "sel"], ["SWEEP", "Sweep", "sel-a"], ["FLOOR", "Floor", "sel"], ["SINGLE", "Single", "sel"], ["BLOCK", "Block", "sel"]]} />
        <Divider />
        <ChipSec label="Min premium" value={filter.prem} onChange={v => setFilter(f => ({ ...f, prem: v as FilterState["prem"] }))}
          opts={[["ALL", "Any", "sel"], ["500K", "≥ $500K", "sel"], ["1M", "≥ $1M", "sel"], ["5M", "≥ $5M", "sel"]]} />
        <ChipSec label="Confidence" value={filter.conf} onChange={v => setFilter(f => ({ ...f, conf: v as FilterState["conf"] }))}
          opts={[["ALL", "All", "sel"], ["HIGH", "High", "sel-g"], ["MED", "Medium", "sel-a"]]} />
        <SelectSec label="Expiry (DTE)" value={filter.dte} onChange={v => setFilter(f => ({ ...f, dte: v }))}
          opts={[{ v: "ALL", l: "All expirations" }, { v: "0", l: "0DTE" }, { v: "7", l: "≤ 7 days" }, { v: "30", l: "≤ 30 days" }]} />
        <SelectSec label="Rule / alert type" value={filter.rule} onChange={v => setFilter(f => ({ ...f, rule: v }))}
          opts={[
            { v: "ALL", l: "All rules" },
            { v: "Repeated Hits", l: "Repeated hits" },
            { v: "Floor Trade", l: "Floor trade" },
            { v: "Unusual Activity", l: "Unusual activity" },
            { v: "Block Print", l: "Block print" },
            { v: "Large Hedge", l: "Large hedge" },
          ]} />
        <Divider />
        <div className="mb-[12px]">
          <FpLabel>Quick toggles</FpLabel>
          <TogRow
            checked={filter.sweepOnly}
            onChange={v => setFilter(f => ({ ...f, sweepOnly: v }))}
            label="Sweep only"
          />
          <TogRow
            checked={filter.otmOnly}
            onChange={v => setFilter(f => ({ ...f, otmOnly: v }))}
            label="OTM only"
          />
          <TogRow
            checked={filter.sizeOverOi}
            onChange={v => setFilter(f => ({ ...f, sizeOverOi: v }))}
            label="Size > OI"
          />
        </div>
        <div className="mb-[12px]">
          <FpLabel>Premium range</FpLabel>
          <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
            <RangeIn
              placeholder="Min $"
              type="number"
              inputMode="numeric"
              value={filter.premMin}
              onChange={e => setFilter(f => ({ ...f, premMin: e.target.value }))}
            />
            <RangeIn
              placeholder="Max $"
              type="number"
              inputMode="numeric"
              value={filter.premMax}
              onChange={e => setFilter(f => ({ ...f, premMax: e.target.value }))}
            />
          </div>
        </div>
        <div className="mb-[12px]">
          <FpLabel>Sector</FpLabel>
          <FpSelect
            value={filter.sector}
            onChange={(e) => setFilter((f) => ({ ...f, sector: e.target.value }))}
          >
            {SECTOR_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "ALL" ? "All sectors" : s}</option>
            ))}
          </FpSelect>
        </div>
      </div>
    </aside>
  );
}

function ChipSec({
  label,
  value,
  onChange,
  opts,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opts: [string, string, "sel" | "sel-g" | "sel-r" | "sel-a"][];
}) {
  return (
    <div className="mb-[12px]">
      <FpLabel>{label}</FpLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {opts.map(([v, l, selCls]) => {
          const selected = value === v;
          const selStyles: Record<string, { bg: string; border: string; color: string }> = {
            sel: { bg: "rgba(201, 165, 90, 0.18)", border: "#C9A55A", color: "#C9A55A" },
            "sel-g": { bg: "rgba(127, 191, 82, 0.14)", border: "#7FBF52", color: "#7FBF52" },
            "sel-r": { bg: "rgba(231, 106, 106, 0.14)", border: "#E76A6A", color: "#E76A6A" },
            "sel-a": { bg: "#FAEEDA", border: "#E2BF73", color: "#633806" },
          };
          const s = selStyles[selCls]!;
          return (
            <span
              key={v}
              onClick={() => onChange(v)}
              className="cursor-pointer select-none rounded-full"
              style={{
                fontSize: 10,
                padding: "2px 8px",
                border: `0.5px solid ${selected ? s.border : "var(--color-border-secondary)"}`,
                background: selected ? s.bg : "var(--color-background-primary)",
                color: selected ? s.color : "var(--color-text-secondary)",
                fontWeight: selected ? 500 : undefined,
              }}
            >
              {l}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SelectSec({
  label,
  value,
  onChange,
  opts,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  opts: { v: string; l: string }[];
}) {
  return (
    <div className="mb-[12px]">
      <FpLabel>{label}</FpLabel>
      <FpSelect value={value} onChange={e => onChange(e.target.value)}>
        {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </FpSelect>
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

function FpSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{
        width: "100%",
        fontSize: 10,
        padding: "4px 6px",
        borderRadius: 8,
        border: "0.5px solid var(--color-border-secondary)",
        background: "var(--color-background-secondary)",
        color: "var(--color-text-secondary)",
        outline: "none",
        cursor: "pointer",
        marginTop: 4,
        ...props.style,
      }}
    />
  );
}

function RangeIn(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        fontSize: 10,
        padding: "4px 6px",
        borderRadius: 8,
        border: "0.5px solid var(--color-border-secondary)",
        background: "var(--color-background-secondary)",
        color: "var(--color-text-primary)",
        outline: "none",
      }}
    />
  );
}

function TogRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label
      className="flex items-center gap-[6px] cursor-pointer"
      style={{ fontSize: 10, color: "var(--color-text-secondary)", padding: "3px 0" }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ cursor: "pointer", width: 11, height: 11 }}
      />
      {label}
    </label>
  );
}

function Divider() {
  return <div style={{ height: "0.5px", background: "var(--color-border-tertiary)", margin: "8px 0" }} />;
}

// ---------- Misc ----------

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

function SV({ color, children, style }: { color: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <span style={{ fontWeight: 500, color, ...style }}>{children}</span>;
}

function SL({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--color-text-tertiary)", fontSize: 10 }}>{children}</span>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: "var(--color-background-primary)",
        padding: "6px 10px",
        textAlign: "left",
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

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: "6px 10px", verticalAlign: "middle", whiteSpace: "nowrap", ...style }}>
      {children}
    </td>
  );
}

function Badge({ type, children }: { type: "call" | "put" | "buy" | "sell" | "sweep" | "floor" | "single" | "block"; children: React.ReactNode }) {
  const styles: Record<typeof type, { bg: string; color: string }> = {
    call:   { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" },
    put:    { bg: "rgba(231, 106, 106, 0.14)", color: "#E76A6A" },
    buy:    { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" },
    sell:   { bg: "rgba(231, 106, 106, 0.14)", color: "#E76A6A" },
    sweep:  { bg: "#FAEEDA", color: "#633806" },
    floor:  { bg: "#EEEDFE", color: "#3C3489" },
    single: { bg: "#F1EFE8", color: "#A8A496" },
    block:  { bg: "rgba(201, 165, 90, 0.18)", color: "#C9A55A" },
  };
  const { bg, color } = styles[type];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 3,
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

function ConfBadge({ conf }: { conf: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    HIGH: { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" },
    MED:  { bg: "#FAEEDA", color: "#633806" },
    MOD:  { bg: "#FAEEDA", color: "#633806" },
    LOW:  { bg: "rgba(231, 106, 106, 0.14)", color: "#E76A6A" },
  };
  const s = styles[conf] ?? styles.MED!;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 3,
        background: s.bg,
        color: s.color,
        display: "inline-flex",
      }}
    >
      {conf}
    </span>
  );
}
