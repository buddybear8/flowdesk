# Champagne Sessions — Build Progress

Last updated: 2026-05-10
Current `main` head: **`f383db6`** (Vercel + Railway auto-deploy on push)

> Product was rebranded from "FlowDesk" → "Champagne Sessions" (commit `bbecffb`, late April). Repo path is still `flowdesk/`, GitHub remote is still `github.com/buddybear8/flowdesk`. Every user-facing string says Champagne Sessions; backend names and file paths were intentionally not churned.

---

## Deployment status

| Surface | Status | Notes |
|---|---|---|
| GitHub repo | ✅ Live | `github.com/buddybear8/flowdesk` |
| Vercel (Next.js app) | ✅ Live, auto-deploys on push to `main` | Domain: `flowdesk-puce.vercel.app` |
| Railway Postgres | ✅ Live | v1.3 schema migration applied 2026-05-06 (`ask_prem`, `bid_prem`, `all_opening`, `issue_type`, `has_floor`, `has_single_leg`) |
| Railway worker (`flowdesk-worker`) | ✅ Live, auto-deploys | 11 cron schedules (1 stub: `s3-darkpool-import`); includes `pollFlowAlerts`, `pollLottoAlerts`, `pollSweeperAlerts` |
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
- 🚫 Live data — X API + sentiment AI summary pipeline deferred from V1

### 3. Market Pulse (`/market-tide`) — PRD §3
- ✅ Market Tide line chart — SPY price + net call/put premium, 5-min buckets
- ✅ Top Net Impact horizontal bar chart — 20 tickers ranked by net options premium
- ✅ Stats strip
- ✅ Period toggle UI (1H / 4H / 1D)
- ✅ **Live data** via worker `pollMarketTide` + `computeNetImpact` jobs
- ✅ UW source attribution dropped from user-facing copy (2026-05-06)
- ⬜ Period toggle wired to API param (currently UI-only)

### 4. Options GEX (`/gex`) — PRD §4
- ✅ GEX bar chart by strike (net OI + net DV overlaid)
- ✅ Ticker selector (SPY, QQQ, SPX, NVDA, TSLA) — 200ms inter-call spacing to dodge UW rate limit
- ✅ Key levels panel (call wall, put wall, gamma flip, max pain, spot)
- ✅ Gamma regime indicator
- ✅ Bounded retry when UW returns far-from-spot chains (`min_strike`/`max_strike` fallback)
- ✅ **Live data** via worker `pollGex` (60s market hours, 10m off-hours per ticker)
- ✅ UW source attribution dropped from user-facing copy
- ⚠️ Greek switcher (Vanna/Charm) **removed from V1** (UW Basic tier doesn't expose those endpoints)
- ⬜ AI explanation modal — pre-computed daily by `ai-summarizer-gex` cron at 07:00 ET; wiring to a modal UI pending
- ⬜ By strike / By expiry / Key levels secondary tabs (topbar tabs defined, views not built)

### 5. Flow Alerts (`/flow`) — PRD §5
- ✅ Live feed table — time, ticker, type, side, exec, contract, strike, expiry, size, OI, premium, spot, confidence
- ✅ Filter panel — type, side, sentiment, exec type, premium threshold, confidence, rule, ticker, sweep-only toggle, DTE
- ✅ Stats bar — alert count, call/put split, total premium
- ✅ **Live data** via worker `pollFlowAlerts` (30s market hours, 5m off-hours)
- ✅ **Lottos** preset tab (2026-05-06) — backend-locked WHERE; dedicated `pollLottoAlerts` worker job; "Exactly at ask" client toggle is the only user-facing knob; sidebar shows gold-bordered "Custom Champagne Room Lotto Flow Filters Applied" banner
- ✅ **Opening Sweeps** preset tab (2026-05-07) — same backend-locked pattern; dedicated `pollSweeperAlerts` worker job; sidebar shows "Custom Champagne Room Opening Sweeper Filters Applied" banner; no user-facing knobs
- ❌ 0DTE flow and Unusual activity tabs **removed 2026-05-07** (both were placeholder tabs falling back to FlowView; will re-add when distinct views exist)

### 6. Dark Pools (`/darkpool`) — PRD §3.5
- ✅ Ranked feed table — time, ticker, price, size, premium, volume, ETF flag, extended-hours flag, all-time rank, percentile
- ✅ Filter panel — rank range, ETF toggle, regular/extended hours toggles, ticker search
- ✅ Sort by time / rank / premium
- ✅ Stats bar
- ✅ **Live data** via worker `pollDarkPool` (30s market hours)
- ⬜ DP levels tab (defined in topbar, view not built)
- ⬜ Historical DP backfill — `s3-darkpool-import` is a documented stub waiting on AWS env vars + the upstream Polygon extraction pipeline (separate workstream)

---

## Infrastructure & Data Layer

| Item | Status | Notes |
|---|---|---|
| Prisma schema (V1-active models) | ✅ Complete | `FlowAlert` (with v1.3 fields), `GexSnapshot`, `MarketTideBar`, `NetImpactDaily`, `DarkPoolPrint`, `User`, `Account`, `Session`, `VerificationToken`, `TickerMetadata`, `HitListDaily`, `WatchesCriteria`, `AiSummary` |
| Database migrations | ✅ Applied | All migrations run on Railway Postgres |
| Live UW API integration | ✅ Live | `UW_API_TOKEN` set in Railway worker; 5 polling jobs live |
| Live Anthropic (AI summaries) | ✅ Live | `ai-summarizer-gex` cron at 07:00 ET writes to `ai_summaries` (GEX explanations only — sentiment workload archived) |
| Live X API | 🗄 Archived in v1.2.3 | |
| S3 → Postgres dark-pool history import | ⏸ Stub | `s3-darkpool-import` waits on AWS env vars + upstream Polygon pipeline |
| Retention sweeps | ✅ Live | 60-day flow / conditional 30-day DP (top-100 perpetual) at 03:00 ET Mon–Fri |
| `refresh-ticker-metadata` daily job | ✅ Live | 05:30 ET |
| `hit-list-compute` daily job | ⚠️ Live but no upstream | Cron runs at 07:30 ET; waits on the ML model to produce inputs for `hit_list_daily` |
| Sector enum + `ticker_metadata` table | ✅ Live | |

---

## Auth (Phase F, shipped 2026-05-06)

| Item | Status | Notes |
|---|---|---|
| Auth.js v5 (`next-auth@5.0.0-beta.31`) | ✅ Installed | Plus `@auth/prisma-adapter@2.11.2` |
| Whop OIDC provider | ✅ Wired | `issuer: https://api.whop.com`; PKCE + state + nonce checks (Whop strictly enforces nonce) |
| Custom Whop App | ✅ Created | App: "Champagne Sessions Intelligence" in Whop developer dashboard; `oauth:token_exchange` permission enabled; client_secret regenerated after permission grant |
| Whop access pass | ✅ Created | Auto-created free pass `prod_kcPrE6qVHJbp1` ("Champagne Sessions Intelligence" — same name as the App) |
| `signIn` callback access check | ✅ Live | Hits `GET https://api.whop.com/api/v1/users/{sub}/access/{passId}` with Bearer token; returns false if `has_access` is false |
| User upsert on sign-in | ✅ Live | PrismaAdapter silently no-ops under JWT strategy when User schema has required custom fields; explicit upsert in `signIn` callback populates `users` table and refreshes `lastLoginAt` + `membershipCheckedAt` |
| Session strategy | JWT | `maxAge: 30 days`; cookie-only so the proxy can run edge-safe |
| `proxy.ts` (was `middleware.ts`) | ✅ Live | Edge-safe; gates all requests. `/api/auth/*` passes through; `/api/*` returns 401 JSON; everything else redirects to `/login` with `?from=` param |
| `/login` page | ✅ Live | Centered Whop button + AccessDenied error banner; chrome-free (lives outside `(modules)` route group) |
| Type augmentation | ✅ Live | `next-auth.d.ts` extends User with `whopMembershipId` and Session with `user.id` |
| Env vars (Vercel + local) | ✅ Set | `AUTH_SECRET`, `AUTH_URL`, `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_ACCESS_PASS_ID` |
| Sign-out UI button | ⬜ TODO | Phase F polish — not blocking |
| `accounts` table population | ⬜ Not populated | PrismaAdapter's `linkAccount` doesn't fire under our flow. Not blocking V1 (we don't read Account anywhere). Revisit if account-linking features are added. |

**Smoke test on the live deploy (2026-05-06 / 2026-05-07):**
- Test 1 — Unauthenticated page request → redirects to `/login`: ✅
- Test 2 — Unauthenticated API request → 401 JSON: ✅
- Test 3 — Authenticated API request → returns data: ✅
- Test 4 — Signed-in user hitting `/login` → bounces to `/`: ✅
- Test 5 — `?from=` deep-link redirect after login: ✅
- Test 6 — User row written to Postgres on first sign-in: ✅ (after upsert added in `9766ebe`)
- Test 7 — Access pass enforcement (skipped, destructive)

---

## UI / UX polish

| Item | Status | Notes |
|---|---|---|
| Sidebar logo (`public/logo.png`) | ✅ Live | Champagne bottle + chart on navy |
| Sidebar Account section | ❌ Removed 2026-05-09 | Watchlists + Alerts entries deleted (linked to dead `/watchlists` and `/alerts` routes); matching dead entries removed from Topbar `MODULES` dict |
| Topbar "Market open/closed" badge | ✅ Real | Driven by ET wallclock; Mon–Fri 09:30–16:00 ET = green "Market open", else gray "Market closed"; re-checks every 60s; DST handled by Intl |
| US market holiday calendar | ⬜ TODO | Punch-list item; Thanksgiving/Christmas/etc. still show "open" if they fall on a weekday inside the window |
| UW source attribution | ❌ Removed 2026-05-06 | Dropped from Market Pulse pill, GEX subtitle, Sentiment legend |

---

## Security

| Item | Status | Notes |
|---|---|---|
| `.env.local` excluded from git | ✅ | |
| XSS — `dangerouslySetInnerHTML` removed | ✅ | Fixed 2026-04-22 |
| Security headers (HSTS, X-Frame-Options) | ✅ | Added 2026-04-22 |
| Input validation on all API routes | ✅ | Added 2026-04-22 |
| API authentication (Auth.js v5 + Whop OAuth) | ✅ Live 2026-05-06 | Phase F shipped — see Auth section above |
| Dependency upgrades (Prisma 5→7, Tailwind 3→4) | ⬜ Deferred | Breaking changes; revisit post-V1 |

---

## Next priorities (in order)

1. **Daily Watches data pipeline** — wait on the ML model to produce rows for `hit_list_daily`. Swap `app/(modules)/watches/page.tsx` body back to `<WatchesView />` when ready (one-line change; comment in file documents the path).
2. **GEX AI explanation modal** — frontend wiring of the cached AI summaries already produced by `ai-summarizer-gex`.
3. **Secondary tab views** — Watches Criteria config, GEX By strike / By expiry / Key levels, Dark Pools DP levels.
4. **Phase F polish** — sign-out button + Sidebar user menu; periodic access-pass re-check cron (using existing `membershipCheckedAt` field).
5. **US holiday calendar** for the Market open/closed badge + `priorTradingDay()` helpers.
6. **Same-day hit-list rebuild** on `POST /api/admin/criteria` — extract `computeHitList()` to a shared module so the Next.js root can import it cross-package.
7. **UW 429 throttling on flow + DP polls** — port the GEX 200ms inter-call sleep pattern. Recovers on next poll; small data loss, not urgent.
8. **`s3-darkpool-import`** — depends on AWS env vars + upstream Polygon extraction pipeline.
9. **Remove `/api/flow/lottos/debug`** (or gate behind a query secret) before broader rollout.

---

## Known data-quality issues (UW upstream, not our bugs)

UW's `/api/stock/{ticker}/spot-exposures/strike` is unreliable per ticker:

| Ticker | Behavior |
|---|---|
| **SPY** | Alternates between full near-money chains and pure deep-OTM dumps |
| **QQQ** | Always returns legacy non-standard strikes ($174–$310 when spot ~$691) |
| **NVDA** | Often returns far-from-spot strikes; bounded retry triggers and recovers ~36 near-spot strikes per poll |
| **TSLA** | Mix of near-money and deep-OTM LEAPS |
| **SPX** | Clean, full chains every poll |

Current handling: bounded retry in `pollGex` triggers when `<5` strikes land within ±10% of spot ([worker/src/jobs/uw.ts:273](worker/src/jobs/uw.ts#L273)). API band-aid still filters strikes to ±10% of spot before display.

---

## Other known issues / polish

- **Pre-redeploy NULL rows** in `flow_alerts` — alerts captured before the 2026-05-06 worker redeploy don't have v1.3 fields (`ask_prem`, `issue_type`, etc.). They roll out of the 24h window naturally and won't backfill. A `older_than=`-paginated backfill script is ~30 lines if a future schema migration adds more fields.
- **UW 429 throttling** on `/flow` and `/darkpool` polls (occasional, self-recovers next poll).
- **Light cream/lavender chip backgrounds** in Watches / Dark Pools / GEX details panel persist intentionally as champagne accents.
- **Mock data files** (`lib/mock/*-data.ts`) are dormant. `lib/mock/lotto-alerts.ts` is gated behind `?mock=1` as a preview tool. Worth a sweep to delete unused files post-V1.
- **Dark Pools rank chip** still shows `0` for unranked rows. Cosmetic — swap to "—".
- **Date helpers duplicated** between `worker/src/jobs/hit-list-compute.ts` and `app/api/watches/route.ts`. Extract once a cross-package import path exists.

---

## Backend Services & Railway

### Railway project

| Item | Value |
|---|---|
| Project name | `flowdesk-production` |
| Workspace | `buddybear8's Projects` |
| Environment | `production` |
| Project ID | `09aba296-5461-4a0e-8a2d-ebfce3d9d4a6` |
| Services | Postgres (live) + `flowdesk-worker` (live) |
| CLI | Railway CLI 4.43.0, logged in as `buddybear7531@gmail.com`; local repo linked |

### Env vars

**Railway → flowdesk-worker → Variables**:
- `UW_API_TOKEN` ✅
- `TZ=America/New_York` ✅
- `NODE_OPTIONS=--dns-result-order=ipv4first` ✅
- `DATABASE_URL` ✅ (internal reference)
- `ANTHROPIC_API_KEY` ✅
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DARKPOOL_S3_BUCKET`, `DARKPOOL_S3_PREFIX` — pending (`s3-darkpool-import` waits on these)

**Vercel → flowdesk → Environment Variables**:
- `DATABASE_URL` ✅ (Railway public URL)
- `AUTH_SECRET`, `AUTH_URL`, `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_ACCESS_PASS_ID` ✅

### Worker cron schedule

```
*/30 * 9-15  * * 1-5   uw-poll-mkt        pollFlowAlerts + pollLottoAlerts + pollSweeperAlerts + pollDarkPool
0 */5 0-8,16-23 * * 1-5  uw-poll-off       same as above, slower cadence
*/60  * 9-15  * * 1-5   gex-poll           pollGex (200ms inter-ticker spacing)
0 */5 9-15   * * 1-5   market-tide        pollMarketTide
30 */5 9-15  * * 1-5   net-impact         computeNetImpact
0 30 5  * * 1-5         refresh-ticker-metadata
0 0  7  * * 1-5         ai-summarizer-gex  (per-ticker GEX explanations; sentiment workload archived)
0 30 7  * * 1-5         hit-list-compute   (waiting on ML upstream)
0 0  3  * * 1-5         retention-sweeps   (flow + DP)
0 0  2  * * 1-5         s3-darkpool-import (stub — waits on AWS env vars)
```

---

## Prompt for a fresh context window

```
I was building software with you in another context window and hit
the limit. Read progress.md (canonical state snapshot, 2026-05-10),
then docs/FlowDesk_PRD.md and docs/ARCHITECTURE.md as the spec when
you need to verify anything.

Don't trust progress.md blindly for any code references — verify
against the actual files and git log before recommending or building
on them.

Branding: the project is "Champagne Sessions". Repo path is still
flowdesk/, GitHub remote is still github.com/buddybear8/flowdesk,
but every user-facing string says Champagne Sessions.

Live deploy: Vercel auto-deploys frontend on push to main; Railway
worker auto-deploys too. Auth is live (Phase F shipped 2026-05-06)
— every /api/* route requires a session; page routes redirect to
/login if unauthenticated.

Once you're caught up, summarize where things stand and what's
next, and wait for me to pick a thread.
```
