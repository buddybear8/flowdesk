// jobs/data-fixes.ts — one-off idempotent data corrections that run once at
// worker boot. Escape hatch for "hide/fix these rows" requests when direct
// DB access isn't available (e.g. Railway CLI session expired, 2026-11-06).
//
// Each fix runs exactly once: an ai_summaries marker row (kind
// `datafix-{tag}`) records completion, so boots after the first are no-ops.
// Add new fixes to the END of the list with a dated tag; never edit or
// remove executed entries (their markers keep them inert).

import { prisma } from "../lib/prisma.js";

const ts = () => new Date().toISOString();

interface Fix {
  tag: string;
  run: () => Promise<string>; // returns a short result description for the marker
}

// Matcher for hiding trade-alert rows (sets hidden=true; ingest never
// resurrects hidden rows and the API excludes them everywhere).
function hideTrades(
  matchers: { ticker: string; side: string; strike: number; expiry: string; moderator: string }[],
) {
  return async (): Promise<string> => {
    const res = await prisma.tradeAlert.updateMany({
      where: {
        hidden: false,
        OR: matchers.map((m) => ({
          ticker: m.ticker,
          side: m.side,
          strike: m.strike,
          expiry: new Date(`${m.expiry}T00:00:00.000Z`),
          moderator: m.moderator,
        })),
      },
      data: { hidden: true },
    });
    return `hid ${res.count}/${matchers.length} trade_alerts rows`;
  };
}

const SIZE_WEIGHT: Record<string, number> = { Large: 0.1, Medium: 0.05, Small: 0.01, Lotto: 0.005 };

// Close an OPEN position fully at its current realized level: the remaining
// fraction exits at the same pct as the banked scale-outs, so the stored
// weighted average is unchanged; remaining goes to 0, status to CLOSED, and
// the row is frozen as a manual override.
function closeAtRealized(
  matchers: { ticker: string; side: string; strike: number; expiry: string; moderator: string }[],
  tag: string,
) {
  return async (): Promise<string> => {
    const results: string[] = [];
    for (const m of matchers) {
      const row = await prisma.tradeAlert.findFirst({
        where: {
          ticker: m.ticker, side: m.side, strike: m.strike, moderator: m.moderator,
          expiry: new Date(`${m.expiry}T00:00:00.000Z`), status: "OPEN", hidden: false,
        },
      });
      if (!row) { results.push(`${m.ticker} ${m.strike}${m.side[0]}: NOT FOUND`); continue; }
      const rem = Number(row.remainingFrac);
      const pct = Number(row.realizedPct); // weighted avg of banked exits — the close level
      const messageId = `manual-close-${tag}-${m.ticker}-${m.strike}`;
      const events = Array.isArray(row.events) ? [...(row.events as object[])] : [];
      if (!events.some((e) => (e as { messageId?: string }).messageId === messageId)) {
        events.push({ action: "close", price: null, fracClosed: rem, pct, at: new Date().toISOString(), messageId, manual: true });
      }
      await prisma.tradeAlert.update({
        where: { id: row.id },
        data: {
          status: "CLOSED",
          remainingFrac: 0,
          realizedPct: pct, // both halves exit at the same level → avg unchanged
          livePct: null,
          bookDelta: (SIZE_WEIGHT[row.sizeLabel] ?? 0.01) * pct,
          manualOverride: true,
          events: events as object[],
        },
      });
      results.push(`${m.ticker} ${m.strike}${m.side[0]}: closed at ${pct.toFixed(1)}%`);
    }
    return results.join("; ");
  };
}

const FIXES: Fix[] = [
  {
    tag: "2026-11-06-hide-six-losers",
    run: hideTrades([
      { ticker: "IONQ", side: "CALL", strike: 45, expiry: "2026-09-11", moderator: "Seaking" },
      { ticker: "MRVL", side: "PUT", strike: 220, expiry: "2026-09-04", moderator: "Seaking" },
      { ticker: "AAPL", side: "CALL", strike: 332.5, expiry: "2026-09-04", moderator: "Seaking" },
      { ticker: "NKE", side: "CALL", strike: 45, expiry: "2026-10-16", moderator: "BuddyBear" },
      { ticker: "AMD", side: "CALL", strike: 492.5, expiry: "2026-08-12", moderator: "Seaking" },
      { ticker: "IONQ", side: "CALL", strike: 50, expiry: "2026-08-21", moderator: "Seaking" },
    ]),
  },
  {
    tag: "2026-11-06-close-meta-nflx-at-realized",
    run: closeAtRealized([
      { ticker: "META", side: "CALL", strike: 645, expiry: "2026-11-06", moderator: "BuddyBear" },
      { ticker: "NFLX", side: "CALL", strike: 65, expiry: "2026-12-18", moderator: "BuddyBear" },
    ], "20261106"),
  },
];

export async function runDataFixes(): Promise<void> {
  for (const fix of FIXES) {
    const markerKind = `datafix-${fix.tag}`;
    try {
      const done = await prisma.aiSummary.findFirst({ where: { kind: markerKind }, select: { id: true } });
      if (done) continue;
      const result = await fix.run();
      await prisma.aiSummary.create({
        data: { kind: markerKind, generatedAt: new Date(), body: result, tokensUsed: 0 },
      });
      console.log(`[data-fixes] ${ts()} ${fix.tag}: ${result}`);
    } catch (e) {
      console.error(`[data-fixes] ${ts()} ${fix.tag} failed: ${String(e).slice(0, 200)}`);
    }
  }
}
