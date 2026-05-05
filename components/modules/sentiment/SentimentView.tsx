"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import type { SentimentOverview } from "@/lib/types";
import {
  buildSentimentDisplayRows,
  buildSectorDisplayRows,
  buildAnalystDisplayRows,
  MENTIONED_ROWS,
  ACCURACY_LEADERS,
  TOP_BUYS,
  TOP_SELLS,
  PORTFOLIO_ROWS,
  RECENT_CALLS_ROWS,
  TICKER_ACC_ROWS,
  RECENT_ANALYST_POSTS,
  type AnalystDisplayRow,
  type SentimentDisplayRow,
} from "@/lib/mock/sentiment-data";
import { TabBar } from "@/components/layout/TabBar";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "analysts", label: "Analyst intelligence" },
];

export function SentimentView() {
  const searchParams = useSearchParams();
  const tabIdx = Number(searchParams.get("tab") ?? 0);
  const activeId = TABS[tabIdx]?.id ?? "overview";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar tabs={TABS} activeId={activeId} onChange={() => {}} />
      {activeId === "overview" ? <OverviewTab /> : <AnalystTab />}
    </div>
  );
}

// =====================================================
// OVERVIEW
// =====================================================

function OverviewTab() {
  const [data, setData] = useState<SentimentOverview | null>(null);
  const [velFilter, setVelFilter] = useState<"All" | "Bull" | "Bear">("All");

  useEffect(() => {
    fetch("/api/sentiment?view=overview").then(r => r.json()).then(setData);
  }, []);

  if (!data) return <Loading label="Loading sentiment…" />;

  const rows = buildSentimentDisplayRows();
  const filtered = rows.filter(r =>
    velFilter === "All" ? true : velFilter === "Bull" ? r.pill === "bull" : r.pill === "bear"
  );
  const sects = buildSectorDisplayRows();

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ padding: 16, background: "var(--color-background-tertiary)" }}
    >
      {/* Page header */}
      <div className="flex items-start justify-between" style={{ marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
            FinTwit sentiment tracker
          </h1>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Apr 20, 2026 · 8:47 AM ET · {data.postsAnalyzed.toLocaleString()} posts analyzed
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            style={{
              fontSize: 10,
              padding: "3px 10px",
              borderRadius: 20,
              border: "0.5px solid #C9A55A",
              background: "rgba(201, 165, 90, 0.18)",
              color: "#C9A55A",
            }}
          >
            Pre-market
          </button>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Next run 8:00 AM</span>
        </div>
      </div>

      {/* grid4 */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12 }}>
        <Mc label="Overall sentiment" value="Bullish" valueClass="up" sub="Score 68 / 100" subClass="up" />
        <Mc label="Posts analyzed" value={data.postsAnalyzed.toLocaleString()} sub="Last 24 hours" subClass="neu" />
        <Mc label="Top velocity mover" value="PLTR" sub="+340% vs 7-day avg" subClass="up" />
        <Mc label="Divergence alerts" value="3" valueClass="warn" sub="Sentiment vs price" subClass="warn" />
      </div>

      {/* grid2: top tickers | (market sentiment + divergence) */}
      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 12, marginBottom: 12 }}>
        <Card>
          <CardTitle
            right={
              <div style={{ display: "flex", gap: 4 }}>
                {(["All", "Bull", "Bear"] as const).map(f => (
                  <FilterChip key={f} label={f} active={velFilter === f} onClick={() => setVelFilter(f)} />
                ))}
              </div>
            }
          >
            Top tickers by mention velocity
          </CardTitle>
          {filtered.map((r, i) => (
            <TickerRow key={r.ticker} row={r} rank={i + 1} />
          ))}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Card>
            <CardTitle rightText="24h">Market sentiment</CardTitle>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 500, color: "#7FBF52" }}>68</div>
                <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>Mod. bullish</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 3 }}>
                  Bull {data.overall.bullPct}% · Neu {data.overall.neutralPct}% · Bear {data.overall.bearPct}%
                </div>
                <div style={{ height: 7, borderRadius: 4, background: "var(--color-background-secondary)", overflow: "hidden", display: "flex", marginTop: 4 }}>
                  <div style={{ background: "#7FBF52", width: `${data.overall.bullPct}%` }} />
                  <div style={{ background: "#B4B2A9", width: `${data.overall.neutralPct}%` }} />
                  <div style={{ background: "#E76A6A", width: `${data.overall.bearPct}%` }} />
                </div>
                <div style={{ fontSize: 10, color: "#7FBF52", marginTop: 4 }}>
                  Trending up {data.overall.trendVsYesterday >= 0 ? "+" : ""}
                  {data.overall.trendVsYesterday}pts vs yesterday
                </div>
              </div>
            </div>
            <Divider compact />
            <CardTitle small>Sector sentiment</CardTitle>
            {sects.map(s => (
              <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)", width: 68 }}>{s.name}</span>
                <div style={{ flex: 1, height: 6, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: 6, borderRadius: 3, width: s.pctLabel, background: s.color }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 500, width: 30, textAlign: "right", color: s.color }}>{s.pctLabel}</span>
              </div>
            ))}
          </Card>

          <Card>
            <CardTitle rightText="sentiment vs price">Divergence alerts</CardTitle>
            {data.divergenceAlerts.map(a => {
              const dotColor = a.severity === "red" ? "#E76A6A" : a.severity === "green" ? "#7FBF52" : "#C9A55A";
              const titleText =
                a.severity === "red" ? `${a.ticker} bearish flip` :
                a.severity === "green" ? `${a.ticker} bullish surge` :
                `${a.ticker} mixed signal`;
              return (
                <div
                  key={a.ticker}
                  style={{ display: "flex", gap: 7, padding: "5px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 4 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>{titleText}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{a.description}</div>
                  </div>
                  <span style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}>{a.time}</span>
                </div>
              );
            })}
          </Card>
        </div>
      </div>

      {/* grid3: Notable posts | New entrants & flips | AI summary */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle rightText="top by engagement">Notable posts</CardTitle>
          {NOTABLE_POST_VIEW.map(p => (
            <div key={p.handle} style={{ padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 7,
                    fontWeight: 500,
                    background: p.avBg,
                    color: p.avText,
                    flexShrink: 0,
                  }}
                >
                  {p.initials}
                </div>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>{p.handle}</span>
                <Pill pill={p.pill} style={{ marginLeft: 2 }} />
                <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>{p.time}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.45 }}>
                {renderPostBody(p.body)}
              </div>
              <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 2 }}>{p.engagement}</div>
            </div>
          ))}
        </Card>

        <Card>
          <CardTitle>New entrants &amp; flips</CardTitle>
          <SectionLabel>First time in top 20</SectionLabel>
          {NEW_ENTRANTS.map(r => (
            <SrRow key={r.ticker} sym={r.ticker} name={r.name} trailing={
              <Badge bg="rgba(127, 191, 82, 0.14)" color="#7FBF52">{r.badge}</Badge>
            } />
          ))}
          <Divider compact />
          <SectionLabel>Biggest sentiment flips</SectionLabel>
          {FLIPS.map(r => (
            <SrRow
              key={r.ticker}
              sym={r.ticker}
              name={r.name}
              symColor={r.symColor}
              trailing={<Badge bg={r.badgeBg} color={r.badgeText}>{r.badge}</Badge>}
            />
          ))}
        </Card>

        <Card>
          <CardTitle rightText="generated 8:47 AM">AI summary</CardTitle>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
            {data.aiSummary.body}
          </div>
          <Divider compact />
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
            Generated by Claude · Based on {data.postsAnalyzed.toLocaleString()} posts · Refreshed daily pre-market
          </div>
        </Card>
      </div>
    </div>
  );
}

const NOTABLE_POST_VIEW = [
  { initials: "KB", avBg: "rgba(201, 165, 90, 0.18)", avText: "#C9A55A", handle: "@KobeissiLetter",  pill: "bull" as const, time: "6:04 AM", body: "Massive institutional buying on $PLTR. Options flow screaming calls.", engagement: "4.2K likes · 312K followers" },
  { initials: "TW", avBg: "#FAECE7", avText: "#E76A6A", handle: "@TechWatcher",     pill: "bear" as const, time: "7:18 AM", body: "$META earnings whisper below consensus. Preparing for gap down.",      engagement: "2.8K likes · 188K followers" },
  { initials: "MV", avBg: "#E1F5EE", avText: "#7FBF52", handle: "@MarketVigilante", pill: "mix"  as const, time: "8:02 AM", body: "$TSLA delivery numbers Thursday. Bulls and bears loaded.",             engagement: "1.9K likes · 245K followers" },
];

const NEW_ENTRANTS = [
  { ticker: "SMCI", name: "Super Micro", badge: "new entry" },
  { ticker: "COIN", name: "Coinbase",    badge: "new entry" },
  { ticker: "HOOD", name: "Robinhood",   badge: "new entry" },
];

const FLIPS = [
  { ticker: "META", name: "Bull → Bear",          symColor: "#E76A6A", badge: "-41 pts", badgeBg: "rgba(231, 106, 106, 0.14)", badgeText: "#E76A6A" },
  { ticker: "PLTR", name: "Bear → Bull",          symColor: "#7FBF52", badge: "+38 pts", badgeBg: "rgba(127, 191, 82, 0.14)", badgeText: "#7FBF52" },
  { ticker: "NVDA", name: "Momentum building",    symColor: "#7FBF52", badge: "+22 pts", badgeBg: "rgba(127, 191, 82, 0.14)", badgeText: "#7FBF52" },
];

function SrRow({ sym, name, symColor, trailing }: { sym: string; name: string; symColor?: string; trailing: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
      <span style={{ fontSize: 11, fontWeight: 500, width: 38, color: symColor ?? "var(--color-text-primary)" }}>{sym}</span>
      <span style={{ fontSize: 10, color: "var(--color-text-secondary)", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{name}</span>
      <span style={{ marginLeft: "auto" }}>{trailing}</span>
    </div>
  );
}

function TickerRow({ row, rank }: { row: SentimentDisplayRow; rank: number }) {
  const velClass = row.pill === "bull" ? "up" : row.pill === "bear" ? "dn" : "warn";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", width: 14 }}>{rank}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)", width: 38 }}>{row.ticker}</span>
      <span style={{ fontSize: 10, color: "var(--color-text-secondary)", width: 80, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{row.name}</span>
      <div style={{ flex: 1, height: 4, background: "var(--color-background-secondary)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: 4, borderRadius: 2, width: row.velocityPctLabel, background: row.barColor }} />
      </div>
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          width: 44,
          textAlign: "right",
          color: velClass === "up" ? "#7FBF52" : velClass === "dn" ? "#E76A6A" : "#E2BF73",
        }}
      >
        {row.velocityChangeLabel}
      </span>
      <Pill pill={row.pill} />
    </div>
  );
}

// =====================================================
// ANALYST INTELLIGENCE
// =====================================================

function AnalystTab() {
  const analysts = buildAnalystDisplayRows();
  const [view, setView] = useState<"agg" | "ind">("agg");
  const [selected, setSelected] = useState(0);

  const selectAnalyst = (i: number) => {
    setSelected(i);
    setView("ind");
  };

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ padding: 16, background: "var(--color-background-tertiary)" }}
    >
      {/* Header + sort buttons */}
      <div className="flex items-start justify-between" style={{ marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>
            Analyst intelligence
          </h1>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Tracking 24 analysts · 100K+ followers · Apr 20, 2026
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <SortButton>Most followers</SortButton>
          <SortButton active>Best accuracy</SortButton>
        </div>
      </div>

      {/* View toggle */}
      <div
        style={{
          display: "flex",
          background: "var(--color-background-secondary)",
          borderRadius: 8,
          padding: 2,
          gap: 2,
          width: "fit-content",
          marginBottom: 12,
        }}
      >
        <VtBtn active={view === "agg"} onClick={() => setView("agg")}>Aggregate view</VtBtn>
        <VtBtn active={view === "ind"} onClick={() => setView("ind")}>Individual analyst</VtBtn>
      </div>

      {/* Top X analysts carousel card */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: ".04em",
            }}
          >
            Top X analysts
          </span>
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
            {view === "agg" ? "Click any analyst to open individual view" : "Select analyst to view profile"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 3,
          }}
        >
          {analysts.map((a, i) => (
            <AnalystChip
              key={a.handle}
              analyst={a}
              selected={view === "ind" && i === selected}
              onClick={() => selectAnalyst(i)}
            />
          ))}
        </div>
        {view === "agg" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
            <input type="checkbox" style={{ width: 12, height: 12, cursor: "pointer" }} />
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Show only analysts I track</span>
          </div>
        )}
      </Card>

      {view === "agg" ? <AggregateView /> : <IndividualView analyst={analysts[selected]!} />}
    </div>
  );
}

function AggregateView() {
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12 }}>
        <Mc label="Analysts tracked" value="24"      sub="100K+ followers"      subClass="neu" />
        <Mc label="Aggregate bias"   value="Bullish" valueClass="up" sub="16 / 24 bull-leaning" subClass="up" />
        <Mc label="Most mentioned"   value="NVDA"    sub="18 analysts today"    subClass="neu" />
        <Mc label="Top accuracy"     value="68%"     valueClass="up" sub="@KobeissiLetter"      subClass="up" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 12, marginBottom: 12 }}>
        <Card>
          <CardTitle rightText="across all analysts today">Most mentioned</CardTitle>
          {MENTIONED_ROWS.map((r, i) => (
            <div key={r.ticker} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", width: 12 }}>{i + 1}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)", width: 38 }}>{r.ticker}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-secondary)", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{r.name}</span>
              <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", width: 72, textAlign: "right" }}>{r.analystCount}</span>
              <Pill pill={r.pill} />
            </div>
          ))}
        </Card>

        <Card>
          <CardTitle rightText="30-day calls">Accuracy leaderboard</CardTitle>
          {ACCURACY_LEADERS.map(l => (
            <div key={l.handle} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{l.handle}</span>
                <span
                  style={{
                    color: l.tone === "up" ? "#7FBF52" : l.tone === "dn" ? "#E76A6A" : "#E2BF73",
                  }}
                >
                  {l.pctLabel}
                </span>
              </div>
              <div style={{ height: 5, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden", marginTop: 2 }}>
                <div style={{ height: 5, borderRadius: 3, width: `${l.pct}%`, background: l.barColor }} />
              </div>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 4 }}>
            Directional accuracy within 5 trading days
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <BuySellCard title="Top buys"  subtitle="bullish calls · today's % move" rows={TOP_BUYS}  tonedPill="bull" />
        <BuySellCard title="Top sells" subtitle="bearish calls · today's % move" rows={TOP_SELLS} tonedPill="bear" />
      </div>
    </>
  );
}

function BuySellCard({
  title,
  subtitle,
  rows,
  tonedPill,
}: {
  title: string;
  subtitle: string;
  rows: typeof TOP_BUYS;
  tonedPill: "bull" | "bear";
}) {
  return (
    <Card>
      <CardTitle rightText={subtitle}>{title}</CardTitle>
      {rows.map((r, i) => (
        <div key={r.ticker} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
          <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", width: 12 }}>{i + 1}</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)", width: 38 }}>{r.ticker}</span>
          <span style={{ fontSize: 10, color: "var(--color-text-secondary)", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{r.name}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              width: 42,
              textAlign: "right",
              color: r.direction === "up" ? "#7FBF52" : "#E76A6A",
            }}
          >
            {r.pctLabel}
          </span>
          <Pill pill={tonedPill} />
        </div>
      ))}
      <Divider compact />
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
        % = today's price change · Unusual Whales
      </div>
    </Card>
  );
}

function IndividualView({ analyst }: { analyst: AnalystDisplayRow }) {
  return (
    <>
      {/* Profile card */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: analyst.avatarBg,
              color: analyst.avatarText,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {analyst.initials}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>
                {analyst.displayName}
              </span>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{analyst.handle}</span>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 9px",
                  borderRadius: 20,
                  background: analyst.biasBg,
                  color: analyst.biasText,
                }}
              >
                {analyst.bias} bias
              </span>
              <button
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  padding: "3px 12px",
                  borderRadius: 20,
                  border: "0.5px solid #C9A55A",
                  background: "rgba(201, 165, 90, 0.18)",
                  color: "#C9A55A",
                  cursor: "pointer",
                }}
              >
                + Track
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 8 }}>{analyst.bio}</p>
            <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              <Mc label="Followers"     value={analyst.followersLabel}     subClass="neu" />
              <Mc label="Bull/bear"     value={analyst.bullBearLabel}      valueClass="up" subClass="up" />
              <Mc label="Posts/day"     value={analyst.postsPerDay}        subClass="neu" />
              <Mc label="30d accuracy"  value={analyst.accuracy30dLabel}   valueClass="up" subClass="up" />
              <Mc label="Calls tracked" value={analyst.callsTracked}       subClass="neu" />
            </div>
          </div>
        </div>
      </Card>

      {/* grid3: Portfolio | Recent calls | Accuracy by ticker */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 12 }}>
        <Card>
          <CardTitle rightText="inferred · % since call">Portfolio</CardTitle>
          {PORTFOLIO_ROWS.map(p => (
            <div key={p.ticker} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)", width: 36 }}>{p.ticker}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-secondary)", flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p.name}</span>
              <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", width: 52, textAlign: "right" }}>Added {p.addedDate}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  width: 40,
                  textAlign: "right",
                  color: p.pctLabel.startsWith("-") ? "#E76A6A" : "#7FBF52",
                }}
              >
                {p.pctLabel}
              </span>
              <Pill pill={p.side} textOverride={p.side === "bull" ? "long" : "short"} style={{ fontSize: 8 }} />
            </div>
          ))}
          <Divider compact />
          <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
            Inferred from public posts · not verified holdings
          </div>
        </Card>

        <Card>
          <CardTitle rightText="last 14 days">Recent calls</CardTitle>
          {RECENT_CALLS_ROWS.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 7, padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 3, background: h.dotColor }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>{h.title}</div>
                <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginTop: 1 }}>{h.thesis}</div>
                <div style={{ fontSize: 10, marginTop: 2, color: h.dotColor }}>{h.outcome}</div>
              </div>
              <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", flexShrink: 0, paddingTop: 2 }}>{h.time}</span>
            </div>
          ))}
        </Card>

        <Card>
          <CardTitle rightText="30-day">Accuracy by ticker</CardTitle>
          {TICKER_ACC_ROWS.map(t => (
            <div key={t.ticker} style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>{t.ticker}</span>
                <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{t.name}</span>
                <span style={{ color: t.tone === "up" ? "#7FBF52" : t.tone === "dn" ? "#E76A6A" : "#E2BF73" }}>{t.pctLabel}</span>
              </div>
              <div style={{ height: 5, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden", marginTop: 2 }}>
                <div style={{ height: 5, borderRadius: 3, width: `${t.pct}%`, background: t.barColor }} />
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Recent posts card */}
      <Card>
        <CardTitle rightText={`from ${analyst.handle} today`}>Recent posts</CardTitle>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {RECENT_ANALYST_POSTS.map((p, i) => (
            <div key={i} style={{ padding: "6px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 7,
                    fontWeight: 500,
                    background: analyst.avatarBg,
                    color: analyst.avatarText,
                    flexShrink: 0,
                  }}
                >
                  {analyst.initials}
                </div>
                <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>{analyst.handle}</span>
                <Pill pill={p.pill} style={{ marginLeft: 2 }} />
                <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>{p.time}</span>
              </div>
              <div
                style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.45 }}
              >{renderPostBody(p.body)}</div>
              <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginTop: 2 }}>{p.likes}</div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

// =====================================================
// Shared UI primitives (scoped to Sentiment view)
// =====================================================

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 12,
        padding: "1rem 1.25rem",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({
  children,
  right,
  rightText,
  small,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  rightText?: string;
  small?: boolean;
}) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: "var(--color-text-secondary)",
        textTransform: "uppercase",
        letterSpacing: ".04em",
        marginBottom: small ? 6 : "0.75rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>{children}</span>
      {right ? right : rightText ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 400,
            textTransform: "none",
            letterSpacing: 0,
            color: "var(--color-text-tertiary)",
          }}
        >
          {rightText}
        </span>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 500,
        color: "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: ".04em",
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}

function Divider({ compact }: { compact?: boolean }) {
  return (
    <div
      style={{
        height: "0.5px",
        background: "var(--color-border-tertiary)",
        margin: compact ? "6px 0" : "12px 0",
      }}
    />
  );
}

function Mc({
  label,
  value,
  valueClass,
  sub,
  subClass,
}: {
  label: string;
  value: string;
  valueClass?: "up" | "dn" | "warn" | "neu";
  sub?: string;
  subClass?: "up" | "dn" | "warn" | "neu";
}) {
  const color = toneColor(valueClass);
  const subColor = toneColor(subClass);
  return (
    <div
      style={{
        background: "var(--color-background-secondary)",
        borderRadius: 8,
        padding: ".75rem 1rem",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 500, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, marginTop: 1, color: subColor }}>{sub}</div>}
    </div>
  );
}

function toneColor(tone?: "up" | "dn" | "warn" | "neu"): string {
  if (tone === "up") return "#7FBF52";
  if (tone === "dn") return "#E76A6A";
  if (tone === "warn") return "#E2BF73";
  if (tone === "neu") return "var(--color-text-secondary)";
  return "var(--color-text-primary)";
}

function Pill({
  pill,
  textOverride,
  style,
}: {
  pill: "bull" | "bear" | "mix";
  textOverride?: string;
  style?: React.CSSProperties;
}) {
  const map = {
    bull: { bg: "rgba(127, 191, 82, 0.14)", color: "#7FBF52" },
    bear: { bg: "rgba(231, 106, 106, 0.14)", color: "#E76A6A" },
    mix:  { bg: "#FAEEDA", color: "#E2BF73" },
  } as const;
  const c = map[pill];
  return (
    <span
      style={{
        fontSize: 9,
        padding: "1px 7px",
        borderRadius: 20,
        fontWeight: 500,
        whiteSpace: "nowrap",
        background: c.bg,
        color: c.color,
        ...style,
      }}
    >
      {textOverride ?? pill}
    </span>
  );
}

function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9,
        padding: "1px 6px",
        borderRadius: 20,
        background: bg,
        color,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 9,
        padding: "2px 8px",
        borderRadius: 20,
        border: active ? "0.5px solid #C9A55A" : "0.5px solid var(--color-border-secondary)",
        background: active ? "rgba(201, 165, 90, 0.18)" : "transparent",
        color: active ? "#C9A55A" : "var(--color-text-secondary)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function SortButton({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      style={{
        fontSize: 10,
        padding: "3px 10px",
        borderRadius: 20,
        border: active ? "0.5px solid #C9A55A" : "0.5px solid var(--color-border-secondary)",
        background: active ? "rgba(201, 165, 90, 0.18)" : "var(--color-background-primary)",
        color: active ? "#C9A55A" : "var(--color-text-secondary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function VtBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(active && "font-medium")}
      style={{
        fontSize: 11,
        padding: "5px 14px",
        borderRadius: 5,
        border: active ? "0.5px solid var(--color-border-tertiary)" : "none",
        background: active ? "var(--color-background-primary)" : "transparent",
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function AnalystChip({
  analyst,
  selected,
  onClick,
}: {
  analyst: AnalystDisplayRow;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        flexShrink: 0,
        width: 72,
        textAlign: "center",
        cursor: "pointer",
        padding: "5px 3px",
        borderRadius: 8,
        border: selected ? "0.5px solid #C9A55A" : "0.5px solid transparent",
        background: selected ? "rgba(201, 165, 90, 0.18)" : undefined,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          margin: "0 auto 3px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 500,
          background: analyst.avatarBg,
          color: analyst.avatarText,
        }}
      >
        {analyst.initials}
      </div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 500,
          color: "var(--color-text-primary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {analyst.displayName}
      </div>
      <div style={{ fontSize: 8, color: "var(--color-text-tertiary)" }}>{analyst.followersLabel}</div>
    </div>
  );
}

function renderPostBody(body: string): React.ReactNode {
  const parts = body.split(/(\$[A-Z]+)/);
  return parts.map((part, i) =>
    part.startsWith("$") ? (
      <span key={i} style={{ color: "#C9A55A", fontWeight: 500 }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-text-tertiary text-[12px]">
      {label}
    </div>
  );
}
