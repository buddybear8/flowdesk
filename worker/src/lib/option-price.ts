// Shared option-contract pricing helpers (OCC symbol build + latest UW mark).
// Same approach as the trade-alerts pipeline: nbbo mid from the contract's
// historic endpoint, falling back to last_price.

const UW_BASE = "https://api.unusualwhales.com";

export function buildOcc(ticker: string, expiry: Date, type: "CALL" | "PUT", strike: number): string {
  const yy = String(expiry.getUTCFullYear()).slice(2);
  const mm = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getUTCDate()).padStart(2, "0");
  const strk = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${ticker}${yy}${mm}${dd}${type === "PUT" ? "P" : "C"}${strk}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function uwGet(path: string): Promise<unknown | null> {
  const token = process.env.UW_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${UW_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "UW-CLIENT-API-ID": "100001", Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Latest UW mark (nbbo mid, else last_price) for an option contract.
export async function optionMark(occ: string): Promise<number | null> {
  const j = (await uwGet(`/api/option-contract/${occ}/historic`)) as { chains?: Record<string, unknown>[] } | null;
  const chains = j?.chains ?? [];
  if (!chains.length) return null;
  const last = [...chains].sort((a, b) => String(a.date).localeCompare(String(b.date))).pop()!;
  const bid = num(last.nbbo_bid), ask = num(last.nbbo_ask), lp = num(last.last_price);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return lp > 0 ? lp : null;
}
