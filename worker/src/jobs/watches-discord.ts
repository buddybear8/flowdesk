// jobs/watches-discord.ts — post the morning Daily Watches as a rendered PNG
// card to a Discord channel. Zero AI involved: pure canvas drawing from the
// day's hit_list_daily rows + a multipart upload.
//
// Destination (either works; webhook wins if both set):
//   DISCORD_WATCHES_WEBHOOK_URL — channel webhook URL
//   DISCORD_BOT_TOKEN + DISCORD_WATCHES_CHANNEL_ID — bot upload
// Unset → the job logs and no-ops, so it's safe to deploy before configuring.
//
// Cron: 7:50 ET (after the 7:30 compute + 7:45 briefs), with an 8:10 retry
// tick; an ai_summaries marker row (kind discord-watches-{date}) dedupes so
// the card posts exactly once per day.

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { prisma } from "../lib/prisma.js";

const ts = () => new Date().toISOString();

const BG = "#0A1424", PANEL = "#101E36", PANEL2 = "#0C1830";
const LINE = "rgba(255,255,255,0.09)";
const GOLD = "#C9A55A", GOLD2 = "#E2BF73";
const UP = "#7FBF52", DN = "#E76A6A";
const TP = "#E8EDF6", T2 = "#94A1B8", T3 = "#5E6E8C";

// Alpine ships no fonts — the Dockerfile installs ttf-dejavu and we register
// it explicitly. On macOS dev the system fonts are picked up automatically.
const FONT_CANDIDATES = [
  "/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];
const BOLD_CANDIDATES = [
  "/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];
let fontFamily = "sans-serif";
for (const p of FONT_CANDIDATES) {
  if (existsSync(p)) {
    GlobalFonts.registerFromPath(p, "CardSans");
    fontFamily = "CardSans";
    break;
  }
}
for (const p of BOLD_CANDIDATES) {
  if (existsSync(p)) { GlobalFonts.registerFromPath(p, "CardSans"); break; }
}

function todayDateET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

interface CardRow {
  rank: number;
  ticker: string;
  direction: string;
  score: string;
  confidence: string;
  contract: string;
  entry: string;
  t1: string; t2: string; t3: string;
  isCall: boolean | null;
}

export function renderWatchesCard(dateLabel: string, rows: CardRow[]): Buffer {
  const W = 1080;
  const headerH = 118, colsH = 34, rowH = 52, footerH = 54, pad = 26;
  const H = headerH + colsH + rows.length * rowH + footerH + pad;
  const c = createCanvas(W, H);
  const g = c.getContext("2d");

  const f = (size: number, bold = false) => `${bold ? "bold " : ""}${size}px ${fontFamily}`;

  // ground + card
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  g.fillStyle = PANEL2;
  g.beginPath(); g.roundRect(14, 14, W - 28, H - 28, 16); g.fill();
  g.strokeStyle = LINE; g.lineWidth = 1; g.stroke();

  // header
  g.fillStyle = GOLD;
  g.font = f(15, true);
  g.fillText("CHAMPAGNE SESSIONS", 40, 56);
  g.fillStyle = TP;
  g.font = f(30, true);
  g.fillText(`Daily Watches — ${dateLabel}`, 40, 96);
  g.fillStyle = T2;
  g.font = f(14);
  g.textAlign = "right";
  g.fillText("Top-10 confluence screen · options flow + sentiment + dark pool", W - 44, 56);
  g.fillText("Champagne Intelligence", W - 44, 78);
  g.textAlign = "left";

  // column layout
  const cols = [
    { x: 44, label: "#", align: "left" as const },
    { x: 80, label: "TICKER", align: "left" as const },
    { x: 250, label: "SCORE", align: "right" as const },
    { x: 330, label: "CONF", align: "right" as const },
    { x: 520, label: "CONTRACT", align: "right" as const },
    { x: 630, label: "ENTRY", align: "right" as const },
    { x: 770, label: "TARGET 1", align: "right" as const },
    { x: 900, label: "TARGET 2", align: "right" as const },
    { x: 1030, label: "TARGET 3", align: "right" as const },
  ];
  let y = headerH + 22;
  g.font = f(11, true);
  g.fillStyle = T3;
  for (const col of cols) {
    g.textAlign = col.align;
    g.fillText(col.label, col.x, y);
  }
  g.strokeStyle = LINE;
  g.beginPath(); g.moveTo(36, y + 10); g.lineTo(W - 36, y + 10); g.stroke();

  // rows
  y += 10;
  for (const r of rows) {
    const rowY = y + rowH / 2 + 6;
    if (r.rank % 2 === 0) {
      g.fillStyle = "rgba(255,255,255,0.022)";
      g.fillRect(36, y + 2, W - 72, rowH - 2);
    }
    const dirColor = r.direction === "UP" ? UP : DN;
    const sideColor = r.isCall == null ? TP : r.isCall ? UP : DN;

    g.textAlign = "left";
    g.fillStyle = T3; g.font = f(15);
    g.fillText(String(r.rank), 44, rowY);
    g.fillStyle = GOLD2; g.font = f(20, true);
    g.fillText(r.ticker, 80, rowY);
    g.fillStyle = dirColor; g.font = f(14, true);
    g.fillText(r.direction === "UP" ? "▲" : "▼", 80 + g.measureText(r.ticker).width + 46, rowY);

    g.textAlign = "right";
    g.fillStyle = GOLD; g.font = f(17, true);
    g.fillText(r.score, 250, rowY);
    g.fillStyle = T2; g.font = f(14);
    g.fillText(r.confidence, 330, rowY);
    g.fillStyle = sideColor; g.font = f(16, true);
    g.fillText(r.contract, 520, rowY);
    g.fillStyle = TP; g.font = f(16);
    g.fillText(r.entry, 630, rowY);
    g.fillStyle = dirColor; g.font = f(15);
    g.fillText(r.t1, 770, rowY);
    g.fillText(r.t2, 900, rowY);
    g.fillText(r.t3, 1030, rowY);

    y += rowH;
  }

  // footer
  g.strokeStyle = LINE;
  g.beginPath(); g.moveTo(36, y + 8); g.lineTo(W - 36, y + 8); g.stroke();
  g.textAlign = "left";
  g.fillStyle = T3; g.font = f(12);
  g.fillText("Screening list, not trade advice · Targets are direction-matched move levels · Full detail in the platform", 44, y + 36);
  g.textAlign = "right";
  g.fillStyle = GOLD; g.font = f(12, true);
  g.fillText("champagne intelligence", W - 44, y + 36);
  g.textAlign = "left";

  return c.toBuffer("image/png");
}

async function uploadToDiscord(png: Buffer, dateLabel: string): Promise<boolean> {
  const webhook = process.env.DISCORD_WATCHES_WEBHOOK_URL;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_WATCHES_CHANNEL_ID;

  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    content: `**Daily Watches — ${dateLabel}** · today's top-10 confluence screen 🍾`,
  }));
  form.append("files[0]", new Blob([new Uint8Array(png)], { type: "image/png" }), `daily-watches-${todayDateET()}.png`);

  let url: string, headers: Record<string, string> = {};
  if (webhook) {
    url = webhook;
  } else if (botToken && channelId) {
    url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    headers = { Authorization: `Bot ${botToken}` };
  } else {
    console.log(`[watches-discord] ${ts()} no destination configured (set DISCORD_WATCHES_WEBHOOK_URL or DISCORD_WATCHES_CHANNEL_ID) — skipping`);
    return false;
  }

  const res = await fetch(url, { method: "POST", headers, body: form });
  if (!res.ok) {
    console.error(`[watches-discord] ${ts()} Discord upload failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
    return false;
  }
  return true;
}

export async function postWatchesToDiscord(): Promise<void> {
  const dateKey = todayDateET();
  const markerKind = `discord-watches-${dateKey}`;

  // Once per day.
  const posted = await prisma.aiSummary.findFirst({ where: { kind: markerKind }, select: { id: true } });
  if (posted) return;

  const rows = await prisma.hitListDaily.findMany({
    where: { date: new Date(`${dateKey}T00:00:00.000Z`) },
    orderBy: { rank: "asc" },
  });
  if (!rows.length) {
    console.log(`[watches-discord] ${ts()} no hit list for ${dateKey} yet — will retry on the next tick`);
    return;
  }

  const money = (v: unknown) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
  const cardRows: CardRow[] = rows.map((r) => {
    const t = r.atrTargets as { up05?: number; up1?: number; up2?: number; dn05?: number; dn1?: number; dn2?: number } | null;
    const up = r.direction === "UP";
    const ladder = t ? (up ? [t.up05, t.up1, t.up2] : [t.dn05, t.dn1, t.dn2]) : [null, null, null];
    const m = r.contract.match(/\$[\d.]+([CP])\b/);
    return {
      rank: r.rank,
      ticker: r.ticker,
      direction: r.direction,
      score: Number(r.actionabilityScore).toFixed(1),
      confidence: r.confidence,
      contract: r.contract,
      entry: money(r.contractEntryPrice),
      t1: money(ladder[0]), t2: money(ladder[1]), t3: money(ladder[2]),
      isCall: m ? m[1] === "C" : null,
    };
  });

  const dateLabel = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
  const png = renderWatchesCard(dateLabel, cardRows);

  const ok = await uploadToDiscord(png, dateLabel);
  if (ok) {
    await prisma.aiSummary.create({
      data: { kind: markerKind, generatedAt: new Date(), body: `posted ${cardRows.length} rows`, tokensUsed: 0 },
    });
    console.log(`[watches-discord] ${ts()} posted ${cardRows.length}-row card for ${dateKey}`);
  }
}
