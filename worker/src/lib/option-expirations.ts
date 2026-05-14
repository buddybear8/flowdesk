// Per-ticker option expiration calendar.
//
// Used by pollGex to know which expirations to query when populating the GEX
// heatmap (5 nearest expirations × N strikes per ticker).
//
// Patterns (as of 2026):
//   SPY, QQQ, SPX                                — every weekday Mon–Fri
//   TSLA, NVDA, META, AMZN, GOOGL, NFLX, MSFT    — Mon / Wed / Fri only
//   AMD                                          — Friday weeklies only
//
// US market holidays are NOT modeled here — same gap as the market-open badge.
// On a holiday the UW `/spot-exposures/strike?expiry=<holiday>` call returns
// empty data; pollGex logs and skips. Acceptable until we wire a holiday
// calendar (punch list).

export type ExpiryPattern = "DAILY" | "MWF" | "FRIDAY";

const TICKER_PATTERNS: Record<string, ExpiryPattern> = {
  SPY: "DAILY",
  QQQ: "DAILY",
  SPX: "DAILY",
  TSLA: "MWF",
  NVDA: "MWF",
  AMD: "FRIDAY",
  META: "MWF",
  AMZN: "MWF",
  GOOGL: "MWF",
  NFLX: "MWF",
  MSFT: "MWF",
};

function isExpirationDay(date: Date, pattern: ExpiryPattern): boolean {
  const dow = date.getDay(); // 0=Sun..6=Sat
  if (dow === 0 || dow === 6) return false;
  if (pattern === "DAILY") return true;
  if (pattern === "FRIDAY") return dow === 5;
  // MWF = Mon(1) / Wed(3) / Fri(5)
  return dow === 1 || dow === 3 || dow === 5;
}

function fmtIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the N nearest option expiration ISO dates (YYYY-MM-DD) for the
 * given ticker, starting from `asOf`. If `asOf` is itself an expiration day
 * for the ticker, it is included as the first entry (0DTE).
 *
 * `asOf` is interpreted in local time of the calling process. The worker
 * runs with TZ=America/New_York on Railway so this resolves to ET dates.
 */
export function nearestExpirations(
  ticker: string,
  count: number,
  asOf: Date = new Date(),
): string[] {
  const pattern = TICKER_PATTERNS[ticker];
  if (!pattern) {
    throw new Error(`No expiration pattern configured for ticker: ${ticker}`);
  }
  const out: string[] = [];
  const cursor = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  while (out.length < count) {
    if (isExpirationDay(cursor, pattern)) out.push(fmtIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
