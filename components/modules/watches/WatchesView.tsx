"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  if (c === "HIGH") return "#7FBF52";
  if (c === "MOD" || c === "MED") return "#E2BF73";
  return "#E76A6A";
}

type SortKey = "rank" | "prem" | "conf";

export function WatchesView() {
  const router = useRouter();
  const [payload, setPayload] = useState<HitListPayload | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [selRow, setSelRow] = useState<number | null>(0);
  const [selContract, setSelContract] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  // null = latest session; a YYYY-MM-DD selects a prior day's hit list (30-day history).
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`/api/watches${date ? `?date=${date}` : ""}`).then(r => r.json()).then(p => { if (!cancelled) setPayload(p); }).catch(() => {});
    load();
    // Refresh so live trade alerts stay current as new trades are alerted.
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [date]);

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
  const showPanel = !!selected && panelOpen;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* LEFT PANEL — half the screen while the detail pane is open */}
      <div
        className={clsx(
          "flex flex-col overflow-hidden",
          showPanel ? "w-1/2 flex-shrink-0" : "flex-1"
        )}
        style={{ borderRight: showPanel ? "0.5px solid var(--color-border-tertiary)" : "none" }}
      >
        {/* Session header */}
        <div
          className="px-[14px] py-[9px] bg-bg-primary flex-shrink-0"
          style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}
        >
          <div className="flex items-center gap-[9px] mb-[5px]">
            {payload.availableDates && payload.availableDates.length > 1 ? (
              <select
                value={date ?? payload.availableDates[0]}
                onChange={e => {
                  const v = e.target.value;
                  setDate(v === payload.availableDates![0] ? null : v);
                  setSelRow(0);
                  setSelContract(0);
                }}
                className="text-[13px] font-medium rounded-md outline-none cursor-pointer text-text-primary bg-bg-primary"
                style={{ padding: "3px 7px", border: "0.5px solid var(--color-border-secondary)" }}
                title="View a prior day's hit list (up to 30 days back)"
              >
                {payload.availableDates.map((d, i) => (
                  <option key={d} value={d}>
                    {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
                    {i === 0 ? " · latest" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[14px] font-medium text-text-primary">{payload.sessionMeta.date}</span>
            )}
            <span
              className="inline-flex items-center gap-[3px] text-[10px] font-medium rounded-full"
              style={{
                padding: "2px 8px",
                background: payload.sessionMeta.sentiment === "BULLISH" ? "rgba(127, 191, 82, 0.14)" : "rgba(231, 106, 106, 0.14)",
                color: payload.sessionMeta.sentiment === "BULLISH" ? "#7FBF52" : "#E76A6A",
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
                <Th w={64}>Ticker</Th>
                <Th w={42}>Score</Th>
                <Th w={48}>Conf.</Th>
                <Th w={68}>Premium</Th>
                <Th w={96}>Contract</Th>
                <Th w={124} center>Signals</Th>
                <Th w={92} center>Open Trade Alert</Th>
                <Th>Thesis</Th>
                {!showPanel && <Th w={80}>Sector</Th>}
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
                    // Live trade alerted on this ticker → gold-tinted row.
                    background: i === selRow
                      ? "var(--color-background-info)"
                      : h.openAlerts?.length ? "rgba(201, 165, 90, 0.07)" : undefined,
                    boxShadow: h.openAlerts?.length ? "inset 2.5px 0 0 #C9A55A" : undefined,
                  }}
                >
                  <Td style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{h.rank}</Td>
                  <Td>
                    <span className="font-medium" style={{ fontSize: 13, color: "#C9A55A" }}>{h.ticker}</span>{" "}
                    <span style={{ fontSize: 9, color: h.direction === "UP" ? "#7FBF52" : "#E76A6A" }}>
                      {h.direction === "UP" ? "▲" : "▼"}
                    </span>
                  </Td>
                  <Td style={{ fontSize: 12, fontWeight: 600, color: "#C9A55A" }}>{h.score != null ? h.score.toFixed(1) : "—"}</Td>
                  <Td>
                    <ConfBadge conf={h.confidence} />
                  </Td>
                  <Td style={{ fontSize: 12, fontWeight: 500, color: h.direction === "UP" ? "#7FBF52" : "#E76A6A" }}>{fmtP(h.premium)}</Td>
                  <Td style={{ fontSize: 11, color: "var(--color-text-primary)" }}>{h.contract}</Td>
                  <Td center>
                    <SignalBadges hit={h} />
                  </Td>
                  <Td center>
                    {h.openAlerts && h.openAlerts.length > 0 ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push("/trade-alerts"); }}
                        title={`Live trade alert${h.openAlerts.length > 1 ? "s" : ""}: ${h.openAlerts.map(a => a.contract).join(", ")} — click to open Trade alerts`}
                        className="cursor-pointer"
                        style={{ background: "transparent", border: "none", padding: 0, fontSize: 11, color: "#C9A55A", fontWeight: 600 }}
                      >
                        🔔{h.openAlerts.length > 1 ? h.openAlerts.length : ""}
                      </button>
                    ) : (
                      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>—</span>
                    )}
                  </Td>
                  <td
                    title={h.thesis}
                    style={{ padding: "6px 10px", verticalAlign: "middle", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0, fontSize: 11, color: "var(--color-text-secondary)" }}
                  >
                    {h.thesis}
                  </td>
                  {!showPanel && (
                    <Td style={{ fontSize: 10, color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis" }}>{h.sector}</Td>
                  )}
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
                    background: s.netPremium >= 0 ? "#7FBF52" : "#E76A6A",
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
                  color: s.netPremium >= 0 ? "#7FBF52" : "#E76A6A",
                }}
              >
                {s.netPremium >= 0 ? "+" : ""}{fmtP(s.netPremium)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT DETAIL PANEL (minimizable) */}
      {showPanel && selected && (
        <DetailPanel
          hit={selected}
          selectedContractIdx={selContract}
          onSelectContract={setSelContract}
          onReturn={() => setSelRow(null)}
          onMinimize={() => setPanelOpen(false)}
        />
      )}
      {selected && !panelOpen && (
        <button
          onClick={() => setPanelOpen(true)}
          title={`Expand ${selected.ticker} detail`}
          className="flex flex-col items-center flex-shrink-0 cursor-pointer bg-bg-primary hover:bg-bg-secondary"
          style={{ width: 26, border: "none", borderLeft: "0.5px solid var(--color-border-tertiary)", padding: "10px 0", gap: 8 }}
        >
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>«</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#C9A55A", writingMode: "vertical-rl" }}>{selected.ticker}</span>
        </button>
      )}
    </div>
  );
}

function DetailPanel({
  hit,
  selectedContractIdx,
  onSelectContract,
  onReturn,
  onMinimize,
}: {
  hit: HitListItem;
  selectedContractIdx: number;
  onSelectContract: (i: number) => void;
  onReturn: () => void;
  onMinimize: () => void;
}) {
  const router = useRouter();
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
        <button
          onClick={onMinimize}
          title="Minimize panel"
          className="cursor-pointer text-[11px] text-text-secondary hover:text-text-primary"
          style={{ background: "transparent", border: "none", padding: 0 }}
        >
          Minimize »
        </button>
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
            background: hit.direction === "UP" ? "rgba(127, 191, 82, 0.14)" : "rgba(231, 106, 106, 0.14)",
            color: hit.direction === "UP" ? "#7FBF52" : "#E76A6A",
            border: `0.5px solid ${hit.direction === "UP" ? "#7FBF52" : "#E76A6A"}`,
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
        {/* Live trade alerts on this ticker */}
        {hit.openAlerts && hit.openAlerts.length > 0 && (
          <div
            style={{
              padding: "9px 11px",
              marginBottom: 12,
              borderRadius: "0 8px 8px 0",
              background: "rgba(201, 165, 90, 0.10)",
              borderLeft: "3px solid #C9A55A",
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6, color: "#C9A55A" }}>
              🔔 Live trade alert{hit.openAlerts.length > 1 ? "s" : ""} on {hit.ticker}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {hit.openAlerts.map((a, i) => (
                <button
                  key={i}
                  onClick={() => router.push("/trade-alerts")}
                  title={`Open in Trade alerts — alerted by ${a.moderator}`}
                  className="inline-flex items-center gap-[5px] rounded-md cursor-pointer hover:opacity-85"
                  style={{
                    padding: "3px 9px",
                    fontSize: 11,
                    fontWeight: 600,
                    background: "var(--color-background-primary)",
                    border: "0.5px solid #C9A55A",
                    color: a.side === "PUT" ? "#E76A6A" : "#7FBF52",
                  }}
                >
                  {a.contract}
                  {a.livePct != null && (
                    <span style={{ fontWeight: 500, color: a.livePct >= 0 ? "#7FBF52" : "#E76A6A" }}>
                      {a.livePct >= 0 ? "+" : ""}{a.livePct.toFixed(1)}%
                    </span>
                  )}
                  <span style={{ fontSize: 9, fontWeight: 400, color: "var(--color-text-tertiary)" }}>{a.moderator} ↗</span>
                </button>
              ))}
            </div>
          </div>
        )}

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


        {/* Confluence breakdown — factors only; per-signal weightings stay internal */}
        {hit.signals && (
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Confluence score · {hit.signals.total}</SectionLabel>
            <div className="rounded-md bg-bg-secondary" style={{ padding: "8px 11px" }}>
              <ScoreRow label={`Flow — ${fmtP(hit.signals.flow.premium)} / ${hit.signals.flow.alerts} alerts`} />
              {hit.signals.sentiment && (
                <ScoreRow label={`Sentiment — C/P ${hit.signals.sentiment.cpRatio.toFixed(2)} ${hit.signals.sentiment.side === "UP" ? "bullish" : "bearish"}`} />
              )}
              {hit.signals.darkpool && <ScoreRow label={`Dark pool — rank #${hit.signals.darkpool.rank}`} />}
              {hit.signals.persistence && (
                <ScoreRow label={`Persistence — ${hit.signals.persistence.days} of ${hit.signals.persistence.of} sessions`} />
              )}
              {hit.signals.agree != null && (
                <div style={{ fontSize: 10, marginTop: 5, color: hit.signals.agree ? "#7FBF52" : "var(--color-text-tertiary)" }}>
                  {hit.signals.agree ? "✓ Flow and sentiment agree on direction" : "Flow and sentiment point different ways"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Move targets — direction-matched: upside for bullish (call) picks,
            downside for bearish (put) picks. Derivation (weekly ATR) is
            intentionally not surfaced in the UI. */}
        {hit.atrTargets && (
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Move targets</SectionLabel>
            <div
              className="grid overflow-hidden rounded-md"
              style={{ gridTemplateColumns: "repeat(3, 1fr)", border: "0.5px solid var(--color-border-tertiary)" }}
            >
              {hit.direction === "UP" ? (
                <>
                  <AtrCell label="Target 1" value={hit.atrTargets.up05} up primary />
                  <AtrCell label="Target 2" value={hit.atrTargets.up1} up primary />
                  <AtrCell label="Target 3" value={hit.atrTargets.up2} up primary isLast />
                </>
              ) : (
                <>
                  <AtrCell label="Target 1" value={hit.atrTargets.dn05} primary />
                  <AtrCell label="Target 2" value={hit.atrTargets.dn1} primary />
                  <AtrCell label="Target 3" value={hit.atrTargets.dn2} primary isLast />
                </>
              )}
            </div>
            <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 4 }}>
              From last close ${hit.price.toFixed(2)}
            </div>
          </div>
        )}

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
                  <td style={{ fontWeight: 500, color: "#7FBF52", padding: "6px 8px" }}>{c.premiumLabel}</td>
                  <td style={{ fontSize: 10, color: "var(--color-text-secondary)", padding: "6px 8px" }}>{c.rule}</td>
                  <td style={{ fontWeight: 500, color: "#7FBF52", textAlign: "right", padding: "6px 0" }}>{c.vOiLabel}</td>
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
                    background: p.highlighted ? "rgba(201, 165, 90, 0.18)" : "var(--color-background-secondary)",
                    color: p.highlighted ? "#C9A55A" : "var(--color-text-secondary)",
                    border: `0.5px solid ${p.highlighted ? "#C9A55A" : "var(--color-border-secondary)"}`,
                  }}
                >
                  <span style={{ fontSize: 10, color: p.direction === "UP" ? "#7FBF52" : "#E76A6A" }}>
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
              <span style={{ fontSize: 12, fontWeight: 500, color: "#7FBF52" }}>{hit.theme.totalPremiumLabel}</span>
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
                      background: highlighted ? "rgba(201, 165, 90, 0.18)" : "var(--color-background-primary)",
                      border: `0.5px solid ${highlighted ? "#C9A55A" : "var(--color-border-secondary)"}`,
                      color: highlighted ? "#C9A55A" : "var(--color-text-secondary)",
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

        {/* AI briefing — news, signals, recent move (generated premarket) */}
        {hit.aiSummary && (
          <div className="rounded-md bg-bg-secondary" style={{ padding: "9px 11px", marginBottom: 12 }}>
            <div
              className="text-[9px] font-medium uppercase"
              style={{ marginBottom: 4, letterSpacing: ".04em", color: "#C9A55A" }}
            >
              ✦ AI briefing
            </div>
            <div className="text-[12px] text-text-secondary" style={{ lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{hit.aiSummary}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Compact per-row badges: which confluence categories fired.
function SignalBadges({ hit }: { hit: HitListItem }) {
  const s = hit.signals;
  if (!s) {
    // Pre-confluence rows: fall back to the old DP pill.
    return hit.dpConf
      ? <Badge bg="#EEEDFE" color="#3C3489" border="#AFA9EC" title={`Dark pool — ranked print #${hit.dpRank} in the last 48h`}>DP</Badge>
      : <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>—</span>;
  }
  return (
    <span className="inline-flex items-center gap-[3px]" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
      <Badge bg="rgba(90,169,230,0.14)" color="#5AA9E6" border="rgba(90,169,230,0.4)" title={`Options flow — ${fmtP(s.flow.premium)} across ${s.flow.alerts} alerts`}>F</Badge>
      {s.sentiment && (
        <Badge
          bg={s.sentiment.side === "UP" ? "rgba(127,191,82,0.14)" : "rgba(231,106,106,0.14)"}
          color={s.sentiment.side === "UP" ? "#7FBF52" : "#E76A6A"}
          border={s.sentiment.side === "UP" ? "rgba(127,191,82,0.4)" : "rgba(231,106,106,0.4)"}
          title={`Sentiment — C/P ${s.sentiment.cpRatio.toFixed(2)} ${s.sentiment.side === "UP" ? "bullish" : "bearish"}${s.agree ? ", confirms flow" : ""}`}
        >
          S
        </Badge>
      )}
      {s.darkpool && <Badge bg="#EEEDFE" color="#3C3489" border="#AFA9EC" title={`Dark pool — ranked print #${s.darkpool.rank} in the last 48h`}>DP</Badge>}
      {s.persistence && (
        <Badge bg="rgba(201,165,90,0.16)" color="#C9A55A" border="rgba(201,165,90,0.45)" title={`Persistence — signaled ${s.persistence.days} of the last ${s.persistence.of} sessions`}>
          ×{s.persistence.days}
        </Badge>
      )}
    </span>
  );
}

// Badge with an instant styled tooltip (native `title` is slow/unreliable and
// the `help` cursor reads as a bare "?").
function Badge({ children, bg, color, border, title }: { children: React.ReactNode; bg: string; color: string; border: string; title?: string }) {
  return (
    <span className="relative inline-flex group">
      <span
        className="inline-flex items-center font-medium rounded-[3px]"
        style={{ fontSize: 9, padding: "2px 5px", background: bg, color, border: `0.5px solid ${border}` }}
      >
        {children}
      </span>
      {title && (
        <span
          className="pointer-events-none absolute hidden group-hover:block"
          style={{
            top: "calc(100% + 5px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            whiteSpace: "nowrap",
            fontSize: 10.5,
            fontWeight: 400,
            lineHeight: 1.4,
            padding: "5px 9px",
            borderRadius: 6,
            background: "var(--color-background-primary)",
            color: "var(--color-text-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
          }}
        >
          {title}
        </span>
      )}
    </span>
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
        background: conf === "HIGH" ? "rgba(127, 191, 82, 0.14)" : conf === "MOD" || conf === "MED" ? "#FAEEDA" : "rgba(231, 106, 106, 0.14)",
        color: conf === "HIGH" ? "#7FBF52" : conf === "MOD" || conf === "MED" ? "#633806" : "#E76A6A",
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

function ScoreRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[8px]" style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: "#7FBF52", flexShrink: 0 }}>✓</span>
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

function AtrCell({ label, value, up, primary, isLast }: { label: string; value: number; up?: boolean; primary?: boolean; isLast?: boolean }) {
  const color = up ? "#7FBF52" : "#E76A6A";
  return (
    <div
      style={{
        padding: "7px 8px",
        textAlign: "center",
        borderRight: isLast ? undefined : "0.5px solid var(--color-border-tertiary)",
        background: primary ? (up ? "rgba(127,191,82,0.07)" : "rgba(231,106,106,0.07)") : undefined,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 600, color, letterSpacing: ".03em", marginBottom: 2, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>${value.toFixed(2)}</div>
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
