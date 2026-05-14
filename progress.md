# Champagne Sessions — Build Progress

Last updated: 2026-05-14
Current `main` head: **`fd141b9`** (Vercel + Railway auto-deploy on push)

> Product was rebranded from "FlowDesk" → "Champagne Sessions" (commit `bbecffb`, late April). Repo path is still `flowdesk/`, GitHub remote is still `github.com/buddybear8/flowdesk`. Every user-facing string says Champagne Sessions; backend names and file paths were intentionally not churned.

---

## Deployment status

| Surface | Status | Notes |
|---|---|---|
| GitHub repo | ✅ Live | `github.com/buddybear8/flowdesk` |
| Vercel (Next.js app) | ✅ Live, auto-deploys on push to `main` | Domain: `flowdesk-puce.vercel.app` |
| Railway plan | ✅ **Pro** | $20/mo minimum-usage |
| Railway Postgres | ✅ Live, 5 GB volume | v1.3 schema migration applied 2026-05-06 |
| Railway worker (`flowdesk`) | ✅ Live, auto-deploys | **11 cron schedules** — Polygon dark-pool ingest live; UW dark-pool retired (2026-05-13); `pollGex` extended to write per-(strike × expiry) heatmap rows (2026-05-14) |
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
- ⬜ `market_tide_bars.spyPrice` is stored as `0` ([worker/src/jobs/uw.ts:609](worker/src/jobs/uw.ts#L609) TODO)

### 4. Options GEX (`/gex`) — PRD §4
- ✅ GEX bar chart by strike (net OI + net DV overlaid)
- ✅ **Ticker selector — 11 tickers** (`fd141b9`): SPY, SPX, QQQ, TSLA, NVDA, AMD, META, AMZN, GOOGL, NFLX, MSFT. 200ms inter-call spacing keeps total `pollGex` work ~20s of the 60s window.
- ✅ Key levels panel (call wall, put wall, gamma flip, max pain, spot)
- ✅ Gamma regime indicator
- ✅ **Live data** via worker `pollGex` (60s market hours, 5m off-hours per ticker)
- ✅ **Centered strikes**, **split-fetch for lopsided UW chains**, **spot price line on chart**, **real OI + DV in Details panel** (all shipped pre-2026-05-11)
- ✅ **Heatmap sub-tab** (2026-05-14) — strike × expiration matrix, 5 nearest expirations × full strike chain. Sqrt-scaled green/red bg ramp + orange max-abs standout. 60s polling client-side, tab-visibility pause, freshness pill. New `gex_heatmap_snapshots` table + `/api/gex/heatmap` route. Replaces the originally-scoped "By expiry" sub-tab.
  - **Data source: UW `/api/stock/{t}/spot-exposures/expiry-strike?expirations[]=…`** (the one endpoint that actually filters per-expiry; the `/spot-exposures/strike?expiry=…` form silently ignores its filter and returns the aggregated chain — shipped that by mistake in `fd141b9`, fixed in the follow-up commit).
  - Dynamic expiration discovery via `/api/stock/{t}/greek-exposure/expiry` (returns every active expiration with `dte`). Worker takes the 5 lowest-DTE entries per ticker per minute. The static M/W/F/FRIDAY/DAILY calendar in `worker/src/lib/option-expirations.ts` is **retained but no longer consumed** — UW is the source of truth.
  - Param encoding gotcha: `expirations[]=` repeated. `expirations=…&expirations=…` (no brackets) keeps only the last value (UW quirk).
  - Cell values auto-suffix as K/M/B in the view (previous `K`-only formatter rendered `$2.15B` as `$2,154,135K`).
- ✅ **Sub-tabs trimmed** (2026-05-14) — removed `By strike`, `By expiry`, `Vanna & charm`, `Key levels` placeholder tabs that shipped in `fd141b9`. Module now has just `GEX overview` + `Heatmap`.
- ⚠️ Greek switcher (Vanna/Charm) **removed from V1** (UW Basic tier doesn't expose those endpoints)
- ⬜ AI explanation modal — pre-computed daily by `ai-summarizer-gex` cron at 07:00 ET; wiring to a modal UI pending
- ⚠️ **OI/DV magnitudes are ~1.6× UW's reported values** — tracked, not blocking

### 5. Flow Alerts (`/flow`) — PRD §5
- ✅ Live feed table — time, ticker, type, side, exec, contract, strike, expiry, size, OI, premium, spot, confidence
- ✅ Filter panel, stats bar
- ✅ **Live data** via worker `pollFlowAlerts` (30s market hours, 5m off-hours)
- ✅ **Lottos** preset tab (`pollLottoAlerts`)
- ✅ **Opening Sweeps** preset tab (`pollSweeperAlerts`)

### 6. Dark Pools (`/darkpool`) — PRD §3.5 — **REPLATFORMED 2026-05-12..05-13**

The UW dark-pool ingest is **retired**. Polygon is now the sole source of truth for `dark_pool_prints`. The historical corpus was re-pulled without the FINRA TRF filter so lit-exchange large blocks are captured alongside dark prints — the original "$2.5B max" gap vs Volume Leaders is closed (TSLA #1 now $7.8B, AAPL #1 now $26.4B).

- ✅ Ranked feed table — time (12-hour, with year), ticker, price (**2 decimals**, cents), size, premium (**B-suffix for ≥$1B**), all-time rank, percentile
- ✅ Filter panel — **"Only ranked prints" defaults ON** (`646efbf`); ETF / intraday / regular / extended-hours toggles; **ticker filter is a `<select>` dropdown of 229 tracked tickers** (`646efbf`) — was a free-text input
- ✅ Sort by time / rank / premium
- ✅ Stats bar — Prints / Total premium (B-suffix) / Top rank
- ✅ **`lib/tracked-tickers.ts`** — 229 ticker constant, generated from `worker/src/lib/ticker-thresholds.json`. Single source of truth for the dropdown.

**Polygon historical corpus (2023-01-01 → 2026-05-04) — re-pulled 2026-05-12:**
- Pull script: `~/polygon-pull-project/pull.py` + `filter_top200.py` + `build_thresholds.py` + `ticker_thresholds.json`
- Per-ticker pre-filter: notional ≥ 50th-largest historical dark-pool trade for that ticker (computed once from the old `polygon-dark-pool/` corpus). Bounded the unfiltered pull from ~80M trades/day down to ~150 survivors/day across 229 tickers.
- Dedup by `(price, size)` keeping earliest `sip_timestamp` — collapses same-trade-different-condition-code prints and cross-day re-reports.
- Output: `s3://polygon-dark-pool-stefan-760944857401-us-east-1-an/polygon-blocks/<TICKER>/<YYYY-MM-DD>.parquet` (60,811 daily files) + `<TICKER>/top200.parquet` (229 ranked files)
- EC2 cost: ~$16 total (12h on c6i.8xlarge on-demand across pull + 3 filter passes; spot would've been ~$7)
- Old prefix `polygon-dark-pool/` preserved in S3 as rollback artifact (can delete when comfortable)

**Cutover (2026-05-13):**
- `DELETE FROM dark_pool_prints WHERE uw_id IS NULL OR uw_id NOT LIKE 'polygon:%'` → 855,814 UW rows + 188 stragglers (from the 2-min cutover-window race with the still-running `pollDarkPool`) wiped
- Railway env var flipped: `DARKPOOL_S3_PREFIX = polygon-blocks/`
- Smoke import: 37,807 polygon top-200 rows loaded across 229 tickers
- Spot-check: TSLA #1 = **$7.80B** (was $2.54B), AAPL #1 = **$26.44B**, NVDA #1 = **$13.91B**, SPY #1 = **$4.45B** — every top-10 entry across the corpus is a quarterly-expiry closing-auction mega-block

**New ingest pipeline (commit `a7af755`, hot-fix `c783aac`):**
- `worker/src/jobs/polygon-daily-flatfile.ts` (cron `0 0 6 * * 1-5`) — streams previous trading day's Polygon flat file (`us_stocks_sip/trades_v1/...csv.gz`) from `files.massive.com` via `forcePathStyle: true`, applies inline ticker+threshold pre-filter during stream (memory bounded), buffers survivors (~hundreds), dedups by `(price, size)`, inserts via `createMany skipDuplicates`, reranks affected tickers.
- `worker/src/jobs/polygon-hourly-intraday.ts` (cron `0 0 10-17 * * 1-5`) — REST polls Polygon `/v3/trades/{ticker}?timestamp.gte=<cursor>` for each of 229 tickers (concurrency=8) using `POLYGON_API_KEY`. Cursor = max(`executed_at`) per ticker, capped at `now − 24h` so a multi-day cursor gap (first run after a backfill) doesn't try to pull weeks of data via REST.
- Shared lib `worker/src/lib/polygon-trade-filter.ts` — `TICKER_SET`, `THRESHOLDS`, `passesPreFilter(row)`, `filterAndMap(rows)`. Used by both jobs.
- `worker/src/lib/polygon-flatfile.ts` — S3 streaming (`S3 GetObject → zlib.gunzip → csv-parser`).
- `worker/src/lib/polygon-rest.ts` — REST client with pagination, retry/backoff, 50K limit per page, MAX_PAGES_PER_TICKER=20.
- `worker/src/lib/ticker-thresholds.json` — static asset, 229 entries, shipped with the worker.
- **Polygon $79/month Stocks Starter tier** covers flat files + WebSockets + REST. **15-min delay floor** applies to everything (no real-time at this tier). With hourly polling: ~75 min max latency from trade execution to DB row.

**One-shot scripts (`worker/src/script-*.ts`):**
- `script-delete-uw-history.ts` — `DELETE WHERE uw_id NOT LIKE 'polygon:%'`. Used during cutover.
- `script-backfill-polygon.ts <start> <end>` — wraps the daily-flatfile job for an inclusive date range, skipping weekends.
- `script-smoke-flatfile.ts <YYYY-MM-DD>` — dry-run (no inserts); reports filter/dedup stats per day. Used to validate the pipeline against 2026-05-04 before deploy.

**Backfill state (completed 2026-05-14 ~01:03 ET):**
- 2026-05-05 ✅ 158 inserts
- 2026-05-06 ✅ 12 inserts
- 2026-05-07 ✅ 19 inserts
- 2026-05-08 ✅ 18 inserts
- 2026-05-11 ✅ 37 inserts
- 2026-05-12 ✅ 41 inserts
- Skipped-row ratios (e.g. 12/206 for 2026-05-06) are the cross-day trade-id collision signature — see "known issue" below. Reload after fixing `uwId` scheme will recapture the dropped rows.

**Known issue: cross-day trade-id collision** — Polygon's per-day trade IDs (`id`) reset every day or cycle through small ranges. Our `uw_id = polygon:<ticker>:<id>` scheme assumes globally unique IDs per ticker; in practice the same `id` shows up on different dates and `createMany skipDuplicates` drops the new day's trade as a "duplicate." Symptom: backfill inserts are smaller than expected (e.g., 12 of 206 candidates for 2026-05-06). The top-200 ranking is still computed correctly off whatever lands, but the historical corpus may be ~30% sparser than ideal. **Follow-up: switch to `polygon:<ticker>:<YYYY-MM-DD>:<id>` and reload the corpus.** Not blocking.

---

## Infrastructure & Data Layer

| Item | Status | Notes |
|---|---|---|
| Prisma schema (V1-active models) | ✅ Complete | `FlowAlert`, `GexSnapshot`, **`GexHeatmapSnapshot`** (added 2026-05-14, migration `20260514051312_add_gex_heatmap_snapshots`), `MarketTideBar`, `NetImpactDaily`, `DarkPoolPrint`, `User`, `Account`, `Session`, `VerificationToken`, `TickerMetadata`, `HitListDaily`, `WatchesCriteria`, `AiSummary` |
| Live UW API integration | ✅ Live | `UW_API_TOKEN` set in Railway worker. Used by flow / lotto / sweeper / GEX (incl. heatmap per-expiry) / market-tide. **No longer used for dark pool.** |
| Live Anthropic (AI summaries) | ✅ Live | `ai-summarizer-gex` cron at 07:00 ET writes to `ai_summaries` |
| **Polygon dark-pool ingest** | ✅ **LIVE — daily + hourly** | `polygon-daily-flatfile` + `polygon-hourly-intraday` (replaces UW dark-pool poll and the old `s3-darkpool-import` stub) |
| **Dark-pool rerank** | ✅ Live | Per-ticker top-200 by notional. Called per ticker after each insert pass. |
| Retention sweeps | ✅ Live | 60-day flow / **perpetual-ranked + 30d-unranked** DP / 30-day GEX heatmap at 03:00 ET Mon–Fri. (`gex_snapshots` itself still has no sweep — pre-existing gap.) |
| `refresh-ticker-metadata` daily job | ✅ Live | 05:30 ET |
| `hit-list-compute` daily job | ⚠️ Live but no upstream | Cron runs at 07:30 ET; waits on the ML model |

**`dark_pool_prints` state at time of writing (2026-05-13 ~23:00 ET):**
- Only `uw_id LIKE 'polygon:%'` rows remain (all UW data wiped during the 2026-05-13 cutover).
- **229 distinct tickers** (the corpus universe; UW's long-tail 5K+ tickers are gone)
- ~38K rows baseline + backfill additions (still trickling in)
- Coverage: 2023-01-01 → 2026-05-05 ✓, 2026-05-06..05-12 in progress, 2026-05-13+ flows via hourly + daily Polygon jobs going forward

---

## Auth (Phase F, shipped 2026-05-06; refinements 2026-05-12..13)

| Item | Status | Notes |
|---|---|---|
| Auth.js v5 (`next-auth@5.0.0-beta.31`) | ✅ Installed | Plus `@auth/prisma-adapter@2.11.2` |
| Whop OIDC provider | ✅ Wired | `issuer: https://api.whop.com`; PKCE + state + nonce checks |
| Custom Whop App + access pass | ✅ Created | `prod_kcPrE6qVHJbp1` (free) |
| `signIn` callback access check | ✅ Live | Plus **hub admin override** (`fc19765`) — hub admins always pass regardless of pass holdings |
| User upsert on sign-in | ✅ Live | Explicit upsert in `signIn` callback populates `users` table |
| Session strategy | JWT | `maxAge: 30 days`; cookie-only so the proxy can run edge-safe |
| `proxy.ts` | ✅ Live | Edge-safe gate; `/api/*` → 401 JSON; pages → `/login?from=` |
| AccessDenied page | ✅ Branded + CTA (`92bcf55`) | Includes "Join free product" CTA for users without the pass |
| **Whop iframe pivot** | ❌ Reverted (`e94a682`) | Phase 2/3 scaffolded iframe SDK + auth gate (`859e07d`, `7e59e71`); reverted because PrismaAdapter conflicted with the cookie-less iframe session. Reverted to JWT/cookie-only baseline. |
| Sign-out UI button | ⬜ TODO | Phase F polish — not blocking |

---

## Community Performance — NEW MODULE (sidebar)

- **Community Gains** sidebar entry shipped 2026-05-12 (`c9d3d4b`, `5c223be`). Interactive chart module. (Implementation details out of scope for this snapshot — was independent work in a parallel session.)

---

## UI / UX polish

| Item | Status | Notes |
|---|---|---|
| Sidebar logo (`public/logo.png`) | ✅ Live | Champagne bottle + chart on navy |
| Topbar "Market open/closed" badge | ✅ Real | ET wallclock; Mon–Fri 09:30–16:00 ET; re-checks every 60s |
| US market holiday calendar | ⬜ TODO | Punch-list item |
| Dark Pools time format | ✅ 12-hour with year | `MM/DD/YYYY h:MM:SS AM/PM`; still UTC — local-zone conversion is a separate change if needed |
| Dark Pools price column | ✅ 2 decimals (`79dc7f8`) | Was 4 decimals |
| Dark Pools premium column | ✅ B-suffix for ≥$1B (`d42bcb8`) | Was `$1000M` etc. |
| Dark Pools ticker filter | ✅ `<select>` dropdown (`646efbf`) | Was free-text input |
| Dark Pools "Only ranked" default | ✅ ON (`646efbf`) | Was OFF |

---

## Next priorities (in order)

1. **Fix `uwId` cross-day collision for backfill completeness** — change scheme to `polygon:<ticker>:<YYYY-MM-DD>:<id>` and re-run filter_top200 + reload to recapture rows that were over-dedup'd by the current `polygon:<ticker>:<id>` form. Small TS change + a manual rerun. After this lands the corpus is genuinely complete back to 2023-01-01.
2. **Verify first market-hours GEX heatmap polls (2026-05-14 09:30 ET onwards)** — confirm all 11 tickers populate the new `gex_heatmap_snapshots` table cleanly; spot-check that AMD's 5 Friday-only expirations all return data and the M/W/F tickers don't return empty rows on Tue/Thu (the wrong-cadence fallback was assumed safe, but unverified in live conditions).
3. **Tighten Polygon intraday cadence if needed** — currently hourly during 10-17 ET = ~75 min worst-case delay. Bumping to every-15-min gives ~30 min max. One-line cron change (`0 */15 10-17 * * 1-5`). Same code; same Polygon entitlement.
4. **(Stretch) WebSocket trades subscription** — Polygon $79 tier includes it. Gives sub-second push within the 15-min delay floor. Adds a long-running stateful service (more code, more failure modes) but cleanest UX. Defer unless 15-min cadence falls short in practice.
5. **TradingView embedded charts** — separate workstream. Use Polygon WebSocket Aggregates (`A.<ticker>` minute bars) — NOT Trades — to feed bars to TradingView's realtime callback. Currently no chart embed in the app; this is net-new feature work.
6. **Daily Watches data pipeline** — wait on the ML model to produce rows for `hit_list_daily`. Swap `app/(modules)/watches/page.tsx` body back to `<WatchesView />` when ready.
7. **GEX AI explanation modal** — frontend wiring of cached summaries.
8. **GEX Heatmap follow-ups** — (a) add a netOI/netDV toggle to the view (payload already carries both); (b) US holiday calendar so the per-expiry calls don't 404 on closed days; (c) `gex_snapshots` retention sweep (pre-existing gap, surfaced when adding heatmap retention).
9. **Remaining secondary tab views** — Watches Criteria config, GEX By strike / Key levels, Dark Pools DP levels.
10. **Phase F polish** — sign-out button + Sidebar user menu; periodic access-pass re-check cron.
11. **US holiday calendar** for the Market open/closed badge.
12. **GEX OI/DV magnitude reconciliation** — standard-contract filter so totals align with UW's reported aggregates.
13. **Same-day hit-list rebuild** on `POST /api/admin/criteria`.
14. **UW 429 throttling on flow polls** — port the GEX 200ms inter-call sleep pattern.

---

## Known issues / polish

- **Polygon trade-id collision across days** — see Dark Pools section. Causes backfill skipped-counts to be artificially high. Fix in priorities #1.
- **Connection-pool saturation during concurrent backfill + worker + diagnostics** — Postgres default pool is small; running long-running local scripts alongside a live worker can saturate. Mitigation: use a single shared PrismaClient and avoid importing modules that instantiate their own clients (e.g., don't `import { rerankDarkPool }` in a script — inline the SQL instead).
- **2-minute cutover-window race** (resolved) — between local DELETE and Railway redeploy, the still-running `pollDarkPool` re-inserted ~188 UW rows. Cleanup script ran successfully. Future cutovers should remove the cron registration first, then deploy, then delete — not the reverse.
- **Pre-redeploy NULL rows** in `flow_alerts` — alerts captured before the 2026-05-06 worker redeploy don't have v1.3 fields. Roll out of the 24h window naturally.
- **UW 429 throttling** on `/flow` polls (occasional, self-recovers).
- **Dark Pools time** is rendered from UTC ISO. Probably wants ET. One-line change to `formatTime` in `DarkpoolView.tsx`.

---

## Backend Services & Railway

### Railway project

| Item | Value |
|---|---|
| Project name | `flowdesk-production` |
| Workspace | `buddybear8's Projects` |
| Plan | **Pro** |
| Environment | `production` |
| Project ID | `09aba296-5461-4a0e-8a2d-ebfce3d9d4a6` |
| Services | Postgres (5 GB volume) + `flowdesk` (worker) |
| CLI | Railway CLI 4.43.0, logged in as `buddybear7531@gmail.com`; local repo linked to `flowdesk` service |

### Env vars

**Railway → flowdesk (worker) → Variables**:
- `UW_API_TOKEN` ✅ (still used by flow/lotto/sweeper/GEX/market-tide)
- `TZ=America/New_York` ✅
- `NODE_OPTIONS=--dns-result-order=ipv4first` ✅
- `DATABASE_URL` ✅ (internal reference)
- `ANTHROPIC_API_KEY` ✅
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-1` ✅ (`polygon-pull-user` IAM — read of our own bucket)
- `DARKPOOL_S3_BUCKET=polygon-dark-pool-stefan-760944857401-us-east-1-an` ✅
- `DARKPOOL_S3_PREFIX=polygon-blocks/` ✅ (flipped 2026-05-13 from `polygon-dark-pool/`)
- `POLYGON_ACCESS_KEY` ✅ (NEW 2026-05-13 — Polygon's S3 flat-file creds)
- `POLYGON_SECRET_KEY` ✅ (NEW 2026-05-13)
- `POLYGON_API_KEY` ✅ (NEW 2026-05-13 — Polygon REST `/v3/trades` auth)
- `POLYGON_ENDPOINT` ⬜ optional — code defaults to `https://files.massive.com`

**Vercel → flowdesk → Environment Variables**:
- `DATABASE_URL` ✅ (Railway public URL)
- `AUTH_SECRET`, `AUTH_URL`, `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_ACCESS_PASS_ID` ✅

### Worker cron schedule (11 schedules)

```
*/30 * 9-15    * * 1-5   uw-poll-mkt           pollFlowAlerts + pollLottoAlerts + pollSweeperAlerts
0 */5 0-8,16-23 * * 1-5  uw-poll-off           same, slower cadence
*/60 *  9-15   * * 1-5   gex-poll              pollGex
0 */5  9-15    * * 1-5   market-tide           pollMarketTide
30 */5 9-15    * * 1-5   net-impact            computeNetImpact
0 30 5         * * 1-5   refresh-ticker-metadata
0 0  7         * * 1-5   ai-summarizer-gex
0 30 7         * * 1-5   hit-list-compute      (waiting on ML upstream)
0 0  3         * * 1-5   retention-sweeps      (flow + DP, perpetual-ranked rule)
0 0  6         * * 1-5   polygon-daily-flatfile   (NEW 2026-05-13 — replaces s3-darkpool-import)
0 0  10-17     * * 1-5   polygon-hourly-intraday  (NEW 2026-05-13)
```

**Removed 2026-05-13:** `pollDarkPool` (was part of `uw-poll-mkt` and `uw-poll-off`); `s3-darkpool-import` cron entry (file kept for reference but no longer scheduled).

### Ops scripts (worker/src/*)

- `smoke-uw.ts` — fires every UW poll once
- `smoke-gex.ts` — fires `pollGex` once + verifies each ticker has a fresh `gex_heatmap_snapshots` row (NEW 2026-05-14)
- `smoke-uw-heatmap-probe.ts` — one-shot diagnostic that picked the per-expiry endpoint (`/spot-exposures/strike?expiry=`); kept as a reference for future UW endpoint surveys (NEW 2026-05-14)
- `smoke-darkpool-import.ts` — fires the legacy `importDarkpoolHistory` (top200.parquet load); useful only if reloading the historical corpus from S3
- `script-smoke-flatfile.ts <YYYY-MM-DD>` — dry-run smoke for `polygon-daily-flatfile`
- `script-backfill-polygon.ts <start> <end>` — runs the daily job for a date range
- `script-delete-uw-history.ts` — destructive UW cleanup
- `rerank-all.ts` — sequential rerank across every ticker (recovery tool)

All runnable via `railway run` or directly with `DATABASE_URL=$PUBLIC_DB npx tsx src/<script>.ts` after sourcing `.env`.

---

## AWS / EC2 (historical artifacts only)

- AMI `polygon-pull-setup` (`ami-08a4fe1bdb5a38b37`) preserved in us-east-1 for future re-pulls.
- S3 bucket `polygon-dark-pool-stefan-760944857401-us-east-1-an` holds both `polygon-dark-pool/` (rollback) and `polygon-blocks/` (live) prefixes.
- IAM role `polygon-pull-ec2-role`, security group `polygon-pull-sg`, key pair `polygon-pull-key` all retained.
- No running EC2 instances. Two orphan instances terminated 2026-05-12 (one was ours from the re-pull, one was an unidentified stray).

---

## Prompt for a fresh context window

```
I was building software with you in another context window and hit
the limit. Read progress.md first — it's the canonical state snapshot
(dated 2026-05-14, on commit fd141b9). Use docs/FlowDesk_PRD.md and
docs/ARCHITECTURE.md as the spec when you need to verify anything.

Don't trust progress.md blindly for any code references — verify
against the actual files and git log before recommending or building
on them.

Branding: "Champagne Sessions". Repo path is still flowdesk/, GitHub
remote is github.com/buddybear8/flowdesk, every user-facing string
says Champagne Sessions.

Live deploy: Vercel auto-deploys frontend on push to main; Railway
worker auto-deploys too. Railway is on the Pro plan; Postgres volume
is 5 GB.

Recent major work:

(2026-05-12..05-13) Dark pool was replatformed from UW polling to
Polygon-only. Historical corpus re-pulled without the FINRA TRF
filter (lit-exchange blocks included), deduped, loaded into Postgres.
Two new worker jobs ingest going forward:
  - polygon-daily-flatfile (06:00 ET)
  - polygon-hourly-intraday (hourly 10-17 ET)
UW dark-pool retired (cron unregistered, 856K UW rows deleted).
229 tickers in `dark_pool_prints`, all uw_id LIKE 'polygon:%'.
Backfill of 2026-05-05..05-12 completed 2026-05-14 ~01:03 ET.

(2026-05-14) GEX Heatmap shipped. New `gex_heatmap_snapshots` table
+ `/api/gex/heatmap` route + Heatmap sub-tab on /gex. Ticker list
expanded from 5 to 11: SPY, SPX, QQQ, TSLA, NVDA, AMD, META, AMZN,
GOOGL, NFLX, MSFT. Strike bands: 10% indices, 15% megacaps, 20% AMD,
25% high-beta. Client polls every 60s with tab-visibility pause.

Endpoint correction (same day): `fd141b9` shipped with
/spot-exposures/strike?expiry=<date> which silently ignores its
filter — every expiration column was identical. Fixed by switching
to /spot-exposures/expiry-strike?expirations[]=<dates> (the bracket
form is mandatory; bare `expirations=` keeps only the last value).
Worker also dropped the static M/W/F/FRIDAY/DAILY calendar in
favor of UW's /greek-exposure/expiry which lists all active expiries
per ticker — take the 5 lowest-DTE.

Placeholder tabs (By strike / By expiry / Vanna & charm / Key levels)
that shipped in fd141b9 were removed in the same follow-up commit.

Known follow-up (priority #1): Polygon trade IDs collide across days,
so the current uwId scheme `polygon:<ticker>:<id>` over-dedups. Fix
is to switch to `polygon:<ticker>:<YYYY-MM-DD>:<id>` and reload.

Once you're caught up, summarize where things stand and what's next,
and wait for me to pick a thread.
```
