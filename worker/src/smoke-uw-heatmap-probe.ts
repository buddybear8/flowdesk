// One-shot probe of UW endpoints that might give us GEX bucketed by
// (strike × expiration). Read-only — no DB writes.
//
// Goal: figure out which UW endpoint can power the GEX heatmap (50 strikes ×
// 5 expirations). Today's pollGex uses /spot-exposures/strike which is
// aggregated across all expirations — known gap, see ARCHITECTURE.md:1004.
//
// Run with:
//   cd worker && railway run -- npx tsx src/smoke-uw-heatmap-probe.ts
//   cd worker && UW_API_TOKEN=... npx tsx src/smoke-uw-heatmap-probe.ts

const UW_BASE = "https://api.unusualwhales.com";
const TICKER = "SPY";
const PROBE_DELAY_MS = 250;

function nextTradingDayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function probe(path: string): Promise<void> {
  const url = `${UW_BASE}${path}`;
  console.log(`\n─── GET ${path} ───`);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.UW_API_TOKEN ?? ""}`,
        "UW-CLIENT-API-ID": "100001",
        Accept: "application/json",
      },
    });
  } catch (err) {
    console.log(`  fetch failed: ${err instanceof Error ? err.message : err}`);
    return;
  }
  console.log(`  status:   ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!res.ok) {
    console.log(`  body:     ${text.slice(0, 300)}`);
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`  body (non-JSON, first 300 chars): ${text.slice(0, 300)}`);
    return;
  }

  if (Array.isArray(json)) {
    console.log(`  top:      [Array len=${json.length}]`);
    if (json.length) {
      const sample = json[0] as Record<string, unknown>;
      console.log(`  itemKeys: ${Object.keys(sample).join(", ")}`);
      console.log(`  sample:   ${JSON.stringify(sample).slice(0, 400)}`);
    }
    return;
  }

  const obj = json as Record<string, unknown>;
  console.log(`  top:      ${Object.keys(obj).join(", ")}`);

  // Most UW endpoints wrap the payload in one of these keys.
  const candidate =
    (obj.data as unknown) ??
    (obj.strikes as unknown) ??
    (obj.expirations as unknown) ??
    (obj.contracts as unknown) ??
    (obj.results as unknown);
  if (Array.isArray(candidate)) {
    console.log(`  items:    ${candidate.length}`);
    if (candidate.length) {
      const sample = candidate[0] as Record<string, unknown>;
      console.log(`  itemKeys: ${Object.keys(sample).join(", ")}`);
      console.log(`  sample:   ${JSON.stringify(sample).slice(0, 400)}`);
    }
  } else {
    console.log(`  body:     ${JSON.stringify(obj).slice(0, 400)}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.UW_API_TOKEN) {
    console.error("UW_API_TOKEN not set — exiting");
    process.exit(1);
  }
  const expiry = nextTradingDayISO();
  console.log(
    `Probing UW for ${TICKER} — filter probes use expiry=${expiry} (next trading day)`,
  );

  // Per-expiration aggregate, mirroring /spot-exposures/strike naming.
  await probe(`/api/stock/${TICKER}/spot-exposures/expiry`);
  await sleep(PROBE_DELAY_MS);

  // Strike endpoint filtered to a single expiry (two param-name guesses).
  await probe(`/api/stock/${TICKER}/spot-exposures/strike?expiry=${expiry}`);
  await sleep(PROBE_DELAY_MS);
  await probe(`/api/stock/${TICKER}/spot-exposures/strike?expiration=${expiry}`);
  await sleep(PROBE_DELAY_MS);

  // Cross-section endpoints, if they exist.
  await probe(`/api/stock/${TICKER}/spot-exposures/strike-expiry`);
  await sleep(PROBE_DELAY_MS);
  await probe(`/api/stock/${TICKER}/spot-exposures`);
  await sleep(PROBE_DELAY_MS);

  // Raw chain — would let us aggregate per (strike, expiry) ourselves.
  await probe(`/api/stock/${TICKER}/option-contracts`);
  await sleep(PROBE_DELAY_MS);
  await probe(`/api/stock/${TICKER}/option-contracts?expiry=${expiry}`);
  await sleep(PROBE_DELAY_MS);
  await probe(`/api/stock/${TICKER}/options-volume`);

  console.log("\n──────── done ────────");
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
