"use client";

// Earnings Analyst — calendar / screener / deep dive. Data from
// /api/earnings (UW earnings feeds via the worker): consensus EPS, the
// options-implied expected move, per-quarter history with actual moves, and
// a Claude web-search brief for imminent reports.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  EarningsCalendarPayload, EarningsDeepDivePayload, EarningsEventRow,
} from "@/lib/types";
import type { CandlesResult } from "@/lib/candles";
import type { ExtraLevel } from "@/components/modules/charts/TickerPriceChart";
import { useTimeZone, fmtClock } from "@/lib/timezone";

const TickerPriceChart = dynamic(
  () => import("@/components/modules/charts/TickerPriceChart").then((m) => m.TickerPriceChart),
  { ssr: false, loading: () => <ChartLoading /> },
);

const GOLD = "#C9A55A", GOLD2 = "#E2BF73", UP = "#7FBF52", DN = "#E76A6A";
const PRE_BG = "rgba(90,169,230,.16)", PRE_FG = "#5AA9E6";
const POST_BG = "rgba(185,138,230,.18)", POST_FG = "#B98AE6";
const WATCH_KEY = "cs-earnings-watchlist";

const pct = (v: number | null, dp = 1) => (v == null ? "—" : `±${(Math.abs(v) * 100).toFixed(dp)}%`);
const spct = (v: number | null, dp = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`);
const eps = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
const mcap = (v: number | null) =>
  v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : `$${(v / 1e6).toFixed(0)}M`;
const dateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function useWatchlist(): [Set<string>, (t: string) => void] {
  const [set, setSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]");
      if (Array.isArray(v)) setSet(new Set(v.map((x) => String(x).toUpperCase())));
    } catch { /* empty */ }
  }, []);
  const toggle = (t: string) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      try { localStorage.setItem(WATCH_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  return [set, toggle];
}

// Has this report already happened? Time-based (feed actuals can lag):
// premarket names flip once the session opens, after-close names at ~4:10 PM.
function useEtNow(): { date: string; mins: number } {
  const [now, setNow] = useState(() => etNowParts());
  useEffect(() => {
    const id = setInterval(() => setNow(etNowParts()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
function etNowParts(): { date: string; mins: number } {
  const d = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  const h = g("hour") === 24 ? 0 : g("hour");
  return { date, mins: h * 60 + g("minute") };
}
function isReported(e: EarningsEventRow, now: { date: string; mins: number }): boolean {
  if (e.actualEps != null || e.reactionPct != null) return true;
  if (e.reportDate < now.date) return true;
  if (e.reportDate > now.date) return false;
  if (e.reportTime === "premarket") return now.mins >= 9 * 60 + 35;
  if (e.reportTime === "postmarket") return now.mins >= 16 * 60 + 10;
  return false;
}

function SessPill({ t, reported }: { t: EarningsEventRow["reportTime"]; reported?: boolean }) {
  if (reported) {
    return (
      <span style={{
        fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", borderRadius: 4, padding: "1.5px 6px",
        background: "rgba(201,165,90,.16)", color: GOLD2,
      }}>
        REPORTED
      </span>
    );
  }
  const pre = t === "premarket";
  const unknown = t === "unknown";
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 700, letterSpacing: ".05em", borderRadius: 4, padding: "1.5px 6px",
      background: unknown ? "var(--color-background-secondary)" : pre ? PRE_BG : POST_BG,
      color: unknown ? "var(--color-text-tertiary)" : pre ? PRE_FG : POST_FG,
    }}>
      {unknown ? "TBD" : pre ? "PRE-MKT" : "AFTER CLOSE"}
    </span>
  );
}

function ChartLoading() {
  return (
    <div className="flex h-full items-center justify-center" style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
      Loading chart…
    </div>
  );
}

// ═════════════════════════ root ═════════════════════════

export function EarningsView({ tab }: { tab: "calendar" | "screener" | "deepdive" }) {
  const [data, setData] = useState<EarningsCalendarPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ddTicker, setDdTicker] = useState<string | null>(null);
  const [watch, toggleWatch] = useWatchlist();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/earnings")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((p: EarningsCalendarPayload) => { if (!cancelled) { setData(p); setError(null); } })
        .catch(() => { if (!cancelled) setError("Earnings data hasn't landed yet — the first sync runs premarket."); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Clicking any ticker anywhere → deep dive tab with that ticker.
  const openDD = (t: string) => {
    setDdTicker(t);
    router.push("/earnings?tab=2");
  };

  if (error) return <Centered>{error}</Centered>;
  if (!data) return <Centered>Loading…</Centered>;

  if (tab === "deepdive") return <DeepDive events={data.events} initialTicker={ddTicker} watch={watch} />;
  if (tab === "screener") return <Screener data={data} watch={watch} toggleWatch={toggleWatch} onOpen={openDD} />;
  return <CalendarView data={data} onOpen={openDD} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center text-text-tertiary" style={{ fontSize: 12, padding: 24, background: "var(--color-background-tertiary)" }}>{children}</div>;
}

// ═════════════════════════ calendar ═════════════════════════

function CalendarView({ data, onOpen }: { data: EarningsCalendarPayload; onOpen: (t: string) => void }) {
  const { tz, abbr } = useTimeZone();
  const now = useEtNow();
  const todayIso = now.date;

  // Weekday buckets from `from`..`to`, skipping weekends.
  const days = useMemo(() => {
    const out: { iso: string; events: EarningsEventRow[] }[] = [];
    const d = new Date(`${data.from}T12:00:00Z`);
    const end = new Date(`${data.to}T12:00:00Z`);
    while (d <= end) {
      const dow = d.getUTCDay();
      if (dow >= 1 && dow <= 5) {
        const iso = d.toISOString().slice(0, 10);
        out.push({ iso, events: data.events.filter((e) => e.reportDate === iso) });
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [data]);

  return (
    <div className="flex-1 overflow-y-auto p-[14px]" style={{ background: "var(--color-background-tertiary)" }}>
      <div className="flex flex-wrap items-start justify-between gap-[8px]" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>Upcoming major earnings</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, maxWidth: 640 }}>
            S&amp;P 500 · Nasdaq-100 · Dow 30 · platform tickers. The % is the options-implied move for the report;
            blue reports premarket, purple after the close. Click any ticker for the deep dive.
          </div>
        </div>
        <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          {data.updatedAt ? `implied moves updated ${fmtClock(new Date(data.updatedAt), tz)} ${abbr}` : ""}
        </div>
      </div>
      <div className="grid gap-[8px]" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}>
        {days.map((d) => (
          <div key={d.iso} className="rounded-[10px]" style={{
            background: "var(--color-background-primary)", minHeight: 130, padding: 9,
            border: `0.5px solid ${d.iso === todayIso ? "rgba(201,165,90,.5)" : "var(--color-border-tertiary)"}`,
          }}>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 7 }}>
              <b style={{ fontSize: 12 }}>{dateLabel(d.iso)}</b>
              {d.iso === todayIso && <span style={{ fontSize: 9, color: GOLD }}>today</span>}
            </div>
            {d.events.length === 0 && (
              <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary)" }}>No majors</div>
            )}
            {d.events.slice(0, 14).map((e) => {
              const rep = isReported(e, now);
              return (
              <button key={e.ticker} onClick={() => onOpen(e.ticker)} title={`${e.fullName ?? e.ticker} — open deep dive`}
                className="flex w-full items-center justify-between gap-[6px] rounded-[7px] cursor-pointer"
                style={{
                  background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)",
                  borderLeft: (e.marketcap ?? 0) >= 2e11 ? `2.5px solid ${GOLD}` : "0.5px solid var(--color-border-tertiary)",
                  padding: "4px 8px", marginBottom: 5, fontFamily: "inherit",
                }}>
                <span style={{ fontSize: 12 }}>
                  <b style={{ color: GOLD2 }}>{e.ticker}</b>{" "}
                  <span style={{ fontSize: 10.5, color: rep ? "var(--color-text-tertiary)" : "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{pct(e.expectedMovePct)}</span>
                  {rep && e.reactionPct != null && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: e.reactionPct >= 0 ? UP : DN }}>
                      {" "}→ {spct(e.reactionPct)}
                    </span>
                  )}
                </span>
                <SessPill t={e.reportTime} reported={rep} />
              </button>
              );
            })}
            {d.events.length > 14 && (
              <div style={{ fontSize: 9.5, color: "var(--color-text-tertiary)" }}>+{d.events.length - 14} more in screener</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════ screener ═════════════════════════

type SortMode = "date" | "sector" | "im" | "watch";

function Screener({ data, watch, toggleWatch, onOpen }: {
  data: EarningsCalendarPayload; watch: Set<string>; toggleWatch: (t: string) => void; onOpen: (t: string) => void;
}) {
  const [sort, setSort] = useState<SortMode>("date");
  const [addVal, setAddVal] = useState("");
  const now = useEtNow();

  const rows = useMemo(() => {
    const r = [...data.events];
    if (sort === "sector") r.sort((a, b) => (a.sector ?? "z").localeCompare(b.sector ?? "z") || a.reportDate.localeCompare(b.reportDate));
    else if (sort === "im") r.sort((a, b) => (b.expectedMovePct ?? -1) - (a.expectedMovePct ?? -1));
    else if (sort === "watch") r.sort((a, b) => (watch.has(b.ticker) ? 1 : 0) - (watch.has(a.ticker) ? 1 : 0) || a.reportDate.localeCompare(b.reportDate) || (b.marketcap ?? 0) - (a.marketcap ?? 0));
    else r.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || (b.marketcap ?? 0) - (a.marketcap ?? 0));
    return r;
  }, [data, sort, watch]);

  const pill = (id: SortMode, label: string) => (
    <button key={id} onClick={() => setSort(id)} className="rounded-full cursor-pointer"
      style={{
        fontFamily: "inherit", fontSize: 11, padding: "5px 12px",
        background: sort === id ? "rgba(201,165,90,.15)" : "var(--color-background-primary)",
        color: sort === id ? GOLD2 : "var(--color-text-secondary)",
        border: `0.5px solid ${sort === id ? "rgba(201,165,90,.5)" : "var(--color-border-secondary)"}`,
        fontWeight: sort === id ? 600 : 400,
      }}>{label}</button>
  );

  return (
    <div className="flex-1 overflow-y-auto p-[14px]" style={{ background: "var(--color-background-tertiary)" }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 500, color: "var(--color-text-primary)" }}>Earnings screener</div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
          {data.events.length} reports in the window · consensus EPS + the move the options market is pricing.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[8px]" style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", letterSpacing: ".05em", textTransform: "uppercase" }}>Sort</span>
        {pill("date", "Earnings date")}
        {pill("sector", "Sector")}
        {pill("im", "Implied move ↓")}
        {pill("watch", "★ My watchlist first")}
        <span className="flex items-center gap-[6px]" style={{ marginLeft: "auto" }}>
          <input value={addVal} onChange={(e) => setAddVal(e.target.value.toUpperCase())} placeholder="Add ticker… e.g. MU" maxLength={6}
            onKeyDown={(e) => { if (e.key === "Enter" && addVal.trim()) { toggleWatch(addVal.trim()); setAddVal(""); } }}
            style={{
              background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)",
              borderRadius: 7, color: "var(--color-text-primary)", fontFamily: "inherit", fontSize: 11.5,
              padding: "5px 9px", width: 130, outline: "none",
            }} />
          <button onClick={() => { if (addVal.trim()) { toggleWatch(addVal.trim()); setAddVal(""); } }}
            className="cursor-pointer rounded-[7px]"
            style={{ fontFamily: "inherit", fontSize: 11, padding: "5px 11px", background: "rgba(201,165,90,.12)", color: GOLD2, border: "0.5px solid rgba(201,165,90,.5)" }}>
            ★ Watch
          </button>
        </span>
      </div>
      <div className="rounded-[12px] bg-bg-primary" style={{ border: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["", "Ticker", "Sector", "Reports", "Session", "Implied move", "Reaction", "EPS est / act", "Mkt cap", "Avg move (12q)", "Beat rate"].map((h, i) => (
                  <th key={i} style={{
                    fontSize: 9.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase",
                    color: "var(--color-text-tertiary)", textAlign: i <= 2 ? "left" : "right",
                    padding: "7px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const rep = isReported(e, now);
                return (
                <tr key={`${e.ticker}-${e.reportDate}`} onClick={() => onOpen(e.ticker)} className="cursor-pointer hover:bg-bg-secondary"
                  style={{ borderBottom: "0.5px solid var(--color-border-tertiary)", boxShadow: watch.has(e.ticker) ? `inset 2.5px 0 0 ${GOLD}` : undefined }}>
                  <td style={{ padding: "7px 4px 7px 10px", width: 26 }}>
                    <button onClick={(ev) => { ev.stopPropagation(); toggleWatch(e.ticker); }}
                      title={watch.has(e.ticker) ? "Remove from watchlist" : "Add to watchlist"}
                      className="cursor-pointer" style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: watch.has(e.ticker) ? GOLD : "var(--color-border-secondary)" }}>
                      ★
                    </button>
                  </td>
                  <Td left><b style={{ color: GOLD2 }}>{e.ticker}</b> <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)" }}>{e.fullName ?? ""}</span></Td>
                  <Td left style={{ fontSize: 10.5, color: "var(--color-text-secondary)" }}>{e.sector ?? "—"}</Td>
                  <Td>{dateLabel(e.reportDate)}</Td>
                  <Td><SessPill t={e.reportTime} reported={rep} /></Td>
                  <Td style={{ fontWeight: 700, color: rep ? "var(--color-text-tertiary)" : GOLD2 }}>{pct(e.expectedMovePct)}</Td>
                  <Td>
                    {rep && e.reactionPct != null ? (
                      <span style={{ fontWeight: 700, color: e.reactionPct >= 0 ? UP : DN }}>{spct(e.reactionPct)}</span>
                    ) : rep ? (
                      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>pending</span>
                    ) : (
                      <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>—</span>
                    )}
                  </Td>
                  <Td>
                    {e.actualEps != null ? (
                      <span>
                        <span style={{ color: "var(--color-text-tertiary)" }}>{eps(e.epsEstimate)}</span>{" / "}
                        <b style={{ color: e.epsEstimate == null ? "var(--color-text-primary)" : e.actualEps >= e.epsEstimate ? UP : DN }}>{eps(e.actualEps)}</b>
                      </span>
                    ) : (
                      <span>{eps(e.epsEstimate)}{rep && <span style={{ fontSize: 9, color: "var(--color-text-tertiary)" }}> / soon</span>}</span>
                    )}
                  </Td>
                  <Td style={{ color: "var(--color-text-secondary)" }}>{mcap(e.marketcap)}</Td>
                  <Td style={{ color: e.avgMovePct != null && e.expectedMovePct != null && e.avgMovePct > e.expectedMovePct ? UP : "var(--color-text-secondary)" }}>{pct(e.avgMovePct)}</Td>
                  <Td style={{ color: "var(--color-text-secondary)" }}>{e.beatCount != null ? `${e.beatCount}/${e.quarterCount}` : "—"}</Td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 10, lineHeight: 1.6 }}>
        Implied move = the options market&rsquo;s expected move for the report (at-the-money straddle). Avg move is the
        average absolute next-session move over the last 12 reports — green when history runs hotter than what options
        are pricing now. ★ watchlist is saved in this browser.
      </div>
    </div>
  );
}

function Td({ children, left, style }: { children: React.ReactNode; left?: boolean; style?: React.CSSProperties }) {
  return <td style={{ textAlign: left ? "left" : "right", padding: "7px 10px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", ...style }}>{children}</td>;
}

// ═════════════════════════ deep dive ═════════════════════════

function DeepDive({ events, initialTicker, watch }: { events: EarningsEventRow[]; initialTicker: string | null; watch: Set<string> }) {
  const defaultTicker = initialTicker ?? events.find((e) => watch.has(e.ticker))?.ticker ?? events[0]?.ticker ?? "AAPL";
  const [ticker, setTicker] = useState(defaultTicker);
  const [input, setInput] = useState("");
  const [dd, setDd] = useState<EarningsDeepDivePayload | null>(null);
  const [candles, setCandles] = useState<CandlesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tf, setTf] = useState<"1D" | "1H">("1D");
  const [showImplied, setShowImplied] = useState(true);
  const [showAvg, setShowAvg] = useState(true);
  const { tz, abbr } = useTimeZone();
  const lastFetched = useRef(0);

  useEffect(() => { if (initialTicker) setTicker(initialTicker); }, [initialTicker]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDd(null); setCandles(null);
    Promise.all([
      fetch(`/api/earnings/${ticker}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/earnings/candles/${ticker}?tf=${tf}`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([d, c]) => {
      if (cancelled) return;
      setDd(d); setCandles(c); setLoading(false); lastFetched.current = Date.now();
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, tf]);

  const e = dd?.event ?? null;
  const spot = candles?.candles.length ? candles.candles[candles.candles.length - 1]!.close : null;

  // Implied-move rails around the pre-earnings reference (spot, else UW's).
  const ref = spot ?? e?.preEarningsClose ?? null;
  const rails: ExtraLevel[] = [];
  if (e?.expectedMovePct != null && ref != null && e.actualEps == null && showImplied) {
    const m = e.expectedMovePct;
    rails.push(
      { price: ref * (1 + m), title: `implied +${(m * 100).toFixed(1)}%`, color: GOLD, style: "dashed" },
      { price: ref * (1 - m), title: `implied −${(m * 100).toFixed(1)}%`, color: GOLD, style: "dashed" },
    );
  }
  if (e?.avgMovePct != null && ref != null && e.actualEps == null && showAvg) {
    rails.push(
      { price: ref * (1 + e.avgMovePct), title: `avg hist +${(e.avgMovePct * 100).toFixed(1)}%`, color: "rgba(226,191,115,.45)", style: "dotted" },
      { price: ref * (1 - e.avgMovePct), title: `avg hist −${(e.avgMovePct * 100).toFixed(1)}%`, color: "rgba(226,191,115,.45)", style: "dotted" },
    );
  }

  const history = dd?.history ?? [];
  const beat = (h: { epsEstimate: number | null; actualEps: number | null }) =>
    h.epsEstimate == null || h.actualEps == null ? null : h.actualEps >= h.epsEstimate;

  const commit = () => {
    const v = input.trim().toUpperCase();
    if (/^[A-Z][A-Z.]{0,7}$/.test(v)) { setTicker(v); setInput(""); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-[14px]" style={{ background: "var(--color-background-tertiary)" }}>
      {/* header */}
      <div className="flex flex-wrap items-center gap-[14px]" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {ticker}{" "}
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontWeight: 400 }}>
              {e?.fullName ?? ""}{e?.sector ? ` · ${e.sector}` : ""}
            </span>
          </div>
          {spot != null && (
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
              ${spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
        {e && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "5px 13px",
            borderRadius: 7, fontWeight: 600,
            background: e.reportTime === "premarket" ? PRE_BG : POST_BG,
            color: e.reportTime === "premarket" ? PRE_FG : POST_FG,
            border: `0.5px solid ${e.reportTime === "premarket" ? "rgba(90,169,230,.4)" : "rgba(185,138,230,.4)"}`,
          }}>
            {e.actualEps != null ? "Reported" : "Reports"} {dateLabel(e.reportDate)} ·{" "}
            {e.reportTime === "premarket" ? "Before the open" : e.reportTime === "postmarket" ? "After the close" : "Time TBD"}
          </span>
        )}
        <span className="flex items-center gap-[6px]" style={{ marginLeft: "auto" }}>
          <input value={input} onChange={(ev) => setInput(ev.target.value.toUpperCase())}
            onKeyDown={(ev) => { if (ev.key === "Enter") commit(); }}
            placeholder="Search any ticker…  ⏎"
            style={{
              background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)",
              borderRadius: 8, color: "var(--color-text-primary)", fontFamily: "inherit", fontSize: 12,
              padding: "7px 11px", width: 190, outline: "none",
            }} />
        </span>
      </div>

      {loading ? (
        <Centered>Loading {ticker}…</Centered>
      ) : !e ? (
        <Centered>No earnings data for {ticker} — it may be outside the S&amp;P 500 / NDX / Dow / tracked universe, or have no report in the window.</Centered>
      ) : (
        <>
          {/* metric cards */}
          <div className="grid gap-[8px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 12 }}>
            <Metric k="Implied move" v={pct(e.expectedMovePct)} color={GOLD2}
              d={ref != null && e.expectedMovePct != null ? `±$${(ref * e.expectedMovePct).toFixed(2)}` : ""} />
            <Metric k="Consensus EPS" v={eps(e.epsEstimate)} d={e.fiscalQuarter ? `FQ ending ${e.fiscalQuarter}` : ""} />
            {e.actualEps != null && (
              <Metric k="Actual EPS" v={eps(e.actualEps)}
                color={e.epsEstimate != null && e.actualEps >= e.epsEstimate ? UP : DN}
                d={e.epsEstimate != null ? (e.actualEps >= e.epsEstimate ? "beat" : "miss") : ""} />
            )}
            {e.reactionPct != null && (
              <Metric k="Reaction" v={spct(e.reactionPct)}
                color={e.reactionPct >= 0 ? UP : DN}
                d={e.expectedMovePct != null ? (Math.abs(e.reactionPct) > e.expectedMovePct ? "exceeded implied move" : "inside implied move") : ""} />
            )}
            <Metric k="Avg move (12q)" v={pct(e.avgMovePct)}
              d={e.avgMovePct != null && e.expectedMovePct != null ? (e.avgMovePct > e.expectedMovePct ? "history runs hotter" : "options pricing rich") : ""} />
            <Metric k="Beat rate" v={e.beatCount != null ? `${e.beatCount} / ${e.quarterCount}` : "—"} color={e.beatCount != null && e.quarterCount != null && e.beatCount / e.quarterCount >= 0.7 ? UP : undefined} d="EPS beats, last 12 qtrs" />
            <Metric k="Market cap" v={mcap(e.marketcap)} d={e.isSp500 ? "S&P 500" : ""} />
          </div>

          <div className="grid gap-[12px]" style={{ gridTemplateColumns: "1.35fr 1fr", alignItems: "start" }}>
            <div>
              {/* price chart with rails */}
              <div className="rounded-[12px] bg-bg-primary" style={{ border: "0.5px solid var(--color-border-tertiary)", padding: 12 }}>
                <div className="flex flex-wrap items-center justify-between gap-[8px]" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>
                    {tf === "1H" ? "Hourly" : "Daily"} chart · move rails for the report
                  </span>
                  <span className="flex items-center gap-[7px]">
                    <RailToggle on={showImplied} label="Implied move" onClick={() => setShowImplied((v) => !v)} />
                    <RailToggle on={showAvg} label="Avg hist move" onClick={() => setShowAvg((v) => !v)} />
                    <span style={{ display: "inline-flex", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, overflow: "hidden" }}>
                      {(["1H", "1D"] as const).map((t, i) => (
                        <button key={t} onClick={() => setTf(t)}
                          style={{
                            padding: "3px 10px", fontSize: 10.5, fontFamily: "inherit", cursor: "pointer", border: "none",
                            borderLeft: i > 0 ? "0.5px solid var(--color-border-secondary)" : "none",
                            fontWeight: tf === t ? 600 : 400,
                            background: tf === t ? "var(--color-background-tertiary)" : "transparent",
                            color: tf === t ? GOLD2 : "var(--color-text-secondary)",
                          }}>
                          {t}
                        </button>
                      ))}
                    </span>
                  </span>
                </div>
                <div style={{ position: "relative", height: 380 }}>
                  {candles && candles.candles.length > 0 ? (
                    <TickerPriceChart
                      candles={candles.candles} trades={[]} intraday={tf === "1H"}
                      showBubbles={false} bubbleRank={0} showLevels={false} levelRank={0} levelSince={0}
                      extraLevels={rails} scaleToExtraLevels fitBars={tf === "1H" ? 45 : 90} lastFetched={lastFetched.current}
                    />
                  ) : <ChartLoading />}
                </div>
                {rails.length === 0 && e.actualEps == null && (
                  <div style={{ fontSize: 10.5, color: "var(--color-text-tertiary)", marginTop: 6 }}>Implied-move rails appear once the expected move is published.</div>
                )}
              </div>

              {/* Post-earnings results */}
              {dd?.resultsSummary && (
                <div className="rounded-[0_12px_12px_0]" style={{ marginTop: 12, padding: "12px 14px", background: "rgba(95,210,156,.08)", borderLeft: `3px solid ${UP}` }}>
                  <div style={{ fontSize: 12, color: UP, fontWeight: 600, marginBottom: 8 }}>✓ Earnings results — what happened and why it&rsquo;s moving</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{dd.resultsSummary.body}</div>
                  <div style={{ fontSize: 9.5, color: "var(--color-text-tertiary)", marginTop: 8 }}>
                    Generated {fmtClock(new Date(dd.resultsSummary.generatedAt), tz)} {abbr} from results + news search · not investment advice
                  </div>
                </div>
              )}

              {/* AI brief */}
              <div className="rounded-[0_12px_12px_0]" style={{ marginTop: 12, padding: "12px 14px", background: "rgba(201,165,90,.10)", borderLeft: `3px solid ${GOLD}` }}>
                <div style={{ fontSize: 12, color: GOLD2, fontWeight: 600, marginBottom: 8 }}>⭑ {dd?.resultsSummary ? "Pre-earnings briefing (archived)" : "AI briefing — what the street is watching"}</div>
                {dd?.aiSummary ? (
                  <>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{dd.aiSummary.body}</div>
                    <div style={{ fontSize: 9.5, color: "var(--color-text-tertiary)", marginTop: 8 }}>
                      Generated {fmtClock(new Date(dd.aiSummary.generatedAt), tz)} {abbr} from news search + consensus data · not investment advice
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>
                    Briefs generate once, when a name enters the 3-week window. Nothing yet for {ticker}.
                  </div>
                )}
              </div>
            </div>

            <div>
              {/* history bars */}
              <div className="rounded-[12px] bg-bg-primary" style={{ border: "0.5px solid var(--color-border-tertiary)", padding: 12 }}>
                <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 8 }}>
                  Post-earnings move — last {Math.min(history.length, 16)} quarters
                </div>
                {history.length ? <HistoryBars history={[...history].reverse()} /> : (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", padding: "18px 0" }}>History backfills within a day of the ticker entering the window.</div>
                )}
                <div className="flex flex-wrap" style={{ gap: 14, fontSize: 10, color: "var(--color-text-secondary)", marginTop: 8 }}>
                  <span><i style={{ display: "inline-block", width: 14, height: 3, borderRadius: 2, background: UP, verticalAlign: "middle", marginRight: 5 }} />Closed up next session</span>
                  <span><i style={{ display: "inline-block", width: 14, height: 3, borderRadius: 2, background: DN, verticalAlign: "middle", marginRight: 5 }} />Closed down</span>
                  <span><i style={{ display: "inline-block", width: 14, borderTop: `1.5px dashed ${GOLD}`, verticalAlign: "middle", marginRight: 5 }} />Implied move priced pre-report</span>
                </div>
              </div>

              {/* history table */}
              <div className="rounded-[12px] bg-bg-primary" style={{ border: "0.5px solid var(--color-border-tertiary)", marginTop: 12, paddingBottom: 4 }}>
                <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-text-tertiary)", padding: "12px 12px 0" }}>
                  Quarter-by-quarter detail
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                    <thead>
                      <tr>
                        {["Report", "EPS est", "EPS act", "", "Implied", "Next-day move"].map((h, i) => (
                          <th key={i} style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--color-text-tertiary)", textAlign: i === 0 ? "left" : "right", padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => {
                        const b = beat(h);
                        return (
                          <tr key={h.reportDate} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                            <Td left style={{ fontSize: 11 }}>{h.fiscalQuarter ?? h.reportDate} <span style={{ fontSize: 9.5, color: "var(--color-text-tertiary)" }}>{h.reportDate.slice(5)}</span></Td>
                            <Td>{eps(h.epsEstimate)}</Td>
                            <Td>{eps(h.actualEps)}</Td>
                            <Td style={{ color: b == null ? "var(--color-text-tertiary)" : b ? UP : DN, fontWeight: 600, fontSize: 10.5 }}>{b == null ? "" : b ? "beat" : "miss"}</Td>
                            <Td style={{ color: "var(--color-text-secondary)" }}>{pct(h.expectedMovePct)}</Td>
                            <Td style={{ color: (h.move1dPct ?? 0) >= 0 ? UP : DN, fontWeight: 600 }}>{spct(h.move1dPct)}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RailToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", fontSize: 10.5,
        fontWeight: 500, fontFamily: "inherit", borderRadius: 999, cursor: "pointer", userSelect: "none",
        border: `0.5px solid ${on ? "rgba(226,191,115,.5)" : "var(--color-border-secondary)"}`,
        background: on ? "rgba(226,191,115,.15)" : "var(--color-background-tertiary)",
        color: on ? GOLD2 : "var(--color-text-secondary)",
      }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: on ? GOLD2 : "var(--color-text-tertiary)" }} />
      {label}
    </button>
  );
}

function Metric({ k, v, d, color }: { k: string; v: string; d?: string; color?: string }) {
  return (
    <div className="rounded-[10px] bg-bg-primary" style={{ border: "0.5px solid var(--color-border-tertiary)", padding: "10px 12px" }}>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 4 }}>{k}</div>
      <div style={{ fontSize: 15.5, fontWeight: 650, fontVariantNumeric: "tabular-nums", color: color ?? "var(--color-text-primary)" }}>{v}</div>
      {d ? <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2 }}>{d}</div> : null}
    </div>
  );
}

// SVG history bars — |move| vs the implied band per quarter.
function HistoryBars({ history }: { history: { fiscalQuarter: string | null; reportDate: string; move1dPct: number | null; expectedMovePct: number | null }[] }) {
  const W = 460, H = 240, L = 40, R = 6, T = 8, B = 34;
  const rows = history.filter((h) => h.move1dPct != null);
  if (!rows.length) return null;
  const max = Math.max(0.06, ...rows.map((h) => Math.abs(h.move1dPct!)), ...rows.map((h) => Math.abs(h.expectedMovePct ?? 0))) * 1.15;
  const y = (v: number) => T + ((max - v) / (2 * max)) * (H - T - B);
  const bw = (W - L - R) / rows.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Post-earnings moves by quarter">
      {[-max, -max / 2, 0, max / 2, max].map((g, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke={g === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.05)"} strokeWidth={1} />
          <text x={L - 5} y={y(g) + 3} fontSize={8} fill="var(--color-text-tertiary)" textAnchor="end">{`${g > 0 ? "+" : ""}${Math.round(g * 100)}%`}</text>
        </g>
      ))}
      {rows.map((h, i) => {
        const X = L + i * bw;
        const mv = h.move1dPct!;
        const imp = h.expectedMovePct;
        return (
          <g key={h.reportDate}>
            {imp != null && (
              <>
                <line x1={X + bw * 0.12} x2={X + bw * 0.88} y1={y(imp)} y2={y(imp)} stroke={GOLD} strokeOpacity={0.55} strokeDasharray="3 3" strokeWidth={1} />
                <line x1={X + bw * 0.12} x2={X + bw * 0.88} y1={y(-imp)} y2={y(-imp)} stroke={GOLD} strokeOpacity={0.55} strokeDasharray="3 3" strokeWidth={1} />
              </>
            )}
            <rect x={X + bw * 0.22} width={bw * 0.56} y={Math.min(y(0), y(mv))} height={Math.max(2, Math.abs(y(mv) - y(0)))} fill={mv >= 0 ? UP : DN} rx={1.5}>
              <title>{`${h.fiscalQuarter ?? h.reportDate}: ${spct(mv)} (implied ${pct(imp)})`}</title>
            </rect>
            <text x={X + bw * 0.5} y={H - 6} fontSize={7.5} fill="var(--color-text-tertiary)" textAnchor="end" transform={`rotate(-45 ${X + bw * 0.5} ${H - 6})`}>
              {h.fiscalQuarter ?? h.reportDate.slice(2, 7)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
