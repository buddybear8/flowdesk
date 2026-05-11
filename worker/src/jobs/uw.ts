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

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { WATCHED_TICKERS } from "../lib/watched-tickers.js";

export { disconnectPrisma } from "../lib/prisma.js";

const UW_BASE = "https://api.unusualwhales.com";

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

// Upsert helper: Prisma's createMany doesn't merge NULL columns, so when the
// schema gained the v1.3 fields (ask_prem, bid_prem, all_opening, issue_type,
// has_floor, has_single_leg) every existing row stayed NULL even though the
// ingest mapper now had values for them. We need an upsert so revisits of an
// already-stored alert refresh those fields. UW alert ids are immutable, so
// `where: { id }` is the right conflict key.
//
// Implementation note: `createMany` is faster than per-row upsert when the
// majority of records are new. For our cadence (30s polls, ~100 records, most
// previously seen) per-row upsert via Promise.all caps at the connection-pool
// limit and finishes well under a second. Acceptable trade for correctness.
async function upsertFlowAlerts(records: Prisma.FlowAlertCreateManyInput[]): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  await Promise.all(
    records.map(async (r) => {
      const existed = await prisma.flowAlert.findUnique({ where: { id: r.id }, select: { id: true } });
      const { id, ...rest } = r;
      await prisma.flowAlert.upsert({
        where: { id },
        update: rest,
        create: r,
      });
      if (existed) updated++;
      else inserted++;
    })
  );
  return { inserted, updated };
}

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

  const { inserted, updated } = await upsertFlowAlerts(records);
  console.log(`[uw:flow] ${ts()} ${inserted} new + ${updated} updated of ${records.length} alerts`);
}

// pollLottoAlerts — dedicated poll that asks UW for alerts already shaped like
// Lottos (Common Stock, opening single-leg, ask-side, DTE ≤ 14, %OTM 20–100,
// vol > OI, premium ≥ $1k). Without this, the unfiltered top-100 stream from
// pollFlowAlerts can crowd lotto-shape alerts out during heavy big-cap activity.
//
// Rows go into the same flow_alerts table; UW alert ids dedupe naturally via
// `skipDuplicates`, so overlap with pollFlowAlerts is free. The /api/flow/lottos
// route's WHERE clause is the same regardless of which path inserted the row.
export async function pollLottoAlerts(): Promise<void> {
  const params = new URLSearchParams({
    "issue_types[]": "Common Stock",
    max_dte: "14",
    min_diff: "0.2",
    max_diff: "1.0",
    all_opening: "true",
    vol_greater_oi: "true",
    is_multi_leg: "false",
    is_ask_side: "true",
    min_premium: "1000",
    limit: "200",
  });
  const json = await uwFetch(`/api/option-trades/flow-alerts?${params.toString()}`, "lotto");
  if (!json) return;
  const items = asArray(json);
  if (items.length === 0) return;

  const records = items
    .map(mapFlowAlert)
    .filter((r): r is Prisma.FlowAlertCreateManyInput => r !== null);

  if (records.length === 0) {
    console.warn(`[uw:lotto] mapped 0 of ${items.length} raw rows — verify UW response shape`);
    return;
  }

  const { inserted, updated } = await upsertFlowAlerts(records);
  console.log(`[uw:lotto] ${ts()} ${inserted} new + ${updated} updated of ${records.length} candidates`);
}

// pollSweeperAlerts — second backend-locked preset. Asks UW for alerts already
// shaped like Opening Sweepers (Common Stock, opening single-leg, ask-side,
// DTE ≤ 14, %OTM 0–12, vol > OI, sweep execution, premium ≥ $100k, underlying
// ≤ $13). Same dedup pattern as pollLottoAlerts: rows go into the shared
// flow_alerts table; the /api/flow/sweepers WHERE clause applies the strict
// final filter (Min/Max Ask %, Min Vol/OI ratio = 3, exec = 'SWEEP'). UW's
// public flow-alerts endpoint accepts the params below; finer constraints
// not exposed server-side are enforced in the SQL route.
export async function pollSweeperAlerts(): Promise<void> {
  const params = new URLSearchParams({
    "issue_types[]": "Common Stock",
    max_dte: "14",
    min_diff: "0",
    max_diff: "0.12",
    all_opening: "true",
    vol_greater_oi: "true",
    is_multi_leg: "false",
    is_ask_side: "true",
    min_premium: "100000",
    limit: "200",
  });
  const json = await uwFetch(`/api/option-trades/flow-alerts?${params.toString()}`, "sweeper");
  if (!json) return;
  const items = asArray(json);
  if (items.length === 0) return;

  const records = items
    .map(mapFlowAlert)
    .filter((r): r is Prisma.FlowAlertCreateManyInput => r !== null);

  if (records.length === 0) {
    console.warn(`[uw:sweeper] mapped 0 of ${items.length} raw rows — verify UW response shape`);
    return;
  }

  const { inserted, updated } = await upsertFlowAlerts(records);
  console.log(`[uw:sweeper] ${ts()} ${inserted} new + ${updated} updated of ${records.length} candidates`);
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

  // Execution type. UW does expose `has_floor` (verified from public docs
  // 2026-05-05); the prior derivation that omitted it was a bug — every floor
  // trade was being mislabeled as SWEEP/BLOCK/SINGLE. Precedence matches UW's
  // own UI: sweep wins over floor wins over multi-leg ("block") wins over
  // single-leg.
  const exec: "SWEEP" | "FLOOR" | "SINGLE" | "BLOCK" =
    raw.has_sweep   ? "SWEEP"
    : raw.has_floor ? "FLOOR"
    : raw.has_multileg ? "BLOCK"
    : "SINGLE";

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

    // v1.3 — capture raw UW fields so /api/flow/{lottos,opening-sweepers} can
    // filter on them server-side without a second UW request per page load.
    askPrem: raw.total_ask_side_prem != null ? Number(raw.total_ask_side_prem) : null,
    bidPrem: raw.total_bid_side_prem != null ? Number(raw.total_bid_side_prem) : null,
    allOpening: raw.all_opening_trades != null ? Boolean(raw.all_opening_trades) : null,
    issueType: raw.issue_type != null ? String(raw.issue_type) : null,
    hasFloor: raw.has_floor != null ? Boolean(raw.has_floor) : null,
    hasSingleLeg: raw.has_singleleg != null ? Boolean(raw.has_singleleg) : null,
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
  // Space ticker requests by 200ms to stay under UW's short-window rate limit
  // (5 tickers fired serially in <1s was triggering occasional HTTP 429 on SPY).
  const TICKER_DELAY_MS = 200;
  for (let i = 0; i < WATCHED_TICKERS.length; i++) {
    const ticker = WATCHED_TICKERS[i];
    if (i > 0) await sleep(TICKER_DELAY_MS);
    let json = await uwFetch(`/api/stock/${ticker}/spot-exposures/strike`, `gex:${ticker}`);
    if (!json) continue;

    let strikesRaw = asArray((json as any).strikes ?? json);
    if (strikesRaw.length === 0) {
      console.warn(`[uw:gex:${ticker}] no strike data`);
      continue;
    }
    logSampleOnce(`gex-${ticker}`, strikesRaw[0]);

    // UW puts spot price + asOf timestamp on each strike row, not at the
    // response root (verified 2026-05-04). Take from the first row.
    let spot = Number((strikesRaw[0] as any).price ?? 0);

    // UW's /spot-exposures/strike caps its response at 50 strikes and selects
    // them by gamma magnitude. For tickers with put-heavy institutional OI
    // (SPY/SPX especially) the top 50 routinely sit entirely on one side of
    // spot — and a bounded retry with min_strike/max_strike doesn't change
    // the selection, just the band. Verified live on 2026-05-11:
    //   retried with bounds [$627..$850] → 50 strikes, range [$650..$738],
    //   still hasAbove=false even though the band spans both sides of $738.63.
    // Real fix: split into two explicit requests so each side of spot gets
    // its own 50-strike quota from UW, then merge. Skip the split when the
    // initial response is already centered to keep the request cost low.
    if (spot) {
      const tightBand = spot * 0.02;
      const sideBand = spot * 0.05;
      const tightCount = strikesRaw.filter(
        (s: any) => Math.abs(Number(s.strike) - spot) <= tightBand
      ).length;
      const hasAboveSpot = strikesRaw.some((s: any) => {
        const k = Number(s.strike);
        return k > spot && k - spot <= sideBand;
      });
      const hasBelowSpot = strikesRaw.some((s: any) => {
        const k = Number(s.strike);
        return k < spot && spot - k <= sideBand;
      });
      const centered = tightCount >= 3 && hasAboveSpot && hasBelowSpot;
      if (!centered) {
        const aboveMin = Math.floor(spot);
        const aboveMax = Math.ceil(spot * 1.10);
        const belowMin = Math.floor(spot * 0.90);
        const belowMax = Math.ceil(spot);
        await sleep(TICKER_DELAY_MS);
        const aboveJson = await uwFetch(
          `/api/stock/${ticker}/spot-exposures/strike?min_strike=${aboveMin}&max_strike=${aboveMax}`,
          `gex:${ticker}:above`
        );
        await sleep(TICKER_DELAY_MS);
        const belowJson = await uwFetch(
          `/api/stock/${ticker}/spot-exposures/strike?min_strike=${belowMin}&max_strike=${belowMax}`,
          `gex:${ticker}:below`
        );
        const aboveArr = aboveJson ? asArray((aboveJson as any).strikes ?? aboveJson) : [];
        const belowArr = belowJson ? asArray((belowJson as any).strikes ?? belowJson) : [];
        if (aboveArr.length > 0 || belowArr.length > 0) {
          // Dedup by strike — the two requests overlap at the spot boundary.
          const seen = new Set<number>();
          const merged: any[] = [];
          for (const row of [...belowArr, ...aboveArr]) {
            const k = Number((row as any).strike);
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(row);
          }
          console.log(
            `[uw:gex:${ticker}] split-fetch — above=${aboveArr.length}, ` +
              `below=${belowArr.length}, merged=${merged.length} ` +
              `(initial ${strikesRaw.length}, tightCount=${tightCount}, ` +
              `hasAbove=${hasAboveSpot}, hasBelow=${hasBelowSpot})`
          );
          strikesRaw = merged;
          json = aboveJson ?? belowJson ?? json;
          spot = Number((strikesRaw[0] as any).price ?? spot);
        }
      }
    }

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
    // gamma_oi / gamma_bid / gamma_ask already signed by direction:
    //   *_gamma_oi  signed by dealer's net OI position (puts negative when
    //               dealers are net short put gamma, etc.)
    //   *_gamma_bid signed positive (dealer accumulated gamma from bid-side
    //               trades — retail sold to dealer)
    //   *_gamma_ask signed negative (dealer reduced gamma via ask-side
    //               trades — retail bought from dealer)
    // Net dealer change per side = bid + ask (magnitudes nearly cancel when
    // intraday flow is balanced). Total net DV = sum across calls + puts.
    //
    // PRD §3.1's formulas (`call - put` for OI; `(call_ask - call_bid) -
    // (put_ask - put_bid)` for DV) assumed positive magnitudes and break on
    // UW's signed data — the prior smoke run produced netDV values 100× the
    // netOI scale, dwarfing the cumulative and preventing gamma-flip
    // detection. Switching both formulas to plain summation.
    const strikes = strikesRaw.map((s: any) => {
      const callOI = Number(s.call_gamma_oi ?? 0);
      const putOI = Number(s.put_gamma_oi ?? 0);
      const callBid = Number(s.call_gamma_bid ?? 0);
      const callAsk = Number(s.call_gamma_ask ?? 0);
      const putBid = Number(s.put_gamma_bid ?? 0);
      const putAsk = Number(s.put_gamma_ask ?? 0);
      const netOI = callOI + putOI;                                  // OI-based net
      const netDV = callBid + callAsk + putBid + putAsk;             // DV-based net
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
    // Max pain requires raw contract OI per strike, which the spot-exposures
    // endpoint does NOT provide (it returns dollar gamma/delta/charm/vanna,
    // and puts are pre-signed). Defaulting to spot until we wire UW's
    // /api/stock/{t}/options-volume per PRD §8.
    const maxPain = spot;

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
    // Diagnostic: log strike-range stats so we can see if UW is returning
    // a complete chain or a sparse subset. Helpful when the chart looks like
    // it's missing the at-the-money region (SPY chart was rendering deep
    // OTM strikes with no near-money rows).
    const strikePrices = strikes.map((s) => s.strike);
    const minStrike = Math.min(...strikePrices);
    const maxStrike = Math.max(...strikePrices);
    const nearSpotCount = strikes.filter((s) => Math.abs(s.strike - spot) <= spot * 0.1).length;
    console.log(
      `[uw:gex:${ticker}] ${ts()} stored snapshot · spot=${spot} flip=${gammaFlip} ` +
        `(${strikes.length} strikes, range=[$${minStrike}..$${maxStrike}], ${nearSpotCount} within ±10% of spot)`
    );
  }
}

interface ComputedStrike {
  strike: number;
  call_gamma_oi: number;
  put_gamma_oi: number;
  combined: number;
}

function deriveKeyLevels(sorted: ComputedStrike[], spot: number) {
  // Restrict every key-level search to ±5% of spot. Without this bound,
  // deep-OTM strikes produce spurious results — for SPX at $7,265 the
  // unconstrained cumulative-crossing logic returned a gamma flip at
  // $6,000 (driven by put-heavy LEAPS far below spot). Walls have the
  // same problem in the other direction.
  const window = spot * 0.05;

  // call_wall = largest positive `combined` strike inside [spot, spot+5%]
  const callCandidates = sorted.filter(
    (s) => s.strike > spot && s.strike - spot <= window && s.combined > 0
  );
  const callWall = callCandidates.length
    ? callCandidates.reduce((a, b) => (a.combined > b.combined ? a : b)).strike
    : spot;

  // put_wall = most-negative `combined` strike inside [spot-5%, spot]
  const putCandidates = sorted.filter(
    (s) => s.strike < spot && spot - s.strike <= window && s.combined < 0
  );
  const putWall = putCandidates.length
    ? putCandidates.reduce((a, b) => (a.combined < b.combined ? a : b)).strike
    : spot;

  // gamma_flip = strike where running cumulative `combined` crosses zero,
  // counted only when the crossing falls within ±5% of spot. The cumulative
  // is still summed over the full chain so it reflects the real balance.
  let gammaFlip = spot;
  let cum = 0;
  for (const s of sorted) {
    const next = cum + s.combined;
    const nearSpot = Math.abs(s.strike - spot) <= window;
    if (nearSpot && cum !== 0 && Math.sign(cum) !== Math.sign(next)) {
      gammaFlip = s.strike;
      break;
    }
    cum = next;
  }
  return { callWall, putWall, gammaFlip };
}

// Max pain — DISABLED in V1.
//
// 2026-05-04: the spot-exposures/strike endpoint returns dollar gamma values
// (not raw contract OI), and puts are pre-signed negative — applying the
// standard `Σ max(0, K − K′) · call_oi + max(0, K′ − K) · put_oi` formula
// to those values produces nonsensical results (e.g. max_pain=$0.50 for NVDA).
// To compute max pain properly we need contract counts per strike from UW's
// /api/stock/{ticker}/options-volume endpoint (PRD §8). Wire that when adding
// the corresponding poll, then replace the spot fallback in pollGex.
//
// function computeMaxPain(sorted: ComputedStrike[]): number { ... }

// ─── 4. Market Tide ──────────────────────────────────────────────────────────

export async function pollMarketTide(): Promise<void> {
  // UW response shape (verified against UW docs 2026-05-04):
  //   { data: [{ date, net_call_premium, net_put_premium, net_volume, timestamp }] }
  // - No query params accepted (the prior `?interval_5m=1` returned HTTP 422).
  // - Buckets are 1-MINUTE, not 5-minute as PRD §3.1 assumed. Storing as-is;
  //   frontend can downsample to 5-min for the Market Pulse chart per PRD §11.
  // - Response does NOT include SPY price. PRD §3.2 expected it inline; in
  //   reality we'd need to source SPY spot from a separate endpoint
  //   (e.g. /api/stock/SPY/spot-exposures/strike already polled by pollGex).
  //   For now, spyPrice is stored as 0 — Market Pulse SPY-price line will
  //   need backfill from gex_snapshots.spot at render time, or we add a
  //   joining step here in a later iteration.
  const json = await uwFetch("/api/market/market-tide", "tide");
  if (!json) return;
  const buckets = asArray(json);
  if (buckets.length === 0) return;
  logSampleOnce("tide", buckets[0]);

  const records: Prisma.MarketTideBarCreateManyInput[] = buckets
    .filter((b: any) => {
      const t = b?.timestamp ?? b?.time ?? b?.bucket_start;
      return t != null && !Number.isNaN(new Date(t).getTime());
    })
    .map((b: any) => ({
      bucketStart: new Date(b.timestamp ?? b.time ?? b.bucket_start),
      spyPrice: 0, // TODO: backfill from gex_snapshots(ticker=SPY) or pull from a separate UW endpoint
      netCallPremium: Number(b.net_call_premium ?? 0),
      netPutPremium: Number(b.net_put_premium ?? 0),
      volume: BigInt(Math.trunc(Number(b.net_volume ?? b.volume ?? 0))),
    }));

  if (records.length === 0) return;
  const result = await prisma.marketTideBar.createMany({
    data: records,
    skipDuplicates: true,
  });
  console.log(`[uw:tide] ${ts()} stored ${result.count} of ${records.length} buckets`);
}

// ─── 5. Top Net Impact ───────────────────────────────────────────────────────

export async function computeNetImpact(): Promise<void> {
  // UW exposes a Top Net Impact endpoint directly (verified docs 2026-05-04):
  //   GET /api/market/top-net-impact?limit=20
  // Returns top tickers by `net_call_premium − net_put_premium`, split half
  // bullish / half bearish. Defaults to last market day; during market hours
  // that resolves to the current trading day. We upsert all rows keyed by
  // (snapshotDate, ticker) so 5-min repolls overwrite intraday refreshes.
  // Frontend slices top 10 by |net_premium| at render time per PRD §11.
  const json = await uwFetch("/api/market/top-net-impact?limit=20", "net-impact");
  if (!json) return;
  const rows = asArray(json);
  if (rows.length === 0) return;
  logSampleOnce("net-impact", rows[0]);

  // Today's date in ET. Cron is gated to weekdays 09:00–15:59 ET so we never
  // straddle a date boundary; using en-CA Intl format gives "YYYY-MM-DD".
  const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date()
  );
  const snapshotDate = new Date(todayET);

  let upserted = 0;
  for (const row of rows) {
    if (!row?.ticker || row.net_premium == null) continue;
    const ticker = String(row.ticker).toUpperCase();
    const netPremium = Number(row.net_premium);
    if (!Number.isFinite(netPremium)) continue;
    await prisma.netImpactDaily.upsert({
      where: { snapshotDate_ticker: { snapshotDate, ticker } },
      update: { netPremium },
      create: { snapshotDate, ticker, netPremium },
    });
    upserted++;
  }
  console.log(`[uw:net-impact] ${ts()} upserted ${upserted}/${rows.length} rows for ${todayET}`);
}

// ─── Graceful shutdown re-exported from ../lib/prisma.js (top of file) ───────
