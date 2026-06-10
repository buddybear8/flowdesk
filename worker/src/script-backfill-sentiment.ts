// One-shot backfill of flow_sentiment_days from UW /flow-per-strike history.
//
// UW serves full-chain whole-day cumulative flow back to roughly the start of
// the prior calendar month (probed 2026-06-10: 2026-05-04 OK, 2026-04-27 403).
// This pulls every (tracked ticker × weekday) in the range as a single-snapshot
// day. Idempotent: days that already have a row are skipped, so live-collected
// days are never touched and re-runs are safe.
//
//   railway run -- npx tsx src/script-backfill-sentiment.ts 2026-05-04 2026-06-05
//
// Quota: ~229 tickers × ~24 weekdays ≈ 5.5K UW calls at ~600ms spacing
// (~60 min). Aborts when daily headroom drops under 600.

import { backfillFlowSentimentDay, disconnectPrisma } from "./jobs/flow-sentiment.js";
import { HOT_TICKERS, TAIL_TICKERS } from "./lib/sentiment-tickers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  const start = process.argv[2];
  const end = process.argv[3];
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    console.error("usage: script-backfill-sentiment.ts <YYYY-MM-DD start> <YYYY-MM-DD end>");
    process.exit(1);
  }
  const tickers = [...HOT_TICKERS, ...TAIL_TICKERS];

  let stored = 0;
  let exists = 0;
  let empty = 0;
  let errors = 0;
  outer: for (let t = new Date(`${start}T12:00:00Z`).getTime(); ; t += DAY_MS) {
    const d = new Date(t);
    const day = dayStr(d);
    if (day > end) break;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekends — no session
    console.log(`── ${day} ──`);
    for (const ticker of tickers) {
      let r = await backfillFlowSentimentDay(ticker, day);
      // A 429 (shared per-minute window with the live worker) surfaces as a
      // low/zero headroom reading or an empty error. Wait out the minute
      // window and retry once before trusting the reading; abort only if a
      // fresh call still reports exhaustion (genuine daily cap).
      if (r.dailyRemaining != null && r.dailyRemaining < 600) {
        console.warn(`   low headroom reading (${r.dailyRemaining}) at ${ticker} — sleeping 65s and retrying`);
        await sleep(65_000);
        r = await backfillFlowSentimentDay(ticker, day);
        if (r.dailyRemaining != null && r.dailyRemaining < 600) {
          console.warn(`daily quota genuinely low (${r.dailyRemaining}) — stopping (resume later, idempotent)`);
          break outer;
        }
      }
      if (r.status === "stored") stored++;
      else if (r.status === "exists") exists++;
      else if (r.status === "empty") empty++;
      else errors++;
      // ~52/min leaves headroom under UW's per-minute cap for the live worker.
      if (r.status !== "exists") await sleep(1_150);
    }
    console.log(`   totals so far: ${stored} stored · ${exists} existed · ${empty} empty · ${errors} errors`);
  }
  console.log(`\ndone — ${stored} stored, ${exists} existed, ${empty} empty (holidays), ${errors} errors`);
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("backfill-sentiment failed:", err);
  process.exit(1);
});
