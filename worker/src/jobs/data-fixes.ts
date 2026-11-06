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
