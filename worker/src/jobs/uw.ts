// jobs/uw.ts — Unusual Whales polling jobs.
//
// Endpoints used (PRD §3.1):
//   • /api/option-trades/flow-alerts            → flow_alerts
//   • /api/darkpool/recent                      → dark_pool_prints
//   • /api/stock/{ticker}/spot-exposures/strike → gex_snapshots (+ key levels)
//   • /api/market/market-tide?interval_5m=1     → market_tide_bars
//   • Net Impact: pending (PRD §16 open question)
//
// Auth (PRD §3.1):
//   Authorization: Bearer <UW_API_TOKEN>
//   UW-CLIENT-API-ID: 100001
//
// Idempotency: every insert uses `skipDuplicates: true` against the natural
// key (FlowAlert.id, DarkPoolPrint.uwId, MarketTideBar.bucketStart). Repeat
// polls in the same window do not produce dupes.

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const UW_BASE = "https://api.unusualwhales.com";

// 5 watched tickers per PRD §8 (Options GEX module dropdown). Keep in sync.
const WATCHED_TICKERS = ["SPY", "QQQ", "SPX", "NVDA", "TSLA"] as const;

const uwHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${process.env.UW_API_TOKEN ?? ""}`,
  "UW-CLIENT-API-ID": "100001",
  Accept: "application/json",
});

// ─── Tiny utility helpers ────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;

async function uwFetch(path: string, label: string): Promise<unknown | null> {
  if (!process.env.UW_API_TOKEN) {
    console.error(`[uw:${label}] UW_API_TOKEN not set — skipping`);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${UW_BASE}${path}`, {
      headers: uwHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[uw:${label}] HTTP ${res.status} ${res.statusText} — ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[uw:${label}] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function asArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray((v as any).data)) return (v as any).data;
  return [];
}

const ts = () => new Date().toISOString();

// True if a Date falls inside RTH (09:30–15:59 ET) on a weekday.
function isIntradayET(date: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;
  if (hour < 9 || hour >= 16) return false;
  if (hour === 9 && minute < 30) return false;
  return true;
}

function logSampleOnce(label: string, sample: unknown): void {
  // Print the first row's raw shape once per worker process so we can verify
  // UW response field names match our mappings. Subsequent calls are silent.
  const key = `__SAMPLED_${label}`;
  if ((process as any)[key]) return;
  (process as any)[key] = true;
  try {
    console.log(`[uw:${label}] sample raw row:`, JSON.stringify(sample).slice(0, 800));
  } catch {
    /* serialization errors ignored */
  }
}

// ─── 1. Flow alerts ──────────────────────────────────────────────────────────

export async function pollFlowAlerts(): Promise<void> {
  const json = await uwFetch("/api/option-trades/flow-alerts?limit=100", "flow");
  if (!json) return;
  const items = asArray(json);
  if (items.length === 0) return;
  logSampleOnce("flow", items[0]);

  const records = items
    .map(mapFlowAlert)
    .filter((r): r is Prisma.FlowAlertCreateManyInput => r !== null);

  if (records.length === 0) {
    console.warn(`[uw:flow] mapped 0 of ${items.length} raw rows — verify UW response shape`);
    return;
  }

  const result = await prisma.flowAlert.createMany({
    data: records,
    skipDuplicates: true,
  });
  console.log(`[uw:flow] ${ts()} inserted ${result.count} of ${records.length} alerts`);
}

function mapFlowAlert(raw: any): Prisma.FlowAlertCreateManyInput | null {
  if (!raw?.id || !raw?.ticker) return null;
  // Field names verified against live UW /api/option-trades/flow-alerts on
  // 2026-05-04. UW does NOT provide type/side/sentiment/exec/confidence
  // directly — they're derived below.

  const time = new Date(raw.created_at ?? raw.executed_at ?? raw.time ?? Date.now());
  const expiry = new Date(raw.expiry ?? raw.expiration ?? time);
  const strike = Number(raw.strike ?? 0);

  // Type: parse from the OCC-encoded option_chain symbol.
  // Format: TICKER + YYMMDD + C/P + 8-digit-strike (e.g. SPXW260506P07225000).
  const chain = String(raw.option_chain ?? "");
  const occ = chain.match(/(\d{6})([CP])(\d{8})$/);
  const type: "CALL" | "PUT" = occ?.[2] === "P" ? "PUT" : "CALL";

  // Side: aggressive direction from premium balance.
  //   ask-side total > bid-side total → BUY (initiator hit the ask)
  //   bid-side total > ask-side total → SELL (initiator hit the bid)
  const askPrem = Number(raw.total_ask_side_prem ?? 0);
  const bidPrem = Number(raw.total_bid_side_prem ?? 0);
  const side: "BUY" | "SELL" = askPrem >= bidPrem ? "BUY" : "SELL";

  // Sentiment: directional read on the trade.
  //   CALL+BUY  = BULLISH    PUT+BUY  = BEARISH
  //   CALL+SELL = BEARISH    PUT+SELL = BULLISH
  const sentiment: "BULLISH" | "BEARISH" =
    (type === "CALL" && side === "BUY") || (type === "PUT" && side === "SELL")
      ? "BULLISH"
      : "BEARISH";

  // Execution type: from has_* flags. UW doesn't expose FLOOR explicitly in
  // the response sample we have; revisit if a FLOOR-marker field surfaces.
  const exec: "SWEEP" | "FLOOR" | "SINGLE" | "BLOCK" =
    raw.has_sweep ? "SWEEP" : raw.has_multileg ? "BLOCK" : "SINGLE";

  // Confidence: derived from volume/OI ratio (PRD §6 doesn't mandate a
  // formula; this mirrors common "unusualness" heuristics). Tunable.
  const voi = Number(raw.volume_oi_ratio ?? 0);
  const confidence: "HIGH" | "MED" | "LOW" =
    voi >= 5 ? "HIGH" : voi >= 1 ? "MED" : "LOW";

  // Contract label: e.g. "$7225P May 6" — matches mock display format.
  const monthAbbrev = expiry.toLocaleString("en-US", { month: "short", timeZone: "America/New_York" });
  const day = expiry.toLocaleString("en-US", { day: "numeric", timeZone: "America/New_York" });
  const contract = `$${strike}${type[0]} ${monthAbbrev} ${day}`;

  return {
    id: String(raw.id),
    capturedAt: new Date(),
    time,
    ticker: String(raw.ticker).toUpperCase(),
    type,
    side,
    sentiment,
    exec,
    multiLeg: Boolean(raw.has_multileg ?? false),
    contract: contract.slice(0, 64),
    strike,
    expiry,
    size: Math.trunc(Number(raw.volume ?? raw.size ?? 0)),
    oi: Math.trunc(Number(raw.open_interest ?? 0)),
    premium: Number(raw.total_premium ?? raw.premium ?? 0),
    spot: Number(raw.underlying_price ?? raw.spot ?? 0),
    rule: String(raw.alert_rule ?? raw.rule ?? "Unusual activity"),
    confidence,
    sector: String(raw.sector ?? "Technology"), // TODO Phase 2 step 4: enrich from ticker_metadata
  };
}

// ─── 2. Dark pool ────────────────────────────────────────────────────────────

export async function pollDarkPool(): Promise<void> {
  const json = await uwFetch("/api/darkpool/recent?limit=200", "dp");
  if (!json) return;
  const items = asArray(json);
  if (items.length === 0) return;
  logSampleOnce("dp", items[0]);

  const records = items
    .map(mapDarkPoolPrint)
    .filter((r): r is Prisma.DarkPoolPrintCreateManyInput => r !== null);

  if (records.length === 0) {
    console.warn(`[uw:dp] mapped 0 of ${items.length} raw rows — verify response shape`);
    return;
  }

  const result = await prisma.darkPoolPrint.createMany({
    data: records,
    skipDuplicates: true,
  });
  console.log(`[uw:dp] ${ts()} inserted ${result.count} of ${records.length} prints`);
}

function mapDarkPoolPrint(raw: any): Prisma.DarkPoolPrintCreateManyInput | null {
  if (!raw?.ticker) return null;
  // Field names verified against live UW /api/darkpool/recent on 2026-05-04.
  // - Dedup key is `tracking_id` (UW's stable per-print identifier), not `id`.
  // - `ext_hour_sold_codes` is non-null for extended-hours prints.
  // - `volume` is per-print daily volume (NOT a separate `daily_volume` field).
  // - `is_etf` not in the response — defer to ticker_metadata enrichment.
  // - `exchange_id` / `trf_id` not exposed; UW provides `market_center` (letter
  //   code) and `trf_executed_at` instead. Leaving exchange_id/trf_id null.

  const executedAt = new Date(raw.executed_at ?? raw.time ?? Date.now());
  const isExtended = raw.ext_hour_sold_codes != null && raw.ext_hour_sold_codes !== "";

  return {
    uwId: raw.tracking_id != null ? String(raw.tracking_id) : null,
    executedAt,
    ticker: String(raw.ticker).toUpperCase(),
    price: Number(raw.price ?? 0),
    size: Math.trunc(Number(raw.size ?? 0)),
    premium: Number(raw.premium ?? Number(raw.price ?? 0) * Number(raw.size ?? 0)),
    volume: raw.volume != null ? BigInt(Math.trunc(Number(raw.volume))) : null,
    exchangeId: null, // UW returns market_center letter code, not numeric id
    trfId: null,      // not exposed in /api/darkpool/recent response
    isEtf: Boolean(raw.is_etf ?? false), // TODO: enrich from ticker_metadata
    isExtended,
    isIntraday: isIntradayET(executedAt),
    rank: raw.rank != null ? Math.trunc(Number(raw.rank)) : null,
    percentile: raw.percentile != null ? Number(raw.percentile) : null,
  };
}

// ─── 3. GEX snapshots ────────────────────────────────────────────────────────

export async function pollGex(): Promise<void> {
  for (const ticker of WATCHED_TICKERS) {
    const json = await uwFetch(`/api/stock/${ticker}/spot-exposures/strike`, `gex:${ticker}`);
    if (!json) continue;

    const strikesRaw = asArray((json as any).strikes ?? json);
    if (strikesRaw.length === 0) {
      console.warn(`[uw:gex:${ticker}] no strike data`);
      continue;
    }
    logSampleOnce(`gex-${ticker}`, strikesRaw[0]);

    // UW puts spot price + asOf timestamp on each strike row, not at the
    // response root (verified 2026-05-04). Take from the first row.
    const spot = Number((strikesRaw[0] as any).price ?? 0);
    const asOf = new Date(
      (strikesRaw[0] as any).time ??
        (strikesRaw[0] as any).date ??
        (json as any).as_of ??
        Date.now()
    );
    if (!spot) {
      console.warn(`[uw:gex:${ticker}] missing spot price`);
      continue;
    }

    // ⚠️ Sign convention (verified from 2026-05-04 smoke test): UW returns
    // put_gamma_* values already signed (negative when dealers are short put
    // gamma). PRD §3.1's `call - put` formula assumes positive magnitudes —
    // applying it to UW's signed data over-corrects. We sum instead, treating
    // UW values as pre-signed dealer-net exposures. Same logic for bid/ask.
    const strikes = strikesRaw.map((s: any) => {
      const callOI = Number(s.call_gamma_oi ?? 0);
      const putOI = Number(s.put_gamma_oi ?? 0);
      const callBid = Number(s.call_gamma_bid ?? 0);
      const callAsk = Number(s.call_gamma_ask ?? 0);
      const putBid = Number(s.put_gamma_bid ?? 0);
      const putAsk = Number(s.put_gamma_ask ?? 0);
      const netOI = callOI + putOI;                       // UW-signed sum
      const netDV = (callAsk - callBid) + (putAsk - putBid); // ditto
      return {
        strike: Number(s.strike),
        call_gamma_oi: callOI,
        put_gamma_oi: putOI,
        call_gamma_bid: callBid,
        call_gamma_ask: callAsk,
        put_gamma_bid: putBid,
        put_gamma_ask: putAsk,
        netDV,
        netOI,
        combined: netOI + netDV,
      };
    });

    const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
    const { callWall, putWall, gammaFlip } = deriveKeyLevels(sorted, spot);
    const maxPain = computeMaxPain(sorted); // TODO: prefer UW /options-volume if exposed

    const netGexOI = strikes.reduce((sum, s) => sum + s.netOI, 0);
    const netGexDV = strikes.reduce((sum, s) => sum + s.netDV, 0);

    await prisma.gexSnapshot.create({
      data: {
        capturedAt: new Date(),
        ticker,
        asOf,
        spot,
        netGexOI,
        netGexDV,
        gammaRegime: spot > gammaFlip ? "POSITIVE" : "NEGATIVE",
        callWall,
        putWall,
        gammaFlip,
        maxPain,
        strikes: strikes as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(`[uw:gex:${ticker}] ${ts()} stored snapshot · spot=${spot} flip=${gammaFlip} (${strikes.length} strikes)`);
  }
}

interface ComputedStrike {
  strike: number;
  call_gamma_oi: number;
  put_gamma_oi: number;
  combined: number;
}

function deriveKeyLevels(sorted: ComputedStrike[], spot: number) {
  // PRD §8 derivations:
  //   call_wall  = strike with largest positive `combined` above spot
  //   put_wall   = strike with most-negative `combined` below spot
  //   gamma_flip = strike where running cumulative `combined` crosses zero
  const above = sorted.filter((s) => s.strike > spot && s.combined > 0);
  const callWall = above.length
    ? above.reduce((a, b) => (a.combined > b.combined ? a : b)).strike
    : spot;

  const below = sorted.filter((s) => s.strike < spot && s.combined < 0);
  const putWall = below.length
    ? below.reduce((a, b) => (a.combined < b.combined ? a : b)).strike
    : spot;

  let gammaFlip = spot;
  let cum = 0;
  for (const s of sorted) {
    const next = cum + s.combined;
    if (cum !== 0 && Math.sign(cum) !== Math.sign(next)) {
      gammaFlip = s.strike;
      break;
    }
    cum = next;
  }
  return { callWall, putWall, gammaFlip };
}

function computeMaxPain(sorted: ComputedStrike[]): number {
  // Max pain = strike K minimizing total option-holder payoff at expiry:
  //   sum over K' of max(0, K - K') * call_oi(K') + max(0, K' - K) * put_oi(K')
  // Picks the strike from the chain itself.
  if (sorted.length === 0) return 0;
  let best = sorted[0]!.strike;
  let bestPain = Infinity;
  for (const candidate of sorted) {
    let pain = 0;
    for (const s of sorted) {
      pain += Math.max(0, candidate.strike - s.strike) * s.call_gamma_oi;
      pain += Math.max(0, s.strike - candidate.strike) * s.put_gamma_oi;
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = candidate.strike;
    }
  }
  return best;
}

// ─── 4. Market Tide ──────────────────────────────────────────────────────────

export async function pollMarketTide(): Promise<void> {
  // ⚠️ As of 2026-05-04 smoke test, UW returns HTTP 422 for `?interval_5m=1`.
  // PRD §3.1 documents that param spelling but it appears UW expects
  // something different. Need to check current UW docs for the right param
  // (could be `?interval=5m`, `?bucket=5m`, or no param required). Until
  // then this job logs the 422 and returns no rows — Market Pulse module
  // will show empty data on /market-tide.
  const json = await uwFetch("/api/market/market-tide?interval_5m=1", "tide");
  if (!json) return;
  const buckets = asArray(json);
  if (buckets.length === 0) return;
  logSampleOnce("tide", buckets[0]);

  const records: Prisma.MarketTideBarCreateManyInput[] = buckets
    .filter((b: any) => {
      const t = b?.time ?? b?.bucket_start ?? b?.timestamp;
      return t != null && !Number.isNaN(new Date(t).getTime());
    })
    .map((b: any) => ({
      bucketStart: new Date(b.time ?? b.bucket_start ?? b.timestamp),
      spyPrice: Number(b.spy_price ?? b.price ?? 0),
      netCallPremium: Number(b.net_call_premium ?? 0),
      netPutPremium: Number(b.net_put_premium ?? 0),
      volume: BigInt(Math.trunc(Number(b.volume ?? b.spy_volume ?? 0))),
    }));

  if (records.length === 0) return;
  const result = await prisma.marketTideBar.createMany({
    data: records,
    skipDuplicates: true,
  });
  console.log(`[uw:tide] ${ts()} stored ${result.count} of ${records.length} buckets`);
}

// ─── 5. Top Net Impact (placeholder) ─────────────────────────────────────────

export async function computeNetImpact(): Promise<void> {
  // PRD §11 formula:
  //   Net Impact = (call_ask_premium − call_bid_premium)
  //              + (put_bid_premium  − put_ask_premium)
  //
  // PRD §16 still-open question: does UW's /api/option-trades/flow-alerts row
  // include `*_bid_premium` / `*_ask_premium`? Our FlowAlert table currently
  // has only a single `premium` field, so even the fallback aggregation needs
  // schema additions.
  //
  // Action items before implementing:
  //   1. Inspect a real flow-alerts response (look at logSampleOnce output)
  //   2. If bid/ask premium per row exists → add fields to FlowAlert schema
  //      and aggregate from there
  //   3. If not → check /api/screener/option-contracts or contact UW
  //
  // Until resolved, this job is a no-op so the Top Net Impact card on the
  // Market Pulse page reads from net_impact_daily that stays empty (UI shows
  // empty state).
  console.warn(
    `[uw:net-impact] ${ts()} not implemented — pending UW response shape verification (PRD §16 #1)`
  );
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
