// jobs/earnings.ts — Earnings Analyst data pipeline.
//
// Universe: platform tracked corpus (ticker-thresholds.json) ∪ S&P 500
// (UW's is_s_p_500 flag) ∪ Nasdaq-100 ∪ Dow 30 (static lists).
//
// Three jobs:
//   syncEarningsCalendar   — sweep UW's premarket/afterhours calendars for a
//                            15-day window (yesterday → +13d) and upsert
//                            earnings_events. UW rows carry consensus EPS,
//                            the options-implied expected move, sector and
//                            market cap, so this one sweep IS the intraday
//                            implied-move refresh too. 2 calls per day
//                            swept (~30/run).
//   backfillEarningsHistory — per-ticker /earnings/{t} history for names with
//                            an upcoming event: est vs actual EPS, implied
//                            move, actual 1d/1w post-report moves. Also
//                            computes the avg-move / beat-rate rollups onto
//                            the event rows.
//   runEarningsAiBriefs    — Claude + web search brief for names reporting
//                            today or tomorrow: setup, what the street is
//                            watching (incl. revenue/guidance expectations,
//                            which our feeds don't carry numerically), and
//                            key risks. Stored in ai_summaries as
//                            kind="earnings-{TICKER}-{reportDate}".

import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { INDEX_EXTRA_SET } from "../lib/earnings-universe.js";
import thresholds from "../lib/ticker-thresholds.json" with { type: "json" };

const ts = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UW_BASE = "https://api.unusualwhales.com";

const TRACKED_SET = new Set(Object.keys(thresholds as Record<string, number>));
const WINDOW_DAYS = 21; // forward window (3 weeks); sweep also covers yesterday for actuals
const HISTORY_TICKERS_PER_RUN = 80;
const ROLLUP_QUARTERS = 12;
const BRIEF_CAP_PER_RUN = 60;
// 2-wide: 4 concurrent Opus calls × 3 web searches tripped the org's
// web-search rate limit on 2026-07-13 (briefs came back as narration about
// the rate limit instead of content — since purged).
const BRIEF_CONCURRENCY = 2;

async function uwGet(path: string): Promise<unknown | null> {
  const token = process.env.UW_API_TOKEN;
  if (!token) {
    console.warn(`[earnings] UW_API_TOKEN not set — skipping`);
    return null;
  }
  try {
    const res = await fetch(`${UW_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "UW-CLIENT-API-ID": "100001", Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dec = (v: unknown): Prisma.Decimal | null => {
  const n = num(v);
  return n == null ? null : new Prisma.Decimal(n);
};

function etDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

interface UwCalRow {
  symbol: string;
  reaction?: string;
  post_earnings_close?: string;
  full_name?: string;
  sector?: string;
  marketcap?: string;
  is_s_p_500?: boolean;
  has_options?: boolean;
  report_date?: string;
  report_time?: string;
  street_mean_est?: string;
  actual_eps?: string;
  expected_move?: string;
  expected_move_perc?: string;
  pre_earnings_close?: string;
  ending_fiscal_quarter?: string;
}

function inUniverse(r: UwCalRow): boolean {
  if (!r.symbol || !r.has_options) return false;
  return !!r.is_s_p_500 || INDEX_EXTRA_SET.has(r.symbol) || TRACKED_SET.has(r.symbol);
}

// ─── 1. Calendar sweep (also the implied-move refresh) ──────────────────────

export async function syncEarningsCalendar(): Promise<void> {
  let upserts = 0, days = 0;
  for (let off = -1; off <= WINDOW_DAYS; off++) {
    const date = etDateStr(off);
    const [pre, post] = await Promise.all([
      uwGet(`/api/earnings/premarket?date=${date}`),
      uwGet(`/api/earnings/afterhours?date=${date}`),
    ]);
    days++;
    const rows: UwCalRow[] = [
      ...((pre as { data?: UwCalRow[] })?.data ?? []),
      ...((post as { data?: UwCalRow[] })?.data ?? []),
    ];
    for (const r of rows) {
      if (!inUniverse(r) || !r.report_date) continue;
      const reportDate = new Date(`${r.report_date}T00:00:00.000Z`);
      const data = {
        reportTime: r.report_time === "premarket" || r.report_time === "postmarket" ? r.report_time : "unknown",
        fullName: r.full_name ?? null,
        sector: r.sector?.slice(0, 40) ?? null,
        marketcap: dec(r.marketcap),
        isSp500: !!r.is_s_p_500,
        epsEstimate: dec(r.street_mean_est),
        actualEps: dec(r.actual_eps),
        expectedMove: dec(r.expected_move),
        expectedMovePct: dec(r.expected_move_perc),
        preEarningsClose: dec(r.pre_earnings_close),
        postEarningsClose: dec(r.post_earnings_close),
        reactionPct: dec(r.reaction),
        fiscalQuarter: r.ending_fiscal_quarter ?? null,
      };
      await prisma.earningsEvent.upsert({
        where: { ticker_reportDate: { ticker: r.symbol, reportDate } },
        create: { ticker: r.symbol, reportDate, ...data },
        update: data,
      });
      upserts++;
    }
    await sleep(120);
  }
  console.log(`[earnings-calendar] ${ts()} swept ${days} days, upserted ${upserts} events`);
}

// ─── 2. Per-ticker history backfill + rollups ────────────────────────────────

export async function backfillEarningsHistory(): Promise<void> {
  // Upcoming names AND last week's reporters — recent reporters need their
  // fresh quarter (actual EPS + reaction move) folded into earnings_history.
  const today = new Date(`${etDateStr(0)}T00:00:00.000Z`);
  const weekAgo = new Date(`${etDateStr(-7)}T00:00:00.000Z`);
  const events = await prisma.earningsEvent.findMany({
    where: { reportDate: { gte: weekAgo } },
    select: { ticker: true },
    distinct: ["ticker"],
  });
  // Stale = no history refresh in the last 5 days.
  const cutoff = new Date(Date.now() - 5 * 86_400_000);
  const tickers: string[] = [];
  for (const e of events) {
    const fresh = await prisma.earningsHistory.findFirst({
      where: { ticker: e.ticker, updatedAt: { gte: cutoff } },
      select: { id: true },
    });
    if (!fresh) tickers.push(e.ticker);
    if (tickers.length >= HISTORY_TICKERS_PER_RUN) break;
  }
  if (!tickers.length) {
    console.log(`[earnings-history] ${ts()} all history fresh — nothing to do`);
    return;
  }

  let rows = 0, rolled = 0;
  for (const ticker of tickers) {
    const j = (await uwGet(`/api/earnings/${ticker}`)) as { data?: Record<string, string | null>[] } | null;
    const hist = j?.data ?? [];
    for (const h of hist) {
      if (!h.report_date) continue;
      const reportDate = new Date(`${h.report_date}T00:00:00.000Z`);
      const data = {
        reportTime: (h.report_time as string) ?? null,
        fiscalQuarter: (h.ending_fiscal_quarter as string) ?? null,
        epsEstimate: dec(h.street_mean_est),
        actualEps: dec(h.actual_eps),
        expectedMovePct: dec(h.expected_move_perc),
        move1dPct: dec(h.post_earnings_move_1d),
        move1wPct: dec(h.post_earnings_move_1w),
      };
      await prisma.earningsHistory.upsert({
        where: { ticker_reportDate: { ticker, reportDate } },
        create: { ticker, reportDate, ...data },
        update: data,
      });
      rows++;
    }

    // Rollups over the last N completed quarters → onto upcoming event rows.
    const completed = await prisma.earningsHistory.findMany({
      where: { ticker, move1dPct: { not: null } },
      orderBy: { reportDate: "desc" },
      take: ROLLUP_QUARTERS,
    });
    if (completed.length) {
      const avg =
        completed.reduce((s, q) => s + Math.abs(Number(q.move1dPct)), 0) / completed.length;
      const withEps = completed.filter((q) => q.epsEstimate != null && q.actualEps != null);
      const beats = withEps.filter((q) => Number(q.actualEps) >= Number(q.epsEstimate)).length;
      await prisma.earningsEvent.updateMany({
        where: { ticker, reportDate: { gte: today } },
        data: {
          avgMovePct: new Prisma.Decimal(avg),
          beatCount: withEps.length ? beats : null,
          quarterCount: withEps.length || null,
        },
      });
      rolled++;
    }
    await sleep(150);
  }
  console.log(`[earnings-history] ${ts()} backfilled ${tickers.length} tickers (${rows} rows, ${rolled} rollups)`);
}

// ─── 3. AI briefs ────────────────────────────────────────────────────────────
//
// ONE brief per ticker per report: generated when the name enters the 3-week
// window, never refreshed (cost decision 2026-07-13 — each brief runs ~$0.28
// of Opus + web search; the numeric data around it refreshes free via UW).
// Failed/invalid generations store nothing, so they retry on the next run.

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1200;
const MAX_WEB_SEARCHES = 3;
const MAX_CONTINUATIONS = 3;

const SYSTEM_PROMPT = `You are a market analyst writing pre-earnings briefs for the "Earnings Analyst" dashboard of a trading platform. Each brief covers one company reporting within the next two days.

Write exactly three sections, in this order, using these plain-text headers:

Setup: 2-3 sentences on where the stock and business stand going into the print. Use web search for anything recent (analyst previews, news, prior-quarter context).

Watching: 2-4 bullet points on the specific numbers and topics the street cares about this quarter — include the consensus revenue expectation and any guidance figure investors are anchored to when search surfaces them. Each bullet starts with "- ".

Risk: 1-2 sentences on what would most likely produce the downside scenario for the stock's reaction.

Rules: under 180 words total. No preamble, no narration of your search process, no investment advice, no disclaimers, nothing after the three sections. Plain text only.`;

export async function runEarningsAiBriefs(cap: number = BRIEF_CAP_PER_RUN): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(`[earnings-briefs] ${ts()} ANTHROPIC_API_KEY not set — skipping.`);
    return;
  }
  const client = new Anthropic();
  const todayIso = etDateStr(0);
  const d0 = new Date(`${todayIso}T00:00:00.000Z`);
  const dEnd = new Date(`${etDateStr(WINDOW_DAYS)}T00:00:00.000Z`);
  const events = await prisma.earningsEvent.findMany({
    where: { reportDate: { gte: d0, lte: dEnd } },
    orderBy: [{ reportDate: "asc" }, { marketcap: "desc" }],
  });
  // Decide which briefs are due under the cadence policy.
  const due: typeof events = [];
  let skipped = 0;
  for (const e of events) {
    const dateKey = e.reportDate.toISOString().slice(0, 10);
    const kind = `earnings-${e.ticker}-${dateKey}`;
    const latest = await prisma.aiSummary.findFirst({
      where: { kind }, orderBy: { generatedAt: "desc" }, select: { generatedAt: true },
    });
    if (!latest) due.push(e); else skipped++;
    if (due.length >= cap) break;
  }

  let generated = 0, failed = 0;
  const work = [...due];
  const runOne = async (e: (typeof events)[number]) => {
    const dateKey = e.reportDate.toISOString().slice(0, 10);
    const kind = `earnings-${e.ticker}-${dateKey}`;
    try {
      const userPrompt = `Company: ${e.fullName ?? e.ticker} (${e.ticker})
Sector: ${e.sector ?? "n/a"}
Reports: ${dateKey} ${e.reportTime === "premarket" ? "before the open" : e.reportTime === "postmarket" ? "after the close" : ""}
Consensus EPS: ${e.epsEstimate != null ? `$${Number(e.epsEstimate).toFixed(2)}` : "n/a"}
Options-implied move for the report: ${e.expectedMovePct != null ? `±${(Number(e.expectedMovePct) * 100).toFixed(1)}%` : "n/a"}
Average post-earnings move (last 12 qtrs): ${e.avgMovePct != null ? `±${(Number(e.avgMovePct) * 100).toFixed(1)}%` : "n/a"}
EPS beat rate: ${e.beatCount != null ? `${e.beatCount}/${e.quarterCount}` : "n/a"}

Search the web for the latest ${e.ticker} earnings preview and news, then write the brief.`;

      const body = await runWithWebSearch(client, userPrompt);
      if (!body) { failed++; return; }
      await prisma.aiSummary.create({
        data: { kind, generatedAt: new Date(), body: body.text, tokensUsed: body.tokens },
      });
      generated++;
    } catch (err) {
      failed++;
      console.error(`[earnings-briefs] ${e.ticker} failed:`, err instanceof Error ? err.message : err);
    }
  };

  // Small worker pool — briefs are network-bound (web search), so a few in
  // flight cuts wall time without hammering the API.
  const workers = Array.from({ length: Math.min(BRIEF_CONCURRENCY, work.length) }, async () => {
    for (;;) {
      const e = work.shift();
      if (!e) return;
      await runOne(e);
    }
  });
  await Promise.all(workers);

  console.log(`[earnings-briefs] ${ts()} generated ${generated}, fresh ${skipped}, failed ${failed} (due ${due.length})`);
}

// ─── 4. Post-earnings results briefs ─────────────────────────────────────────
//
// After the numbers are out: reported EPS vs consensus + an AI read of
// revenue, guidance, and what's driving the stock's reaction.
//   • 8:00 PM ET — same-evening pass for today's after-close reporters
//   • 9:00 AM ET — today's premarket reporters + yesterday's AMC stragglers
// kind = earnings-results-{TICKER}-{reportDate}; one per report (idempotent,
// invalid generations retry next run).

const RESULTS_SYSTEM_PROMPT = `You are a market analyst writing post-earnings result summaries for the "Earnings Analyst" dashboard of a trading platform. The company just reported.

Write exactly three sections, in this order, using these plain-text headers:

Results: 2-3 bullet points with the reported numbers — EPS vs consensus, revenue vs consensus, and any guidance change. Use web search to get them. Each bullet starts with "- ".

Reaction: 1-2 sentences on how the stock is trading since the report (after-hours or premarket/regular session) and how that compares to the options-implied move provided.

Drivers: 2-3 sentences on WHY the stock is reacting this way — the specific line items, guidance, or commentary the market is keying on.

Rules: under 180 words total. No preamble, no narration of your search process, no investment advice, nothing after the three sections. Plain text only.`;

export async function runEarningsResultsBriefs(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(`[earnings-results] ${ts()} ANTHROPIC_API_KEY not set — skipping.`);
    return;
  }
  const client = new Anthropic();
  const todayIso = etDateStr(0);
  const hourET = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date()),
  );
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const yesterday = new Date(`${etDateStr(-1)}T00:00:00.000Z`);

  // Evening run → today's AMC names. Morning run → today's premarket names +
  // yesterday's AMC stragglers (e.g. actuals that landed late).
  const where =
    hourET >= 16
      ? { reportDate: today, reportTime: "postmarket" }
      : {
          OR: [
            { reportDate: today, reportTime: "premarket" },
            { reportDate: yesterday, reportTime: "postmarket" },
          ],
        };
  const events = await prisma.earningsEvent.findMany({ where, orderBy: [{ marketcap: "desc" }] });

  let generated = 0, skipped = 0, failed = 0;
  for (const e of events) {
    const dateKey = e.reportDate.toISOString().slice(0, 10);
    const kind = `earnings-results-${e.ticker}-${dateKey}`;
    const existing = await prisma.aiSummary.findFirst({ where: { kind }, select: { id: true } });
    if (existing) { skipped++; continue; }
    try {
      const userPrompt = `Company: ${e.fullName ?? e.ticker} (${e.ticker})
Sector: ${e.sector ?? "n/a"}
Reported: ${dateKey} ${e.reportTime === "premarket" ? "before the open" : "after the close"}
Consensus EPS was: ${e.epsEstimate != null ? `$${Number(e.epsEstimate).toFixed(2)}` : "n/a"}
Reported EPS (from our feed, may lag): ${e.actualEps != null ? `$${Number(e.actualEps).toFixed(2)}` : "not yet captured — get it from search"}
Options-implied move was: ${e.expectedMovePct != null ? `±${(Number(e.expectedMovePct) * 100).toFixed(1)}%` : "n/a"}
Measured reaction so far: ${e.reactionPct != null ? `${(Number(e.reactionPct) * 100).toFixed(1)}%` : "not yet measured — describe from search"}

Search the web for ${e.ticker}'s earnings results and stock reaction, then write the summary.`;

      const body = await runResultsWithWebSearch(client, userPrompt);
      if (!body) { failed++; continue; }
      await prisma.aiSummary.create({
        data: { kind, generatedAt: new Date(), body: body.text, tokensUsed: body.tokens },
      });
      generated++;
    } catch (err) {
      failed++;
      console.error(`[earnings-results] ${e.ticker} failed:`, err instanceof Error ? err.message : err);
    }
    await sleep(400);
  }
  console.log(`[earnings-results] ${ts()} generated ${generated}, existing ${skipped}, failed ${failed} (${events.length} reporters)`);
}

async function runResultsWithWebSearch(
  client: Anthropic,
  userPrompt: string,
): Promise<{ text: string; tokens: number } | null> {
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCHES }] as unknown as Anthropic.Messages.Tool[];
  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userPrompt }];
  let tokens = 0;
  const parts: string[] = [];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: RESULTS_SYSTEM_PROMPT, messages, tools,
    });
    tokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
    for (const b of response.content) {
      if (b.type === "text" && b.text) parts.push(b.text);
    }
    if (response.stop_reason === "pause_turn" && i < MAX_CONTINUATIONS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }
    break;
  }
  let text = parts.join("").trim();
  const idx = text.indexOf("Results:");
  if (idx > 0) text = text.slice(idx);
  if (!text.includes("Results:") || !text.includes("Reaction:")) return null;
  return { text, tokens };
}

async function runWithWebSearch(
  client: Anthropic,
  userPrompt: string,
): Promise<{ text: string; tokens: number } | null> {
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCHES }] as unknown as Anthropic.Messages.Tool[];
  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userPrompt }];
  let tokens = 0;
  const parts: string[] = [];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages, tools,
    });
    tokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
    for (const b of response.content) {
      if (b.type === "text" && b.text) parts.push(b.text);
    }
    if (response.stop_reason === "pause_turn" && i < MAX_CONTINUATIONS) {
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }
    break;
  }
  let text = parts.join("").trim();
  const idx = text.indexOf("Setup:");
  if (idx > 0) text = text.slice(idx);
  // Structural validation — a brief without its sections is search-failure
  // narration, not a brief. Return null so nothing is stored and the name
  // stays due for the next run.
  if (!text.includes("Setup:") || !text.includes("Watching:")) return null;
  return { text, tokens };
}
