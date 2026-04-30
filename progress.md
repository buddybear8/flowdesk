# FlowDesk — Build Progress

Last updated: 2026-04-29

---

## Deployment

| Target | Status | Notes |
|--------|--------|-------|
| GitHub repo | ✅ Live | github.com/buddybear8/flowdesk |
| Vercel deployment | ✅ Live | Auto-deploys on push to `main` |
| Environment config | ✅ Done | `USE_MOCK_DATA=true` set in Vercel |
| Database (Prisma/PostgreSQL) | ⬜ Not connected | Schema defined; no live DB wired for demo |

---

## Modules

### 1. Daily Watches (`/watches`) — PRD §1
- ✅ Hit list table with rank, ticker, price, direction, confidence, premium, contract
- ✅ Detail panel (right pane) — thesis, contracts, sector peers, related theme
- ✅ Sort by rank / premium / confidence
- ✅ Session meta strip (date, overall sentiment, total premium, call/put ratio, lead sector)
- ✅ Sector flow sidebar
- ✅ Mock data (`lib/mock/watches-data.ts`)
- ⬜ Criteria config tab (tab exists in topbar, view not built)
- ⬜ Live data — UW "daily watches" hit-list endpoint not wired

### 2. Sentiment Tracker (`/sentiment`) — PRD §2
- ✅ Overview tab — overall sentiment score, bull/bear/neutral breakdown, top velocity movers
- ✅ Divergence alerts (price vs. sentiment direction mismatch)
- ✅ Sector sentiment breakdown
- ✅ New entrants & sentiment flips list
- ✅ Notable posts feed (safe rendering via `renderPostBody`, XSS fix applied)
- ✅ AI summary card
- ✅ Analyst intelligence tab — analyst profiles, accuracy leaderboard, top buys/sells
- ✅ Mock data (`lib/mock/sentiment-data.ts`)
- ⬜ Live data — xAI/X sentiment pipeline not wired
- ⬜ Live data — AI summaries (Anthropic API) not wired

### 3. Market Pulse (`/market-tide`) — PRD §3
- ✅ Market Tide line chart — SPY price (gold) + net call premium (green) + net put premium (red), 5-min buckets
- ✅ Top Net Impact horizontal bar chart — 20 tickers ranked by net options premium
- ✅ Stats strip — SPY price, volume, net call/put premium totals
- ✅ Period toggle UI (1H / 4H / 1D)
- ✅ Mock data mirroring UW Market Tide screen (`lib/mock/market-tide-data.ts`)
- ⬜ Period toggle wired to API (currently UI-only; mock returns same data regardless)
- ⬜ Live data — UW `market-tide` and `net-impact` endpoints not wired

### 4. Options GEX (`/gex`) — PRD §4
- ✅ GEX bar chart by strike (net OI + net DV overlaid)
- ✅ Ticker selector (SPY, QQQ, SPX, NVDA, TSLA)
- ✅ Key levels panel (call wall, put wall, gamma flip, max pain, spot)
- ✅ Gamma regime indicator (Positive / Negative)
- ✅ Show/hide OI and DV series toggles
- ✅ Mock data (`lib/mock/gex-data.ts`)
- ⚠️ Greek switcher (GEX / Vanna / Charm) — **removed from V1** (v1.2.1 decision; UW Basic tier doesn't expose Vanna/Charm endpoints; returns post-V1)
- ⬜ AI explanation modal — pre-computed daily in 07:00 ET batch with static-as-of-market-open header note (PRD §8); not yet wired
- ⬜ By strike / By expiry / Vanna & charm / Key levels tabs (topbar tabs defined, views not built)
- ⬜ Live data — UW GEX endpoint not wired

### 5. Flow Alerts (`/flow`) — PRD §5
- ✅ Live feed table — time, ticker, type, side, exec, contract, strike, expiry, size, OI, premium, spot, confidence
- ✅ Filter panel — type, side, sentiment, exec type, premium threshold, confidence, rule, ticker, sweep-only toggle, DTE
- ✅ Sort by time / premium / size
- ✅ Stats bar — alert count, call/put split, total premium
- ✅ Mock data (`lib/mock/flow-alerts.ts`)
- ⬜ Sweep scanner / 0DTE flow / Unusual activity tabs (defined in topbar, views not built)
- ⬜ Live data — UW flow endpoint not wired

### 6. Dark Pools (`/darkpool`) — PRD §3.5
- ✅ Ranked feed table — time, ticker, price, size, premium, volume, ETF flag, extended-hours flag, all-time rank, percentile
- ✅ Filter panel — rank range, ETF toggle, regular/extended hours toggles, ticker search
- ✅ Sort by time / rank / premium
- ✅ Mock data (`lib/mock/dark-pool-prints.ts`)
- ⬜ DP levels tab (defined in topbar, view not built)
- ⬜ Live data — UW `/api/darkpool/recent` + `/api/darkpool/{ticker}` not wired
- ⬜ Historical DP backfill — Polygon-sourced files land in S3 (extraction handled in a separate workstream); `worker/src/jobs/import-darkpool-history.ts` to consume them and write to `dark_pool_prints`

---

## Infrastructure & Data Layer

| Item | Status | Notes |
|------|--------|-------|
| Prisma schema | ⚠️ Partial | Has `DarkPoolPrint`, `WatchesCriteria`, `SentimentSnapshot`, `AiSummary`. Per ARCHITECTURE §3 still need: `FlowAlert`, `GexSnapshot`, `MarketTideBar`, `NetImpactDaily`, `XPost`, `AnalystProfile` |
| Database migrations | ⬜ Not run | `npx prisma migrate deploy` needed against Railway Postgres once schema is complete |
| `USE_MOCK_DATA` flag | ✅ Wired | All 6 API routes check this env var before hitting live sources |
| Live UW API integration | ⬜ Not started | Token placeholder in `.env.local` |
| Live X API v2 integration | ⬜ Not started | `X_BEARER_TOKEN` placeholder in `.env.local` (xAI Grok dropped in v1.2.1) |
| Live Anthropic (AI summaries) | ⬜ Not started | Key placeholder in `.env.local` |
| S3 → Postgres dark-pool history import | ⬜ Not started | Polygon extraction is a separate workstream; this codebase only consumes S3 files via `import-darkpool-history.ts` |
| Retention sweeps (60d flow / 30d DP except top-100 perpetual) | ⬜ Not started | Two cron sweeps to add at 03:00 ET (PRD §3.5 / ARCHITECTURE §2.1) |

---

## Backend Services & Railway (added 2026-04-28)

### Railway project

| Item | Value |
|------|-------|
| Project name | `flowdesk-production` |
| Workspace | `buddybear8's Projects` |
| Environment | `production` (default; no staging yet) |
| Project ID | `09aba296-5461-4a0e-8a2d-ebfce3d9d4a6` |
| Dashboard | https://railway.com/project/09aba296-5461-4a0e-8a2d-ebfce3d9d4a6 |
| Services attached | None yet |
| CLI | Railway CLI 4.43.0, logged in as `buddybear7531@gmail.com`; local repo linked |

### Repo scaffolding

```
services/
  websocket-server/   src/index.ts (stub), package.json, tsconfig.json, Dockerfile
  data-ingestion/     src/index.ts (stub), package.json, tsconfig.json, Dockerfile
lambdas/
  sentiment-batch/index.ts   (export async handler() stub)
  dp-ranking/index.ts        (export async handler() stub)
  hitlist-compute/index.ts   (export async handler() stub)
scripts/
  backfill-darkpool.ts       (main()/process.exit stub)
```

| Item | Status | Notes |
|------|--------|-------|
| `services/websocket-server/` scaffolding | ✅ Created | Deps: `@clerk/backend`, `ioredis`, `ws` (per spec) |
| `services/data-ingestion/` scaffolding | ✅ Created | Deps: `ioredis`, `pg` — placeholders, revisit |
| Both `tsconfig.json` | ✅ Created | ES2022 / CommonJS / strict |
| Both `Dockerfile` | ✅ Created | 2-stage Node 20-alpine; ws-server EXPOSE 8080 |
| `lambdas/*/index.ts` | ✅ Created | Plain `export async function handler()` — not AWS-Lambda-typed |
| `scripts/backfill-darkpool.ts` | ✅ Created | Stub only |
| Root monorepo wiring (workspaces / turbo) | ⬜ Not set up | Each service has its own `package.json` |
| `npm install` inside services | ⬜ Not run | Will run during Docker build |

### Placeholder choices to revisit

- **`data-ingestion` deps** (`ioredis` + `pg`) are guesses — real set depends on which providers it pulls (Polygon SDK? Finnhub? UW?).
- **Lambda handler shape** is plain async fn. If these run on AWS Lambda, signatures need `APIGatewayEvent`/`Context` types.
- **`websocket-server` Dockerfile EXPOSEs 8080** but `src/index.ts` doesn't read `process.env.PORT` yet — Railway injects PORT and the server must bind to it.
- **TS target ES2022/CommonJS** — switch to ESM if the rest of the stack expects it.

### Open questions

- **Single worker vs multi-service architecture** — ARCHITECTURE.md specs a single Node + node-cron worker; the `services/` and `lambdas/` scaffolding here imply a multi-service Clerk/Redis/WS design. Pick one before live-data work proceeds. Recommendation: single worker (UW has no push channel; Clerk overkill for single-user). If single worker wins, `lambdas/sentiment-batch` and `lambdas/hitlist-compute` move into `worker/src/jobs/`; `services/websocket-server` and `services/data-ingestion` get deleted; `lambdas/dp-ranking` and `scripts/backfill-darkpool.ts` stay (they're the Polygon-sourced S3 import path that runs out-of-band).
- Does the Next.js app stay on Vercel or move to Railway too? Recommendation: stay on Vercel.

---

## Security

| Item | Status |
|------|--------|
| `.env.local` excluded from git | ✅ |
| XSS — `dangerouslySetInnerHTML` removed | ✅ Fixed 2026-04-22 |
| Security headers (HSTS, X-Frame-Options, etc.) | ✅ Added 2026-04-22 |
| Input validation on all API routes | ✅ Added 2026-04-22 |
| API authentication | ⬜ Not implemented — needed before live data |
| Dependency upgrades (Prisma 5→7, Tailwind 3→4) | ⬜ Deferred — breaking changes |

---

## What's Left Before Live Data

1. **Resolve open architecture question** — single worker vs multi-service (see Open questions above).
2. **Add the 6 missing Prisma models** — `FlowAlert`, `GexSnapshot`, `MarketTideBar`, `NetImpactDaily`, `XPost`, `AnalystProfile` per ARCHITECTURE §3.
3. **Create Railway Postgres service** and run `npx prisma migrate deploy`.
4. **Set environment variables in Railway worker + Vercel** — `UW_API_TOKEN`, `X_BEARER_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `TZ=America/New_York`, plus AWS S3 vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DARKPOOL_S3_BUCKET`, `DARKPOOL_S3_PREFIX`) for the historical DP import. Vercel only needs `DATABASE_URL` (public URL) + `USE_MOCK_DATA=false` + `NEXT_PUBLIC_APP_URL`.
5. **Stand up the worker** with `node-cron` schedules per ARCHITECTURE §6 — UW polling (flow / GEX / DP / market tide), Net Impact aggregation, X-batch (06:00 ET), AI-summary batch (07:00 ET, sentiment + per-ticker GEX explanations), retention sweeps (03:00 ET), S3 dark-pool history import (02:00 ET).
6. **Implement retention enforcement** — 60-day flow sweep, conditional 30-day DP sweep that preserves top-100 ranked rows in perpetuity.
7. **Replace mock branches** in each `route.ts` with Prisma reads.
8. **Add authentication to API routes** before flipping `USE_MOCK_DATA=false`.
9. **Build secondary tab views** — Criteria config, Sweep scanner, 0DTE flow, Unusual activity, DP levels.
10. **Wire the Market Pulse period toggle** to the UW `market-tide` interval param.
11. **Confirm Top Net Impact source with UW** — preferred is a UW endpoint exposing the bid/ask formula directly (PRD §11); fallback is worker-side aggregation.
12. **Lock the AI summary prompt template** before the first 07:00 ET batch run.
