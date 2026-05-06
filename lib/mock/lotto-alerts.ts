import type { FlowAlert } from "@/lib/types";

// Mock data for previewing the Lottos preset tab. Rendered only when the URL
// includes ?mock=1, so this never bleeds into the real Vercel build.
//
// Each row obeys the Lottos preset (Common Stock; DTE 0–14; %OTM 20–100%;
// premium ≥ $1k; volume > OI; opening single-leg trades) so the table looks
// the same shape it'll have once real data lands. Tickers + numbers are
// illustrative — ignore them for trading purposes.
//
// Mix is intentional:
//   • Most rows are CALL+BUY (bullish lotto)
//   • A handful are PUT+BUY (bearish lotto — buyer hits ask on a put)
//     to exercise the bearish-red premium color.
//   • Each row carries an internal `pure` flag — true means "every trade at
//     ask" (passes the strict exact=1 filter); false means "ask-side
//     dominant but not 100%". buildLottoMock filters with that flag.

type Pure = boolean;
type SeedKind = "CALL_BUY" | "PUT_BUY";

type Seed = {
  minAgo: number;
  ticker: string;
  kind: SeedKind;
  spot: number;
  strike: number;
  dte: number;
  size: number;
  oi: number;
  premium: number;
  exec: "SWEEP" | "FLOOR" | "BLOCK" | "SINGLE";
  rule: string;
  confidence: "HIGH" | "MED" | "LOW";
  pure: Pure;
};

const SEEDS: Seed[] = [
  { minAgo: 4,   ticker: "PLTR",  kind: "CALL_BUY", spot: 28.40,  strike: 35,  dte: 7,  size: 4200,   oi: 980,   premium: 8_400,  exec: "SWEEP",  rule: "Repeated Hits ↑",     confidence: "HIGH", pure: true  },
  { minAgo: 6,   ticker: "RBLX",  kind: "PUT_BUY",  spot: 42.10,  strike: 32,  dte: 5,  size: 1850,   oi: 612,   premium: 3_700,  exec: "SWEEP",  rule: "Unusual Activity",    confidence: "HIGH", pure: true  },
  { minAgo: 12,  ticker: "AMC",   kind: "CALL_BUY", spot: 4.90,   strike: 7,   dte: 2,  size: 25_400, oi: 8_120, premium: 12_700, exec: "SWEEP",  rule: "Repeated Hits ↑",     confidence: "MED",  pure: false },
  { minAgo: 18,  ticker: "SOFI",  kind: "CALL_BUY", spot: 11.20,  strike: 14,  dte: 9,  size: 3100,   oi: 740,   premium: 4_650,  exec: "SINGLE", rule: "Volume Surge",        confidence: "HIGH", pure: true  },
  { minAgo: 27,  ticker: "RIOT",  kind: "CALL_BUY", spot: 9.85,   strike: 13,  dte: 4,  size: 2200,   oi: 410,   premium: 2_200,  exec: "FLOOR",  rule: "Floor Trade Mid Cap", confidence: "HIGH", pure: true  },
  { minAgo: 35,  ticker: "MARA",  kind: "PUT_BUY",  spot: 16.20,  strike: 11,  dte: 3,  size: 1640,   oi: 380,   premium: 1_840,  exec: "SWEEP",  rule: "Repeated Hits ↓",     confidence: "MED",  pure: false },
  { minAgo: 48,  ticker: "GME",   kind: "CALL_BUY", spot: 22.10,  strike: 35,  dte: 6,  size: 5100,   oi: 1_680, premium: 7_650,  exec: "SWEEP",  rule: "Unusual Activity",    confidence: "HIGH", pure: false },
  { minAgo: 61,  ticker: "COIN",  kind: "CALL_BUY", spot: 188.40, strike: 245, dte: 11, size: 280,    oi: 92,    premium: 14_000, exec: "SINGLE", rule: "Repeated Hits ↑",     confidence: "HIGH", pure: true  },
  { minAgo: 76,  ticker: "DKNG",  kind: "CALL_BUY", spot: 36.40,  strike: 50,  dte: 14, size: 1_140,  oi: 290,   premium: 5_700,  exec: "BLOCK",  rule: "Block Print",         confidence: "MED",  pure: false },
  { minAgo: 91,  ticker: "SNAP",  kind: "PUT_BUY",  spot: 9.45,   strike: 7,   dte: 8,  size: 6200,   oi: 1_840, premium: 4_960,  exec: "FLOOR",  rule: "Floor Trade Mid Cap", confidence: "HIGH", pure: true  },
  { minAgo: 110, ticker: "HOOD",  kind: "CALL_BUY", spot: 19.60,  strike: 27,  dte: 1,  size: 9_300,  oi: 2_100, premium: 18_600, exec: "SWEEP",  rule: "Repeated Hits ↑",     confidence: "HIGH", pure: false },
  { minAgo: 132, ticker: "BBY",   kind: "CALL_BUY", spot: 78.20,  strike: 105, dte: 13, size: 410,    oi: 130,   premium: 2_460,  exec: "SINGLE", rule: "Unusual Activity",    confidence: "MED",  pure: true  },
];

export function buildLottoMock(opts: { exactAtAsk?: boolean } = {}): FlowAlert[] {
  const { exactAtAsk = false } = opts;
  const today = new Date();
  const fmtTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const fmtDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
  const isoDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const minutesAgo = (n: number) => new Date(today.getTime() - n * 60_000);
  const daysFromNow = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d;
  };

  const eligible = exactAtAsk ? SEEDS.filter((s) => s.pure) : SEEDS;

  return eligible.map((s, i) => {
    const time = minutesAgo(s.minAgo);
    const expiry = daysFromNow(s.dte);
    const isCall = s.kind === "CALL_BUY";
    return {
      id: `lotto-mock-${i}`,
      date: fmtDate.format(time),
      time: fmtTime.format(time),
      ticker: s.ticker,
      type: isCall ? ("CALL" as const) : ("PUT" as const),
      side: "BUY" as const, // every Lottos row is a buyer hitting the ask
      // Sentiment matches type+side: CALL+BUY = BULLISH, PUT+BUY = BEARISH.
      // Drives the row's premium color in LottosView.
      sentiment: isCall ? ("BULLISH" as const) : ("BEARISH" as const),
      exec: s.exec,
      multiLeg: false,
      contract: `$${s.strike}${isCall ? "C" : "P"} ${fmtDate.format(expiry)}`,
      strike: s.strike,
      expiry: isoDate(expiry),
      size: s.size,
      oi: s.oi,
      premium: s.premium,
      spot: s.spot,
      rule: s.rule,
      confidence: s.confidence,
      sector: "Technology" as const,
    };
  });
}
