// jobs/model-shadow-score.ts — silent shadow scorer for the ML direction
// model px-cand2-dir5 (study: ta_pipeline/data/reports/model_restudy_2026-10.md §8).
//
// Runs daily after the 07:30 hit-list compute, scores each idea with the
// FROZEN logistic model (params in lib/model-cand2-dir5.json, trained through
// 2026-10-16, never refit), and writes p_dir5 to model_scores. Nothing reads
// this table in the product — it exists solely for the pre-registered
// confirmation test on idea dates 2026-10-20..12-04 (scored ~2026-12-11).
//
// Feature construction is a line-for-line port of the study's builder
// (ta_pipeline/data/scratch/restudy/scripts/s3_build.py px_ block +
// scratch_oct/px/common.py::engineer): daily candle_bars strictly before the
// idea date, >= 60 bars required, Wilder RSI, population-std realized vol.
// Verified against the python pipeline on 2026-10-05..16 before deploy.

import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma.js";

const ts = () => new Date().toISOString();

type Frozen = {
  name: string;
  features: string[];
  impute_median: Record<string, number>;
  scale_mean: Record<string, number>;
  scale_std: Record<string, number>;
  coef: Record<string, number>;
  intercept: number;
};

const FROZEN: Frozen = JSON.parse(
  readFileSync(new URL("../lib/model-cand2-dir5.json", import.meta.url), "utf8"),
);
const MODEL_TAG = "cand2-dir5-tradable-nopvr";

function todayDateET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// Wilder RSI, matching s3_build.py::wilder_rsi (seeded with simple mean of
// first n deltas, then Wilder smoothing; input = last 60 closes).
function wilderRsi(closes: number[], n = 14): number {
  const delta: number[] = [];
  for (let i = 1; i < closes.length; i++) delta.push(closes[i] - closes[i - 1]);
  if (delta.length < n + 1) return NaN;
  const up = delta.map((d) => Math.max(d, 0));
  const dn = delta.map((d) => Math.max(-d, 0));
  let au = up.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let ad = dn.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < delta.length; i++) {
    au = (au * (n - 1) + up[i]) / n;
    ad = (ad * (n - 1) + dn[i]) / n;
  }
  if (ad === 0) return 100;
  return 100 - 100 / (1 + au / ad);
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
// population std (ddof=0), matching numpy's default used in the study
const stdP = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
};

interface Bar { close: number; high: number; low: number; volume: number }

// Raw px_ features from daily bars strictly before the idea date.
// Mirrors s3_build.py lines 160-193 (without px_price_vs_ref / px_close_prev).
export function pxFeatures(bars: Bar[], atrW: number | null): Record<string, number> | null {
  if (bars.length < 60) return null;
  const cl = bars.map((b) => b.close);
  const hi = bars.map((b) => b.high);
  const lo = bars.map((b) => b.low);
  const vol = bars.map((b) => b.volume);
  const n = cl.length;
  const c0 = cl[n - 1];

  const tr: number[] = [];
  for (let i = 1; i < n; i++) tr.push(Math.max(hi[i], cl[i - 1]) - Math.min(lo[i], cl[i - 1]));
  const atr14 = mean(tr.slice(-14));
  const sma20 = mean(cl.slice(-20));
  const sma50 = mean(cl.slice(-50));
  const sma200 = n >= 200 ? mean(cl.slice(-200)) : NaN;
  const lr: number[] = [];
  for (let i = 1; i < n; i++) lr.push(Math.log(Math.max(cl[i], 1e-9)) - Math.log(Math.max(cl[i - 1], 1e-9)));
  const hi20 = Math.max(...hi.slice(-20));
  const lo20 = Math.min(...lo.slice(-20));

  return {
    px_ext_sma50_atr: atr14 > 0 ? (c0 - sma50) / atr14 : NaN,
    px_ext_sma20_atr: atr14 > 0 ? (c0 - sma20) / atr14 : NaN,
    px_ext_sma200_atr: atr14 > 0 && Number.isFinite(sma200) ? (c0 - sma200) / atr14 : NaN,
    px_ext_sma50_atrw: atrW ? (c0 - sma50) / atrW : NaN,
    px_rsi14: wilderRsi(cl.slice(-60)),
    px_ret_1d: cl[n - 1] / cl[n - 2] - 1,
    px_ret_5d: cl[n - 1] / cl[n - 6] - 1,
    px_ret_20d: cl[n - 1] / cl[n - 21] - 1,
    px_rvol20: stdP(lr.slice(-20)) * Math.sqrt(252),
    px_atr14_pct: atr14 / c0,
    px_range_pos_20d: (c0 - lo20) / Math.max(hi20 - lo20, 1e-9),
    px_hi20_dist: c0 / hi20 - 1,
    px_lo20_dist: c0 / lo20 - 1,
    px_vol_ratio20: vol[n - 1] / Math.max(mean(vol.slice(-20)), 1e-9),
  };
}

// Engineered terms from common.py::engineer (the subset the frozen model uses).
export function engineer(
  px: Record<string, number>,
  directionUp: boolean,
  atrwPct: number,
): Record<string, number> {
  const dir = directionUp ? 1 : -1;
  return {
    ...px,
    e_ext50_x_dir: px.px_ext_sma50_atr * dir,
    e_ext20_x_dir: px.px_ext_sma20_atr * dir,
    e_rsi_x_dir: (px.px_rsi14 - 50) * dir,
    e_ret5_x_dir: px.px_ret_5d * dir,
    e_rangepos_x_dir: (px.px_range_pos_20d - 0.5) * dir,
    e_lo20hi20_x_dir: (px.px_lo20_dist - px.px_hi20_dist) * dir,
    e_barrier_ratio: atrwPct / px.px_atr14_pct,
  };
}

export function scoreFrozen(feats: Record<string, number>): number {
  let z = FROZEN.intercept;
  for (const f of FROZEN.features) {
    let v = feats[f];
    if (v == null || !Number.isFinite(v)) v = FROZEN.impute_median[f];
    z += FROZEN.coef[f] * ((v - FROZEN.scale_mean[f]) / FROZEN.scale_std[f]);
  }
  return 1 / (1 + Math.exp(-z));
}

// Score one idea date (defaults to today ET). Exposed with a date param so a
// local script can replay historical dates for the python cross-check.
export async function scoreShadowModel(dateIso?: string): Promise<void> {
  const dateKey = dateIso ?? todayDateET();
  const date = new Date(`${dateKey}T00:00:00.000Z`);

  const ideas = await prisma.hitListDaily.findMany({
    where: { date },
    select: { rank: true, ticker: true, price: true, direction: true, atrTargets: true },
    orderBy: { rank: "asc" },
  });
  if (ideas.length === 0) {
    console.log(`[shadow-score] ${ts()} no hit_list_daily rows for ${dateKey} — skipping`);
    return;
  }

  let scored = 0;
  for (const idea of ideas) {
    const existing = await prisma.modelScore.findUnique({
      where: { date_rank_model: { date, rank: idea.rank, model: MODEL_TAG } },
      select: { id: true },
    });
    if (existing) continue;

    const bars = await prisma.candleBar.findMany({
      where: { ticker: idea.ticker, timeframe: "1D", barTime: { lt: date } },
      orderBy: { barTime: "desc" },
      take: 210,
      select: { close: true, high: true, low: true, volume: true },
    });
    bars.reverse();

    const at = (idea.atrTargets ?? {}) as { atrW?: number };
    const price = Number(idea.price);
    const atrW = at.atrW != null && Number.isFinite(Number(at.atrW)) ? Number(at.atrW) : null;
    const atrwPct = atrW != null && price > 0 ? atrW / price : NaN;

    let p: number | null = null;
    const px = pxFeatures(
      bars.map((b) => ({ close: Number(b.close), high: Number(b.high), low: Number(b.low), volume: Number(b.volume) })),
      atrW,
    );
    if (px) {
      p = scoreFrozen(engineer(px, idea.direction === "UP", atrwPct));
      scored++;
    }

    await prisma.modelScore.create({
      data: { date, rank: idea.rank, ticker: idea.ticker, model: MODEL_TAG, pDir5: p },
    });
  }
  console.log(`[shadow-score] ${ts()} ${dateKey}: stored ${ideas.length} rows (${scored} scored, ${ideas.length - scored} null/no-candles)`);
}
