# FlowDesk — Live Architecture & Railway Setup
### From mock sandbox to a live data pipeline · v1.2 · Apr 2026

This doc scopes what needs to stand up to flip `USE_MOCK_DATA=false` and
serve real data from Unusual Whales, X API v2, and Anthropic. Paired with
the PRD at [./FlowDesk_PRD.md](./FlowDesk_PRD.md).

**v1.2 update (Apr 29, 2026):** locks the architecture-review decisions —
60-day flow retention, split DP retention (perpetual top-100 / 30 days
otherwise), Polygon historical DP backfill consumed via S3, GEX AI
explanations pre-computed in the daily 07:00 ET batch, X API v2 used
directly. Adds retention-sweep crons, the S3 import job, and corrects a
node-cron expression bug in the v1.1 schedule list.

**v1.1 (Apr 2026):** switched cloud host from AWS to **Railway**.
Railway is a managed PaaS (like a modern Heroku) — one dashboard handles
Postgres, worker services, cron schedules, and env-var management.
Trade-off: we lose AWS's granular IAM / VPC / CloudWatch story in
exchange for dramatically less setup and about half the monthly cost.
For a single-user personal tool, that trade-off is correct.

---

## 1. System overview

```
                         ┌─────────────────────────────────────┐
                         │      Vercel (Next.js frontend)      │
                         │  https://flowdesk-puce.vercel.app   │
                         └───────────┬─────────────────────────┘
                                     │ HTTPS + TLS to DB
                                     ▼
                         ┌─────────────────────────┐
                         │  Railway: Postgres 16   │  managed DB
                         │  (DATABASE_URL)         │  connection pooling built-in
                         └───────────▲─────────────┘
                                     │ writes
                         ┌───────────┴─────────────┐
                         │  Railway: flowdesk-     │  single long-running
                         │  worker (Node service)  │  service with node-cron
                         │                         │  managing 3 schedules:
                         │  • uw-poll   30s (mkt)  │
                         │              5m (off)   │
                         │  • x-batch   06:00 ET   │
                         │  • ai-summ   07:00 ET   │
                         └───────────┬─────────────┘
                                     │ reads env vars
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ Unusual Whales   │  │   X API v2       │  │ Anthropic Claude │
   │ api.unusual      │  │  api.x.com       │  │ api.anthropic    │
   │ whales.com       │  │                  │  │  .com            │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

**Design principles**

1. **Pull, don't push.** UW doesn't offer a WebSocket; polling is the only option. The poller runs on Railway (not Vercel) so Vercel's function-duration limits don't constrain freshness.
2. **Single source of truth.** Everything polled lands in Postgres. Vercel reads from Postgres, never calls upstream APIs directly. Reasons: (a) keeps UW / X rate limits manageable, (b) gives us a time-series we can backtest against, (c) insulates the UI from upstream outages.
3. **One worker, scheduled internally.** Rather than deploying three separate Lambdas + cron triggers (the AWS approach), we run **one long-lived Node service** that uses `node-cron` to trigger each job at the right cadence. Simpler deploy, same outcome, cheaper on Railway's pricing model.
4. **Connection pooling handled by Railway.** Railway's Postgres includes built-in pooling — no RDS Proxy equivalent to provision.
5. **Single provider.** Everything (DB + worker + env-var secrets) lives in one Railway project. Logs, metrics, and deploys are managed from one dashboard.

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

### 2.2 X API v2

Pulled by the worker's `x-batch` cron, scheduled once daily at 06:00 ET (before market open). v1 uses the X API v2 Basic tier directly (xAI Grok was previously listed as an alternative — dropped in v1.2.1).

- **Watchlist mentions:** `GET /2/tweets/search/recent?query=($NVDA OR $PLTR OR ...)&max_results=100` for every ticker on the watchlist. Paginated until quota or cutoff.
- **Tracked analyst posts:** For each analyst handle in `analyst_profiles`, `GET /2/users/:id/tweets?start_time=...`. Capture the last 24 hours.
- Raw posts land in `x_posts`; sentiment classification happens in the next step (see §2.3).

**Rate limits:** X API v2 Basic ($100/mo) gives ~500K tweet reads/month — comfortably enough for 50 tickers × once-daily + 20 analysts × 30 posts/day.

### 2.3 Anthropic Claude

Called by the worker's `ai-summarizer` cron at 07:00 ET (Mon–Fri). v1.2.1 batches **two** workloads in one run:

1. **Sentiment summary:** classify last 24h of `x_posts` (bull/bear/neutral), generate the market-wide AI summary paragraph, store in `ai_summaries` (`kind="sentiment-{YYYY-MM-DD}"`) and update `sentiment_snapshots`.
2. **Per-ticker GEX explanation:** for each watched ticker (SPY/QQQ/SPX/NVDA/TSLA — see PRD §8), pull the most recent `gex_snapshots` row, prompt Claude with regime + spot + key levels + DV-vs-OI delta, store the response in `ai_summaries` (`kind="gex-{TICKER}-{YYYY-MM-DD}"`).

The GEX modal in the frontend reads the cached body and renders a header note: *"Static summary as of market open — regime and key levels may change throughout the trading day."* On-demand (per-click) generation moves to a later iteration once latency/cost is benchmarked.

**Model:** `claude-haiku-4-5`. Estimated cost: ~$1–3/month for the combined batch (sentiment + 5 GEX explanations × ~300 tokens each).

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
| Railway egress | UW polling + occasional X batch | < $1 |
| **Railway subtotal** | | **~$15–20/mo** |
| UW Basic | | $150 |
| X API Basic | | $100 |
| Anthropic Claude Haiku | | ~$1–5 |
| Vercel Hobby | | $0 |
| **Total** | | **~$270–275/mo** |

**Compared to AWS (v1.0 plan):** the infra line drops from ~$44/mo (RDS + Proxy + Lambda + Secrets + CloudWatch) to ~$15–20/mo on Railway. Same workload, roughly half the cost, and the setup walkthrough shrinks from 8 phases to 4.

Cheaper paths if you want: move X to the free tier for the sandbox phase (saves $100), downgrade the Railway Postgres service (saves ~$5), defer the worker by running the poller locally overnight during development (saves ~$8).

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
import { pollFlowAlerts, pollGex, pollDarkPool, pollMarketTide, computeNetImpact } from "./uw.js";
import { runXBatch } from "./x.js";
import { runAiSummary } from "./ai.js";
import { runFlowRetentionSweep, runDpRetentionSweep } from "./retention.js";
import { importDarkpoolHistory } from "./s3-import.js";

// node-cron uses 6-field expressions (sec min hour DOM month DOW). TZ=America/New_York
// is set as a service env var so all expressions below resolve in ET.
const marketHours30s   = "*/30 * 9-15 * * 1-5";     // every 30s, 9:00-15:59 ET (covers 9:30 open through 16:00 close)
const offHours5m       = "0 */5 0-8,16-23 * * 1-5"; // every 5 min outside market hours, weekdays
const marketGex60s     = "*/60 * 9-15 * * 1-5";     // every 60s, market hours, per watched ticker
const marketTide5m     = "0 */5 9-15 * * 1-5";      // every 5 min, market hours (UW returns 5-min buckets)
const netImpact5m      = "30 */5 9-15 * * 1-5";     // every 5 min at :30 (offset 30s after tide poll lands)
const daily6amET       = "0 0 6 * * 1-5";           // 06:00 ET Mon–Fri — X batch
const daily7amET       = "0 0 7 * * 1-5";           // 07:00 ET Mon–Fri — sentiment + GEX explanation batch
const daily3amET       = "0 0 3 * * 1-5";           // 03:00 ET Mon–Fri — retention sweeps
const daily2amET       = "0 0 2 * * 1-5";           // 02:00 ET Mon–Fri — pull new S3 DP history files

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

// X API daily batch
cron.schedule(daily6amET, runXBatch);

// AI summary batch — sentiment + per-ticker GEX explanations
cron.schedule(daily7amET, runAiSummary);

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
   - `X_BEARER_TOKEN` → your X API bearer token
   - `ANTHROPIC_API_KEY` → your Anthropic key
   - `TZ` → `America/New_York` (so cron expressions respect ET)
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DARKPOOL_S3_BUCKET`, `DARKPOOL_S3_PREFIX` — for the dark-pool history S3 import job (PRD §3.5). The Polygon extraction pipeline lands files in this bucket; the worker job consumes them.
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
- [ ] Phase B4: Update `prisma/schema.prisma` with §3 additions
- [ ] Phase B5: `npx prisma migrate deploy` against Railway Postgres
- [ ] Phase C1: Scaffold `worker/` directory in the repo
- [ ] Phase C1: Implement `uw.ts`, `x.ts`, `ai.ts` polling jobs
- [ ] Phase C3: Commit + push
- [ ] Phase C4: Create the worker service on Railway, reference Postgres DB, set env vars, set root dir to `worker/`
- [ ] Phase C5: Confirm `[worker] started` log and first data rows land in Postgres
- [ ] Add authentication to API routes (API key header or NextAuth single-user) before flipping `USE_MOCK_DATA` off
- [ ] Phase D5: Rewrite each `app/api/*/route.ts` to read from Postgres (remove the 501 branch)
- [ ] Phase D2–D3: Set `DATABASE_URL` + `USE_MOCK_DATA=false` in Vercel, redeploy
- [ ] Phase E: Sentry + UptimeRobot (optional)
- [ ] Confirm Railway usage stays inside the $25 cap after a full week

---

## 8. Open questions

**Resolved in v1.2.1:**
- ~~X API tier~~ → **Basic ($100/mo) confirmed**, used directly (no xAI Grok layer).
- ~~Data retention~~ → **60d flow / 30d DP except perpetual top-100 per ticker** (see §2.1).
- ~~Top Net Impact source~~ → preferred path is a UW endpoint exposing the bid/ask formula (PRD §11); fallback is worker-side aggregation. Confirm with UW support whether `/api/option-trades/flow-alerts` rows include `*_bid_premium` / `*_ask_premium`.

**Still open:**

1. **Single worker vs multi-service architecture.** This doc specs the single-worker model. The repo also contains scaffolding for `services/websocket-server` (Clerk + Redis + ws) and `services/data-ingestion`. Resolve before standing up the worker — the recommendation is single-worker since UW has no push channel and a personal tool doesn't need Clerk.
2. **Authentication on the Next.js API routes.** Before flipping to live data, at least an API key header is needed so random visitors can't hammer the endpoints and burn the UW quota. NextAuth single-user (email magic link) is the recommended path.
3. **Disaster recovery.** Railway's default 4-day daily snapshots — fine for a personal tool. Bump retention only if it ever matters.
4. **GEX key levels in production.** UW does not expose call wall / put wall / gamma flip directly; the worker derives them from per-strike rows. Confirm whether UW returns max pain anywhere (likely in `/options-volume`) before computing it locally.
5. **AI summary prompt template.** Lock the input schema and target output length for both `kind="sentiment-{date}"` and `kind="gex-{TICKER}-{date}"` before the first 07:00 ET batch run, so output stays consistent across days.
