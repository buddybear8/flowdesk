# Champagne Sessions — Build Progress

Last updated: 2026-05-11
Current `main` head: **`ea57ab8`** (Vercel + Railway auto-deploy on push)

> Product was rebranded from "FlowDesk" → "Champagne Sessions" (commit `bbecffb`, late April). Repo path is still `flowdesk/`, GitHub remote is still `github.com/buddybear8/flowdesk`. Every user-facing string says Champagne Sessions; backend names and file paths were intentionally not churned.

---

## Deployment status

| Surface | Status | Notes |
|---|---|---|
| GitHub repo | ✅ Live | `github.com/buddybear8/flowdesk` |
| Vercel (Next.js app) | ✅ Live, auto-deploys on push to `main` | Domain: `flowdesk-puce.vercel.app` |
| Railway plan | ✅ **Pro** (upgraded 2026-05-11 after disk-full incident) | $20/mo minimum-usage |
| Railway Postgres | ✅ Live | v1.3 schema migration applied 2026-05-06; volume grown to **5 GB** 2026-05-11 after the Polygon backfill saturated the original 500 MB volume mid-WAL-replay |
| Railway worker (`flowdesk`) | ✅ Live, auto-deploys | 10 cron schedules — all live including `s3-darkpool-import` (no longer a stub) |
| Auth (Whop OAuth via Auth.js v5) | ✅ Live | All `/api/*` routes 401 without a session; page routes redirect to `/login` |

---

## Modules (V1 active)

### 1. Daily Watches (`/watches`) — PRD §1
- ✅ Hit list table with rank, ticker, price, direction, confidence, premium, contract (`WatchesView.tsx`)
- ✅ Detail panel (right pane) — thesis, contracts, sector peers, related theme
- ✅ Sort by rank / premium / confidence
- ✅ Session meta strip + sector flow sidebar
- ⏸ **"Coming Soon" placeholder** active in `app/(modules)/watches/page.tsx` (2026-05-10). Full UI in `WatchesView.tsx` is preserved and ready — one-line swap when the upstream ML model is producing rows. Comment in `page.tsx` documents the swap path.
- ⬜ Criteria config tab (tab exists in topbar, view not built)
- ⬜ Live data — upstream ML model still in development (separate workstream, user-owned)

### 2. Sentiment Tracker (`/sentiment`) — 🗄 ARCHIVED in v1.2.3
- 🗄 Archived from V1 scope (Apr 30, 2026) due to X API Basic ($100/mo) cost. Module remains in repo (route, page, mock data, component, types) for future reactivation. Sidebar entry hidden. See PRD §7 archive banner for reactivation steps.

### 3. Market Pulse (`/market-tide`) — PRD §3
- ✅ Market Tide line chart — SPY price + net call/put premium, 5-min buckets
- ✅ Top Net Impact horizontal bar chart — 20 tickers ranked by net options premium
- ✅ Stats strip
- ✅ Period toggle UI (1H / 4H / 1D)
- ✅ **Live data** via worker `pollMarketTide` + `computeNetImpact` jobs
- ⬜ Period toggle wired to API param (currently UI-only)
- ⬜ `market_tide_bars.spyPrice` is stored as `0` ([worker/src/jobs/uw.ts:609](worker/src/jobs/uw.ts#L609) TODO) — UW's market-tide endpoint doesn't return SPY price; Polygon could fill this if/when we wire a Polygon spot client

### 4. Options GEX (`/gex`) — PRD §4
- ✅ GEX bar chart by strike (net OI + net DV overlaid)
- ✅ Ticker selector (SPY, QQQ, SPX, NVDA, TSLA) — 200ms inter-call spacing to dodge UW rate limit
- ✅ Key levels panel (call wall, put wall, gamma flip, max pain, spot)
- ✅ Gamma regime indicator
- ✅ **Live data** via worker `pollGex` (60s market hours, 5m off-hours per ticker)
- ✅ **Centered strikes** — chart anchors on spot with N/2 below + N/2 above via `pickStrikesCentered` (lib/utils.ts). Applied at API and chart layers (`59627f3`).
- ✅ **Split-fetch for lopsided UW chains** — when UW's `/spot-exposures/strike` returns a 50-row chain that isn't centered around spot, the worker issues two bounded requests (above-spot ±5%, below-spot ±5%) so each side gets its own 50-strike quota from UW (`e1666e5`, tightened to ±5% in `b74f0d4`). This dodges UW's top-by-gamma selection bias that previously returned all-deep-ITM strikes for SPY/SPX.
- ✅ **Spot price line on chart** (`af31119`) — inline Chart.js plugin draws a dashed teal horizontal line interpolated between the two strikes that bracket spot, labeled `Spot $X.XX`. Hidden when spot falls outside the visible strike range.
- ✅ **Real OI + Directionalized Volume in Details panel** (`28dcc3c`) — previously the right rail showed hardcoded `$18.06B` / `35,723` from `lib/mock/gex-data.ts`. Now reads `data.netGexOI` / `data.netGexDV` from the API and derives `Net Gamma Exposure` (shares) as `dollarGamma / (spot² × 0.01)`.
- ⚠️ Greek switcher (Vanna/Charm) **removed from V1** (UW Basic tier doesn't expose those endpoints)
- ⬜ AI explanation modal — pre-computed daily by `ai-summarizer-gex` cron at 07:00 ET; wiring to a modal UI pending
- ⬜ By strike / By expiry / Key levels secondary tabs (topbar tabs defined, views not built)
- ⚠️ **OI/DV magnitudes are ~1.6× UW's reported values** — our worker sums every strike in the chain; UW filters to standard front-month contracts before aggregating. Reconciling requires either intersecting with a contract-list endpoint or applying a strike-distance threshold. Tracked, not blocking.

### 5. Flow Alerts (`/flow`) — PRD §5
- ✅ Live feed table — time, ticker, type, side, exec, contract, strike, expiry, size, OI, premium, spot, confidence
- ✅ Filter panel — type, side, sentiment, exec type, premium threshold, confidence, rule, ticker, sweep-only toggle, DTE
- ✅ Stats bar — alert count, call/put split, total premium
- ✅ **Live data** via worker `pollFlowAlerts` (30s market hours, 5m off-hours)
- ✅ **Lottos** preset tab (`pollLottoAlerts` worker job; gold sidebar banner; only user knob is "Exactly at ask")
- ✅ **Opening Sweeps** preset tab (`pollSweeperAlerts` worker job; no user knobs)

### 6. Dark Pools (`/darkpool`) — PRD §3.5
- ✅ Ranked feed table — time (12-hour, with year), ticker, price, size, premium, ETF flag, extended-hours flag, all-time rank, percentile (`ea57ab8` dropped the misleading Volume column)
- ✅ Filter panel — **"Only ranked prints" toggle** (was rank min/max inputs); ETF / intraday / regular / extended-hours toggles; ticker search (now server-side, refetch on change)
- ✅ Sort by time / rank / premium
- ✅ Stats bar — Prints / Total premium / Top rank (Volume stat dropped — was double-counting)
- ✅ **Live UW polls** via worker `pollDarkPool` (30s market hours)
- ✅ **Polygon historical backfill** loaded (`e18426c`) — 229 tickers × ~195 rows = **44,664 rows** in `dark_pool_prints` with `uwId = polygon:<TICKER>:<id>`. Coverage 2023-01-01..2026-05-04, FINRA TRF only (`trf_id != 0`).
- ✅ **Rolling re-rank** (`worker/src/lib/rerank-darkpool.ts`) — called from `pollDarkPool` after each insert, scoped to tickers that received new rows. Per-ticker SQL: top 200 by `price × size` DESC get rank 1..200, rest get `rank = NULL`. New UW prints that break into the corpus auto-promote.
- ✅ **Perpetual-ranked retention** (`80d8737`) — `runDpRetentionSweep` keeps every row with `rank IS NOT NULL` forever; deletes `rank IS NULL AND executedAt < 30d ago`.
- ✅ **"Only ranked prints" UI toggle** (`3938f7b`) — when ON, API filters to rank 1..100 and orders by rank ASC; when OFF, live feed by time DESC. Ticker filter is server-side so a TSLA search pulls TSLA's full top-100 historical corpus regardless of recency window.
- ⚠️ **Polygon corpus is dark-pool only** (FINRA TRF). Volume Leaders includes lit-exchange large blocks too, so our "top trade" notionals are smaller than VL's (~2× gap for TSLA: our $2.5B max vs VL's $4.5B+). **Next workstream: re-pull Polygon without the `trf_id` filter** — see `~/polygon-pull-project/resume.md` for the task brief.
- ⬜ DP levels tab (defined in topbar, view not built)

---

## Infrastructure & Data Layer

| Item | Status | Notes |
|---|---|---|
| Prisma schema (V1-active models) | ✅ Complete | `FlowAlert`, `GexSnapshot`, `MarketTideBar`, `NetImpactDaily`, `DarkPoolPrint`, `User`, `Account`, `Session`, `VerificationToken`, `TickerMetadata`, `HitListDaily`, `WatchesCriteria`, `AiSummary` |
| Database migrations | ✅ Applied | All migrations run on Railway Postgres |
| Live UW API integration | ✅ Live | `UW_API_TOKEN` set in Railway worker; polling jobs live |
| Live Anthropic (AI summaries) | ✅ Live | `ai-summarizer-gex` cron at 07:00 ET writes to `ai_summaries` |
| **S3 → Postgres dark-pool import** | ✅ **LIVE** (was stub) | Reads Polygon top-200 corpus from `s3://polygon-dark-pool-stefan-760944857401-us-east-1-an/polygon-dark-pool/<TICKER>/top200.parquet`; idempotent re-runs are no-ops via `skipDuplicates` + insert-count-gated rerank |
| **Dark-pool rerank** | ✅ Live | Per-ticker top-200 by notional, called from `pollDarkPool` after each insert |
| Retention sweeps | ✅ Live | 60-day flow / **perpetual-ranked + 30d-unranked** DP at 03:00 ET Mon–Fri |
| `refresh-ticker-metadata` daily job | ✅ Live | 05:30 ET |
| `hit-list-compute` daily job | ⚠️ Live but no upstream | Cron runs at 07:30 ET; waits on the ML model |

**Current `dark_pool_prints` state (2026-05-11):**
- 627,851 total rows / 256 MB
- 5,672 distinct tickers (229 Polygon + ~5,443 UW-only)
- 183,670 ranked rows
- 44,664 Polygon rows (a handful of tickers are 1–5 rows short of 200; remainder is tickers whose all-time top-200 had <200 unique large prints)

---

## Auth (Phase F, shipped 2026-05-06)

| Item | Status | Notes |
|---|---|---|
| Auth.js v5 (`next-auth@5.0.0-beta.31`) | ✅ Installed | Plus `@auth/prisma-adapter@2.11.2` |
| Whop OIDC provider | ✅ Wired | `issuer: https://api.whop.com`; PKCE + state + nonce checks |
| Custom Whop App | ✅ Created | "Champagne Sessions Intelligence"; `oauth:token_exchange` enabled |
| Whop access pass | ✅ Created | `prod_kcPrE6qVHJbp1` (free) |
| `signIn` callback access check | ✅ Live | Hits `GET https://api.whop.com/api/v1/users/{sub}/access/{passId}` |
| User upsert on sign-in | ✅ Live | Explicit upsert in `signIn` callback populates `users` table |
| Session strategy | JWT | `maxAge: 30 days`; cookie-only so the proxy can run edge-safe |
| `proxy.ts` | ✅ Live | Edge-safe gate; `/api/*` → 401 JSON; pages → `/login?from=` |
| Env vars (Vercel + local) | ✅ Set | `AUTH_SECRET`, `AUTH_URL`, `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_ACCESS_PASS_ID` |
| Sign-out UI button | ⬜ TODO | Phase F polish — not blocking |

---

## UI / UX polish

| Item | Status | Notes |
|---|---|---|
| Sidebar logo (`public/logo.png`) | ✅ Live | Champagne bottle + chart on navy |
| Sidebar Account section | ❌ Removed 2026-05-09 | Watchlists + Alerts entries deleted; matching dead Topbar entries removed |
| Topbar "Market open/closed" badge | ✅ Real | ET wallclock; Mon–Fri 09:30–16:00 ET; re-checks every 60s |
| US market holiday calendar | ⬜ TODO | Punch-list item; holidays still show "open" if they fall on a weekday inside the window |
| Dark Pools time format | ✅ 12-hour with year (`ea57ab8`) | `MM/DD/YYYY h:MM:SS AM/PM`; still UTC — local-zone conversion is a separate change if needed |

---

## Security

| Item | Status | Notes |
|---|---|---|
| `.env.local` excluded from git | ✅ | |
| XSS — `dangerouslySetInnerHTML` removed | ✅ | Fixed 2026-04-22 |
| Security headers (HSTS, X-Frame-Options) | ✅ | Added 2026-04-22 |
| Input validation on all API routes | ✅ | Added 2026-04-22 |
| API authentication (Auth.js v5 + Whop OAuth) | ✅ Live 2026-05-06 | |
| Dependency upgrades (Prisma 5→7, Tailwind 3→4) | ⬜ Deferred | Breaking changes; revisit post-V1 |

---

## Next priorities (in order)

1. **Polygon historical re-pull without `trf_id` filter** (active workstream — see `~/polygon-pull-project/resume.md`). Parallel pull on a c6i.8xlarge with 8 workers; ~12 hours, ~$15 on-demand. After the rerun, the worker's `s3-darkpool-import` job picks up the wider corpus on its next nightly cron and the rerank handles the rest.
2. **Daily Polygon flat-file ingest worker** — new TS cron (~1 day of work) that pulls yesterday's `<YYYY-MM-DD>.csv.gz` from Polygon S3, stream-parses, filters to our ticker list + size threshold, inserts via `createMany({ skipDuplicates: true })`, calls `rerankDarkPool` for affected tickers. Runs on the existing Railway worker (cost = $0 marginal). Lands after the historical re-pull validates.
3. **Daily Watches data pipeline** — wait on the ML model to produce rows for `hit_list_daily`. Swap `app/(modules)/watches/page.tsx` body back to `<WatchesView />` when ready.
4. **GEX AI explanation modal** — frontend wiring of cached summaries already produced by `ai-summarizer-gex`.
5. **Secondary tab views** — Watches Criteria config, GEX By strike / By expiry / Key levels, Dark Pools DP levels.
6. **Phase F polish** — sign-out button + Sidebar user menu; periodic access-pass re-check cron.
7. **US holiday calendar** for the Market open/closed badge.
8. **GEX OI/DV magnitude reconciliation** — apply standard-contract filter (or strike-distance bound) so our totals align with UW's reported aggregates. Currently ~1.6× over.
9. **Same-day hit-list rebuild** on `POST /api/admin/criteria` — extract `computeHitList()` to a shared module.
10. **UW 429 throttling on flow + DP polls** — port the GEX 200ms inter-call sleep pattern.

---

## Known issues / polish

- **Polygon corpus is dark-pool only** — the active workstream above fixes this; until then, "top trades" in `/darkpool` only reflect FINRA TRF prints, not lit-exchange blocks.
- **Pre-redeploy NULL rows** in `flow_alerts` — alerts captured before the 2026-05-06 worker redeploy don't have v1.3 fields. Roll out of the 24h window naturally.
- **UW 429 throttling** on `/flow` and `/darkpool` polls (occasional, self-recovers).
- **Dark Pools time** is rendered from UTC ISO. Probably wants ET. One-line change to `formatTime` in `DarkpoolView.tsx`.
- **Mock data files** (`lib/mock/*-data.ts`) are dormant. Worth a sweep post-V1.

---

## Backend Services & Railway

### Railway project

| Item | Value |
|---|---|
| Project name | `flowdesk-production` |
| Workspace | `buddybear8's Projects` |
| Plan | **Pro** (upgraded 2026-05-11) |
| Environment | `production` |
| Project ID | `09aba296-5461-4a0e-8a2d-ebfce3d9d4a6` |
| Services | Postgres (5 GB volume) + `flowdesk` (worker) |
| CLI | Railway CLI 4.43.0, logged in as `buddybear7531@gmail.com`; local repo linked to `flowdesk` service |

### Env vars

**Railway → flowdesk (worker) → Variables**:
- `UW_API_TOKEN` ✅
- `TZ=America/New_York` ✅
- `NODE_OPTIONS=--dns-result-order=ipv4first` ✅
- `DATABASE_URL` ✅ (internal reference)
- `ANTHROPIC_API_KEY` ✅
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1` ✅ (set 2026-05-11; `polygon-pull-user` IAM)
- `DARKPOOL_S3_BUCKET=polygon-dark-pool-stefan-760944857401-us-east-1-an` ✅
- `DARKPOOL_S3_PREFIX=polygon-dark-pool/` ✅

**Vercel → flowdesk → Environment Variables**:
- `DATABASE_URL` ✅ (Railway public URL)
- `AUTH_SECRET`, `AUTH_URL`, `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_ACCESS_PASS_ID` ✅

### Worker cron schedule

```
*/30 * 9-15  * * 1-5   uw-poll-mkt        pollFlowAlerts + pollLottoAlerts + pollSweeperAlerts + pollDarkPool
0 */5 0-8,16-23 * * 1-5  uw-poll-off       same as above, slower cadence
*/60  * 9-15  * * 1-5   gex-poll           pollGex (200ms inter-ticker spacing + split-fetch when lopsided)
0 */5 9-15   * * 1-5   market-tide        pollMarketTide
30 */5 9-15  * * 1-5   net-impact         computeNetImpact
0 30 5  * * 1-5         refresh-ticker-metadata
0 0  7  * * 1-5         ai-summarizer-gex
0 30 7  * * 1-5         hit-list-compute   (waiting on ML upstream)
0 0  3  * * 1-5         retention-sweeps   (flow + DP, new perpetual-ranked rule)
0 0  2  * * 1-5         s3-darkpool-import (idempotent re-runs; no-op once corpus loaded)
```

### Ops scripts (worker/src/*)

- `smoke-uw.ts` — fires every UW poll once
- `smoke-gex.ts` — fires `pollGex` once
- `smoke-darkpool-import.ts` — fires `importDarkpoolHistory` once
- `rerank-all.ts` — sequential rerank across every ticker in `dark_pool_prints` (recovery tool)

All four run via `railway run --service flowdesk -- bash -c "DATABASE_URL='<public-url>' npx tsx src/<script>.ts"`.

---

## Prompt for a fresh context window

```
I was building software with you in another context window and hit
the limit. Read progress.md first — it's the canonical state snapshot
(dated 2026-05-11, on commit ea57ab8). Use docs/FlowDesk_PRD.md and
docs/ARCHITECTURE.md as the spec when you need to verify anything.

Don't trust progress.md blindly for any code references — verify
against the actual files and git log before recommending or building
on them.

Branding: the project is "Champagne Sessions". Repo path is still
flowdesk/, GitHub remote is still github.com/buddybear8/flowdesk,
but every user-facing string says Champagne Sessions.

Live deploy: Vercel auto-deploys frontend on push to main; Railway
worker auto-deploys too. Railway is on the Pro plan now (upgraded
2026-05-11 after a disk-full incident during the initial Polygon
dark-pool backfill — Postgres volume grown to 5 GB).

Active workstream: re-pulling the Polygon dark-pool corpus without
the FINRA TRF filter so we capture lit-exchange large blocks too.
See ~/polygon-pull-project/resume.md for that task's brief.

Once you're caught up, summarize where things stand and what's
next, and wait for me to pick a thread.
```
