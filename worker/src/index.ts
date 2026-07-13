// FlowDesk worker — single Node service driving all backend cron jobs.
//
// Locked architecture: ARCHITECTURE.md §1 / §6 (single-worker option A, v1.4).
// Dark-pool source switched 2026-05-13 from UW polling to Polygon. UW dark-
// pool ingest and the s3-darkpool-import stub are both retired. Polygon
// daily flat-file + hourly REST poll own dark_pool_prints going forward.

import cron from "node-cron";
import {
  pollFlowAlerts,
  pollLottoAlerts,
  pollSweeperAlerts,
  pollGex,
  pollMarketTide,
  computeNetImpact,
} from "./jobs/uw.js";
import { HOT_TICKERS as GEX_HOT_TICKERS, EXTENDED_TICKERS as GEX_EXTENDED_TICKERS } from "./lib/watched-tickers.js";
import { runFlowRetentionSweep, runDpRetentionSweep, runGexHeatmapRetentionSweep, runFlowSentimentRetentionSweep, runWatchesRetentionSweep } from "./jobs/retention.js";
import { runArchiveSweep } from "./jobs/archive.js";
import { pollFlowSentiment } from "./jobs/flow-sentiment.js";
import { HOT_TICKERS, TAIL_TICKERS } from "./lib/sentiment-tickers.js";
import { refreshTickerMetadata } from "./jobs/refresh-ticker-metadata.js";
import { runAiSummarizerGex } from "./jobs/ai-summarizer-gex.js";
import { runAiSummarizerWatches } from "./jobs/ai-summarizer-watches.js";
import { computeHitList, priceWatchContracts } from "./jobs/hit-list-compute.js";
import { syncEarningsCalendar, backfillEarningsHistory, runEarningsAiBriefs } from "./jobs/earnings.js";
import { postWatchesToDiscord } from "./jobs/watches-discord.js";
import { importPolygonDailyFlatFile } from "./jobs/polygon-daily-flatfile.js";
import { pollPolygonIntraday } from "./jobs/polygon-hourly-intraday.js";
import { pollCandles } from "./jobs/candles.js";
import { pollTradeAlerts } from "./jobs/trade-alerts.js";
import { prisma, disconnectPrisma } from "./lib/prisma.js";

const ts = () => new Date().toISOString();

// Wraps a job in error-isolation: a single failing run never bubbles to
// node-cron and never kills the process.
const safe =
  (label: string, fn: () => Promise<unknown> | unknown) =>
  () => {
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error(`[${ts()}] [job:${label}] uncaught:`, err));
  };

// node-cron 6-field expressions: sec min hour dayOfMonth month dayOfWeek.
// TZ=America/New_York must be set on the Railway service so cron resolves in ET.

// ─── UW polling (jobs/uw.ts) — flow/lotto/sweeper only; dark pool moved to Polygon
cron.schedule("*/30 * 9-15 * * 1-5", safe("uw-poll-mkt", async () => {
  await Promise.all([pollFlowAlerts(), pollLottoAlerts(), pollSweeperAlerts()]);
}));
cron.schedule("0 */5 0-8,16-23 * * 1-5", safe("uw-poll-off", async () => {
  await Promise.all([pollFlowAlerts(), pollLottoAlerts(), pollSweeperAlerts()]);
}));
// GEX-poll cadence reduced from every 60s to every 2 min on 2026-05-20 after
// a second consecutive day of UW daily-quota exhaustion (the row-count cut in
// bc87b02 wasn't sufficient on its own). Dealer positioning barely changes
// minute-to-minute; 2 min is perceptually fine and halves the dominant UW
// consumer. Stacked with the per-cycle row-count cut, the worker should now
// stay comfortably under UW's daily quota.
// Tiered GEX cadence (see watched-tickers.ts): hot names every 2 min,
// extended names on a 10-min rotation offset to minute :01.
cron.schedule("0 */2 9-15 * * 1-5", safe("gex-poll-hot", () => pollGex(GEX_HOT_TICKERS)));
cron.schedule("0 1-59/10 9-15 * * 1-5", safe("gex-poll-extended", () => pollGex(GEX_EXTENDED_TICKERS)));
cron.schedule("0 */5 9-15 * * 1-5", safe("market-tide", pollMarketTide));
cron.schedule("30 */5 9-15 * * 1-5", safe("net-impact", computeNetImpact));

// ─── Options Sentiment (jobs/flow-sentiment.ts) — tiered cadence ──────────────
// Per-strike call/put buy-vs-sell snapshots feeding the /flow-sentiment replay
// slider. HOT (11 watched names) every 5 min for a live feel; TAIL (~218 names)
// hourly. One UW /flow-per-strike call per ticker per sweep; the job watches the
// UW quota headers and bails before tripping a limit. Combined ≈ 2.1K calls/day.
// Offset 45s into the minute so it doesn't collide with the net-impact (:30) tick.
cron.schedule("45 */5 9-15 * * 1-5", safe("flow-sentiment-hot", () => pollFlowSentiment(HOT_TICKERS)));
cron.schedule("45 0 10-15 * * 1-5", safe("flow-sentiment-tail", () => pollFlowSentiment(TAIL_TICKERS)));

// ─── Trade Alerts (jobs/trade-alerts.ts) ─────────────────────────────────────
// Ingest Discord "Trade Alert Bot" embeds + re-price open positions. Every 5
// min during market hours, plus a post-close pass to settle expirations.
cron.schedule("0 */5 9-16 * * 1-5", safe("trade-alerts", () => pollTradeAlerts()));
cron.schedule("0 30 16,20 * * 1-5", safe("trade-alerts-settle", () => pollTradeAlerts()));

// ─── Polygon dark-pool ingest (replaces UW dark-pool + s3-darkpool-import) ───
// Polygon publishes the previous trading day's flat file around 3-5 AM ET;
// 06:00 leaves a safe buffer. Hourly intraday picks up the rest of the day
// (15-min delay floor at the $79 Starter tier; ~75 min max delay to DB).
cron.schedule("0 0 6 * * 1-5", safe("polygon-daily-flatfile", importPolygonDailyFlatFile));
cron.schedule("0 0 10-17 * * 1-5", safe("polygon-hourly-intraday", pollPolygonIntraday));

// Price-chart candles (jobs/candles.ts) — every 10 min, 08:00–20:59 ET Mon–Fri.
// A full sweep of ~229 tickers × 3 timeframes takes several minutes, so the
// cadence is 10 min (not 1 min); the in-flight guard skips a tick if a sweep
// runs long. Sole Polygon caller for chart data; /api/candles reads candle_bars.
cron.schedule("0 */10 8-20 * * 1-5", safe("candles-poll", pollCandles));

// ─── Daily batches (jobs/*) ──────────────────────────────────────────────────
cron.schedule("0 30 5 * * 1-5", safe("refresh-ticker-metadata", refreshTickerMetadata));
cron.schedule("0 0 7 * * 1-5", safe("ai-summarizer-gex", runAiSummarizerGex));
cron.schedule("0 30 7 * * 1-5", safe("hit-list-compute", computeHitList));
// Suggested-contract live marks for today's watches — every 15 min in session.
cron.schedule("0 */15 9-16 * * 1-5", safe("watch-contract-prices", priceWatchContracts));

// ─── Earnings Analyst (jobs/earnings.ts) ─────────────────────────────────────
// Calendar sweep doubles as the implied-move refresh (UW rows carry the
// expected move): full daily pass premarket, then every 15 min through the
// session; history backfill + AI briefs run before the open.
cron.schedule("0 50 5 * * 1-5", safe("earnings-calendar", syncEarningsCalendar));
cron.schedule("0 55 5 * * 1-5", safe("earnings-history", backfillEarningsHistory));
cron.schedule("0 40 6 * * 1-5", safe("earnings-briefs", runEarningsAiBriefs));
cron.schedule("0 5 8-17 * * 1-5", safe("earnings-refresh", syncEarningsCalendar));
cron.schedule("0 45 7 * * 1-5", safe("ai-summarizer-watches", runAiSummarizerWatches));
// Daily Watches → Discord card (no-op until DISCORD_WATCHES_* env is set);
// 8:10 retry covers a slow/watchdog-recovered compute. Dedupes per day.
cron.schedule("0 50 7 * * 1-5", safe("watches-discord", postWatchesToDiscord));
cron.schedule("0 10 8 * * 1-5", safe("watches-discord-retry", postWatchesToDiscord));

// Daily-watches watchdog — recurring self-heal (replaces the boot-only
// catch-up). Two incidents motivated this: 2026-07-08 (worker down over the
// 07:00-07:45 window, cron skipped) and 2026-07-09 (cron fired but the job
// threw on an ICU "24:00" midnight-format quirk — a one-shot cron gets no
// retry). Every 5 minutes on weekdays after 07:35 ET: if today's hit list is
// missing, run compute + briefs. Idempotent; in-flight guard prevents overlap.
let watchesWatchdogInFlight = false;
async function watchesWatchdogTick(): Promise<void> {
  if (watchesWatchdogInFlight) return;
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
    const dow = get("weekday");
    if (dow === "Sat" || dow === "Sun") return;
    const hRaw = get("hour");
    const minutes = (hRaw === "24" ? 0 : Number(hRaw)) * 60 + Number(get("minute"));
    if (minutes < 7 * 60 + 35) return;
    const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
    const existing = await prisma.hitListDaily.count({ where: { date: new Date(`${todayET}T00:00:00.000Z`) } });
    if (existing > 0) return;
    watchesWatchdogInFlight = true;
    console.log(`[${ts()}] [worker] watches watchdog: no hit list for ${todayET} after 07:35 ET — running compute + briefs`);
    await safe("hit-list-compute-watchdog", computeHitList)();
    await safe("ai-summarizer-watches-watchdog", runAiSummarizerWatches)();
  } catch (err) {
    console.error(`[${ts()}] [worker] watches watchdog failed:`, err instanceof Error ? err.message : err);
  } finally {
    watchesWatchdogInFlight = false;
  }
}
setInterval(() => { void watchesWatchdogTick(); }, 5 * 60 * 1000);
void watchesWatchdogTick(); // also check immediately on boot
// S3 training-data archive (jobs/archive.ts) — 02:00 ET daily, one hour BEFORE
// the retention sweeps delete anything. Copies each complete UTC day of
// flow_alerts / flow_sentiment_days / gex(+heatmap) / dark_pool_prints to
// s3://$DARKPOOL_S3_BUCKET/archive/ as JSONL.gz for the ta_pipeline ML corpus.
cron.schedule("0 0 2 * * *", safe("archive-sweep", () => runArchiveSweep()));

cron.schedule("0 0 3 * * 1-5", safe("retention-sweeps", async () => {
  await Promise.all([runFlowRetentionSweep(), runDpRetentionSweep(), runGexHeatmapRetentionSweep(), runFlowSentimentRetentionSweep()]);
  await runWatchesRetentionSweep();
}));

// ─── 🗄 Archived in v1.4 (do NOT re-add in V1) ────────────────────────────────
// "0 0 6 * * 1-5"  — was the X API daily batch. Sentiment Tracker module
//                    deferred from V1 (see PRD §7 archive banner).

// Graceful shutdown — disconnect Prisma on SIGINT/SIGTERM so Railway redeploys
// don't leak DB connections.
const shutdown = async (signal: string) => {
  console.log(`[${ts()}] [worker] received ${signal}, disconnecting Prisma...`);
  await disconnectPrisma();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`[${ts()}] [worker] started — 26 schedules registered (tiered GEX cadence; watches Discord card) (Polygon dark-pool ingest live; Options Sentiment hot+tail live; S3 archive live; Trade Alerts live)`);
