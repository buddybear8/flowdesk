// jobs/gex-nodes.ts — compact GEX node time-series for the GEX Chart tab.
//
// Every 2 minutes during RTH, for each watched ticker whose latest heatmap
// snapshot is newer than the last stored bucket, append one bucket to the
// day's gex_node_days row:
//   { t: "13:35", s: spot, front: [{k,g}], all: [{k,g}], cw, pw, fl }
// front = nearest expiration's per-strike net GEX (incl. 0DTE), all = summed
// across the stored expirations. Top NODE_COUNT strikes by |g| per scope.
// This keeps the chart API away from the heavy heatmap JSON (hundreds of
// large rows/day) — one slim row per ticker-day, FlowSentimentDay-style.

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { WATCHED_TICKERS } from "../lib/watched-tickers.js";

const ts = () => new Date().toISOString();
const NODE_COUNT = 12;

type Cells = {
  expirations: { date: string; dte: number }[];
  strikes: { strike: number; byExp: Record<string, { netOI: number; netDV: number }> }[];
};

interface NodeBucket {
  t: string;
  ts: number; // capture epoch ms (chart x-placement)
  s: number;
  front: { k: number; g: number }[];
  all: { k: number; g: number }[];
  cw: number | null;
  pw: number | null;
  fl: number | null;
}

function etClock(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}
function etDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

function topNodes(pairs: { k: number; g: number }[]): { k: number; g: number }[] {
  return pairs
    .filter((p) => Number.isFinite(p.g) && p.g !== 0)
    .sort((a, b) => Math.abs(b.g) - Math.abs(a.g))
    .slice(0, NODE_COUNT)
    .sort((a, b) => a.k - b.k);
}

export async function appendGexNodeBuckets(): Promise<void> {
  const dateKey = etDate(new Date());
  const tradingDate = new Date(`${dateKey}T00:00:00.000Z`);
  let appended = 0;

  for (const ticker of WATCHED_TICKERS) {
    try {
      const snap = await prisma.gexHeatmapSnapshot.findFirst({
        where: { ticker },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true, spot: true, cells: true },
      });
      if (!snap) continue;
      if (Date.now() - snap.capturedAt.getTime() > 20 * 60_000) continue; // stale

      const existing = await prisma.gexNodeDay.findUnique({
        where: { ticker_tradingDate: { ticker, tradingDate } },
        select: { id: true, capturedAt: true, buckets: true },
      });
      // Only one bucket per distinct snapshot
      if (existing && existing.capturedAt >= snap.capturedAt) continue;

      const cells = snap.cells as unknown as Cells;
      if (!cells?.strikes?.length || !cells?.expirations?.length) continue;
      const frontExp = [...cells.expirations].sort((a, b) => a.dte - b.dte)[0]?.date;

      const front: { k: number; g: number }[] = [];
      const all: { k: number; g: number }[] = [];
      for (const s of cells.strikes) {
        let sum = 0;
        for (const exp of Object.keys(s.byExp)) {
          const v = Number(s.byExp[exp]?.netOI ?? 0);
          sum += v;
          if (exp === frontExp && v !== 0) front.push({ k: s.strike, g: v });
        }
        if (sum !== 0) all.push({ k: s.strike, g: sum });
      }

      const levels = await prisma.gexSnapshot.findFirst({
        where: { ticker },
        orderBy: { capturedAt: "desc" },
        select: { callWall: true, putWall: true, gammaFlip: true },
      });

      const bucket: NodeBucket = {
        t: etClock(snap.capturedAt),
        ts: snap.capturedAt.getTime(),
        s: Number(snap.spot),
        front: topNodes(front),
        all: topNodes(all),
        cw: levels ? Number(levels.callWall) : null,
        pw: levels ? Number(levels.putWall) : null,
        fl: levels ? Number(levels.gammaFlip) : null,
      };

      if (existing) {
        const buckets = (existing.buckets as unknown as NodeBucket[]) ?? [];
        // Dedupe on clock label (two captures within the same minute)
        if (buckets.length && buckets[buckets.length - 1].t === bucket.t) {
          buckets[buckets.length - 1] = bucket;
        } else {
          buckets.push(bucket);
        }
        await prisma.gexNodeDay.update({
          where: { id: existing.id },
          data: { capturedAt: snap.capturedAt, buckets: buckets as unknown as Prisma.InputJsonValue },
        });
      } else {
        await prisma.gexNodeDay.create({
          data: {
            ticker, tradingDate, capturedAt: snap.capturedAt,
            buckets: [bucket] as unknown as Prisma.InputJsonValue,
          },
        });
      }
      appended++;
    } catch (e) {
      console.error(`[gex-nodes] ${ts()} ${ticker}: ${String(e).slice(0, 150)}`);
    }
  }
  if (appended > 0) console.log(`[gex-nodes] ${ts()} appended buckets for ${appended} tickers (${dateKey})`);
}

// 30-day retention, same policy as the heatmap snapshots the series derives from.
export async function runGexNodeRetentionSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const res = await prisma.gexNodeDay.deleteMany({ where: { tradingDate: { lt: cutoff } } });
  if (res.count > 0) console.log(`[retention] ${ts()} gex_node_days: deleted ${res.count} rows older than 30d`);
}

// 1m candles share the table with 1H/1D/1W (those keep longer history) —
// sweep only the "1m" timeframe.
export async function runMinuteCandleRetentionSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const res = await prisma.candleBar.deleteMany({ where: { timeframe: "1m", barTime: { lt: cutoff } } });
  if (res.count > 0) console.log(`[retention] ${ts()} candle_bars 1m: deleted ${res.count} rows older than 30d`);
}
