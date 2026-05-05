# Champagne Sessions — Session Resume

Last touched: **2026-05-05** (deeper into the day)
Current `main` head: **`f76342d`** (Vercel build clean, deployment live)
Use alongside [progress.md](progress.md) (older snapshot, 2026-04-30) and the canonical [docs/FlowDesk_PRD.md](docs/FlowDesk_PRD.md) + [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). This file captures the *delta* since the prior resume.md (head `7593ccd`) and the live state of the system as of the latest deploy.

> **Branding note**: project was rebranded from "FlowDesk" to "Champagne Sessions" in `bbecffb`. The repo path is still `flowdesk/` and the GitHub remote is still `github.com/buddybear8/flowdesk`. Every user-facing string says Champagne Sessions; backend names and file paths intentionally weren't churned.

---

## What's running right now

| Surface | Status | Notes |
|---|---|---|
| Railway Postgres | ✅ Live | — |
| Railway worker (`flowdesk-worker`) | ✅ Live | All 10 cron schedules wired (1 stub: `s3-darkpool-import`). |
| Vercel Next.js app | ✅ Live | All 5 V1-active API routes serve live Postgres data. `/api/sentiment` returns 501. |
| Auth (`/api/*` gate) | ❌ NOT WIRED | `/api/*` is publicly readable. **Top priority before any user-facing launch.** |

---

## What landed this session (commit summary, oldest first)

Market Pulse / Top Net Impact:
- `c30bdbe` — Off-hours empty state (Closed pill, em-dashes, friendly chart message)
- `06cb616` — Top Net Impact filters by latest poll's `updatedAt`, not day's most-positive
- `15d5308` — Tide chart shows the latest *available trading session*, not just last 6.5h
- `e37e581` — Dropped SPY price line and SPY stat card (no live SPY feed)

Flow Alerts:
- `eb6e390` — Date column added; "Size" → "Volume" rename; ` cts` suffix dropped; OTM-only and Size>OI toggles wired
- `8818367` — Size range filter wired; non-functional IV range removed (no IV in schema/ingestion)
- `a899585` — Size range renamed to Premium range; filters on `premium` USD instead of `size`
- `74a790d` — **Trading-day filter** at top of filter panel — date input + "Today" snap-back; server-side ET day filter

Dark Pools:
- `0c8fcc6` — Removed default rank filter that hid every live-polled row (live UW data has NULL rank — that field comes from S3 backfill which is still stubbed)

GEX module — major iteration on this:
- `c8fceb6` — Strike-count toggle added; honest empty-state for Vanna/Charm tabs
- `a3b6f5e` — API picks strikes nearest spot, not by `|combined|`
- `9c1bc2c` — Toggle expanded to 5/10/15/20/25/40/50, default 25
- `f1f9536` — **Vanna and Charm tabs removed entirely** (UW Basic doesn't expose them)
- `17af282` — Worker diagnostic log added; API clamped to ±20% of spot
- `cc0fba0` — Walk-back fallback (skip bad SPY polls)
- `7321381` — Reverted to simple "latest snapshot, ±10% of spot" — user wanted simplicity over fallback complexity
- `f76342d` — `deriveKeyLevels` bounded to ±5% of spot; ATM strike derived from real strikes (was hardcoded mock for SPX)

Branding & theme:
- `bbecffb` — **Rebrand to Champagne Sessions + full dark theme** (navy backgrounds, champagne-gold accent, cream text, desaturated greens/reds). Twelve hex mappings via sed across all module views; chart gridlines flipped to white-on-alpha. SPI/sentiment swept too even though sentiment is archived.

---

## What's stubbed vs live

**Live**:
- All 5 UW polling jobs (flow, DP, GEX, market-tide, net-impact)
- `refresh-ticker-metadata`, `ai-summarizer-gex`, `hit-list-compute`, retention sweeps
- All 5 V1-active API routes wired to Prisma + dark-themed UI

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

This session's debugging revealed UW's `/api/stock/{ticker}/spot-exposures/strike` endpoint is unreliable per ticker. Verified 2026-05-05 via worker diagnostic logs (`[uw:gex:{ticker}] ... stored snapshot · spot=X flip=Y (N strikes, range=[$lo..$hi], K within ±10% of spot)`):

| Ticker | Behavior |
|---|---|
| **SPY** | Alternates between full near-money chains (47 near spot) and pure deep-OTM dumps (0 near spot) on consecutive polls |
| **QQQ** | Every poll returns the same legacy non-standard strikes ($174–$310 when spot is $682) — likely corp-action-adjusted contracts. **Chart will be empty until UW changes what it returns or we pass different params.** |
| **NVDA / TSLA** | Mix of near-money and deep-OTM LEAPS in roughly equal measure |
| **SPX** | Clean, full chains every poll |

Current API band-aid: `app/api/gex/route.ts` filters strikes to ±10% of spot before display. If the latest poll has nothing in that window, chart goes empty (honest signal). The walk-back fallback was removed at user request — they preferred simplicity.

**Two upstream paths to investigate** for QQQ specifically:
1. Pass `expiry=` or `expiration_date=` param to UW to filter to standard front-month
2. Filter out non-standard contracts in the worker (need to inspect a full UW row to find a marker flag — grab from `[uw:gex-QQQ] sample raw row` in Railway logs next time it fires after a redeploy)

---

## Other known issues / polish items

1. **UW 429 on GEX poll for SPY** (occasional). Cause: `pollGex` walks 5 tickers serially in <1 sec, hits short-window rate limit. Fix: add ~200ms delay between tickers in [worker/src/jobs/uw.ts](worker/src/jobs/uw.ts).
2. **Logo placeholder** — sidebar shows "CS" in a gold-bordered square. The actual logo file hasn't been saved to `public/logo.png` yet (chat-pasted images aren't on disk). Once the file lands, swap the placeholder for `<Image src="/logo.png" />` in [components/layout/Sidebar.tsx](components/layout/Sidebar.tsx).
3. **Light cream/lavender chip backgrounds** persist in Watches / Dark Pools / GEX details panel (`#FAEEDA`, `#F1EFE8`, `#EEEDFE`, `#FAECE7`). They read like champagne accents on navy and were left intentionally during the dark-theme rollout. If any feel out of place, they're easy to swap.
4. **Mock data files** (`lib/mock/*-data.ts`) are dormant — `USE_MOCK_DATA` was removed from the routes. `lib/mock/gex-data.ts`'s `gexLabels()` was leaking the ATM strike value into GexView until commit `f76342d` fixed it. Worth a sweep to delete unused mock files post-V1.
5. **Dark Pools rank chip** still shows `0` for unranked rows (live polls write NULL rank → API returns 0). Cosmetic — could swap to "—" for unranked. Tracked but not done.
6. **No US holiday calendar** in `hit-list-compute` and `priorTradingDay()` helpers.
7. **Date helpers duplicated** between `worker/src/jobs/hit-list-compute.ts` and `app/api/watches/route.ts`. Extract to shared lib once a cross-package import path exists.

---

## Next priorities (in order)

1. **Phase F — Auth.js v5 + Whop OAuth.** Gate every `/api/*` route with the 3-line `auth()` check. PRD §13 / ARCHITECTURE §6 phase F. Critical before exposing live data publicly. Auth.js DB tables (`User`, `Account`, `Session`, `VerificationToken`) already exist in `prisma/schema.prisma`.
2. **Real logo file** → `public/logo.png` → swap the "CS" placeholder in the sidebar.
3. **QQQ data investigation** — try UW params, or filter non-standard contracts in the worker.
4. **UW 429 throttling** — 200ms delay between tickers in `pollGex`.
5. **Build secondary tab views** — Criteria config, Sweep scanner, 0DTE flow, Unusual activity, DP levels.
6. **Same-day hit-list rebuild** — extract `computeHitList` to a shared module.

---

## Quick verification recipes

**Worker is alive and writing to Postgres**:
- Railway → flowdesk-worker → Deployments → latest → Deploy Logs
- Look for `[uw:flow]` or `[uw:dp]` log lines with recent timestamps
- For GEX, the diagnostic line is `[uw:gex:{ticker}] ... stored snapshot · spot=X flip=Y (N strikes, range=[$lo..$hi], K within ±10% of spot)` — read off whether each ticker is getting clean data

**Vercel API is reading from Postgres**:
- Open the live URL → DevTools → Network → reload → click `/api/flow` (or any route)
- Response should be JSON with `alerts` / `prints` / strikes / etc.

**Postgres has fresh data** (Railway Data tab):
```sql
SELECT
  (SELECT MAX(captured_at) FROM flow_alerts)    AS latest_flow,
  (SELECT MAX(captured_at) FROM gex_snapshots)  AS latest_gex,
  (SELECT MAX(updated_at)  FROM net_impact_daily) AS latest_netimp,
  (SELECT MAX(executed_at) FROM dark_pool_prints) AS latest_dp,
  (SELECT COUNT(*) FROM flow_alerts) AS flow_count;
```
