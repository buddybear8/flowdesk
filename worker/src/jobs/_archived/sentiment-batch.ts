// 🗄 ARCHIVED in v1.2.3 — DO NOT IMPORT FROM worker/src/index.ts IN V1.
//
// The Sentiment Tracker module (PRD §7) was archived from V1 scope because the
// X API Basic tier ($100/mo) was unaffordable. This file is the placeholder
// for the daily X-batch sentiment classification job that fed the module.
//
// Reactivation checklist (see PRD §7 archive banner for full steps):
//   1. Restore X_BEARER_TOKEN env var (PRD §15)
//   2. Implement the X API fetcher (was scoped as worker/src/jobs/x.ts)
//   3. Implement Anthropic bull/bear/neutral classification + sentiment
//      summary writer (extends ai-summarizer with the sentiment prompt
//      template archived in PRD §3.4)
//   4. Re-add the 06:00 ET cron schedule to worker/src/index.ts (was
//      `cron.schedule("0 0 6 * * 1-5", ...)`)
//   5. Restore XPost / SentimentSnapshot / AnalystProfile / DivergenceAlert
//      Prisma models from ARCHITECTURE §3 archive block; run a new migration
//   6. Un-comment the `Sentiment tracker` entry in
//      components/layout/Sidebar.tsx
//   7. Confirm X API tier pricing fits the budget

export async function runSentimentBatch(): Promise<void> {
  throw new Error(
    "sentiment-batch is archived in v1.2.3 — see worker/src/jobs/_archived/sentiment-batch.ts header for reactivation steps"
  );
}
