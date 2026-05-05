# FlowDesk — Session Resume

Last touched: **2026-05-05**
Current `main` head: **`7593ccd`** (Vercel build clean, deployment live)
Use alongside [progress.md](progress.md) (older snapshot, 2026-04-30) and the canonical [docs/FlowDesk_PRD.md](docs/FlowDesk_PRD.md) + [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). This file captures the *delta* from progress.md and live state of the system as of the latest deploy.

---

## What's running right now

| Surface | Status | Notes |
|---|---|---|
| Railway Postgres | ✅ Live | Postgres password rotated mid-session. Public URL has the new password. |
| Railway worker (`flowdesk-worker`) | ✅ Live | All 10 cron schedules wired (1 stub — see below). Polls UW, writes to Postgres. |
| Vercel Next.js app | ✅ Live | All 5 V1-active API routes serve live Postgres data. `/api/sentiment` returns 501. |
| Auth (`/api/*` gate) | ❌ NOT WIRED | `/api/*` is publicly readable. **Top priority before any user-facing launch.** |

---

## What landed this session (commit summary)

Worker (Phase 2 step 4 + earlier cleanup):
- `4e5adcc` — Docker layout fix (preserve dev tree)
- `b2cbf57` — prisma CLI moved to runtime dep
- `bbd1bf4` — `refresh-ticker-metadata` (05:30 ET)
- `18d9885` — `ai-summarizer-gex` (07:00 ET, claude-haiku-4-5)
- `138c95d` — `hit-list-compute` (07:30 ET)
- `f280619` — `s3-darkpool-import` (stub)

Phase D (Vercel API → Prisma):
- `10f2843` — Dual Prisma generators + Next.js singleton
- `dcdb354` — `/api/flow`, `/api/darkpool`, `/api/gex`, `/api/market-tide`
- `1ff0aaa` — `/api/watches`
- `1429b83` — `/api/admin/criteria`
- `7593ccd` — Exclude `worker/` from root tsconfig (fixed Vercel TS check)

---

## What's stubbed vs live

**Live**:
- All 5 UW polling jobs (flow, DP, GEX, market-tide, net-impact)
- `refresh-ticker-metadata`, `ai-summarizer-gex`, `hit-list-compute`, retention sweeps
- All 5 V1-active API routes wired to Prisma

**Stubbed** (logs but does not act):
- `s3-darkpool-import` (02:00 ET) — env-var contract documented, parsing pending until upstream Polygon extraction is producing files. See [worker/src/jobs/s3-darkpool-import.ts](worker/src/jobs/s3-darkpool-import.ts) header for the completion checklist.

**Deferred from V1**:
- Same-day hit-list rebuild on `POST /api/admin/criteria` — `computeHitList()` lives in worker package and the Next.js root can't import from there in the current layout. Saving works; rebuild waits for next 07:30 ET cron. Fix path: extract `worker/src/jobs/hit-list-compute.ts` to a shared module both sides import.

---

## Env vars that need to stay set

**Railway → flowdesk-worker → Variables**:
- `UW_API_TOKEN` — set
- `TZ=America/New_York` — set
- `NODE_OPTIONS=--dns-result-order=ipv4first` — set
- `DATABASE_URL` — Reference to Postgres internal URL (auto-resolves)
- `ANTHROPIC_API_KEY` — **NOT YET SET**. Required for `ai-summarizer-gex`. Job logs and skips gracefully without it. Set before tomorrow's 07:00 ET fire to test the job.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DARKPOOL_S3_BUCKET`, `DARKPOOL_S3_PREFIX` — pending. `s3-darkpool-import` waits on these + the upstream extraction pipeline.

**Vercel → flowdesk → Settings → Environment Variables**:
- `DATABASE_URL` — Railway's `DATABASE_PUBLIC_URL` (with rotated password)
- `USE_MOCK_DATA` — deleted (routes no longer check it)

---

## Known issues / polish items

1. **UW 429 on GEX poll for SPY** (occasional). Cause: `pollGex` walks 5 tickers serially in <1 sec, hits short-window rate limit. Fix: add ~200ms delay between tickers in [worker/src/jobs/uw.ts](worker/src/jobs/uw.ts). Tracked as Phase 2 step 3a polish.
2. **Gamma flip degenerate values for NVDA/TSLA** (flip=15 / flip=50 vs spots of $198 / $392). Cause: `deriveKeyLevels` cumulative-crossing logic catches a zero crossing at very deep OTM strikes. Fix: restrict the search to strikes within ±10–20% of spot. Same file.
3. **SPY/SPX gamma flip = spot** — fallback kicked in (no zero crossing found in the window). Worth verifying with more polls whether this is real or a sign-convention edge case.
4. **No US holiday calendar** in `hit-list-compute` and `priorTradingDay()` helpers — Memorial Day / Thanksgiving will pull from a holiday rather than the previous trading day. Add a holiday list before any post-V1 holiday.
5. **Date helpers duplicated** between `worker/src/jobs/hit-list-compute.ts` and `app/api/watches/route.ts` (`priorTradingDay`, `etMidnightUTC`). Extract to a shared lib once a cross-package import path exists.

---

## Next priorities (in order)

1. **Phase F — Auth.js v5 + Whop OAuth.** Gate every `/api/*` route with the 3-line `auth()` check. PRD §13 / ARCHITECTURE §6 phase F have the spec. Critical before exposing live data publicly.
2. **Add `ANTHROPIC_API_KEY` to Railway** so `ai-summarizer-gex` actually runs at 07:00 ET tomorrow.
3. **Polish workstream** — items 1–5 above.
4. **Build secondary tab views** — Criteria config (would call `/api/admin/criteria`), Sweep scanner, 0DTE flow, Unusual activity, DP levels. PRD lists these as ⬜ not built.
5. **Same-day hit-list rebuild** — extract `computeHitList` to shared module.

---

## Quick verification recipes

**Worker is alive and writing to Postgres**:
- Railway → flowdesk-worker → Deployments → latest → Deploy Logs
- Look for `[uw:flow]` or `[uw:dp]` log lines with timestamps in the last 5 min (off-hours) or 30 sec (market hours)

**Vercel API is reading from Postgres**:
- Open the live URL → DevTools → Network tab → reload
- Click on `/api/flow` (or any V1-active route)
- Response should be JSON with `alerts` / `prints` / strikes / etc., not a 500

**Postgres has fresh data** (Railway Data tab):
```sql
SELECT
  (SELECT MAX(captured_at) FROM flow_alerts)   AS latest_flow,
  (SELECT MAX(captured_at) FROM gex_snapshots) AS latest_gex,
  (SELECT MAX(updated_at)  FROM net_impact_daily) AS latest_netimp,
  (SELECT COUNT(*) FROM flow_alerts) AS flow_count;
```
