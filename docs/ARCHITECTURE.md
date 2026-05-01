# FlowDesk — Live Architecture & Railway Setup
### From mock sandbox to a live data pipeline · v1.4 · Apr 2026

This doc scopes what needs to stand up to flip `USE_MOCK_DATA=false` and
serve real data from Unusual Whales and Anthropic. Paired with the PRD at
[./FlowDesk_PRD.md](./FlowDesk_PRD.md).

**v1.4 update (Apr 30, 2026):** archives the Sentiment Tracker module
from V1 (PRD §7). X API Basic ($100/mo) was unaffordable for our
deployment, so the entire X→sentiment data path is removed from V1
scope: no X API integration, no `x-batch` cron, no sentiment summary in
the daily AI batch (per-ticker GEX explanations remain), and the
`XPost` / `SentimentSnapshot` / `AnalystProfile` / `DivergenceAlert`
Prisma models drop to "archived" status. The `ai-summarizer` cron
remains at 07:00 ET, scope reduced to GEX explanations only. Total
infra cost drops by ~$100/mo.

**v1.3 update (Apr 29, 2026 later):** locks single-worker option A as the
chosen architecture (vs the multi-service alternative). Adds the
authentication layer — Auth.js v5 with a Whop OAuth provider, gated by a
free Whop product/access pass. Adds a `hit-list-compute` daily job
(07:30 ET) and a `refresh-ticker-metadata` daily job (05:30 ET). Adds
`User`, `TickerMetadata`, `HitListDaily`, and `DivergenceAlert` Prisma
models. Documents the divergence trigger rule that the AI batch applies.

**v1.2 update (Apr 29, 2026):** locks 60-day flow retention, split DP
retention (perpetual top-100 / 30 days otherwise), Polygon historical DP
backfill consumed via S3, GEX AI explanations pre-computed in the daily
07:00 ET batch, X API v2 used directly. Adds retention-sweep crons, the
S3 import job, and corrects a node-cron expression bug in the v1.1
schedule list.

**v1.1 (Apr 2026):** switched cloud host from AWS to **Railway**.
Railway is a managed PaaS (like a modern Heroku) — one dashboard handles
Postgres, worker services, cron schedules, and env-var management.
Trade-off: we lose AWS's granular IAM / VPC / CloudWatch story in
exchange for dramatically less setup and about half the monthly cost.
For a single-user personal tool, that trade-off is correct.

---

## 1. System overview

```
   ┌─ User browser ──────────────────────────────────────────────┐
   │                                                              │
   │                                  1. "Sign in with Whop" ────►┼─► Whop OAuth
   │                                                              │   (whop.com)
   │   3. session cookie set ◄── 2. OAuth code exchange ◄─────────┤
   │                                                              │
   │   (any /api/* with cookie)                                   │
   └────────────────┬─────────────────────────────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │   Vercel (Next.js frontend + API routes)                     │
   │   https://flowdesk-puce.vercel.app                           │
   │                                                              │
   │   ┌─ Auth.js v5 (NextAuth) + Whop OAuth provider ─┐         │
   │   │  • verifies session cookie on every /api/* req │         │
   │   │  • re-checks Whop membership every ~5 min      │         │
   │   │  • 401 if session missing or revoked          │         │
   │   └────────────────────────────────────────────────┘         │
   └────────────────┬─────────────────────────────────────────────┘
                    │ Prisma (HTTPS + TLS)
                    ▼
        ┌─────────────────────────┐
        │  Railway: Postgres 16   │  managed DB
        │  (DATABASE_URL)         │  connection pooling built-in
        └───────────▲─────────────┘
                    │ writes
        ┌───────────┴─────────────┐
        │  Railway: flowdesk-     │  single long-running Node service
        │  worker                 │  with node-cron managing schedules:
        │                         │  • uw-poll              30s mkt / 5m off
        │                         │  • market-tide          5m mkt
        │                         │  • net-impact           5m mkt (offset 30s)
        │                         │  • ai-summarizer (GEX)  07:00 ET
        │                         │  • hit-list-compute     07:30 ET
        │                         │  • refresh-ticker-meta  05:30 ET
        │                         │  • s3-darkpool-import   02:00 ET
        │                         │  • retention-sweeps     03:00 ET
        └───────────┬─────────────┘
                    │
       ┌────────────┼─────────────┬──────────────┐
       ▼            ▼             ▼              ▼
   ┌────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐
   │ UW     │  │ Anthropic│  │ AWS S3     │  │ Whop     │
   │ flow,  │  │ Haiku    │  │ DP history │  │ OAuth +  │
   │ GEX,   │  │ (GEX     │  │ (Polygon-  │  │ member-  │
   │ DP,    │  │ explan.) │  │  sourced)  │  │ ship API │
   │ tide   │  │          │  │            │  │ (Vercel) │
   └────────┘  └──────────┘  └────────────┘  └──────────┘

🗄 Archived from V1 (PRD §7 / §3.3): the X API v2 box and the x-batch
   06:00 ET cron — were the only consumers of sentiment data, removed
   alongside the Sentiment Tracker module.
```

**Design principles**

1. **Pull, don't push.** UW doesn't offer a WebSocket; polling is the only option. The poller runs on Railway (not Vercel) so Vercel's function-duration limits don't constrain freshness.
2. **Single source of truth.** Everything polled lands in Postgres. Vercel reads from Postgres, never calls upstream APIs directly. Reasons: (a) keeps UW / X rate limits manageable, (b) gives us a time-series we can backtest against, (c) insulates the UI from upstream outages.
3. **One worker, scheduled internally** *(option A — locked v1.3)*. Rather than deploying three separate Lambdas + cron triggers (the AWS approach), we run **one long-lived Node service** that uses `node-cron` to trigger each job at the right cadence. Simpler deploy, same outcome, cheaper on Railway's pricing model. *Rejected alternative:* the multi-service "Clerk + Redis + websocket-server + data-ingestion" scaffolding under `services/` stays dormant; no real-time push channel exists upstream (UW is poll-only) so a WebSocket fan-out adds complexity without value at our scale.
4. **Authenticated frontend, decoupled from backend rate limits.** Each user authenticates via Whop OAuth (Auth.js v5, see §6 Phase F). Adding users does NOT increase UW API load — only the worker polls UW, at a fixed cadence. Auth gates UW redistribution license posture, backend resource hygiene, audit, and per-user state.
5. **Connection pooling handled by Railway.** Railway's Postgres includes built-in pooling — no RDS Proxy equivalent to provision.
6. **Single provider for backend.** Everything (DB + worker + env-var secrets) lives in one Railway project. Logs, metrics, and deploys are managed from one dashboard. Vercel hosts the frontend + auth; Whop is the access-management source of truth.

---

## 2. Data flow by source

### 2.1 Unusual Whales

Polled by **`uw-poller` Lambda**, scheduled by EventBridge.

| Endpoint | Cadence (market hours) | Cadence (off-hours) | Table | Retention |
|---|---|---|---|---|
| `GET /api/option-trades/flow-alerts` | 30s | 5m | `flow_alerts` | **60 days** |
| `GET /api/stock/{t}/spot-exposures/strike` | 60s per watched ticker | 10m | `gex_snapshots` | 30 days |
| `GET /api/darkpool/recent` | 30s | off | `dark_pool_prints` | **Split:** top-100 ranked per ticker = perpetual; everything else = 30 days |
| `GET /api/market/market-tide?interval_5m=1` | 5m | off | `market_tide_bars` | 30 days |
| `GET /api/stock/{t}/options-volume` | once at close | — | `options_volume_daily` | indefinite |

**Retention enforcement.** Two nightly cron sweeps run inside the worker at 03:00 ET (off-hours, Mon–Fri):

```sql
-- flow-retention-sweep
DELETE FROM flow_alerts WHERE captured_at < NOW() - INTERVAL '60 days';

-- dp-retention-sweep
DELETE FROM dark_pool_prints
WHERE rank > 100 AND executed_at < NOW() - INTERVAL '30 days';
```

The top-100-perpetual rule is critical for ongoing historical ranking integrity (rank/percentile must be computable against a stable corpus across years).

**Historical DP backfill (separate inbound source).** The `dark_pool_prints` table is also populated from a Polygon-sourced S3 backfill — see PRD §3.5. The extraction-from-Polygon step is out of scope here; only the S3-to-Postgres import job lives in this codebase. The retention rule above applies uniformly to both backfilled and live-polled rows.

Each poll is idempotent: insert-or-ignore on natural keys (e.g. flow alert id + captured-at timestamp). No duplicate rows.

### 2.2 X API v2 *(ARCHIVED in v1.4 — deferred from V1)*

> **🗄 Archived (Apr 30, 2026).** X API Basic ($100/mo) is unaffordable for our deployment; this entire data path is deferred from V1. The `x-batch` cron is removed from §6, the `XPost` model is archived in §3, and the Sentiment Tracker module (PRD §7) is archived. The original spec follows below for reactivation reference. **Do not implement in V1.**

Pulled by the worker's `x-batch` cron, scheduled once daily at 06:00 ET (before market open). v1 uses the X API v2 Basic tier directly (xAI Grok was previously listed as an alternative — dropped in v1.2.1).

- **Watchlist mentions:** `GET /2/tweets/search/recent?query=($NVDA OR $PLTR OR ...)&max_results=100` for every ticker on the watchlist. Paginated until quota or cutoff.
- **Tracked analyst posts:** For each analyst handle in `analyst_profiles`, `GET /2/users/:id/tweets?start_time=...`. Capture the last 24 hours.
- Raw posts land in `x_posts`; sentiment classification happens in the next step (see §2.3).

**Rate limits:** X API v2 Basic ($100/mo) gives ~500K tweet reads/month — comfortably enough for 50 tickers × once-daily + 20 analysts × 30 posts/day.

### 2.3 Anthropic Claude

Called by the worker's `ai-summarizer` cron at 07:00 ET (Mon–Fri). **V1 scope (locked v1.4): per-ticker GEX explanations only.** The sentiment summary workload is archived alongside the Sentiment Tracker module.

1. ~~Sentiment summary~~ — **🗄 archived in v1.4.** Was: classify last 24h of `x_posts` (bull/bear/neutral), generate market-wide AI summary, store in `ai_summaries` with `kind="sentiment-{YYYY-MM-DD}"` and update `sentiment_snapshots`. Reactivate alongside §2.2 / PRD §7.
2. **Per-ticker GEX explanation (V1 active):** for each watched ticker (SPY/QQQ/SPX/NVDA/TSLA — see PRD §8), pull the most recent `gex_snapshots` row, prompt Claude with regime + spot + key levels + DV-vs-OI delta, store the response in `ai_summaries` (`kind="gex-{TICKER}-{YYYY-MM-DD}"`).

The GEX modal in the frontend reads the cached body and renders a header note: *"Static summary as of market open — regime and key levels may change throughout the trading day."* On-demand (per-click) generation moves to a later iteration once latency/cost is benchmarked.

**Model:** `claude-haiku-4-5`. **V1 cost: <$1/month** (5 GEX explanations × ~300 tokens × ~22 trading days). Was ~$1–3/month before sentiment archive.

---

## 3. Database: why PostgreSQL

### Short answer

**Amazon RDS PostgreSQL 16, `db.t4g.small` instance, 20 GB GP3 storage**. Extension list: `pg_stat_statements`, `pgcrypto`. TimescaleDB optional later — don't add on day one.

### Why Postgres, not a time-series DB or NoSQL

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **PostgreSQL** | Relational, strong indexing, Prisma-native, cheap on RDS, can model everything you need | None for this scale | ✅ Pick |
| TimescaleDB (PG ext) | Auto-partitioning for time-series, fast aggregate queries | Adds operational complexity; overkill until you have >100M rows | Revisit at scale |
| ClickHouse | Insane query speed on analytics | Self-hosted burden, clunky insert model, no managed AWS offering | ❌ Wrong tool |
| DynamoDB | Serverless, no provisioning | Awful for the multi-key filtered queries this UI does (ticker + time range + rank range + ETF flag ...) | ❌ |
| Aurora Postgres | Faster than RDS, global tables | 2–3× the cost of RDS for no benefit at this scale | ❌ |

Your workload is ~thousands of writes/day, ~hundreds of reads/second from a handful of concurrent users. That's firmly in "default Postgres crushes this" territory.

### Schema additions (on top of current `/prisma/schema.prisma`)

```prisma
// ─── Flow alerts (raw polling output) ─────────────────────────
model FlowAlert {
  id              String   @id                        // UW's alert id
  capturedAt      DateTime @map("captured_at")        // when we polled it
  time            DateTime                             // alert timestamp per UW
  ticker          String   @db.VarChar(10)
  type            String   @db.VarChar(4)             // CALL|PUT
  side            String   @db.VarChar(4)             // BUY|SELL
  sentiment       String   @db.VarChar(8)             // BULLISH|BEARISH
  exec            String   @db.VarChar(8)             // SWEEP|FLOOR|SINGLE|BLOCK
  multiLeg        Boolean  @map("multi_leg")
  contract        String                               // "$145P May 15"
  strike          Decimal  @db.Decimal(12, 4)
  expiry          DateTime @db.Date
  size            Int
  oi              Int
  premium         Decimal  @db.Decimal(16, 2)
  spot            Decimal  @db.Decimal(12, 4)
  rule            String
  confidence      String   @db.VarChar(4)             // HIGH|MED|MOD|LOW
  sector          String   @db.VarChar(32)

  @@index([capturedAt(sort: Desc)])
  @@index([ticker, capturedAt(sort: Desc)])
  @@map("flow_alerts")
}

// ─── GEX snapshots (per ticker per poll) ──────────────────────
model GexSnapshot {
  id              BigInt   @id @default(autoincrement())
  capturedAt      DateTime @map("captured_at")
  ticker          String   @db.VarChar(10)
  asOf            DateTime @map("as_of")               // UW's stated timestamp
  spot            Decimal  @db.Decimal(12, 4)
  netGexOI        Decimal  @db.Decimal(20, 2) @map("net_gex_oi")
  netGexDV        Decimal  @db.Decimal(20, 2) @map("net_gex_dv")
  gammaRegime     String   @db.VarChar(10) @map("gamma_regime")
  callWall        Decimal  @db.Decimal(12, 4) @map("call_wall")
  putWall         Decimal  @db.Decimal(12, 4) @map("put_wall")
  gammaFlip       Decimal  @db.Decimal(12, 4) @map("gamma_flip")
  maxPain         Decimal  @db.Decimal(12, 4) @map("max_pain")
  strikes         Json                                 // per-strike array
  @@index([ticker, capturedAt(sort: Desc)])
  @@map("gex_snapshots")
}

// ─── Market Tide history ──────────────────────────────────────
model MarketTideBar {
  id                       BigInt   @id @default(autoincrement())
  bucketStart              DateTime @map("bucket_start")      // 5-min bucket start
  spyPrice                 Decimal  @db.Decimal(12, 4) @map("spy_price")
  netCallPremium           Decimal  @db.Decimal(20, 2) @map("net_call_premium")
  netPutPremium            Decimal  @db.Decimal(20, 2) @map("net_put_premium")
  volume                   BigInt
  @@unique([bucketStart])
  @@index([bucketStart(sort: Desc)])
  @@map("market_tide_bars")
}

// ─── Net Impact daily snapshots (for the Top Net Impact chart) ──
model NetImpactDaily {
  id             BigInt   @id @default(autoincrement())
  snapshotDate   DateTime @db.Date @map("snapshot_date")
  ticker         String   @db.VarChar(10)
  netPremium     Decimal  @db.Decimal(16, 2) @map("net_premium")
  @@unique([snapshotDate, ticker])
  @@index([snapshotDate, netPremium(sort: Desc)])
  @@map("net_impact_daily")
}

// ─── Dark pool prints ─────────────────────────────────────────
model DarkPoolPrint {
  id              BigInt   @id @default(autoincrement())
  uwId            String?  @unique @map("uw_id")       // UW's print id if provided
  executedAt      DateTime @map("executed_at")
  ticker          String   @db.VarChar(10)
  price           Decimal  @db.Decimal(12, 4)
  size            Int
  premium         Decimal  @db.Decimal(16, 2)
  volume          BigInt?
  isEtf           Boolean  @default(false) @map("is_etf")
  isExtended      Boolean  @default(false) @map("is_extended")
  rank            Int?                                  // from UW response
  percentile      Decimal? @db.Decimal(5, 2)            // from UW response
  @@index([ticker, executedAt(sort: Desc)])
  @@index([rank])
  @@map("dark_pool_prints")
}

// ─── 🗄 ARCHIVED in v1.4 ──────────────────────────────────────
// XPost, SentimentSnapshot, AnalystProfile, DivergenceAlert below are
// deferred from V1 alongside the Sentiment Tracker module (PRD §7).
// Do NOT add these to prisma/schema.prisma in V1. They are retained
// here for future reactivation reference.

// ─── Sentiment: raw X posts + daily snapshots ─────────────────
model XPost {
  id             String   @id                         // X tweet id
  capturedAt     DateTime @map("captured_at")
  postedAt       DateTime @map("posted_at")
  authorHandle   String   @db.VarChar(64) @map("author_handle")
  authorFollowers Int     @map("author_followers")
  body           String   @db.Text
  cashtags       String[]
  likes          Int
  retweets       Int
  sentiment      String?  @db.VarChar(8)              // set by ai-summarizer
  @@index([postedAt(sort: Desc)])
  @@index([authorHandle, postedAt(sort: Desc)])
  @@map("x_posts")
}

model SentimentSnapshot {
  id             BigInt   @id @default(autoincrement())
  snapshotAt     DateTime @map("snapshot_at")
  ticker         String   @db.VarChar(10)
  mentions       Int
  velocityPct    Float    @map("velocity_pct")
  bullPct        Float    @map("bull_pct")
  bearPct        Float    @map("bear_pct")
  neutralPct     Float    @map("neutral_pct")
  sentiment      String   @db.VarChar(8)
  @@index([snapshotAt(sort: Desc)])
  @@index([ticker])
  @@map("sentiment_snapshots")
}

model AnalystProfile {
  handle         String   @id
  initials       String   @db.VarChar(4)
  followers      Int
  bio            String   @db.Text
  bias           String   @db.VarChar(8)
  accuracy30d    Float    @map("accuracy_30d")
  callsTracked  Int      @map("calls_tracked")
  updatedAt      DateTime @updatedAt @map("updated_at")
  portfolio      Json
  recentCalls    Json     @map("recent_calls")
  accuracyByTicker Json   @map("accuracy_by_ticker")
  @@map("analyst_profiles")
}
// ─── End of archived sentiment block ──────────────────────────

// ─── AI summaries ─────────────────────────────────────────────
model AiSummary {
  id           BigInt   @id @default(autoincrement())
  kind         String   @db.VarChar(64)              // "market-overview" | "gex-SPY" | etc
  generatedAt  DateTime @map("generated_at")
  body         String   @db.Text
  tokensUsed   Int      @map("tokens_used")
  @@index([kind, generatedAt(sort: Desc)])
  @@map("ai_summaries")
}

// ─── User config (already in v1.2 schema) ─────────────────────
// WatchesCriteria — kept as-is

// ─── Auth (Auth.js v5 + Whop OAuth) — added v1.3 ──────────────
model User {
  id                  String   @id @default(cuid())
  whopMembershipId    String   @unique @map("whop_membership_id")
  email               String   @unique
  isActive            Boolean  @default(true) @map("is_active")
  createdAt           DateTime @default(now()) @map("created_at")
  lastLoginAt         DateTime? @map("last_login_at")
  membershipCheckedAt DateTime? @map("membership_checked_at")
  @@index([email])
  @@map("users")
}

// Auth.js standard tables (Session, Account, VerificationToken) generated by
// the Prisma adapter. Documented here for completeness; their exact shape
// matches @auth/prisma-adapter@^2's schema.

// ─── Ticker reference table — added v1.3 ──────────────────────
model TickerMetadata {
  ticker     String   @id @db.VarChar(10)
  sector     String   @db.VarChar(32)        // matches `Sector` union (PRD §18)
  name       String?
  isEtf      Boolean  @default(false) @map("is_etf")
  updatedAt  DateTime @updatedAt @map("updated_at")
  @@map("ticker_metadata")
}

// ─── Daily hit list — added v1.3 ──────────────────────────────
model HitListDaily {
  id                BigInt   @id @default(autoincrement())
  date              DateTime @db.Date
  rank              Int                                          // 1..20
  ticker            String   @db.VarChar(10)
  price             Decimal  @db.Decimal(12, 4)
  direction         String   @db.VarChar(4)                     // UP|DOWN
  confidence        String   @db.VarChar(4)                     // HIGH|MED|LOW
  premium           Decimal  @db.Decimal(16, 2)
  contract          String
  dpConf            Boolean  @map("dp_conf")
  dpRank            Int?     @map("dp_rank")
  dpAge             String?  @map("dp_age")                     // "today"|"yesterday"
  dpPrem            Decimal? @db.Decimal(16, 2) @map("dp_prem")
  thesis            String   @db.Text
  sector            String   @db.VarChar(32)
  actionabilityScore Decimal @db.Decimal(8, 4) @map("actionability_score")
  contracts         Json
  peers             Json
  theme             Json
  @@unique([date, rank])
  @@index([date(sort: Desc)])
  @@map("hit_list_daily")
}

// ─── Divergence alerts — added v1.3, ARCHIVED in v1.4 ─────────
// Materialized by the 07:00 ET ai-summarizer batch per the rule in PRD §7.
// 🗄 Archived from V1 alongside the Sentiment Tracker module — divergence
// alerts are a sentiment-derived feature with no consumer in V1. Retained
// here for future reactivation.
model DivergenceAlert {
  id              BigInt   @id @default(autoincrement())
  generatedAt     DateTime @map("generated_at")
  ticker          String   @db.VarChar(10)
  sentimentDir    String   @db.VarChar(8) @map("sentiment_dir")  // BULLISH|BEARISH
  priceDir        String   @db.VarChar(8) @map("price_dir")      // BULLISH|BEARISH
  deltaSentimentPts Int    @map("delta_sentiment_pts")
  deltaPricePct3d Decimal  @db.Decimal(8, 4) @map("delta_price_pct_3d")
  severity        String   @db.VarChar(6)                        // red|amber|green
  description     String
  @@index([generatedAt(sort: Desc)])
  @@index([ticker, generatedAt(sort: Desc)])
  @@map("divergence_alerts")
}
```

Run `npx prisma migrate dev --name live_data_schema` once the DB is reachable.

---

## 4. Caching strategy

Two caches in series:

1. **Postgres (warm storage)** — every upstream response lands here. TTL is enforced by the pollers: reads always go to Postgres, no direct upstream calls from Vercel.
2. **Next.js route cache** — thin in-memory cache on top of Postgres to shave database round-trips. 30-second TTL for GEX/flow/DP, 5-minute for market tide, 6-hour for sentiment/AI summaries.

```ts
// Example: app/api/flow/route.ts (production)
export async function GET(req: NextRequest) {
  // ... input validation (already in place) ...
  const cacheKey = `flow:${JSON.stringify(filterParams)}`;
  const cached = cache.get(cacheKey);            // unstable_cache or similar
  if (cached && age(cached) < 30_000) return NextResponse.json(cached);

  const alerts = await prisma.flowAlert.findMany({
    where: { /* ...filters... */ },
    orderBy: { capturedAt: "desc" },
    take: 100,
  });
  const payload = { alerts, stats: computeFlowStats(alerts) };
  cache.set(cacheKey, { payload, at: Date.now() });
  return NextResponse.json(payload);
}
```

---

## 5. Cost estimate (monthly)

Railway charges usage-based, with a **$5/mo minimum** that includes the first $5 of resource consumption. A single-user workload comfortably fits inside the next tier up.

| Service | Config | Est. cost |
|---|---|---|
| Railway — Postgres | 1 GB RAM, ~5 GB storage | ~$8–12 |
| Railway — worker service | 512 MB RAM, ~0.1 vCPU average, 24/7 | ~$5–8 |
| Railway egress | UW polling | < $1 |
| **Railway subtotal** | | **~$15–20/mo** |
| UW Basic | | $150 |
| ~~X API Basic~~ | ~~Sentiment Tracker (PRD §7)~~ | **🗄 $0 — archived in v1.4** *(was $100/mo)* |
| Anthropic Claude Haiku | GEX explanations only (sentiment summary archived) | **<$1** *(was $1–5)* |
| Vercel (Pro for ~100 users) | | $20 |
| Whop (free product) | | $0 |
| **Total** | | **~$185–195/mo** |

**Compared to v1.3 plan (~$285–295/mo with X API + Vercel Pro):** ~$100/mo savings from archiving the Sentiment Tracker module.

**Compared to AWS (v1.0 plan):** the infra line drops from ~$44/mo (RDS + Proxy + Lambda + Secrets + CloudWatch) to ~$15–20/mo on Railway. Same workload, roughly half the cost, and the setup walkthrough shrinks from 8 phases to 4 (or 5 with auth).

Cheaper paths if you want: downgrade the Railway Postgres service (saves ~$5), defer the worker by running the poller locally overnight during development (saves ~$8), stay on Vercel Hobby during single-user testing before scaling to Pro (saves $20).

---

## 6. Railway setup — step by step

These instructions assume you've never used Railway. Everything happens in two places: **railway.com** (the web dashboard) and your local terminal. Setup end-to-end should take ~90 minutes the first time.

### Phase A · Railway account + billing (10 min)

**A1. Sign up**

1. Go to https://railway.com → **Sign Up**
2. Sign in with GitHub (recommended — gives Railway permission to deploy repos later)
3. You'll land in the empty dashboard

**A2. Add a payment method + set a spending cap**

Railway's free trial includes $5 credit. Add a card before you exhaust it so the service doesn't pause.

1. Top-right avatar → **Account Settings** → **Billing**
2. **Payment Methods** → add a card
3. Plan: **Hobby** ($5/mo base, then usage-based). The free **Trial** tier is fine for setup but won't keep the worker running 24/7.
4. **Usage Limit** → set a **hard cap at $25/mo** for peace of mind (well above the $15–20 estimate)
5. **Usage Alerts** → turn on email alerts at 50%, 75%, and 100% of the cap

**A3. Create the project**

1. Dashboard → **New Project** → **Empty Project**
2. Name: `flowdesk`
3. You now have an empty project canvas where you'll add services

---

### Phase B · Provision Postgres + run migrations (20 min)

**B1. Add the Postgres service**

1. In the `flowdesk` project → **+ New** → **Database** → **Add PostgreSQL**
2. Railway provisions a managed Postgres 16 instance in ~30 seconds
3. Click the Postgres tile → **Variables** tab — you'll see several auto-generated env vars including `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `PGHOST`, `PGPASSWORD`, etc.

The **`DATABASE_URL`** value (format `postgresql://postgres:<PASS>@<host>.railway.app:5432/railway`) is what you'll use everywhere.

**B2. Install `psql` locally if you haven't already**

```bash
brew install libpq
echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
psql --version             # should print psql (PostgreSQL) 16.x
```

**B3. Test the connection from your laptop**

Copy the `DATABASE_PUBLIC_URL` from the Variables tab (the public-facing one with a full hostname). Run:

```bash
psql "postgresql://postgres:<PASS>@<host>.railway.app:<PORT>/railway?sslmode=require"
railway=> \dt
No relations found.
railway=> \q
```

If you get "connection refused" or similar, confirm you used `DATABASE_PUBLIC_URL` (not the internal `DATABASE_URL`, which only resolves inside Railway's network).

**B4. Update the Prisma schema with the new models**

Per §3 of this doc, add `FlowAlert`, `GexSnapshot`, `MarketTideBar`, `NetImpactDaily`, `DarkPoolPrint`, `XPost`, `SentimentSnapshot`, `AnalystProfile`, `AiSummary` models to `prisma/schema.prisma`. Commit.

**B5. Run migrations against Railway**

From your laptop:

```bash
cd "/Users/Stefan/Documents/Coding/Champagne Room Software/flowdesk"
export DATABASE_URL="postgresql://postgres:<PASS>@<host>.railway.app:<PORT>/railway?sslmode=require"
npx prisma migrate deploy
```

Verify:

```bash
psql "$DATABASE_URL" -c "\dt"
# should now list all the tables from the schema
```

---

### Phase C · Deploy the worker service (40 min)

We'll deploy a single long-running Node service that polls all three sources.

**C1. Scaffold the worker in your existing repo**

Inside the `flowdesk/` repo (same repo as the Next.js app — keeps one codebase, one deploy story):

```bash
cd "/Users/Stefan/Documents/Coding/Champagne Room Software/flowdesk"
mkdir -p worker
```

Create `worker/package.json`:

```json
{
  "name": "flowdesk-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "node-cron": "^3.0.3",
    "tsx": "^4.19.1"
  },
  "devDependencies": {
    "@types/node-cron": "^3.0.11",
    "@types/node": "^20"
  }
}
```

Create `worker/src/index.ts`:

```ts
import cron from "node-cron";
import { pollFlowAlerts, pollGex, pollDarkPool, pollMarketTide, computeNetImpact } from "./jobs/uw.js";
import { runAiSummary } from "./jobs/ai-summarizer.js";
import { runFlowRetentionSweep, runDpRetentionSweep } from "./jobs/retention.js";
import { importDarkpoolHistory } from "./jobs/s3-import.js";
import { computeHitList } from "./jobs/hit-list-compute.js";
import { refreshTickerMetadata } from "./jobs/refresh-ticker-metadata.js";
// 🗄 Archived in v1.4: import { runXBatch } from "./jobs/_archived/x.js";
//    Restore alongside the daily6amET schedule below if reactivating Sentiment Tracker.

// node-cron uses 6-field expressions (sec min hour DOM month DOW). TZ=America/New_York
// is set as a service env var so all expressions below resolve in ET.
const marketHours30s   = "*/30 * 9-15 * * 1-5";     // every 30s, 9:00-15:59 ET (covers 9:30 open through 16:00 close)
const offHours5m       = "0 */5 0-8,16-23 * * 1-5"; // every 5 min outside market hours, weekdays
const marketGex60s     = "*/60 * 9-15 * * 1-5";     // every 60s, market hours, per watched ticker
const marketTide5m     = "0 */5 9-15 * * 1-5";      // every 5 min, market hours (UW returns 5-min buckets)
const netImpact5m      = "30 */5 9-15 * * 1-5";     // every 5 min at :30 (offset 30s after tide poll lands)
const daily530amET     = "0 30 5 * * 1-5";          // 05:30 ET Mon–Fri — refresh ticker_metadata
const daily7amET       = "0 0 7 * * 1-5";           // 07:00 ET Mon–Fri — V1: per-ticker GEX explanations only (sentiment summary archived)
const daily730amET     = "0 30 7 * * 1-5";          // 07:30 ET Mon–Fri — hit-list-compute (after AI summary lands)
const daily3amET       = "0 0 3 * * 1-5";           // 03:00 ET Mon–Fri — retention sweeps
const daily2amET       = "0 0 2 * * 1-5";           // 02:00 ET Mon–Fri — pull new S3 DP history files
// 🗄 Archived in v1.4:
// const daily6amET    = "0 0 6 * * 1-5";           // 06:00 ET — was X batch (Sentiment Tracker module archived from V1)

// UW polling — flow + DP
cron.schedule(marketHours30s, () => Promise.all([pollFlowAlerts(), pollDarkPool()]));
cron.schedule(offHours5m, () => Promise.all([pollFlowAlerts(), pollDarkPool()]));

// UW polling — GEX per watched ticker
cron.schedule(marketGex60s, pollGex);

// UW polling — market tide (5-min buckets naturally)
cron.schedule(marketTide5m, pollMarketTide);

// Top Net Impact aggregation — see PRD §11 for the formula. Runs every 5 min
// during market hours; writes top 10 by |Net Impact| to net_impact_daily.
cron.schedule(netImpact5m, computeNetImpact);

// Refresh ticker_metadata (PRD §18 — 11 GICS sectors + 4 ETF asset classes)
cron.schedule(daily530amET, refreshTickerMetadata);

// 🗄 Archived in v1.4: cron.schedule(daily6amET, runXBatch);
//    Was the X API daily batch feeding the Sentiment Tracker module.

// AI summary batch — V1 scope: per-ticker GEX explanations only.
// (Sentiment summary path archived in v1.4 alongside the Sentiment Tracker module.)
cron.schedule(daily7amET, runAiSummary);

// Hit list compute — daily 07:30 ET (PRD §6). Reads flow_alerts + dark_pool_prints,
// applies WatchesCriteria, ranks by actionability, writes top-20 to hit_list_daily.
// Also exposed as an HTTP endpoint inside the worker so /api/admin/criteria can
// trigger a same-day rebuild after a config save (option ii).
cron.schedule(daily730amET, computeHitList);

// Retention sweeps (PRD §3.5 / ARCHITECTURE §2.1)
cron.schedule(daily3amET, () => Promise.all([runFlowRetentionSweep(), runDpRetentionSweep()]));

// S3 → Postgres dark-pool history import (PRD §3.5).
// Polygon extraction is handled out-of-band; this job only consumes
// already-extracted Parquet/CSV files from DARKPOOL_S3_BUCKET.
cron.schedule(daily2amET, importDarkpoolHistory);

console.log("[worker] started — schedules registered");
```

> **Note on `marketTide5m`.** v1.0/v1.1 of this doc used `"*/5 * * * * *"`, which in node-cron's 6-field format means *every 5 seconds* — corrected here to `"0 */5 9-15 * * 1-5"` (every 5 minutes during market hours, on the minute).

Then implement `worker/src/uw.ts`, `worker/src/x.ts`, `worker/src/ai.ts` — one function per job. Skeleton for `uw.ts`:

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const UW_BASE = "https://api.unusualwhales.com";
const uwHeaders = () => ({
  Authorization: `Bearer ${process.env.UW_API_TOKEN}`,
  "UW-CLIENT-API-ID": "100001",
});

export async function pollFlowAlerts() {
  const res = await fetch(`${UW_BASE}/api/option-trades/flow-alerts?limit=100`, {
    headers: uwHeaders(),
  });
  if (!res.ok) {
    console.error("[uw] flow-alerts failed", res.status);
    return;
  }
  const { alerts } = await res.json();
  await prisma.flowAlert.createMany({
    data: alerts.map(mapFlowAlert),
    skipDuplicates: true,
  });
  console.log(`[uw] stored ${alerts.length} flow alerts`);
}

function mapFlowAlert(a: any) { /* ... shape to your Prisma model ... */ }

// ... pollGex, pollDarkPool, pollMarketTide similarly ...
```

**C2. Add a worker-specific build config**

Railway infers how to build based on files at the root of the service. Two options:

**Option A — dedicated root directory (recommended):** configure the worker service to use `worker/` as its root. This keeps the Next.js build and the worker build independent.

**Option B — monorepo with explicit start command:** keep the single repo root and tell Railway to `cd worker && npm install && npm start`. Simpler for one project but couples the two deploys.

We'll go with Option A.

**C3. Commit + push to GitHub**

```bash
cd "/Users/Stefan/Documents/Coding/Champagne Room Software/flowdesk"
git add worker/ prisma/schema.prisma
git commit -m "Add live-data worker + Prisma models"
git push
```

**C4. Create the worker service on Railway**

1. In the `flowdesk` project → **+ New** → **GitHub Repo**
2. Pick `buddybear8/flowdesk`
3. Railway auto-detects a Node project. Click into the new service.
4. **Settings** → **Source** → **Root Directory** → set to `worker`
5. **Settings** → **Deploy** → **Start Command** → `npm start`
6. **Settings** → **Variables** → add:
   - `DATABASE_URL` → click **Reference** → pick the Postgres service's `DATABASE_URL` (Railway injects the internal URL, not the public one — faster + free egress)
   - `UW_API_TOKEN` → your UW token
   - `ANTHROPIC_API_KEY` → your Anthropic key
   - `TZ` → `America/New_York` (so cron expressions respect ET)
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DARKPOOL_S3_BUCKET`, `DARKPOOL_S3_PREFIX` — for the dark-pool history S3 import job (PRD §3.5). The Polygon extraction pipeline lands files in this bucket; the worker job consumes them.
   - 🗄 ~~`X_BEARER_TOKEN`~~ — archived in v1.4 alongside the Sentiment Tracker module. Do NOT set in V1.
7. Trigger the first deploy: push any commit, or click **Deploy** in the service view

**C5. Verify the worker is running**

1. Worker service → **Deployments** → latest → **View Logs**
2. You should see `[worker] started — schedules registered` shortly after deploy
3. After the next tick (≤30s during market hours), you should see `[uw] stored N flow alerts`
4. From your laptop: `psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM flow_alerts;"` — should be > 0

---

### Phase D · Connect Vercel to Railway Postgres (15 min)

**D1. Grab the Railway Postgres public URL**

Railway Postgres service → **Variables** → copy the value of **`DATABASE_PUBLIC_URL`** (the public-facing URL; the internal `DATABASE_URL` only resolves within Railway's private network, so Vercel can't use it).

**D2. Set the env var in Vercel**

```bash
vercel env add DATABASE_URL production
# paste the Railway DATABASE_PUBLIC_URL
```

Or via https://vercel.com → your project → **Settings** → **Environment Variables**.

**D3. Flip the mock flag**

In Vercel → Settings → Environment Variables, change `USE_MOCK_DATA` from `true` to `false`.

**D4. Update `.env.local` locally**

For local dev against real data (optional):

```bash
# flowdesk/.env.local
USE_MOCK_DATA=false
DATABASE_URL="postgresql://postgres:...@<host>.railway.app:<PORT>/railway?sslmode=require"
```

Leave it at `true` and keep using mock data locally if you prefer — both setups coexist.

**D5. Rewrite each `app/api/*/route.ts` to read from Postgres**

Each handler currently has an `if (USE_MOCK_DATA === "true") return mock()` branch and a `501` fallback. Replace the 501 branch with a Prisma query. Example for `/api/flow`:

```ts
// before (v1.2):
return NextResponse.json({ error: "Live UW API not wired yet" }, { status: 501 });

// after:
const alerts = await prisma.flowAlert.findMany({
  where: { /* apply validated query params as filters */ },
  orderBy: { capturedAt: "desc" },
  take: 100,
});
return NextResponse.json({ alerts, stats: computeFlowStats(alerts) });
```

Repeat for each of the six routes. Ship incrementally — you can flip one route to live data while others stay on mock.

**D6. Redeploy Vercel**

Push any commit or click **Redeploy** in the Vercel dashboard. Visit `https://flowdesk-puce.vercel.app/flow` — data now comes from Railway Postgres, populated by the worker polling UW.

---

### Phase E · Monitoring (optional, 15 min)

Railway's built-in metrics are lightweight. For anything more sophisticated, add free-tier external tools.

**E1. Railway built-ins (free, already on)**

- Each service has a **Metrics** tab — CPU, memory, network, request rate
- **Logs** tab streams stdout/stderr
- **Observability** tab shows deploy health

**E2. Error tracking — Sentry free tier (recommended)**

1. Sign up at https://sentry.io (free for <5K events/mo)
2. Create a Node.js project, grab the DSN
3. Add `@sentry/node` to the worker, init at startup with the DSN in env var
4. Repeat for the Next.js app on Vercel (separate Sentry project)

**E3. Uptime ping — UptimeRobot or Better Uptime**

Free tier pings your Vercel URL every 5 minutes and emails you on failures.

**E4. Cost alerts**

Already configured in Phase A2 via Railway's usage cap. If you'd like a lower threshold, lower the cap — Railway will email before pausing.

---

### Phase F · Authentication via Auth.js v5 + Whop OAuth (30 min)

Locked architecture (v1.3): every `/api/*` route requires an authenticated session. The user's identity is verified by Whop; sessions are signed cookies issued by Auth.js v5 running inside the Vercel app. There is no separate auth service to deploy.

**F1. Create the Whop product/access pass**

1. Sign up at https://whop.com as a creator
2. Dashboard → **Apps & Products** → **Create new** → **Free product/membership**
3. Name: "FlowDesk access"
4. Copy the **Product ID** — this is `WHOP_PRODUCT_ID`
5. Settings → **OAuth** → create an OAuth app
   - Redirect URI: `https://flowdesk-puce.vercel.app/api/auth/callback/whop` (use your real domain)
   - Copy the **Client ID** (`WHOP_CLIENT_ID`) and **Client Secret** (`WHOP_CLIENT_SECRET`)

**F2. Install Auth.js v5 in the Next.js app**

```bash
cd "/Users/Stefan/Documents/Coding/Champagne Room Software/flowdesk"
npm install next-auth@beta @auth/prisma-adapter
```

**F3. Add the Whop OAuth provider**

Auth.js doesn't ship with Whop as a built-in provider; we add it as a custom OAuth provider. Skeleton at `lib/auth.ts`:

```ts
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    {
      id: "whop",
      name: "Whop",
      type: "oauth",
      authorization: {
        url: "https://whop.com/oauth/authorize",
        params: { scope: "user:read membership:read", response_type: "code" },
      },
      token: "https://api.whop.com/api/v5/oauth/token",
      userinfo: "https://api.whop.com/api/v5/me",
      clientId: process.env.WHOP_CLIENT_ID,
      clientSecret: process.env.WHOP_CLIENT_SECRET,
      profile(profile) {
        return { id: profile.id, email: profile.email, whopMembershipId: profile.id };
      },
    },
  ],
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    async signIn({ user, account, profile }) {
      // Verify the user's Whop membership covers WHOP_PRODUCT_ID.
      const res = await fetch(
        `https://api.whop.com/api/v5/me/memberships?product_id=${process.env.WHOP_PRODUCT_ID}`,
        { headers: { Authorization: `Bearer ${account?.access_token}` } }
      );
      if (!res.ok) return false;
      const { data } = await res.json();
      const active = data?.some((m: any) => m.status === "active");
      return Boolean(active);
    },
  },
});
```

> Verify the Whop OAuth endpoint paths against current Whop docs at provisioning time — the URLs above match v5 of the Whop API as of April 2026.

**F4. Add the catch-all auth route**

`app/api/auth/[...nextauth]/route.ts`:

```ts
export { GET, POST } from "@/lib/auth";
```

**F5. Gate every other API route**

Add the 3-line check at the top of `app/api/{watches,sentiment,market-tide,gex,flow,darkpool}/route.ts`:

```ts
import { auth } from "@/lib/auth";
const session = await auth();
if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

**F6. Add the `/login` page**

`app/login/page.tsx` — minimal Next.js page with a "Sign in with Whop" button that calls `signIn("whop")`.

**F7. Set Vercel env vars**

```bash
vercel env add WHOP_CLIENT_ID production
vercel env add WHOP_CLIENT_SECRET production
vercel env add WHOP_PRODUCT_ID production
vercel env add NEXTAUTH_URL production    # https://flowdesk-puce.vercel.app
vercel env add NEXTAUTH_SECRET production # output of: openssl rand -base64 32
```

**F8. Periodic membership re-check**

Auth.js runs the `signIn` callback only on initial login. To revoke access mid-session when a Whop membership lapses, add a `session` callback that refreshes `users.membershipCheckedAt` every ~5 minutes and re-hits the Whop memberships endpoint:

```ts
session: {
  async session({ session, user }) {
    if (!user.membershipCheckedAt || Date.now() - user.membershipCheckedAt.getTime() > 5 * 60 * 1000) {
      const stillActive = await checkWhopMembership(user.whopMembershipId);
      if (!stillActive) throw new Error("Membership revoked");
      await prisma.user.update({ where: { id: user.id }, data: { membershipCheckedAt: new Date() } });
    }
    return session;
  },
},
```

**Cost:** Whop is free for free products. Auth.js is open-source. No new line items.

### What AWS would have been (for comparison)

This doc originally walked through 8 phases of AWS setup (account hardening, IAM, VPC, security groups, RDS, Secrets Manager, Lambda + EventBridge, CloudWatch). Railway collapses that to 4 phases because:

- No IAM/VPC/security group plumbing — everything is inside one Railway project
- No RDS Proxy — Postgres is managed end-to-end
- No Lambda packaging or cron wiring — one Node service with `node-cron`
- No Secrets Manager — env vars on the service are encrypted at rest

What you trade: no granular IAM policies, less detailed metrics than CloudWatch, no point-in-time DB restore beyond Railway's default retention (4 days of snapshots on Hobby). For a single-user tool these trade-offs are correct. Revisit AWS only if Railway pricing or limits become a constraint.

---

## 7. Punch list in execution order

- [ ] Phase A1–A3: Railway sign-up, billing + $25/mo hard cap, create `flowdesk` project
- [ ] Phase B1: Add Postgres service to the project
- [ ] Phase B2: Install `psql` locally
- [ ] Phase B3: Test connection via `DATABASE_PUBLIC_URL`
- [ ] Phase B4: Update `prisma/schema.prisma` with §3 V1-active additions (FlowAlert, GexSnapshot, MarketTideBar, NetImpactDaily, DarkPoolPrint, AiSummary, **User, TickerMetadata, HitListDaily**). 🗄 Archived in v1.4 — do NOT add: XPost, SentimentSnapshot, AnalystProfile, DivergenceAlert
- [ ] Phase B5: `npx prisma migrate deploy` against Railway Postgres
- [ ] Phase C1: Scaffold `worker/` directory in the repo; move `lambdas/hitlist-compute`, `lambdas/dp-ranking` into `worker/src/jobs/`. 🗄 Park `lambdas/sentiment-batch` under `worker/src/jobs/_archived/` for future reactivation
- [ ] Phase C1: Implement V1-active job files: `uw.ts`, `ai-summarizer.ts` (GEX-only), `retention.ts`, `s3-import.ts`, `hit-list-compute.ts`, `refresh-ticker-metadata.ts`. 🗄 Skip `x.ts` (Sentiment Tracker archived)
- [ ] Phase C1: Implement `worker/src/prompts/gex.ts` per PRD §3.4 template. 🗄 Skip `prompts/sentiment.ts` (template archived)
- [ ] Phase C3: Commit + push
- [ ] Phase C4: Create the worker service on Railway, reference Postgres DB, set env vars (UW, Anthropic, AWS S3, TZ — NOT X_BEARER_TOKEN), set root dir to `worker/`
- [ ] Phase C5: Confirm `[worker] started` log and first data rows land in Postgres
- [ ] Phase D5: Rewrite each `app/api/*/route.ts` to read from Postgres (remove the 501 branch); add the 3-line `auth()` check at the top
- [ ] **Phase F1: Create the free Whop product/access pass + OAuth app**
- [ ] **Phase F2–F8: Install Auth.js v5, add Whop OAuth provider, gate all `/api/*` routes, build `/login` page, set Whop + NEXTAUTH env vars in Vercel**
- [ ] Phase D2–D3: Set `DATABASE_URL` + `USE_MOCK_DATA=false` in Vercel, redeploy
- [ ] Phase E: Sentry + UptimeRobot (optional)
- [ ] Confirm Railway usage stays inside the $25 cap after a full week
- [ ] Confirm UW multi-user license posture before onboarding past initial-user testing (PRD §16)

---

## 8. Open questions

**Resolved in v1.2.1:**
- ~~X API tier~~ → **Basic ($100/mo) confirmed**, used directly (no xAI Grok layer).
- ~~Data retention~~ → **60d flow / 30d DP except perpetual top-100 per ticker** (see §2.1).

**Resolved in v1.3:**
- ~~Single worker vs multi-service~~ → **Single worker (option A)** locked. The `services/websocket-server` + `services/data-ingestion` scaffolding stays dormant; lambdas move to `worker/src/jobs/`.
- ~~Authentication on Next.js API routes~~ → **Auth.js v5 with Whop OAuth provider** (Phase F). Whop manages the access list via a free product/access pass. Each user gets a session cookie; every `/api/*` route 401s without one.
- ~~Disaster recovery~~ → **Railway default 4-day daily snapshots** accepted.
- ~~GEX key levels~~ → **Worker computes** call wall / put wall / gamma flip from per-strike rows. Max pain comes from UW's `/options-volume` if available, otherwise computed locally.
- ~~AI summary prompt templates~~ → **Locked.** See PRD §3.4 for the full sentiment + per-ticker GEX templates. Files live at `worker/src/prompts/{sentiment,gex}.ts`.

**Still open:**

1. **Top Net Impact source.** Preferred path is a UW endpoint exposing the bid/ask formula (PRD §11); fallback is worker-side aggregation. Confirm with UW support whether `/api/option-trades/flow-alerts` rows include `*_bid_premium` / `*_ask_premium`.
2. **UW multi-user license.** Basic tier is licensed for personal/single-user use. A Whop-managed access list (potentially scaling to ~100 internal company users) likely requires a team or enterprise agreement with UW. Confirm with UW sales before moving past initial-user testing.
