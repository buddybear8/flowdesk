// jobs/trade-alerts.ts — Trade Alerts ingestion.
//
// Pulls the "Trade Alert Bot" embeds from the alphapodtrading Discord (options +
// equities channels) via the bot API, parses them into events
// (open/add/trim/close), stitches events into POSITIONS, prices the still-open
// slice via UW per-contract pricing, and upserts into trade_alerts. Full history
// is retained. See prisma model TradeAlert.
//
// Profit accounting (replaces the old discord_extractor assumed-zero −100% bug):
//   realizedSum = Σ fracClosed_i × pct_i   (banked trims/closes, position-weighted)
//   realizedPct (display) = realizedSum / fracClosed
//   livePct = (mark − entry)/entry × 100   on the open slice
//   bookDelta = sizeWeight × (realizedSum + remainingFrac × livePct)
//   sizeWeight: Large .10 · Medium .05 · Small .01 · Lotto .005
// Expired-and-open remainder settles at its last real UW mark (≈0 OTM / intrinsic
// ITM), never −100%.

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sendPushToAll } from "../lib/push.js";

export { disconnectPrisma } from "../lib/prisma.js";

const DISCORD_API = "https://discord.com/api/v10";
const UW_BASE = "https://api.unusualwhales.com";
const ts = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const SIZE_WEIGHT: Record<string, number> = { Large: 0.1, Medium: 0.05, Small: 0.01, Lotto: 0.005 };
const TRIM_DEFAULT_FRAC = 0.5; // a SCALE OUT closes 50% of remaining unless an explicit % is given
const REDERIVE_DAYS = 30; // re-derive positions from this much recent history each run

const ZWS = "​";
const CONTRACT_RE = /^\s*([A-Za-z.]{1,6})\s+(\d+(?:\.\d+)?)\s*([cCpP])\s*$/;
const EQUITY_RE = /^\s*([A-Za-z.]{1,6})\s*$/;

type Action = "open" | "add" | "trim" | "close";
type AssetType = "option" | "equity";

interface Channel { id: string; assetType: AssetType }
function channels(): Channel[] {
  const out: Channel[] = [];
  if (process.env.DISCORD_OPTIONS_CHANNEL_ID) out.push({ id: process.env.DISCORD_OPTIONS_CHANNEL_ID, assetType: "option" });
  if (process.env.DISCORD_EQUITIES_CHANNEL_ID) out.push({ id: process.env.DISCORD_EQUITIES_CHANNEL_ID, assetType: "equity" });
  return out;
}

// ── Discord ──────────────────────────────────────────────────────────────────

async function discordGet(path: string): Promise<any | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.error("[trade-alerts] DISCORD_BOT_TOKEN not set — skipping"); return null; }
  try {
    const res = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bot ${token}`, "User-Agent": "FlowDesk-TradeAlerts/1.0" },
    });
    if (res.status === 429) {
      const j = (await res.json().catch(() => ({ retry_after: 2 }))) as { retry_after?: number };
      await sleep((j.retry_after ?? 2) * 1000 + 250);
      return discordGet(path);
    }
    if (!res.ok) { console.error(`[trade-alerts] discord ${res.status} ${path}`); return null; }
    return await res.json();
  } catch (err) {
    console.error("[trade-alerts] discord fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Most-recent messages back to `sinceMs` (page backward via ?before).
async function fetchRecentMessages(channelId: string, sinceMs: number): Promise<any[] | null> {
  const all: any[] = [];
  let before: string | undefined;
  for (let page = 0; page < 80; page++) {
    const q = before ? `?limit=100&before=${before}` : `?limit=100`;
    const msgs = await discordGet(`/channels/${channelId}/messages${q}`);
    if (msgs === null) return all.length ? all : null;
    if (!Array.isArray(msgs) || msgs.length === 0) break;
    all.push(...msgs);
    const oldest = msgs[msgs.length - 1];
    before = oldest.id;
    if (Date.parse(oldest.timestamp) < sinceMs) break;
    await sleep(350);
  }
  return all.filter((m) => Date.parse(m.timestamp) >= sinceMs);
}

// ── Parse one embed → event ──────────────────────────────────────────────────

interface Ev {
  action: Action; assetType: AssetType;
  ticker: string; side: "CALL" | "PUT" | "LONG"; strike: number | null;
  expiryLabel: string | null; expiry: Date | null;
  price: number; pct: number | null; size: string | null;
  moderator: string; messageId: string; at: Date; fracHint: number | null;
}

function parsePrice(s?: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function parsePct(s?: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[%+\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
// Explicit scale fraction from the title or Notes (future: 25/50/75). null → default.
function parseFracHint(title: string, notes?: string): number | null {
  const hay = `${title} ${notes ?? ""}`.toLowerCase();
  const pm = hay.match(/\b(25|50|75)\s*%/);
  if (pm) return Number(pm[1]) / 100;
  if (/\bhalf\b/.test(hay)) return 0.5;
  if (/\bquarter\b/.test(hay)) return 0.25;
  if (/\bthird\b/.test(hay)) return 1 / 3;
  return null;
}
function resolveExpiry(label: string, ref: Date): Date | null {
  const m = label.match(/^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*$/);
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ref.getUTCFullYear();
  let dt = new Date(Date.UTC(y, mo - 1, d));
  // No year given and the date is already well in the past → it's next year.
  if (!m[3] && dt.getTime() < ref.getTime() - 7 * 86400000) dt = new Date(Date.UTC(y + 1, mo - 1, d));
  return dt;
}

function parseEmbed(msg: any, assetType: AssetType): Ev | null {
  const embed = (msg.embeds || [])[0];
  if (!embed) return null;
  const title = String(embed.title || "").trim();
  let action: Action;
  if (title.includes("BUY TO OPEN")) action = "open";
  else if (title.includes("ADD")) action = "add";
  else if (title.includes("SCALE OUT")) action = "trim";
  else if (title.includes("SELL TO CLOSE")) action = "close";
  else return null;

  const fields: Record<string, string> = {};
  for (const f of embed.fields || []) if (f?.name && f.name !== ZWS) fields[f.name] = f.value;

  const contract = fields["Contract"];
  if (!contract) return null;
  let ticker: string, side: "CALL" | "PUT" | "LONG", strike: number | null;
  const cm = CONTRACT_RE.exec(contract);
  if (cm) {
    ticker = cm[1].toUpperCase(); strike = parseFloat(cm[2]); side = cm[3].toLowerCase() === "c" ? "CALL" : "PUT";
  } else {
    const em = EQUITY_RE.exec(contract);
    if (!em || assetType === "option") return null; // option channel must be an option contract
    ticker = em[1].toUpperCase(); side = "LONG"; strike = null;
  }

  const expiryLabel = fields["Expiration"] || null;
  const expiry = expiryLabel ? resolveExpiry(expiryLabel, new Date(msg.timestamp)) : null;
  const price = parsePrice(action === "open" || action === "add" ? fields["Entry Price"] : fields["Exit Price"]);
  if (price == null) return null;

  return {
    action, assetType, ticker, side, strike, expiryLabel, expiry,
    price,
    pct: parsePct(fields["% Gain/Loss"]),
    size: action === "open" ? (fields["Size"] || null) : null,
    moderator: String((embed.author || {}).name || "unknown").trim(),
    messageId: String(msg.id),
    at: new Date(msg.timestamp),
    fracHint: parseFracHint(title, fields["📝 Notes"] || fields["Notes"]),
  };
}

// ── Build positions from the event stream ────────────────────────────────────

interface EvtRec { action: Action; price: number; fracClosed?: number; pct?: number | null; at: string; messageId: string; expired?: boolean }
interface Position {
  openMessageId: string; assetType: AssetType; ticker: string; side: "CALL" | "PUT" | "LONG";
  strike: number | null; expiryLabel: string | null; expiry: Date | null;
  moderator: string; sizeLabel: string; entryPrice: number; entryAt: Date;
  remaining: number; realizedSum: number; status: "OPEN" | "CLOSED";
  events: EvtRec[];
  lastMark: number | null; livePct: number | null;
}

const keyOf = (e: Ev) => [e.moderator, e.ticker, e.side, e.strike ?? "", e.expiryLabel ?? ""].join("|");

function buildPositions(events: Ev[]): Position[] {
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  const openByKey = new Map<string, Position>();
  const all: Position[] = [];
  for (const e of events) {
    const k = keyOf(e);
    if (e.action === "open") {
      const p: Position = {
        openMessageId: e.messageId, assetType: e.assetType, ticker: e.ticker, side: e.side,
        strike: e.strike, expiryLabel: e.expiryLabel, expiry: e.expiry, moderator: e.moderator,
        sizeLabel: normalizeSize(e.size), entryPrice: e.price, entryAt: e.at,
        remaining: 1, realizedSum: 0, status: "OPEN",
        events: [{ action: "open", price: e.price, at: e.at.toISOString(), messageId: e.messageId }],
        lastMark: null, livePct: null,
      };
      openByKey.set(k, p);
      all.push(p);
      continue;
    }
    const p = openByKey.get(k);
    if (!p) continue; // exit/add with no matching open in window — skip (orphan)
    if (e.action === "add") {
      p.events.push({ action: "add", price: e.price, at: e.at.toISOString(), messageId: e.messageId });
    } else if (e.action === "trim") {
      const frac = (e.fracHint ?? TRIM_DEFAULT_FRAC) * p.remaining;
      const pct = e.pct ?? 0;
      p.realizedSum += frac * pct;
      p.remaining = Math.max(0, p.remaining - frac);
      p.events.push({ action: "trim", price: e.price, fracClosed: frac, pct, at: e.at.toISOString(), messageId: e.messageId });
      if (p.remaining < 1e-6) { p.remaining = 0; p.status = "CLOSED"; openByKey.delete(k); }
    } else if (e.action === "close") {
      const frac = p.remaining;
      const pct = e.pct ?? 0;
      p.realizedSum += frac * pct;
      p.remaining = 0; p.status = "CLOSED";
      p.events.push({ action: "close", price: e.price, fracClosed: frac, pct, at: e.at.toISOString(), messageId: e.messageId });
      openByKey.delete(k);
    }
  }
  return all;
}

function normalizeSize(s: string | null): string {
  const t = (s || "").trim().toLowerCase();
  if (t.startsWith("large") || t === "l") return "Large";
  if (t.startsWith("medium") || t === "m") return "Medium";
  if (t.startsWith("lotto")) return "Lotto";
  if (t.startsWith("small") || t === "s") return "Small";
  return "Small";
}

// ── Pricing ──────────────────────────────────────────────────────────────────

function buildOcc(ticker: string, expiry: Date, side: "CALL" | "PUT" | "LONG", strike: number): string {
  const yy = String(expiry.getUTCFullYear()).slice(2);
  const mm = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getUTCDate()).padStart(2, "0");
  const cp = side === "PUT" ? "P" : "C";
  const strk = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${ticker}${yy}${mm}${dd}${cp}${strk}`;
}

async function uwGet(path: string): Promise<any | null> {
  const token = process.env.UW_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${UW_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "UW-CLIENT-API-ID": "100001", Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Latest UW mark (nbbo mid, else last_price) for an option contract.
async function optionMark(occ: string): Promise<number | null> {
  const j = await uwGet(`/api/option-contract/${occ}/historic`);
  const chains = (j?.chains ?? []) as any[];
  if (!chains.length) return null;
  const last = [...chains].sort((a, b) => String(a.date).localeCompare(String(b.date))).pop();
  const bid = num(last.nbbo_bid), ask = num(last.nbbo_ask), lp = num(last.last_price);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return lp > 0 ? lp : null;
}

async function equityMark(ticker: string): Promise<number | null> {
  const row = await prisma.candleBar.findFirst({ where: { ticker }, orderBy: { barTime: "desc" }, select: { close: true } });
  return row?.close ? Number(row.close) : null;
}

// Price the open slice + settle expired remainders in place.
async function priceAndSettle(p: Position): Promise<void> {
  if (p.status !== "OPEN" || p.remaining <= 0) return;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (p.assetType === "option" && p.strike != null && p.expiry) {
    const occ = buildOcc(p.ticker, p.expiry, p.side, p.strike);
    const mark = await optionMark(occ);
    p.lastMark = mark;
    if (mark != null) p.livePct = (mark - p.entryPrice) / p.entryPrice * 100;
    if (p.expiry.getTime() < today.getTime()) {
      // Expired with an open remainder → settle at the last real mark (≈0 OTM).
      const settle = mark ?? 0;
      p.livePct = (settle - p.entryPrice) / p.entryPrice * 100;
      p.realizedSum += p.remaining * p.livePct;
      p.remaining = 0; p.status = "CLOSED";
      const lastEv = p.events[p.events.length - 1];
      p.events.push({ action: "close", price: settle, fracClosed: 0, pct: p.livePct, at: new Date(p.expiry.getTime()).toISOString(), messageId: `${p.openMessageId}:exp`, expired: true });
      void lastEv;
    }
  } else if (p.assetType === "equity") {
    const mark = await equityMark(p.ticker);
    p.lastMark = mark;
    if (mark != null) p.livePct = (mark - p.entryPrice) / p.entryPrice * 100;
  }
}

function bookDelta(p: { sizeLabel: string; realizedSum: number; remaining: number; livePct: number | null }): number {
  const w = SIZE_WEIGHT[p.sizeLabel] ?? 0.01;
  return w * (p.realizedSum + p.remaining * (p.livePct ?? 0));
}

// ── Upsert ───────────────────────────────────────────────────────────────────

async function upsertPosition(p: Position): Promise<void> {
  const fracClosed = 1 - p.remaining;
  const realizedPct = fracClosed > 1e-6 ? p.realizedSum / fracClosed : 0;
  const bd = bookDelta(p);

  // Non-mark fields always refresh.
  const core = {
    assetType: p.assetType, ticker: p.ticker, side: p.side,
    strike: p.strike != null ? new Prisma.Decimal(p.strike) : null,
    expiry: p.expiry, expiryLabel: p.expiryLabel,
    occ: p.assetType === "option" && p.strike != null && p.expiry ? buildOcc(p.ticker, p.expiry, p.side, p.strike) : null,
    moderator: p.moderator, sizeLabel: p.sizeLabel,
    entryPrice: new Prisma.Decimal(p.entryPrice), entryAt: p.entryAt, status: p.status,
    remainingFrac: new Prisma.Decimal(p.remaining), realizedPct: new Prisma.Decimal(realizedPct),
    events: p.events as unknown as Prisma.InputJsonValue,
  };

  const markFields = {
    lastMark: p.lastMark != null ? new Prisma.Decimal(p.lastMark) : null,
    markedAt: p.lastMark != null ? new Date() : null,
    livePct: p.livePct != null ? new Prisma.Decimal(p.livePct) : null,
    bookDelta: new Prisma.Decimal(bd),
  };

  // Only overwrite the live-mark columns when we actually have a fresh mark, or
  // when the position just closed (its settled result is final). Otherwise a
  // failed UW fetch (e.g. the daily-quota 429) would wipe the last good live
  // P/L back to blank — instead we keep the prior value on the row.
  const persistMarks = p.status === "CLOSED" || p.lastMark != null;

  await prisma.tradeAlert.upsert({
    where: { openMessageId: p.openMessageId },
    create: { openMessageId: p.openMessageId, ...core, ...markFields },
    update: persistMarks ? { ...core, ...markFields } : core,
  });
}

// Re-price standing OPEN positions older than the re-derive window.
async function repriceStandingOpen(sinceMs: number): Promise<void> {
  const rows = await prisma.tradeAlert.findMany({
    where: { status: "OPEN", entryAt: { lt: new Date(sinceMs) } },
  });
  for (const r of rows) {
    const p: Position = {
      openMessageId: r.openMessageId, assetType: r.assetType as AssetType, ticker: r.ticker,
      side: r.side as Position["side"], strike: r.strike ? Number(r.strike) : null,
      expiryLabel: r.expiryLabel, expiry: r.expiry, moderator: r.moderator, sizeLabel: r.sizeLabel,
      entryPrice: Number(r.entryPrice), entryAt: r.entryAt, remaining: Number(r.remainingFrac),
      realizedSum: Number(r.realizedPct) * (1 - Number(r.remainingFrac)), status: "OPEN",
      events: (r.events as unknown as EvtRec[]) ?? [], lastMark: null, livePct: null,
    };
    await priceAndSettle(p);
    await upsertPosition(p);
  }
}

// ── Push notification for genuinely new positions ────────────────────────────

// Contract-ish one-liner for the push body, e.g. "$150C 7/18 @ $2.35 —
// ModName (Medium)" for options or "NVDA LONG @ $118.42 — ModName (Small)"
// for equities. Mirrors the label style /api/watches builds for open alerts.
function pushSummary(p: Position): string {
  const contract = p.strike != null
    ? `$${p.strike}${p.side === "PUT" ? "P" : "C"}${p.expiryLabel ? ` ${p.expiryLabel}` : ""}`
    : `${p.ticker} ${p.side}`;
  return `${contract} @ $${p.entryPrice} — ${p.moderator} (${p.sizeLabel})`;
}

// ── Entry point ──────────────────────────────────────────────────────────────

// Only push for positions whose OPEN is this recent. The job re-derives 30
// days of history on every run, so "not in the table yet" alone is NOT
// "just happened" — a fresh DB, a truncated table, a new channel, or a
// parser improvement would otherwise blast stale alerts for the whole
// lookback window. One hour comfortably covers the 5-min poll cadence plus
// short worker downtime without ever notifying about old positions.
const PUSH_RECENCY_MS = 60 * 60 * 1000;

// In-flight guard: the market-hours and settle crons can overlap (both fire
// at 16:30), and a long run can outlast the 5-min cadence. Two concurrent
// runs would each snapshot knownIds before the other upserts and double-push
// every new position, so overlapping ticks are skipped instead.
let pollInFlight = false;

export async function pollTradeAlerts(lookbackDays: number = REDERIVE_DAYS): Promise<void> {
  if (pollInFlight) {
    console.log("[trade-alerts] previous run still in flight — skipping this tick");
    return;
  }
  pollInFlight = true;
  try {
    await pollTradeAlertsInner(lookbackDays);
  } finally {
    pollInFlight = false;
  }
}

async function pollTradeAlertsInner(lookbackDays: number): Promise<void> {
  const chans = channels();
  if (!chans.length) { console.error("[trade-alerts] no channels configured (DISCORD_*_CHANNEL_ID)"); return; }
  const sinceMs = Date.now() - lookbackDays * 86400000;
  let upserts = 0;

  // Snapshot the openMessageIds already in the table BEFORE upserting so we
  // can tell genuinely NEW positions (first time we see this open message)
  // apart from the re-derives this job does on every run.
  const existingRows = await prisma.tradeAlert.findMany({ select: { openMessageId: true } });
  const knownIds = new Set(existingRows.map((r) => r.openMessageId));

  for (const ch of chans) {
    const msgs = await fetchRecentMessages(ch.id, sinceMs);
    if (msgs === null) { console.warn(`[trade-alerts] ${ch.assetType} channel unreachable (perms?) — skipping`); continue; }
    const events = msgs.map((m) => parseEmbed(m, ch.assetType)).filter((e): e is Ev => e !== null);
    const positions = buildPositions(events);
    for (const p of positions) {
      await priceAndSettle(p);
      const isNew = !knownIds.has(p.openMessageId);
      try {
        await upsertPosition(p); upserts++;
        if (isNew) {
          knownIds.add(p.openMessageId);
          // Push only for positions that are genuinely fresh: still OPEN and
          // opened within PUSH_RECENCY_MS. Rederives/backfills (fresh env,
          // restored table, new channel) insert rows without notifying.
          const isFresh = p.status === "OPEN" && Date.now() - p.entryAt.getTime() <= PUSH_RECENCY_MS;
          if (isFresh) {
            // Fire-and-forget — a push failure must never break ingestion,
            // and sendPushToAll no-ops when FCM_SERVICE_ACCOUNT_JSON is unset.
            sendPushToAll(`New trade alert: ${p.ticker}`, pushSummary(p)).catch(console.error);
          }
        }
      } catch (err) {
        console.error(`[trade-alerts] upsert ${p.ticker} failed:`, err instanceof Error ? err.message : err);
      }
      await sleep(120);
    }
    console.log(`[trade-alerts] ${ch.assetType}: ${events.length} events → ${positions.length} positions`);
    await sleep(300);
  }

  await repriceStandingOpen(sinceMs);
  console.log(`[trade-alerts] ${ts()} done — ${upserts} positions upserted`);
}
