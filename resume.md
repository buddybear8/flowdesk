# Champagne Sessions — Session Resume

Last touched: **2026-05-06** (afternoon)
Current `main` head: **`e26ab15`** (pushed to origin, Vercel auto-deploys)
Use alongside [progress.md](progress.md) (older snapshot, 2026-04-30) and the canonical [docs/FlowDesk_PRD.md](docs/FlowDesk_PRD.md) + [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). This file captures the *delta* since the prior resume.md (head `5f915ca`) and the live state of the system after today's deploy work.

> **Branding note**: project is rebranded from "FlowDesk" to "Champagne Sessions" (commit `bbecffb`). The repo path is still `flowdesk/` and the GitHub remote is still `github.com/buddybear8/flowdesk`. Every user-facing string says Champagne Sessions; backend names and file paths intentionally weren't churned.

---

## What's running right now

| Surface | Status | Notes |
|---|---|---|
| Railway Postgres | ✅ Live | `prisma migrate deploy` ran today against `DATABASE_PUBLIC_URL` for `20260506051157_add_flow_alert_lotto_fields`. |
| Railway worker (`flowdesk-worker`) | ✅ Live, running `e26ab15` | 11 cron schedules wired (1 stub: `s3-darkpool-import`). Includes the new `pollLottoAlerts` job. |
| Vercel Next.js app | ✅ Live, auto-deploys on push | All 5 V1-active API routes serve live Postgres data. `/api/sentiment` returns 501. `/api/flow/lottos` and `/api/flow/lottos/debug` added today. |
| Auth (`/api/*` gate) | ❌ NOT WIRED | `/api/*` is publicly readable. **Top priority before any user-facing launch.** |

---

## What landed this session (commit summary, oldest first)

**Worker hardening:**
- `01b8533` — Space GEX ticker polls by 200ms to dodge UW's short-window rate limit
- `b8b8933` — GEX retry with `min_strike`/`max_strike` bounds when the unbounded chain dumps far from spot (fixes QQQ chronic empty-chart, also helps NVDA intermittently)

**Sidebar logo:**
- `02352fa` — Replace "CS" placeholder with `public/logo.png` (champagne bottle + chart, navy bg)

**Lottos tab — initial build:**
- `44ca763` — Flow Alerts gets a "Lottos" preset tab. Schema migration adds 6 nullable cols (`ask_prem`, `bid_prem`, `all_opening`, `issue_type`, `has_floor`, `has_single_leg`). Worker `mapFlowAlert` captures them; rebuilds `exec` derivation to actually set `FLOOR`. New `/api/flow/lottos` route with server-locked WHERE. `LottosView` wraps the same table chrome as `FlowView`. Tab order on `/flow` becomes `Live feed | Lottos | Sweep scanner | 0DTE flow | Unusual activity`.
- `e911aa9` — Design-review changes: criteria list **hidden** from sidebar (replaced with the gold-bordered banner *"Custom Champagne Room Lotto Flow Filters Applied"*). Side + Sentiment columns restored. Confidence column dropped. Premium color follows `sentiment` (BULLISH=green, BEARISH=red). New "Exactly at ask" toggle is the only user-facing knob; route accepts `?exact=1`. New `pollLottoAlerts` worker job hits UW with the criteria as server-side filters (`issue_types[]=Common Stock`, `max_dte=14`, `min_diff=0.2`, `max_diff=1.0`, `all_opening=true`, `vol_greater_oi=true`, `is_multi_leg=false`, `is_ask_side=true`, `min_premium=1000`). Mock data at `lib/mock/lotto-alerts.ts` gated behind `?mock=1`.

**Worker Dockerfile — three Railway build failures and fixes:**
- `6cb8764` — `npm install --omit=dev` was reusing a stale Railway cache layer with a partial node_modules (missing prisma's bin symlink). Switched to `npm ci --omit=dev`.
- `14a0baa` — Prisma 5's "auto-install on generate" walked up from `/app/prisma/schema.prisma` and stopped at `/app` with no package.json. Added a stub package.json at `/app/`.
- `9a2aeb3` — Stub silenced the warning but Prisma still tried to install itself because the stub didn't declare prisma as a dep. Added `prisma`/`@prisma/client` to stub `devDependencies` and set `ENV CI=true`.

**Vercel build fix:**
- `e65e0bc` — `app/(modules)/flow/page.tsx` used `useSearchParams()` at the top level without a `<Suspense>` boundary, blocking static prerender. Wrapped the inner content. *This was blocking ALL commits on the branch from deploying — the logo and Lottos tab didn't go live until this landed.*

**Lottos diagnosis & relaxation:**
- `5090bd4` — New `/api/flow/lottos/debug` endpoint (still in repo). Walks the WHERE clause one predicate at a time and returns row counts at each step plus a sample row dump. Use to verify the live filter is matching expected data.
- `6fc2f7c` — Two issues surfaced by debug: (1) UW's response field `all_opening_trades` is TRUE only when EVERY trade is opening — empirically ~0.4% of Common Stock alerts pass that bar even though pollLottoAlerts already filters server-side via UW's looser `all_opening=true` query param. **Dropped `all_opening = TRUE` from the WHERE.** (2) `populated_24h: 659 of 12,178 (5.4%)` — `createMany skipDuplicates` meant revisits never refreshed the v1.3 fields, so pre-redeploy rows stayed permanently NULL. **Switched `pollFlowAlerts` and `pollLottoAlerts` to per-row upsert** (Promise.all-batched, capped at the connection-pool limit, ~under-1s for 100-row batches).
- `40aaee8` — Updated debug endpoint to mirror the relaxed chain + added alt counts that drop `size > oi` and the OTM window separately so we can isolate which constraint is now dominant. Confirmed: OTM 20–100% is the new dominant cut (86 → 3 in 24h after relaxation).

**Market Pulse sign fix:**
- `e26ab15` — `app/api/market-tide/route.ts` was overriding UW's signed `net_put_premium` with `-Math.abs(...)` (left over from V1 mock convention). UW's actual API returns put premium as a signed value; UW's own Market Tide chart plots it that way (both lines can sit above or below zero independently). Dropped the flip. The data in our DB has always been correct — frontend-only fix.

---

## Live status of the Lottos tab

**Currently working** at https://flowdesk-puce.vercel.app/flow?tab=1 (or live domain). Filter chain confirmed via `/api/flow/lottos/debug`.

**Today's count is partial** because of a NULL-field artifact:
- 12,178 alerts in the last 24h
- Only ~1100 have v1.3 fields populated (alerts captured *after* the worker redeployed at ~15:00 ET)
- The other ~11,000 are pre-redeploy alerts with NULL `issue_type` etc. — they fell out of UW's "latest 100" rolling window before the upsert went live, so they'll never be backfilled via normal polling
- Of the populated subset, 3 alerts in the last 24h pass the full chain. Expected to climb to ~30–50/day starting tomorrow morning when the worker is the only thing writing.

**To recover this morning's lottos today** (optional): build `worker/scripts/backfill-flow-alerts.ts` that pages backward through UW's `/api/option-trades/flow-alerts` using `older_than=<ISO timestamp>`, runs each page through the same `mapFlowAlert`, and upserts. ~30 lines of script work. **Decided to defer**; tomorrow's data will roll forward naturally.

---

## What's stubbed vs live

**Live**:
- All 5 UW polling jobs (flow, DP, GEX, market-tide, net-impact) + the new `pollLottoAlerts` (6th)
- `refresh-ticker-metadata`, `ai-summarizer-gex`, `hit-list-compute`, retention sweeps
- All 5 V1-active API routes wired to Prisma + dark-themed UI
- `/api/flow/lottos` (preset Lottos route) + `/api/flow/lottos/debug` (diagnostic)

**Stubbed** (logs but does not act):
- `s3-darkpool-import` (02:00 ET) — waits on AWS env vars + the upstream Polygon extraction pipeline. See [worker/src/jobs/s3-darkpool-import.ts](worker/src/jobs/s3-darkpool-import.ts) header.

**Deferred from V1**:
- Same-day hit-list rebuild on `POST /api/admin/criteria` — `computeHitList()` lives in the worker package; Next.js root can't import it cross-package. Saving works; rebuild waits for next 07:30 ET cron.

---

## Env vars that need to stay set

**Railway → flowdesk-worker → Variables**:
- `UW_API_TOKEN` — set
- `TZ=America/New_York` — set
- `NODE_OPTIONS=--dns-result-order=ipv4first` — set
- `DATABASE_URL` — Reference to Postgres internal URL (auto-resolves)
- `ANTHROPIC_API_KEY` — set
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DARKPOOL_S3_BUCKET`, `DARKPOOL_S3_PREFIX` — pending. `s3-darkpool-import` waits on these.

**Vercel → flowdesk → Settings → Environment Variables**:
- `DATABASE_URL` — Railway's `DATABASE_PUBLIC_URL`

---

## Known data-quality issues (UW upstream, not our bugs)

UW's `/api/stock/{ticker}/spot-exposures/strike` is unreliable per ticker. Verified via worker diagnostic logs:

| Ticker | Behavior |
|---|---|
| **SPY** | Alternates between full near-money chains and pure deep-OTM dumps |
| **QQQ** | Always returns legacy non-standard strikes ($174–$310 when spot is ~$691) |
| **NVDA** | Often returns far-from-spot strikes; `bounded` retry now triggers and recovers ~36 near-spot strikes per poll |
| **TSLA** | Mix of near-money and deep-OTM LEAPS |
| **SPX** | Clean, full chains every poll |

Current handling: bounded retry in `pollGex` triggers when `<5` strikes land within ±10% of spot ([uw.ts](worker/src/jobs/uw.ts#L273)). API band-aid still filters strikes to ±10% of spot before display.

---

## Other known issues / polish items

1. **UW 429 throttling on `/flow` and `/darkpool` polls** (occasional, recovers next poll). Could add the same kind of inter-call sleep we have for GEX, but data loss is small and self-correcting.
2. **Light cream/lavender chip backgrounds** persist in Watches / Dark Pools / GEX details panel (`#FAEEDA`, `#F1EFE8`, `#EEEDFE`, `#FAECE7`). They read like champagne accents on navy and were left intentionally during the dark-theme rollout. Easy to swap if any feel out of place.
3. **Mock data files** (`lib/mock/*-data.ts`) are dormant. `lib/mock/lotto-alerts.ts` is gated behind `?mock=1` and stays in tree as a preview tool. Worth a sweep to delete unused mock files post-V1.
4. **Dark Pools rank chip** still shows `0` for unranked rows (live polls write NULL rank → API returns 0). Cosmetic — could swap to "—" for unranked.
5. **No US holiday calendar** in `hit-list-compute` and `priorTradingDay()` helpers.
6. **Date helpers duplicated** between `worker/src/jobs/hit-list-compute.ts` and `app/api/watches/route.ts`. Extract to shared lib once a cross-package import path exists.
7. **`/api/flow/lottos/debug` endpoint** is still in the repo. Useful for diagnosis; remove (or gate behind a query secret) before user-facing launch.
8. **Pre-redeploy NULL rows** in `flow_alerts` (~11,000 in last 24h as of now) won't backfill. They'll roll out of the 24h window naturally over the next day. If a future schema migration adds more fields, build the `older_than=` backfill script then.

---

## Next priorities (in order)

1. **Phase F — Auth.js v5 + Whop OAuth.** Gate every `/api/*` route with the 3-line `auth()` check. PRD §13 / ARCHITECTURE §6 phase F. Critical before exposing live data publicly. Auth.js DB tables (`User`, `Account`, `Session`, `VerificationToken`) already exist in `prisma/schema.prisma`. Whop dashboard setup needed first (free product/access pass, OAuth app, redirect URI = `<vercel-domain>/api/auth/callback/whop`).
2. **Build "Opening Sweepers" tab** — the second backend-locked preset the user signaled is coming. Same pattern as Lottos: schema is sufficient, route + view + worker poll job. Filters TBD.
3. **Build secondary tab views** — Criteria config, Sweep scanner, 0DTE flow, Unusual activity, DP levels.
4. **Same-day hit-list rebuild** — extract `computeHitList` to a shared module so the Next.js root can import it.
5. **UW 429 throttling on flow + dark pool polls** — same 200ms inter-call sleep pattern as GEX.
6. **(Optional) backfill script** — `older_than=` paginator for `flow_alerts` if a future field addition or data-recovery need surfaces.

---

## Quick verification recipes

**Lottos tab is live with current data**:
- Open `/api/flow/lottos/debug` — check `field_fill.populated_24h` (should keep climbing as upsert backfills) and `counts.8_+otm_window_20_100__final_route_count` (the number the UI will show)
- Open `/flow?tab=1` — should display matching rows

**Worker is alive and writing to Postgres**:
- Railway → flowdesk-worker → Deployments → latest → Deploy Logs
- New log line format: `[uw:flow] 2026-05-... N new + M updated of 100 alerts` (the `+ M updated` confirms upsert is doing backfills)
- For lottos: `[uw:lotto] 2026-05-... N new + M updated of K candidates`
- For GEX: `[uw:gex:{ticker}] ... stored snapshot · spot=X flip=Y (N strikes, range=[$lo..$hi], K within ±10% of spot)`

**Postgres has fresh data** (Railway Data tab):
```sql
SELECT
  (SELECT MAX(captured_at) FROM flow_alerts)    AS latest_flow,
  (SELECT MAX(captured_at) FROM gex_snapshots)  AS latest_gex,
  (SELECT MAX(updated_at)  FROM net_impact_daily) AS latest_netimp,
  (SELECT MAX(executed_at) FROM dark_pool_prints) AS latest_dp,
  (SELECT COUNT(*) FROM flow_alerts)                                        AS flow_count_total,
  (SELECT COUNT(*) FROM flow_alerts WHERE issue_type IS NOT NULL)           AS flow_count_v13_populated,
  (SELECT COUNT(*) FROM flow_alerts WHERE time >= NOW() - INTERVAL '24 hours') AS flow_count_24h;
```

---

## Prompt to paste into a fresh Claude Code session

```
I was building software with you in another context window and hit
the limit. Read resume.md first for the session-specific state
snapshot, then progress.md for the older baseline (2026-04-30 — the
resume.md captures the delta), and use docs/FlowDesk_PRD.md and
docs/ARCHITECTURE.md as the canonical spec when you need to verify
anything.

Current main head should be e26ab15 or whatever's latest. Don't
trust resume.md blindly for any code references — verify against
the actual files and git log before recommending or building on
them.

Branding: the project was rebranded to "Champagne Sessions". Repo
path is still flowdesk/, GitHub remote is still
github.com/buddybear8/flowdesk, but every user-facing string says
Champagne Sessions.

Live deploy: Vercel auto-deploys frontend on push to main; Railway
worker auto-deploys too. Schema migration for v1.3 fields
(ask_prem, bid_prem, all_opening, issue_type, has_floor,
has_single_leg) was applied to Railway Postgres today.

Once you're caught up, summarize where things stand and what's
next, and wait for me to pick a thread.
```
