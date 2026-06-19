// One-time Trade Alerts seed: ingest the last N days (default 14) of alerts from
// the Discord channels into trade_alerts. After this, the trade-alerts cron's
// rolling re-derive keeps the full history growing incrementally.
//
//   railway run -- npx tsx src/script-backfill-trade-alerts.ts [days]
//   (or with DISCORD_* + DATABASE_URL + UW_API_TOKEN in env)

import { pollTradeAlerts, disconnectPrisma } from "./jobs/trade-alerts.js";

async function main() {
  const days = Number(process.argv[2] ?? 14);
  console.log(`seeding trade alerts from the last ${days} days…`);
  await pollTradeAlerts(days);
  await disconnectPrisma();
}

main().catch((err) => {
  console.error("backfill-trade-alerts failed:", err);
  process.exit(1);
});
