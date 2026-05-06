"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { FlowAlert } from "@/lib/types";
import { buildLottoMock } from "@/lib/mock/lotto-alerts";
import { Badge, fmtP, SL, StatGroup, SV, Td, Th } from "./shared";

type SortKey = "time" | "prem" | "size";

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const todayET = () => ET_DATE_FMT.format(new Date());

export function LottosView() {
  // ?mock=1 — opt-in preview mode for layout work without a live DB. Read once
  // on render; toggling the URL switches data source without a hard reload.
  const useMock = useSearchParams().get("mock") === "1";

  const [alerts, setAlerts] = useState<FlowAlert[]>([]);
  const [date, setDate] = useState<string>(() => todayET());
  const [ticker, setTicker] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [exactAtAsk, setExactAtAsk] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (useMock) {
      setAlerts(buildLottoMock({ exactAtAsk }));
      setLoading(false);
      return;
    }
    setLoading(true);
    const qs = new URLSearchParams({ date });
    if (exactAtAsk) qs.set("exact", "1");
    fetch(`/api/flow/lottos?${qs.toString()}`)
      .then((r) => r.json())
      .then((r) => setAlerts(r.alerts ?? []))
      .finally(() => setLoading(false));
  }, [date, exactAtAsk, useMock]);

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
      {/* LEFT SIDE — preset banner + only-user-facing knob (Exactly at ask). The
          actual filter set is intentionally NOT shown here; it's the product's
          secret-sauce criteria. Server-locked filters live in
          app/api/flow/lottos/route.ts. */}
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
              border: `0.5px solid ${useMock ? "#E76A6A" : "var(--color-border-info)"}`,
              color: useMock ? "#E76A6A" : "var(--color-text-info)",
              letterSpacing: "0.04em",
            }}
          >
            {useMock ? "MOCK" : "LOCKED"}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-[12px] py-[10px]">
          {/* Trading day */}
          <div className="mb-[12px]">
            <FpLabel>Trading day</FpLabel>
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

          {/* Locked banner — replaces the criteria list. Brand voice intentional. */}
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.45,
              padding: "10px 11px",
              borderRadius: 8,
              border: "0.5px solid var(--color-border-info)",
              background: "rgba(201, 165, 90, 0.10)",
              color: "var(--color-text-secondary)",
              marginBottom: 14,
            }}
          >
            <span style={{ color: "#E2BF73", fontWeight: 500 }}>
              Custom Champagne Room Lotto Flow Filters Applied
            </span>
          </div>

          {/* Single user-facing knob */}
          <FpLabel>Execution match</FpLabel>
          <label
            className="flex items-center gap-[8px] cursor-pointer"
            style={{
              fontSize: 11,
              color: "var(--color-text-primary)",
              padding: "4px 0 6px",
            }}
          >
            <input
              type="checkbox"
              checked={exactAtAsk}
              onChange={(e) => setExactAtAsk(e.target.checked)}
              style={{ cursor: "pointer", width: 12, height: 12 }}
            />
            <span>Exactly at ask</span>
          </label>
          <div
            style={{
              fontSize: 9,
              lineHeight: 1.5,
              color: "var(--color-text-tertiary)",
            }}
          >
            {exactAtAsk
              ? "Only contracts whose execution price equals the ask. Strictest setting."
              : "Includes ask-side and above-ask executions. Toggle on to tighten to exactly at ask."}
          </div>
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
                  "Side",
                  "Sentiment",
                  "Exec",
                  "Contract",
                  "DTE",
                  "% OTM",
                  "Volume",
                  "OI",
                  "Premium",
                  "Spot",
                  "Rule",
                ].map((h) => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dte = daysBetween(r.expiry, todayET());
                const otmPct = otmPercent(r);
                const premiumColor = r.sentiment === "BEARISH" ? "#E76A6A" : "#7FBF52";
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
                      <Badge type={r.side === "BUY" ? "buy" : "sell"}>{r.side}</Badge>
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: r.sentiment === "BULLISH" ? "#7FBF52" : "#E76A6A",
                        }}
                      >
                        {r.sentiment}
                      </span>
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
                    <Td style={{ fontSize: 12, fontWeight: 500, color: premiumColor }}>
                      {fmtP(r.premium)}
                    </Td>
                    <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      ${r.spot.toFixed(2)}
                    </Td>
                    <Td style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{r.rule}</Td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={15}
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
