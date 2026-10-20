// lib/live-server.ts — tiny HTTP endpoint on the worker serving the live
// forming 1m bar per ticker (built from Polygon's per-second stream held in
// memory by jobs/polygon-stream.ts). The GEX Chart front end polls this
// directly (browser → Railway domain, CORS open: prices are public data and
// 1s polling must not fan through Vercel functions).
//
//   GET /live?ticker=SPY → { ticker, forming, recent, lastEventAt, asOf }
//   GET /health          → ok
//
// Listens on 8787 — the Railway service domain is bound to that port
// explicitly (railway domain --port 8787), so we do NOT follow Railway's
// injected $PORT. LIVE_PORT overrides for local runs.

import { createServer } from "node:http";
import { liveSnapshot } from "../jobs/polygon-stream.js";
import { WATCHED_TICKERS } from "./watched-tickers.js";

const ts = () => new Date().toISOString();
const VALID = new Set<string>(WATCHED_TICKERS);

export function startLiveServer(): void {
  const port = Number(process.env.LIVE_PORT ?? 8787);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    };
    if (url.pathname === "/health") {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/live") {
      const ticker = (url.searchParams.get("ticker") ?? "").toUpperCase();
      if (!VALID.has(ticker)) {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ error: "unknown ticker" }));
        return;
      }
      const snap = liveSnapshot(ticker);
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ticker, ...snap, asOf: Date.now() }));
      return;
    }
    res.writeHead(404, headers);
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, () => console.log(`[live-server] ${ts()} listening on :${port}`));
}
