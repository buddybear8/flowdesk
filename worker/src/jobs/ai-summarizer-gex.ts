// jobs/ai-summarizer-gex.ts — daily at 07:00 ET.
//
// V1 scope (PRD §3.4): per-ticker GEX explanations only. Sentiment summary
// archived in v1.2.3.
//
// For each watched ticker:
//   1. Skip if today's summary (kind="gex-{TICKER}-{YYYY-MM-DD}") already
//      exists. Idempotent — re-runs are no-ops.
//   2. Read the latest gex_snapshot for the ticker.
//   3. Pick the top 5 strikes by |combined| (net dealer gamma).
//   4. Format inputs via prompts/gex.ts and call Anthropic Haiku.
//   5. Insert one ai_summaries row with the body and token usage.
//
// Model: claude-haiku-4-5 (PRD §2 — locked choice; ~25 calls/day, low
// intelligence demand, cost matters more than capability here).
//
// Failures isolated per-ticker — one bad call doesn't kill the batch.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma.js";
import { WATCHED_TICKERS, type WatchedTicker } from "../lib/watched-tickers.js";
import { SYSTEM_PROMPT, buildUserPrompt, type GexInputs } from "../prompts/gex.js";

const ts = () => new Date().toISOString();

const MODEL = "claude-haiku-4-5";

// Output ceiling. Locked spec is 200–280 words; ~600 tokens leaves headroom
// without risking a mid-thought truncation if the model goes slightly long.
const MAX_TOKENS = 600;

// Strikes JSON shape stored by jobs/uw.ts pollGex. We only need `strike` and
// `combined` here — the prompt doesn't surface the full per-side breakdown.
interface StoredStrike {
  strike: number;
  combined: number;
}

export async function runAiSummarizerGex(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      `[ai-summarizer-gex] ${ts()} ANTHROPIC_API_KEY not set — skipping. Add it to Railway worker env to enable.`
    );
    return;
  }

  const client = new Anthropic();
  const dateET = todayDateET();

  let generated = 0;
  let skippedExisting = 0;
  let skippedNoData = 0;
  let failed = 0;

  for (const ticker of WATCHED_TICKERS) {
    const kind = `gex-${ticker}-${dateET}`;
    try {
      // Idempotency: skip if today's summary already exists.
      const existing = await prisma.aiSummary.findFirst({
        where: { kind },
        select: { id: true },
      });
      if (existing) {
        skippedExisting++;
        continue;
      }

      const snapshot = await prisma.gexSnapshot.findFirst({
        where: { ticker },
        orderBy: { capturedAt: "desc" },
      });
      if (!snapshot) {
        console.warn(`[ai-summarizer-gex] ${ts()} ${ticker}: no gex_snapshot found, skipping`);
        skippedNoData++;
        continue;
      }

      const inputs = buildInputs(ticker, dateET, snapshot);
      const userPrompt = buildUserPrompt(inputs);

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      const body = extractText(response.content);
      if (!body) {
        console.warn(`[ai-summarizer-gex] ${ts()} ${ticker}: empty response, skipping insert`);
        failed++;
        continue;
      }

      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
      await prisma.aiSummary.create({
        data: {
          kind,
          generatedAt: new Date(),
          body,
          tokensUsed,
        },
      });
      generated++;
      console.log(`[ai-summarizer-gex] ${ts()} ${ticker}: stored summary (${tokensUsed} tokens)`);
    } catch (err) {
      failed++;
      console.error(
        `[ai-summarizer-gex] ${ts()} ${ticker}: failed —`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[ai-summarizer-gex] ${ts()} done · generated=${generated} skipped-existing=${skippedExisting} skipped-no-data=${skippedNoData} failed=${failed}`
  );
}

// Today's date in America/New_York as YYYY-MM-DD. en-CA Intl format gives
// the canonical ISO date shape directly. Cron is gated to 07:00 ET so we
// never straddle a date boundary.
function todayDateET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// Map a GexSnapshot row to the prompt inputs. Decimal columns come back as
// Prisma.Decimal — Number() coerces. Strikes JSON is an unknown shape until
// parsed; the cast is safe given pollGex always writes the StoredStrike[]
// shape, but the optional chaining + filter below tolerates corruption.
function buildInputs(
  ticker: WatchedTicker,
  dateET: string,
  snapshot: Awaited<ReturnType<typeof prisma.gexSnapshot.findFirst>>
): GexInputs {
  if (!snapshot) throw new Error("snapshot required"); // filtered upstream

  const allStrikes = Array.isArray(snapshot.strikes)
    ? (snapshot.strikes as unknown as StoredStrike[]).filter(
        (s) => typeof s?.strike === "number" && typeof s?.combined === "number"
      )
    : [];
  const topStrikes = [...allStrikes]
    .sort((a, b) => Math.abs(b.combined) - Math.abs(a.combined))
    .slice(0, 5)
    .map((s) => ({ strike: s.strike, combined: s.combined }));

  return {
    ticker,
    date: dateET,
    regime: snapshot.gammaRegime === "POSITIVE" ? "POSITIVE" : "NEGATIVE",
    spot: Number(snapshot.spot),
    callWall: Number(snapshot.callWall),
    putWall: Number(snapshot.putWall),
    gammaFlip: Number(snapshot.gammaFlip),
    maxPain: Number(snapshot.maxPain),
    netGexOI: Number(snapshot.netGexOI),
    netGexDV: Number(snapshot.netGexDV),
    topStrikes,
  };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
