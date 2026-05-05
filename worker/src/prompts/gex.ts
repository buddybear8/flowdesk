// prompts/gex.ts — Per-ticker GEX explanation prompt (PRD §3.4, V1 active).
//
// The SYSTEM_PROMPT is reproduced verbatim from PRD §3.4 — DO NOT modify
// without a corresponding PRD change. Output shape (4 short paragraphs,
// 200–280 words total, plain English) is part of the locked spec because
// the frontend modal renders the body as-is.
//
// `buildUserPrompt` formats the ai-summarizer-gex job's gex_snapshot
// fields into a structured input block. The frontend modal also renders
// a header note that this summary is static as of market open.

export const SYSTEM_PROMPT = `You are FlowDesk's GEX analyst. Generate a structured explanation of today's
gamma exposure for the ticker provided. Output 4 short paragraphs in this order:
(1) regime, (2) gamma flip distance + implications, (3) key levels (call wall,
put wall, max pain), (4) actionable read for the session. Total 200–280 words.
Plain English; no jargon left undefined on first use.`;

export interface GexInputs {
  ticker: string;          // uppercase symbol
  date: string;            // ISO date YYYY-MM-DD
  regime: "POSITIVE" | "NEGATIVE";
  spot: number;
  callWall: number;
  putWall: number;
  gammaFlip: number;
  maxPain: number;
  netGexOI: number;        // sum across strikes (OI-based dealer gamma)
  netGexDV: number;        // sum across strikes (volume-based dealer gamma)
  topStrikes: Array<{ strike: number; combined: number }>;  // ≤ 5 rows by |combined|
}

export function buildUserPrompt(inputs: GexInputs): string {
  const fmtMoney = (n: number) => (n >= 0 ? "+" : "") + formatLargeNumber(n);
  const flipDistPct = inputs.spot > 0
    ? ((inputs.gammaFlip - inputs.spot) / inputs.spot) * 100
    : 0;
  const flipDirection = inputs.gammaFlip > inputs.spot ? "above" : inputs.gammaFlip < inputs.spot ? "below" : "at";

  const topStrikesBlock = inputs.topStrikes.length
    ? inputs.topStrikes
        .map((s) => `  - $${s.strike}: ${fmtMoney(s.combined)}`)
        .join("\n")
    : "  (no strikes available)";

  return [
    `Ticker: ${inputs.ticker}`,
    `Date: ${inputs.date}`,
    `Regime: ${inputs.regime}`,
    `Spot price: $${inputs.spot.toFixed(2)}`,
    ``,
    `Key levels:`,
    `  - Call wall: $${inputs.callWall.toFixed(2)}`,
    `  - Put wall: $${inputs.putWall.toFixed(2)}`,
    `  - Gamma flip: $${inputs.gammaFlip.toFixed(2)} (${Math.abs(flipDistPct).toFixed(2)}% ${flipDirection} spot)`,
    `  - Max pain: $${inputs.maxPain.toFixed(2)}`,
    ``,
    `Net dealer gamma (OI-based): ${fmtMoney(inputs.netGexOI)}`,
    `Net dealer gamma (volume-based): ${fmtMoney(inputs.netGexDV)}`,
    ``,
    `Top ${inputs.topStrikes.length} strikes by |net dealer gamma|:`,
    topStrikesBlock,
    ``,
    `Generate today's GEX explanation per the system instructions.`,
  ].join("\n");
}

// Format a number into a compact dollar-amount string for the prompt.
// Net dealer gamma values can range from millions to billions.
function formatLargeNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
