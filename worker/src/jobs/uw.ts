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

function normalizeConfidence(v: unknown): "HIGH" | "MED" | "LOW" {
  const s = String(v ?? "").toUpperCase();
  if (s === "HIGH" || s === "H") return "HIGH";
  if (s === "LOW" || s === "L") return "LOW";
  return "MED"; // covers MED, MOD, MEDIUM, missing
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
  // TODO verify against real UW response — these are best-guess field names.
  // The first row of every poll prints to logs via logSampleOnce; once shapes
  // are confirmed, tighten the `??` chains.
  const time = new Date(raw.executed_at ?? raw.created_at ?? raw.time ?? Date.now());
  const expiry = new Date(raw.expiry ?? raw.expiration ?? raw.expires_at ?? time);
  return {
    id: String(raw.id),
    capturedAt: new Date(),
    time,
    ticker: String(raw.ticker).toUpperCase(),
    type: String(raw.type ?? raw.option_type ?? "CALL").toUpperCase().slice(0, 4),
    side: String(raw.side ?? "BUY").toUpperCase().slice(0, 4),
    sentiment: String(raw.sentiment ?? "BULLISH").toUpperCase().slice(0, 8),
    exec: String(raw.exec ?? raw.execution_type ?? "SINGLE").toUpperCase().slice(0, 8),
    multiLeg: Boolean(raw.multi_leg ?? raw.is_multi_leg ?? false),
    contract: String(raw.contract ?? `${raw.strike ?? ""}${(raw.type ?? "C")[0]} ${raw.expiry ?? ""}`).slice(0, 64),
    strike: Number(raw.strike ?? 0),
    expiry,
    size: Math.trunc(Number(raw.size ?? raw.volume ?? 0)),
    oi: Math.trunc(Number(raw.open_interest ?? raw.oi ?? 0)),
    premium: Number(raw.premium ?? raw.total_premium ?? 0),
    spot: Number(raw.spot ?? raw.spot_price ?? 0),
    rule: String(raw.rule ?? raw.alert_rule ?? "Unusual activity"),
    confidence: normalizeConfidence(raw.confidence),
    sector: String(raw.sector ?? "Technology"), // TODO: enrich from ticker_metadata once that table is populated
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
  const executedAt = new Date(raw.executed_at ?? raw.time ?? raw.timestamp ?? Date.now());
  return {
    uwId: raw.id != null ? String(raw.id) : null,
    executedAt,
    ticker: String(raw.ticker).toUpperCase(),
    price: Number(raw.price ?? 0),
    size: Math.trunc(Number(raw.size ?? raw.volume ?? 0)),
    premium: Number(raw.premium ?? raw.notional ?? raw.price * (raw.size ?? 0)),
    volume: raw.daily_volume != null ? BigInt(Math.trunc(Number(raw.daily_volume))) : null,
    exchangeId: raw.exchange_id != null ? Math.trunc(Number(raw.exchange_id)) : null,
    trfId: raw.trf_id != null ? Math.trunc(Number(raw.trf_id)) : null,
    isEtf: Boolean(raw.is_etf ?? false),
    isExtended: Boolean(raw.is_extended ?? raw.extended_hours ?? false),
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

    const spot = Number((json as any).spot ?? (json as any).spot_price ?? 0);
    if (!spot) {
      console.warn(`[uw:gex:${ticker}] missing spot price`);
      continue;
    }

    const strikes = strikesRaw.map((s: any) => {
      const callOI = Number(s.call_gamma_oi ?? 0);
      const putOI = Number(s.put_gamma_oi ?? 0);
      const callBid = Number(s.call_gamma_bid ?? 0);
      const callAsk = Number(s.call_gamma_ask ?? 0);
      const putBid = Number(s.put_gamma_bid ?? 0);
      const putAsk = Number(s.put_gamma_ask ?? 0);
      const netOI = callOI - putOI;
      const netDV = callAsk - callBid - (putAsk - putBid);
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
        asOf: new Date((json as any).as_of ?? Date.now()),
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
