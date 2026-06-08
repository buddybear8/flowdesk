// Ticker universes for the Options Sentiment job (jobs/flow-sentiment.ts).
//
// Tiered cadence (chosen to keep UW load decoupled from user count and well
// under the daily quota — see worker/src/index.ts):
//   • HOT  — the GEX/watched names, polled every 5 min  → snappy "live" feel
//   • TAIL — the rest of the tracked corpus, polled hourly
//
// HOT reuses WATCHED_TICKERS; TAIL is the 229-ticker tracked corpus
// (ticker-thresholds.json, same source as the dark-pool filter) minus HOT.

import thresholdsJson from "./ticker-thresholds.json" with { type: "json" };
import { WATCHED_TICKERS } from "./watched-tickers.js";

export const HOT_TICKERS: readonly string[] = [...WATCHED_TICKERS];

const hotSet = new Set(HOT_TICKERS);

export const TAIL_TICKERS: readonly string[] = Object.keys(
  thresholdsJson as Record<string, unknown>,
)
  .filter((t) => !hotSet.has(t))
  .sort();
