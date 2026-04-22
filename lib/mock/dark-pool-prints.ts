import type { DarkPoolPrint } from "@/lib/types";

// 16 dark pool prints from the mockup's genDP output (ported with deterministic values).
const ENTRIES: { t: string; p: number; isETF: boolean; rank: number; ext: boolean; time: string }[] = [
  { t: "NVDA", p: 872.20, isETF: false, rank: 1,  ext: false, time: "11:17:42" },
  { t: "SPY",  p: 544.40, isETF: true,  rank: 3,  ext: false, time: "11:16:08" },
  { t: "AAPL", p: 172.40, isETF: false, rank: 5,  ext: false, time: "11:15:33" },
  { t: "META", p: 613.66, isETF: false, rank: 7,  ext: false, time: "11:14:21" },
  { t: "TSLA", p: 247.60, isETF: false, rank: 10, ext: false, time: "11:13:05" },
  { t: "QQQ",  p: 462.80, isETF: true,  rank: 14, ext: false, time: "11:12:44" },
  { t: "MSFT", p: 415.30, isETF: false, rank: 17, ext: false, time: "11:11:19" },
  { t: "AMZN", p: 252.27, isETF: false, rank: 19, ext: false, time: "11:10:38" },
  { t: "GLD",  p: 442.71, isETF: true,  rank: 22, ext: false, time: "11:09:55" },
  { t: "AMD",  p: 148.90, isETF: false, rank: 25, ext: false, time: "11:09:12" },
  { t: "JPM",  p: 244.10, isETF: false, rank: 31, ext: true,  time: "11:08:33" },
  { t: "XOM",  p: 108.20, isETF: false, rank: 38, ext: false, time: "11:07:48" },
  { t: "PLTR", p: 21.40,  isETF: false, rank: 42, ext: false, time: "11:06:22" },
  { t: "GS",   p: 512.30, isETF: false, rank: 51, ext: false, time: "11:05:41" },
  { t: "COIN", p: 224.80, isETF: false, rank: 63, ext: true,  time: "11:04:17" },
  { t: "NFLX", p: 638.40, isETF: false, rank: 74, ext: false, time: "11:03:09" },
];

export function buildDarkPoolPrints(): DarkPoolPrint[] {
  // Deterministic size/volume derivation so the layout is stable across renders.
  return ENTRIES.map((e, i) => {
    const sizeBase = (((i * 173) % 900) + 100);
    const size = sizeBase * 1000;
    const priceDrift = e.p + (((i * 37) % 40) - 20) / 100;
    const price = Number(priceDrift.toFixed(4));
    const premium = Number((price * size / 100).toFixed(2));
    const volume = Math.round(size * ((i % 7) * 0.3 + 0.8) * 1000);

    return {
      id: i + 1,
      executed_at: `2026-04-21T${e.time}Z`,
      ticker: e.t,
      price,
      size,
      premium,
      volume,
      exchange_id: 4,
      trf_id: 202,
      is_etf: e.isETF,
      is_extended: e.ext,
      all_time_rank: e.rank,
      percentile: Number((100 - (e.rank - 1)).toFixed(2)),
    };
  });
}
