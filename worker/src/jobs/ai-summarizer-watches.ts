// jobs/ai-summarizer-watches.ts — daily at 07:45 ET (after hit-list-compute at 07:30).
//
// For each ticker on today's Daily Watches hit list, generate an AI summary via
// Claude (claude-opus-4-8) with the server-side web_search tool:
//   1. Latest news on the ticker (model searches the web).
//   2. Why it's flagged — restated from the confluence signals.
//   3. Price action over the last 1–2 weeks (from our own daily candles).
//
// Stored in ai_summaries with kind="watch-{TICKER}-{YYYY-MM-DD}", read by
// /api/watches. Idempotent — existing kinds are skipped, so re-runs only fill
// gaps. Failures isolated per-ticker.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma.js";

const ts = () => new Date().toISOString();

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1200;
const MAX_WEB_SEARCHES = 3;
const MAX_CONTINUATIONS = 3; // pause_turn resume cap

const SYSTEM_PROMPT = `You are a market analyst writing short daily briefs for the "Daily Watches" dashboard of a trading platform. Each brief covers one ticker that today's screen flagged from a confluence of options-flow signals.

Write exactly three sections, in this order, using these plain-text headers:

News: 2-3 bullet points on the most relevant recent news for the ticker (last ~2 weeks). Use web search to find it. Each bullet starts with "- " and includes the date. If nothing material is found, write one bullet saying so.

Signals: 1-2 sentences interpreting why the screen flagged this name, based ONLY on the signal data provided (flow premium, call/put sentiment, dark pool, persistence, direction). Do not invent signals.

Price action: 2-3 sentences describing the stock's move over the last 1-2 weeks using ONLY the price series provided (trend, magnitude, notable days, where it sits vs the recent range).

Rules: under 170 words total. No preamble, no narration of your search process, no investment advice, no disclaimers. Do not append word counts, notes, or anything after the three sections. Plain text only — no markdown headings other than the three section labels above.`;

interface CandlePoint {
  d: string;
  close: number;
}

export async function runAiSummarizerWatches(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(`[ai-summarizer-watches] ${ts()} ANTHROPIC_API_KEY not set — skipping.`);
    return;
  }

  const client = new Anthropic();
  const dateET = todayDateET();

  // Today's hit list (fall back to the latest date so a late run still works).
  const latest = await prisma.hitListDaily.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  if (!latest) {
    console.log(`[ai-summarizer-watches] ${ts()} no hit list rows — nothing to summarize`);
    return;
  }
  const rows = await prisma.hitListDaily.findMany({ where: { date: latest.date }, orderBy: { rank: "asc" } });
  const dateKey = latest.date.toISOString().slice(0, 10);

  let generated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const kind = `watch-${row.ticker}-${dateKey}`;
    try {
      const existing = await prisma.aiSummary.findFirst({ where: { kind }, select: { id: true } });
      if (existing) { skipped++; continue; }

      // Last ~14 trading days of daily closes for the price-action section.
      const candles = await prisma.candleBar.findMany({
        where: { ticker: row.ticker, timeframe: "1D" },
        orderBy: { barTime: "desc" },
        take: 14,
        select: { barTime: true, close: true },
      });
      const series: CandlePoint[] = candles
        .reverse()
        .map((c) => ({ d: c.barTime.toISOString().slice(0, 10), close: Number(c.close) }));

      const userPrompt = buildUserPrompt(row, series);

      const body = await runWithWebSearch(client, userPrompt);
      if (!body) { failed++; continue; }

      await prisma.aiSummary.create({
        data: { kind, generatedAt: new Date(), body: body.text, tokensUsed: body.tokens },
      });
      generated++;
    } catch (err) {
      failed++;
      console.error(`[ai-summarizer-watches] ${row.ticker} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[ai-summarizer-watches] ${ts()} generated ${generated}, skipped ${skipped} existing, failed ${failed} (${dateET})`);
}

function buildUserPrompt(
  row: { ticker: string; direction: string; thesis: string; contract: string; price: unknown; signals: unknown },
  series: CandlePoint[],
): string {
  const s = row.signals as {
    flow?: { premium: number; alerts: number };
    sentiment?: { cpRatio: number; side: string };
    darkpool?: { rank: number };
    persistence?: { days: number; of: number };
    agree?: boolean;
  } | null;

  const signalLines = [
    s?.flow ? `- Options flow: $${Math.round(s.flow.premium / 1000)}K premium across ${s.flow.alerts} qualifying alerts` : null,
    s?.sentiment ? `- Chain sentiment: call/put ratio ${s.sentiment.cpRatio} (${s.sentiment.side === "UP" ? "bullish" : "bearish"})${s.agree ? ", agrees with flow direction" : ""}` : null,
    s?.darkpool ? `- Dark pool: ranked print #${s.darkpool.rank} in the last 48h` : null,
    s?.persistence ? `- Persistence: signaled on ${s.persistence.days} of the last ${s.persistence.of} sessions` : null,
  ].filter(Boolean).join("\n");

  const priceLines = series.map((p) => `${p.d}: $${p.close.toFixed(2)}`).join("\n");

  return `Ticker: ${row.ticker}
Screen direction: ${row.direction === "UP" ? "bullish" : "bearish"}
Suggested contract to watch: ${row.contract}
Last close: $${Number(row.price).toFixed(2)}
Screen thesis: ${row.thesis}

Signal data:
${signalLines || "- (flow only)"}

Daily closes (oldest to newest):
${priceLines}

Search the web for the latest ${row.ticker} stock news, then write the brief.`;
}

// One request with the server-side web_search tool; resume on pause_turn (the
// server-tool loop can pause after several searches).
async function runWithWebSearch(
  client: Anthropic,
  userPrompt: string,
): Promise<{ text: string; tokens: number } | null> {
  // SDK 0.65 predates the web_search_20260209 tool type — cast keeps us on the
  // documented wire shape.
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_WEB_SEARCHES }] as unknown as Anthropic.Messages.Tool[];

  let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userPrompt }];
  let tokens = 0;
  const parts: string[] = [];

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });
    tokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    // Accumulate ALL text blocks — the model may write a section, run more
    // searches, then continue in a later block (taking only the last block
    // dropped the News section in testing). Web-search citations split text
    // into contiguous fragments, so join WITHOUT trimming/separators to keep
    // sentences intact.
    for (const b of response.content) {
      if (b.type === "text" && b.text) parts.push(b.text);
    }

    if (response.stop_reason === "pause_turn" && i < MAX_CONTINUATIONS) {
      // Re-send with the paused assistant turn appended — server resumes.
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }
    break;
  }

  let text = parts.join("").trim();
  // The brief must start at "News:" — drop any pre-search narration the model
  // emitted before the final answer.
  const newsIdx = text.indexOf("News:");
  if (newsIdx > 0) text = text.slice(newsIdx);
  if (!text) return null;
  return { text, tokens };
}

// Today's date in ET as YYYY-MM-DD.
function todayDateET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
