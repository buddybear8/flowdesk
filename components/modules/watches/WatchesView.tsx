"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { HitListItem, HitListPayload } from "@/lib/types";

function fmtP(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "K";
  return s + "$" + a;
}

function confClass(c: string): string {
  if (c === "HIGH") return "conf-HIGH";
  if (c === "MOD" || c === "MED") return "conf-MOD";
  return "conf-LOW";
}

function confColor(c: string): string {
  if (c === "HIGH") return "#3B6D11";
  if (c === "MOD" || c === "MED") return "#854F0B";
  return "#A32D2D";
}

type SortKey = "rank" | "prem" | "conf";

export function WatchesView() {
  const [payload, setPayload] = useState<HitListPayload | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [selRow, setSelRow] = useState<number | null>(0);
  const [selContract, setSelContract] = useState(0);

  useEffect(() => {
    fetch("/api/watches").then(r => r.json()).then(setPayload);
  }, []);

  const hits = useMemo(() => {
    if (!payload) return [];
    const arr = [...payload.hits];
    if (sortKey === "prem") arr.sort((a, b) => b.premium - a.premium);
    else if (sortKey === "conf") arr.sort((a, b) => ["HIGH", "MOD", "MED", "LOW"].indexOf(a.confidence) - ["HIGH", "MOD", "MED", "LOW"].indexOf(b.confidence));
    else arr.sort((a, b) => a.rank - b.rank);
    return arr;
  }, [payload, sortKey]);

  if (!payload) return <LoadingPage />;

  const sfMax = Math.max(...payload.sectorFlow.map(s => Math.abs(s.netPremium)));
  const selected = selRow !== null ? hits[selRow] : null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT PANEL */}
      <div
        className={clsx(
          "flex flex-col overflow-hidden",
          selected ? "w-[520px] flex-shrink-0" : "flex-1"
        )}
        style={{ borderRight: selected ? "0.5px solid var(--color-border-tertiary)" : "none" }}
      >
        {/* Session header */}
        <div
          className="px-[14px] py-[9px] bg-bg-primary flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <div className="flex items-center gap-[9px] mb-[5px]">
            <span className="text-[14px] font-medium text-text-primary">{payload.sessionMeta.date}</span>
            <span
              className="inline-flex items-center gap-[3px] text-[10px] font-medium rounded-full"
              style={{
                padding: "2px 8px",
                background: payload.sessionMeta.sentiment === "BULLISH" ? "#EAF3DE" : "#FCEBEB",
                color: payload.sessionMeta.sentiment === "BULLISH" ? "#27500A" : "#791F1F",
              }}
            >
              {payload.sessionMeta.sentiment === "BULLISH" ? "▲ Bullish" : "▼ Bearish"}
            </span>
          </div>
          <div className="flex flex-wrap gap-[12px] text-[11px] text-text-secondary">
            <span>
              Premium <b className="font-medium text-text-primary">{payload.sessionMeta.totalPremLabel}</b>
            </span>
            <span>·</span>
            <span>
              Call/Put <b className="font-medium text-text-primary">{payload.sessionMeta.callPutLabel}</b>
            </span>
            <span>·</span>
            <span>
              Lead <b className="font-medium text-text-primary">{payload.sessionMeta.leadSector}</b>
            </span>
          </div>
        </div>

        {/* Sort bar */}
        <div
          className="flex items-center justify-between px-[14px] py-[7px] bg-bg-primary flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <span className="text-[12px] font-medium text-text-primary">
            Hit list <span className="font-normal text-text-secondary">{hits.length} names</span>
          </span>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="text-[10px] rounded-md outline-none cursor-pointer text-text-secondary bg-bg-primary"
            style={{ padding: "3px 7px", border: "0.5px solid var(--color-border-secondary)" }}
          >
            <option value="rank">Sort: Actionability</option>
            <option value="prem">Sort: Premium ↓</option>
            <option value="conf">Sort: Confidence</option>
          </select>
        </div>

        {/* Hit list table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <Th w={22}>#</Th>
                <Th w={66}>Ticker</Th>
                <Th w={48}>Conf.</Th>
                <Th w={68}>Premium</Th>
                <Th w={96}>Contract</Th>
                <Th w={72} center>DP confluence</Th>
                <Th>Thesis</Th>
                <Th w={80}>Sector</Th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h, i) => (
                <tr
                  key={h.rank}
                  onClick={() => { setSelRow(i); setSelContract(0); }}
                  className="cursor-pointer"
                  style={{
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    background: i === selRow ? "var(--color-background-info)" : undefined,
                  }}
                >
                  <Td style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{h.rank}</Td>
                  <Td>
                    <span className="font-medium" style={{ fontSize: 13, color: i === selRow ? "#0C447C" : "#185FA5" }}>{h.ticker}</span>{" "}
                    <span style={{ fontSize: 9, color: h.direction === "UP" ? "#3B6D11" : "#A32D2D" }}>
                      {h.direction === "UP" ? "▲" : "▼"}
                    </span>
                  </Td>
                  <Td>
                    <ConfBadge conf={h.confidence} />
                  </Td>
                  <Td style={{ fontSize: 12, fontWeight: 500, color: h.direction === "UP" ? "#3B6D11" : "#A32D2D" }}>{fmtP(h.premium)}</Td>
                  <Td style={{ fontSize: 11, color: "var(--color-text-primary)" }}>{h.contract}</Td>
                  <Td center>
                    {h.dpConf ? (
                      <span
                        className="inline-flex items-center gap-[3px] font-medium rounded-[3px]"
                        style={{
                          fontSize: 9,
                          padding: "2px 6px",
                          background: "#EEEDFE",
                          color: "#3C3489",
                          border: "0.5px solid #AFA9EC",
                        }}
                      >
                        ● #{h.dpRank}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>—</span>
                    )}
                  </Td>
                  <Td style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{h.thesis}</Td>
                  <Td style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{h.sector}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sector flow */}
        <div
          className="bg-bg-primary flex-shrink-0"
          style={{ padding: "8px 14px", borderTop: "0.5px solid var(--color-border-tertiary)" }}
        >
          <div
            className="text-[9px] font-medium uppercase mb-[6px] text-text-tertiary"
            style={{ letterSpacing: ".05em" }}
          >
            Sector flow
          </div>
          {payload.sectorFlow.map(s => (
            <div key={s.sector} className="flex items-center gap-[6px] mb-[3px]">
              <span style={{ fontSize: 10, color: "var(--color-text-secondary)", width: 100, textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sector}</span>
              <div className="flex-1 overflow-hidden" style={{ height: 5, background: "var(--color-background-secondary)", borderRadius: 3 }}>
                <div
                  style={{
                    height: 5,
                    borderRadius: 3,
                    width: `${Math.abs(s.netPremium / sfMax) * 100}%`,
                    background: s.netPremium >= 0 ? "#639922" : "#E24B4A",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  width: 50,
                  textAlign: "right",
                  flexShrink: 0,
                  color: s.netPremium >= 0 ? "#3B6D11" : "#A32D2D",
                }}
              >
                {s.netPremium >= 0 ? "+" : ""}{fmtP(s.netPremium)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT DETAIL PANEL */}
      {selected && (
        <DetailPanel
          hit={selected}
          selectedContractIdx={selContract}
          onSelectContract={setSelContract}
          onReturn={() => setSelRow(null)}
        />
      )}
    </div>
  );
}

function DetailPanel({
  hit,
  selectedContractIdx,
  onSelectContract,
  onReturn,
}: {
  hit: HitListItem;
  selectedContractIdx: number;
  onSelectContract: (i: number) => void;
  onReturn: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg-primary">
      <div
        className="flex items-center justify-between px-[14px] py-[7px] flex-shrink-0"
        style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
      >
        <button
          onClick={onReturn}
          className="cursor-pointer text-[11px] text-text-secondary hover:text-text-primary"
          style={{ background: "transparent", border: "none", padding: 0 }}
        >
          ↩ Return to overview
        </button>
        <span className="text-[10px] text-text-tertiary">Following focus</span>
      </div>

      <div className="px-[14px] py-[12px] flex-shrink-0" style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[22px] font-medium text-text-primary">{hit.ticker}</div>
            <div className="text-[12px] text-text-secondary">{hit.sector} · #{hit.rank}</div>
          </div>
          <span className="text-[20px] font-medium text-text-primary">${hit.price.toFixed(2)}</span>
        </div>
        <div
          className="inline-flex items-center gap-[5px] font-medium rounded-md"
          style={{
            marginTop: 9,
            marginBottom: 10,
            fontSize: 12,
            padding: "5px 14px",
            background: hit.direction === "UP" ? "#EAF3DE" : "#FCEBEB",
            color: hit.direction === "UP" ? "#27500A" : "#791F1F",
            border: `0.5px solid ${hit.direction === "UP" ? "#639922" : "#A32D2D"}`,
          }}
        >
          {hit.direction === "UP" ? "▲ Bullish" : "▼ Bearish"}
        </div>
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: 8,
          }}
        >
          <DetailMc label="Total premium" value={fmtP(hit.premium)} />
          <DetailMc label="Contracts" value={String(hit.contracts.length)} />
          <DetailMc label="Confidence" value={hit.confidence} valueColor={confColor(hit.confidence)} isLast />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[14px] py-[12px]">
        {/* Why this stands out */}
        <div className="rounded-md bg-bg-secondary" style={{ padding: "9px 11px", marginBottom: 12 }}>
          <div
            className="text-[9px] font-medium uppercase text-text-tertiary"
            style={{ marginBottom: 4, letterSpacing: ".04em" }}
          >
            Why this stands out
          </div>
          <div className="text-[12px] text-text-secondary" style={{ lineHeight: 1.6 }}>{hit.thesis}</div>
        </div>

        {/* Contracts table */}
        <div style={{ marginBottom: 14 }}>
          <SectionLabel>Contracts</SectionLabel>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {["Strike", "Expiry", "Premium", "Rule", "V/OI"].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      fontSize: 9,
                      fontWeight: 500,
                      color: "var(--color-text-tertiary)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      padding: `4px ${i === 4 ? 0 : 8}px`,
                      borderBottom: "0.5px solid var(--color-border-tertiary)",
                      textAlign: i === 4 ? "right" : "left",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hit.contracts.map((c, i) => (
                <tr
                  key={i}
                  onClick={() => onSelectContract(i)}
                  style={{
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    cursor: "pointer",
                    background: i === selectedContractIdx ? "var(--color-background-info)" : undefined,
                  }}
                >
                  <td style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", padding: "6px 8px" }}>{c.strikeLabel}</td>
                  <td style={{ color: "var(--color-text-secondary)", padding: "6px 8px" }}>{c.expiryLabel}</td>
                  <td style={{ fontWeight: 500, color: "#3B6D11", padding: "6px 8px" }}>{c.premiumLabel}</td>
                  <td style={{ fontSize: 10, color: "var(--color-text-secondary)", padding: "6px 8px" }}>{c.rule}</td>
                  <td style={{ fontWeight: 500, color: "#3B6D11", textAlign: "right", padding: "6px 0" }}>{c.vOiLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Dark pool confluence */}
        <div
          style={{
            padding: "9px 11px",
            marginBottom: 12,
            borderRadius: "0 8px 8px 0",
            background: hit.dpConf ? "#EEEDFE" : "var(--color-background-secondary)",
            borderLeft: `3px solid ${hit.dpConf ? "#7F77DD" : "var(--color-border-secondary)"}`,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: ".04em",
              marginBottom: 4,
              color: hit.dpConf ? "#3C3489" : "var(--color-text-tertiary)",
            }}
          >
            {hit.dpConf ? "Dark pool confluence detected" : "No dark pool confluence"}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: hit.dpConf ? "#534AB7" : "var(--color-text-secondary)" }}>
            {hit.dpConf
              ? <>Ranked dark pool print <b>{hit.dpAge}</b> — rank <b>#{hit.dpRank}</b> · {fmtP(hit.dpPrem ?? 0)} print. Options + DP within 48h is a high-conviction signal.</>
              : `No ranked dark pool trades found for ${hit.ticker} in the last 48 hours.`}
          </div>
        </div>

        {/* Peers */}
        {hit.peers.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <SectionLabel>Sector peers with flow today</SectionLabel>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {hit.peers.map(p => (
                <span
                  key={p.ticker}
                  className="inline-flex items-center gap-[3px] rounded-md font-medium"
                  style={{
                    padding: "3px 9px",
                    fontSize: 11,
                    background: p.highlighted ? "#E6F1FB" : "var(--color-background-secondary)",
                    color: p.highlighted ? "#0C447C" : "var(--color-text-secondary)",
                    border: `0.5px solid ${p.highlighted ? "#185FA5" : "var(--color-border-secondary)"}`,
                  }}
                >
                  <span style={{ fontSize: 10, color: p.direction === "UP" ? "#3B6D11" : "#A32D2D" }}>
                    {p.direction === "UP" ? "▲" : "▼"}
                  </span>
                  {p.ticker}
                  <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginLeft: 2 }}>{p.premiumLabel}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Theme */}
        <div style={{ marginBottom: 14 }}>
          <SectionLabel>Related theme</SectionLabel>
          <div className="rounded-md bg-bg-secondary" style={{ padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>{hit.theme.name}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#3B6D11" }}>{hit.theme.totalPremiumLabel}</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {hit.theme.tickers.map(t => {
                const highlighted = t === hit.ticker;
                return (
                  <span
                    key={t}
                    className="rounded-md"
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      background: highlighted ? "#E6F1FB" : "var(--color-background-primary)",
                      border: `0.5px solid ${highlighted ? "#185FA5" : "var(--color-border-secondary)"}`,
                      color: highlighted ? "#0C447C" : "var(--color-text-secondary)",
                      fontWeight: highlighted ? 500 : undefined,
                    }}
                  >
                    {t}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Th({ children, w, center }: { children: React.ReactNode; w?: number; center?: boolean }) {
  return (
    <th
      style={{
        position: "sticky",
        top: 0,
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
        width: w,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
  center,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  center?: boolean;
}) {
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

function ConfBadge({ conf }: { conf: string }) {
  return (
    <span
      className={clsx(confClass(conf))}
      style={{
        fontSize: 9,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 3,
        display: "inline-flex",
        alignItems: "center",
        background: conf === "HIGH" ? "#EAF3DE" : conf === "MOD" || conf === "MED" ? "#FAEEDA" : "#FCEBEB",
        color: conf === "HIGH" ? "#27500A" : conf === "MOD" || conf === "MED" ? "#633806" : "#791F1F",
      }}
    >
      {conf}
    </span>
  );
}

function DetailMc({
  label,
  value,
  valueColor,
  isLast,
}: {
  label: string;
  value: string;
  valueColor?: string;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        textAlign: "center",
        borderRight: isLast ? undefined : "0.5px solid var(--color-border-tertiary)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 500,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: ".04em",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: valueColor ?? "var(--color-text-primary)" }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 500,
        color: "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: ".05em",
        marginBottom: 7,
      }}
    >
      {children}
    </div>
  );
}

function LoadingPage() {
  return (
    <div className="flex flex-1 items-center justify-center text-text-tertiary text-[12px]">
      Loading hit list…
    </div>
  );
}
