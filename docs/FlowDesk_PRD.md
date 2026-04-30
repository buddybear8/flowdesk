# FlowDesk — Product Requirements Document
### Trading Intelligence Dashboard · v1.2.1 · April 2026

*Revised Apr 29, 2026 — v1.2.1 locks decisions from the architecture review: UW Basic tier confirmed, Vanna/Charm pill toggle removed from V1, X API v2 used directly (xAI Grok dropped), historical DP ranking restored via Polygon-sourced S3 import, GEX AI explanation pre-computed daily, top 10 by |Net Impact|, retention rules locked (60-day flow, 30-day DP except perpetual top 100), Confidence enum normalized to HIGH/MED/LOW.*  
*Prior v1.2 (Apr 23, 2026) added Market Pulse and reflected the live Vercel deployment + security hardening landed 2026-04-22.*

---

## Table of Contents

1. [Project overview](#1-project-overview)
2. [Tech stack](#2-tech-stack)
3. [Data sources & APIs](#3-data-sources--apis)
4. [Architecture](#4-architecture)
5. [App shell & navigation](#5-app-shell--navigation)
6. [Module 1 — Daily watches](#6-module-1--daily-watches)
7. [Module 2 — Sentiment tracker](#7-module-2--sentiment-tracker)
8. [Module 3 — Options GEX](#8-module-3--options-gex)
9. [Module 4 — Flow alerts](#9-module-4--flow-alerts)
10. [Module 5 — Dark pools](#10-module-5--dark-pools)
11. [Module 6 — Market Pulse](#11-module-6--market-pulse)
12. [Design system](#12-design-system)
13. [Sandbox deployment](#13-sandbox-deployment)
14. [Backend API endpoints](#14-backend-api-endpoints)
15. [Environment variables & secrets](#15-environment-variables--secrets)
16. [Open questions & future work](#16-open-questions--future-work)
17. [Current implementation status (v1.2)](#17-current-implementation-status-v12)
18. [Shared type contracts](#18-shared-type-contracts)

---

## 1. Project overview

FlowDesk is a personal trading intelligence web app that aggregates institutional options flow, dark pool prints, gamma exposure data, and social/X sentiment into a unified real-time dashboard. It is not a brokerage or advisory tool — it is a data visualization and signal aggregation platform for a single user (personal use).

### Core goals

- Surface high-conviction trading setups combining options flow + dark pool confluence
- Visualise dealer gamma exposure across strikes (GEX/Vanna/Charm) with key levels (call wall, put wall, gamma flip, max pain)
- Surface ranked dark pool prints from Unusual Whales to identify statistically significant institutional positioning
- Produce a daily "hit list" of no more than 20 curated flow alerts that meet configurable backend criteria
- Track FinTwit sentiment and analyst accuracy over time

### Non-goals (v1)

- No brokerage integration or order execution
- No multi-user authentication (single-user personal tool)
- No mobile-first layout (desktop-optimised at ≥1280px)
- No embedded price chart widget — v1.1 descoped the TradingView / Charting module; GEX and DP levels surface in their own modules

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | **Next.js 16** (App Router + Turbopack) | React server + client components. Upgraded from 14 to patch CVE-2025-29927 and a set of DoS-class advisories |
| UI runtime | **React 19** | Required by Next 16 |
| Styling | Tailwind CSS 3.4 | Utility classes + inline styles for mockup-exact per-element colors |
| Charts | **Chart.js 4.x + react-chartjs-2** | Horizontal bar chart for GEX/Vanna/Charm by strike. No embedded time-series price chart — the TradingView/Charting module was removed from v1.1 scope |
| Icons | lucide-react | Sidebar and UI affordances |
| Class merging | clsx | |
| Language | TypeScript (strict, `react-jsx` transform) | |
| Backend API | Next.js Route Handlers (`/app/api/`) | Thin proxy + transform layer. All handlers gate real-API calls behind `USE_MOCK_DATA=true` and return mock payloads otherwise |
| Database | PostgreSQL (Supabase or Neon) | Cached API responses, stored criteria config, sentiment snapshots. No longer used for historical DP ranking (removed from v1.2) |
| ORM | Prisma | Schema migrations |
| Real-time | Polling against UW endpoints; prices arrive embedded in flow, GEX, market-tide, and DP responses | **v1.2 default — no dedicated price feed vendor.** Finnhub ($50/mo) remains an optional upgrade if sub-second ticks become necessary. See §3.2 |
| Hosting | **Vercel** (frontend) + **Railway** (Postgres + worker service) | Frontend live on Vercel; Railway hosts the live-data DB and the polling worker. Full setup in [ARCHITECTURE.md](./ARCHITECTURE.md) §6. |
| AI summaries | Anthropic Claude API (`claude-haiku-4-5`) | Pre-market batch, ~$1/mo for 50 tickers/day |
| Sentiment API | xAI Grok API or X API v2 | Cashtag mention velocity, once-daily batch |

---

## 3. Data sources & APIs

### 3.1 Unusual Whales API

**Base URL:** `https://api.unusualwhales.com`  
**Auth:** `Authorization: Bearer <UW_API_TOKEN>` + `UW-CLIENT-API-ID: 100001`  
**All requests are GET only.**

| Data needed | Endpoint | Notes |
|---|---|---|
| Options flow / flow alerts | `GET /api/option-trades/flow-alerts` | Params: `limit`, `is_call`, `is_put`, `is_otm`, `min_premium`, `ticker_symbol`, `size_greater_oi` |
| Options screener | `GET /api/screener/option-contracts` | Params: `limit`, `min_premium`, `type`, `is_otm`, `issue_types[]`, `min_volume_oi_ratio` |
| Spot GEX by strike (directionalized volume) | `GET /api/stock/{ticker}/spot-exposures/strike` | Response fields: `strike`, `call_gamma_oi`, `put_gamma_oi`, `call_gamma_bid`, `call_gamma_ask`, `put_gamma_bid`, `put_gamma_ask` · Updates real-time |
| Static GEX by strike (OI-based) | `GET /api/stock/{ticker}/greek-exposure/strike` | OI counts locked intraday, dollar values recalculate vs spot · First update ~6:50 AM ET after OCC 6:45 AM release |
| Dark pool — ticker | `GET /api/darkpool/{ticker}` | Live feed only — historical pre-2026 prints come from the Polygon-sourced S3 backfill (see §3.5) |
| Dark pool — market-wide | `GET /api/darkpool/recent` | |
| Market tide | `GET /api/market/market-tide` | Params: `interval_5m` |
| Options volume & P/C ratio | `GET /api/stock/{ticker}/options-volume` | Used for max-pain key level (per-strike OI snapshot) when present |

**Net directionalized GEX calculation (per strike):**
```
net_dir_vol_GEX = (call_gamma_ask - call_gamma_bid) - (put_gamma_ask - put_gamma_bid)
net_OI_GEX     = call_gamma_oi - put_gamma_oi
net_combined   = net_OI_GEX + net_dir_vol_GEX   ← what we display in the combined chart
```

**Update frequency:**
- Volume-based spot GEX: **real-time** throughout session
- OI-based GEX: **real-time dollar recalculation** intraday (OI counts locked until 6:45 AM ET next day)
- Pre-market gamma values: modeled from pre-market data in some scenarios

**v1 tier — confirmed Basic ($150/mo).** Advanced ($375/mo) adds Vanna/Charm endpoints and higher rate limits. v1.2.1 ships with the GEX greek-toggle removed entirely (see §8) — Vanna and Charm return as a follow-up iteration only after the tool is live with Basic-tier data flowing.

### 3.2 Price data — UW-embedded (primary), Finnhub optional

**v1.2 decision:** UW's existing endpoints carry enough price data to cover every module in this PRD. A dedicated real-time price-feed vendor is **no longer part of the critical path**. Finnhub remains documented below as an optional upgrade.

#### Price data already available from Unusual Whales

| Consumer | Source | Freshness |
|---|---|---|
| Spot price in GEX module | `/api/stock/{ticker}/spot-exposures/strike` — response includes spot | Updates on every GEX request (real-time intraday) |
| `% change` / spot on flow alerts | Each row in `/api/option-trades/flow-alerts` has a `spot` field captured at alert time | Per-alert (seconds-to-minutes cadence) |
| SPY price line in Market Pulse | `/api/market/market-tide?interval_5m=1` series includes SPY price per bucket | 5-min resolution |
| Trade price on dark pool prints | `/api/darkpool/*` returns `price` per print | Real-time as prints arrive |
| Basic ticker info (volume, day range) | UW ticker snapshot endpoints | On demand |

Net result: for a personal analytics dashboard where price updates at the cadence of the underlying UW data (seconds to minutes), **no separate price vendor is required**.

#### What UW does NOT provide

- **No price-tick WebSocket** — no `wss://` stream for live trades/quotes at sub-second resolution
- **No arbitrary-ticker live quotes** — you only see prices for tickers that happen to appear in flow / GEX / DP responses. Searching a ticker UW doesn't cover today won't return a price.
- **No tick-by-tick trade data** — UW's cadence is options-flow-centric, not market-microstructure
- **Limited off-hours coverage** — pre-market / post-market price snapshots are narrower than a dedicated market-data vendor

#### Finnhub (optional upgrade) — only add if needed

If a professional-terminal feel becomes required (continuously-updating spot on every page without user action, sub-second tick charts, arbitrary ticker price lookup), add Finnhub:

- **Tier:** All-In-One — $50/mo (real-time US stock trades via WebSocket + REST, 300 calls/minute)
- **WebSocket URL:** `wss://ws.finnhub.io?token=<FINNHUB_API_KEY>`
- **Key endpoints:** WebSocket trade ticks, `GET /quote?symbol=SPY` (quote snapshot), `GET /stock/candle?...` (OHLCV bars)
- **Fan-out architecture:** one Finnhub WebSocket connection on the backend server fans trade messages out to N browser sessions — never open multiple Finnhub connections per ticker

Until that tipping point is reached, the $50/mo is not spent.

**Price-vendor history:** v1.0 used Polygon.io Advanced ($199/mo). v1.1 replaced it with Finnhub All-In-One ($50/mo). v1.2 drops Finnhub from the critical path in favor of UW-embedded prices — saving $50/mo on the default plan while keeping Finnhub as a clean drop-in if needs grow.

### 3.3 X API v2

**Purpose:** Cashtag mention velocity, sentiment scoring, analyst post tracking  
**Tier:** Basic ($100/mo) — ~500K tweet reads/month, comfortably enough for 50 tickers × once-daily + 20 analysts × 30 posts/day  
**Cadence:** Once-daily pre-market batch (not real-time)  
**Decision (v1.2.1):** xAI Grok was previously listed as an alternative; v1 uses **X API v2 directly** to eliminate an extra dependency. Anthropic Claude Haiku (§3.4) handles bull/bear/neutral classification of the raw posts.  
**Important:** Unusual Whales' Socials Tracker is a website-only feature — UW does NOT expose X/Twitter sentiment via their API. Must use X API directly.

### 3.4 Anthropic Claude API

**Purpose:** Pre-market AI summaries for Sentiment tracker and GEX AI explanation modal  
**Model:** `claude-haiku-4-5` (cost-optimised)  
**Cadence:** Once daily pre-market batch + on-demand for GEX modal  
**Cost estimate:** ~$1/mo for 50 tickers/day pre-market

### 3.5 Dark pool data source

**Purpose:** Stream ranked dark pool prints for the Dark pools module feed and compute durable historical rank against a multi-year tick-level index.

**Live feed:** Unusual Whales `GET /api/darkpool/recent` and `GET /api/darkpool/{ticker}` — on the Basic tier we already pay for. No additional vendor required for the live stream.

**Historical ranking database — RESTORED in v1.2.1** (after being briefly removed in v1.2). The `dark_pool_prints` Postgres table is populated from a Polygon.io historical trades backfill, restricted to the curated watchlist tickers, and is used to compute durable all-time rank + percentile fields per print.

**Backfill pipeline (handled outside this codebase):**
1. Polygon.io historical trades are extracted, filtered to dark-pool prints (`exchange_id=4` + `trf_id` set) for the watchlist tickers, and deposited as Parquet/CSV files in an **AWS S3 bucket** owned by the user.
2. A worker job in this codebase (`worker/src/jobs/import-darkpool-history.ts`) reads from the S3 bucket and writes rows into `dark_pool_prints`.
3. The extraction-from-Polygon step is being scoped in a separate work stream and is **out of scope for this codebase** — only the S3-to-Postgres import is in scope here.

**Retention rule (per §17 / ARCHITECTURE §2.1):**
- Top-100 ranked prints per ticker: **retained in perpetuity** (this is the historical ranking corpus).
- All other prints: 30-day rolling window.

**Consequence in the UI:** The Dark Pools module's feed shows ranked prints. `rank` and `percentile` are computed locally against the perpetual top-100 corpus; for prints outside the top 100, the rank/percentile from the live UW response is passed through. See §10.

---

## 4. Architecture

```
Browser (Next.js)
    │
    └── HTTP/REST ──► Next.js API Routes (/app/api/)
                         │
                         ├── Unusual Whales API (flow, GEX, dark pool, market tide — prices embedded in responses)
                         ├── xAI / X API (sentiment batch, cached)
                         ├── Anthropic API (AI summaries, on-demand)
                         └── PostgreSQL (cache, criteria config, sentiment snapshots)

    ┌─ Optional ─────────────────────────────────────┐
    │ WebSocket fan-out server (Node.js `ws`)         │
    │  └── Finnhub WebSocket — real-time prices       │
    │  Only deployed if/when sub-second tick data     │
    │  is required (see §3.2).                        │
    └────────────────────────────────────────────────┘
```

**Caching strategy:**
- GEX data: cache 30 seconds; refresh on user action or next poll
- Flow alerts: poll every 30 seconds (or WebSocket stream if a push channel becomes available)
- Sentiment data: cache until next 6 AM ET run
- AI summaries: cache until next 6 AM ET run, store in DB with generation timestamp
- Dark pool feed: poll UW `/api/darkpool/recent` every 15–30 seconds during market hours

---

## 5. App shell & navigation

### Layout

Fixed-width left sidebar (192px) + flexible main content area. Height: full viewport. No horizontal scroll.

### Sidebar structure

```
┌─────────────────────┐
│ [SVG mark] FlowDesk │
│ Trading intelligence│
│ [Search nav...]     │
├─────────────────────┤
│ MODULES             │
│ 🔥 Daily watches  [new] │
│ 👑 Sentiment tracker │
│ 🌀 Market Pulse     │
│ ⚡ Options GEX      │
│ 📈 Flow alerts   [18] │
│ 🌊 Dark pools       │
├─────────────────────┤
│ ACCOUNT             │
│ ★  Watchlists       │
│ 🔔 Alerts         [3] │
├─────────────────────┤
│ ⚙  Settings         │
└─────────────────────┘
```

Icons are rendered as emoji on 26×26 tinted-background tiles. The logo mark is a blue rounded square with a white `^` SVG (upward trend).

### Active state

Active nav item: `background: var(--color-background-info)`, `border: 0.5px solid var(--color-border-info)`, label `color: var(--color-text-info)`, icon tile background `rgba(24,95,165,0.15)`.

### Topbar (44px)

Left: breadcrumb `Module / Sub-page` — the sub-page text updates live when the user clicks a tab below. Right: market status pill (green `● Market open` / red `● Market closed`).

### Tab bar

Sits below the topbar. Each module has its own tab set. **Tab state is URL-synced via `?tab=N` query param** so the Topbar breadcrumb and the module view stay in lockstep and deep links are shareable. Active tab: bottom border `2px solid #185FA5`, color `#185FA5`.

### Module tab sets (built in v1.2)

| Module | Tabs | Built |
|---|---|---|
| Daily watches | Hit list · Criteria config | Hit list only (Criteria config placeholder) |
| Sentiment tracker | Overview · Analyst intelligence | **Both** |
| Market Pulse *(new v1.2)* | *single page — no sub-tabs* | Tide line chart + Top Net Impact bar chart stacked |
| Options GEX | *single page — no sub-tabs* | Full single-page layout |
| Flow alerts | Live feed · Sweep scanner · 0DTE flow · Unusual activity | Live feed only (others placeholders) |
| Dark pools | Ranked feed · DP levels | Ranked feed only (DP levels placeholder) |

**Note:** Options GEX was originally scoped with 5 sub-tabs. v1.1 collapses it to a single canonical view to reduce clutter; additional GEX views (By expiry, Vanna & charm, Key levels) are deferred to post-sandbox iterations.

---

## 6. Module 1 — Daily watches

### Purpose

A curated "hit list" of no more than 20 flow alerts per day, filtered by configurable backend criteria. Designed to surface only the most actionable setups, enriched with dark pool confluence checking.

### Layout

Adaptive two-panel:
- **Left panel** contains the session header, hit list table, and sector flow bar chart.
  - When a row is selected → fixed `w-[520px]` with a right border, detail panel visible on the right.
  - When no row is selected (user clicked "↩ Return to overview") → panel expands to `flex-1` and fills the full content area, border hidden.
- **Right detail panel** (flex-1) renders per-row detail. Dismissed via the "↩ Return to overview" button in its nav row.

Default state: row 1 selected → detail panel visible.

### Left panel — header

- Date (e.g. "Monday, April 21")
- Bullish/bearish sentiment badge (driven by C/P ratio and net premium direction)
- Summary meta: Total Premium · Call/Put ratio · Lead sector

### Left panel — hit list table

**Columns:**

| Column | Width | Notes |
|---|---|---|
| # | 22px | Rank/position number |
| Ticker | 66px | Bold, blue link color, direction arrow (▲ green / ▼ red) |
| Conf. | 48px | HIGH (green) / MED (amber) / LOW (red) badge |
| Premium | 68px | Bold, green for bullish, red for bearish |
| Contract | 96px | e.g. `$145P May 15` |
| DP confluence | 72px, centered | Purple `● Rank #N` badge if ranked DP print within 48h; `—` if none |
| Thesis | flex | Truncated text, full on hover |
| Sector | 80px | Muted text |

Clicking any row: highlights row (blue bg) and loads detail panel on right. Default selected: row 1.

**Sort control:** Dropdown top-right — Actionability (default) / Premium ↓ / Confidence

**Row limit:** Maximum 20 rows. Backend criteria config determines what qualifies. **Current demo ships 6 curated hits** (MRVL, IVZ, GLD, CDNS, SPY, NVDA) matching the Sandbox mockup.

### Left panel — sector flow bar chart

Horizontal bar chart below the hit list. Sectors on Y-axis, net premium on X-axis. Green bars = net bullish flow. Red bars = net bearish flow. Values shown at right end of each bar (e.g. `+$23.6M`).

### Right panel — detail view

Triggered by row click. Structure (top to bottom):

1. **Nav bar:** "↩ Return to overview" button (clears `selRow`, hides the detail panel, expands the left panel to fill) · "Following focus" (right, muted)
2. **Header:** Ticker (22px bold) + sector/rank sub-label + price (right-aligned, 20px)
3. **Sentiment button:** ▲ Bullish (green) or ▼ Bearish (red), pill style
4. **Three metric cards in a bordered grid:** Total Premium · Contracts · Confidence (value colored per-confidence)
5. **"Why this stands out" callout box** — grey background, thesis text
6. **Contracts table:** Strike · Expiry · Premium · Rule · V/OI — clickable rows, highlighted selection (blue bg on select)
7. **Dark pool confluence box:**
   - If DP trade found within 48h: purple background + left border, shows rank, age ("today"/"yesterday"), and print size
   - If no DP trade: grey background, "No ranked dark pool confluence" message
8. **Sector peers with flow today:** Chip row, direction-coded (▲/▼ colored green/red), active-ticker peer highlighted in blue
9. **Related theme card:** Theme name + total premium, chip row of related tickers, current ticker highlighted in blue

### Criteria config tab

Admin-style input form where backend filter criteria are configured:

- Min premium threshold (default $700K)
- Confidence filter (HIGH only / HIGH+MED / all)
- Execution types to include (Sweep / Floor / Block / Single checkboxes)
- Max alerts to show (1–20, default 20)
- Exclude sectors (multi-select)
- Dark pool confluence required (toggle — if on, only show tickers with ranked DP print)
- Save button persists config to DB

### Dark pool confluence logic

For each ticker in the hit list:
1. Query UW `GET /api/darkpool/{ticker}?hours=48` and filter to ranked prints only
2. If any rows found: `dpConf = true`, expose `dpRank` (lowest rank number = best), `dpAge` ("today" or "yesterday"), `dpPrem`
3. Otherwise: `dpConf = false`

---

## 7. Module 2 — Sentiment tracker

**Two tabs** — `Overview` and `Analyst intelligence` — rendered via a URL-synced TabBar. Breadcrumb updates live.

### Tab 1 — Overview

**Page header:**
- `FinTwit sentiment tracker` (17px/500)
- Meta: `Apr 20, 2026 · 8:47 AM ET · 41,820 posts analyzed`
- Right group: blue `Pre-market` pill + `Next run 8:00 AM`

**Top row — 4 metric cards (grid4):**
- Overall sentiment — `Bullish` (green), sub `Score 68 / 100`
- Posts analyzed — `41,820`, sub `Last 24 hours`
- Top velocity mover — `PLTR`, sub `+340% vs 7-day avg`
- Divergence alerts — `3` (amber), sub `Sentiment vs price`

**Main two-column grid (1.4fr : 1fr):**

Left card — **Top tickers by mention velocity:**
- Ranked 1–8 list (PLTR, NVDA, META, TSLA, AAPL, AMD, SPY, SMCI)
- Columns per row: `rank #`, ticker (bold), company name (truncated), velocity bar (coloured by dominant sentiment), velocity change % (coloured up/down/warn), sentiment pill (bull/bear/mix)
- Filter chips at top: **All · Bull · Bear** (v1 drops the "Surging" chip from initial scope to match the mockup)

Right column (two stacked cards):

*Market sentiment card:*
- Large score `68` (green) + label `Mod. bullish`
- Breakdown text `Bull 54% · Neu 22% · Bear 24%`
- Tri-color gauge bar, 7px tall, rounded
- `Trending up +4pts vs yesterday` in green
- `Sector sentiment` sub-section: 6 rows (Semis 88% · AI/Cloud 76% · Financials 61% · EV/Auto 52% · Social 31% · Energy 27%) with coloured bars + %

*Divergence alerts card:*
- Right-aligned subtitle `sentiment vs price`
- 3 rows with coloured dot (red/green/amber) + title (e.g. `META bearish flip`) + description + right-aligned time

**Bottom three-column grid:**

- **Notable posts** — top by engagement. Each post has avatar tile with per-author colours, handle, sentiment pill, time, body (cashtags highlighted blue), engagement line `"4.2K likes · 312K followers"`. Mocked with @KobeissiLetter, @TechWatcher, @MarketVigilante.
- **New entrants & flips** — two sub-sections: `First time in top 20` (SMCI, COIN, HOOD) with green `new entry` badges, and `Biggest sentiment flips` (META –41pts, PLTR +38pts, NVDA +22pts) with ticker symbol tinted by direction and `±N pts` badge.
- **AI summary** — generated-at timestamp in header, paragraph body, provenance footer `"Generated by Claude · Based on 41,820 posts · Refreshed daily pre-market"`.

### Tab 2 — Analyst intelligence

**Page header:**
- `Analyst intelligence` (17px/500)
- Meta: `Tracking 24 analysts · 100K+ followers · Apr 20, 2026`
- Right group: two sort pills — `Most followers` · `Best accuracy` (latter active by default)

**View toggle:** `Aggregate view` ↔ `Individual analyst` pill group, persistent at top below the sort pills.

**Top X analysts card (shared across both views):**
- Card wrapper with label `TOP X ANALYSTS` and contextual hint (`Click any analyst to open individual view` in aggregate; `Select analyst to view profile` in individual)
- Horizontal scrollable carousel of chips (34px circular avatar with per-analyst color theme, display name, follower count)
- `Show only analysts I track` checkbox below the carousel (aggregate view only)
- **Current demo ships 8 carousel chips** with real FinTwit-style handles: @KobeissiLetter, @SJosephBurns, @charliebilello, @markminer_, @garyblack00, @WOLF_Financial, @traderstewie, @ripster47. Production will pull anyone meeting the 100K+ follower threshold via the X API v2 — the 24-count badge in the header reflects that aggregate population.

**Aggregate view:**
- 4 metric cards: `Analysts tracked` (24), `Aggregate bias` (Bullish — 16/24 bull-leaning), `Most mentioned` (NVDA — 18 analysts today), `Top accuracy` (68% — @KobeissiLetter)
- grid2:
  - `Most mentioned` (8 rows across all analysts today) — `#`, ticker, name, `N analysts`, sentiment pill
  - `Accuracy leaderboard` (30-day calls) — per-analyst progress bar with `%`. Footer: `Directional accuracy within 5 trading days`
- grid2:
  - `Top buys` — 5 bullish calls with today's % price move, bull pill
  - `Top sells` — 5 bearish calls with today's % price move, bear pill
  - **Both footers:** `% = today's price change · Unusual Whales`

**Individual analyst view:**
- Profile card:
  - 48px avatar circle with per-analyst colour theme
  - Name + handle + bias pill (`Bullish bias` green / `Bearish bias` red / `Mixed bias` amber) + `+ Track` button (right-aligned)
  - Bio line
  - 5 inline stat cards (Mc style): Followers · Bull/bear · Posts/day · 30d accuracy · Calls tracked
- grid3:
  - `Portfolio` — 5 rows (ticker · name · `Added {date}` · % since call · `long`/`short` pill). Footer: `Inferred from public posts · not verified holdings`
  - `Recent calls` (last 14 days) — 5 rows with coloured dot (green=correct, red=incorrect, amber=pending), title (`$NVDA bullish at $812`), thesis, outcome line, date
  - `Accuracy by ticker` (30-day) — 5 rows with ticker · name · %, progress bar
- `Recent posts` card: subtitle `from {handle} today`, 2-column grid of 2 post cards (per-analyst avatar, handle, sentiment pill, time, body with cashtags highlighted, likes)

### Data pipeline

Sentiment data is pre-computed once daily pre-market:
1. Query xAI/X API for cashtag mentions across last 24h for watchlist tickers + tracked analysts
2. Classify each post as bullish/bearish/neutral using Claude Haiku
3. Compute mention velocity = (today's count) / (7-day rolling avg)
4. Store results in PostgreSQL `sentiment_snapshots` table
5. Classify analyst calls and compute 5-day forward accuracy
6. Frontend reads from DB cache, does not call X API directly

---

## 8. Module 3 — Options GEX

**Single page — no sub-tabs, no greek toggle.** The originally-scoped sub-tabs (By strike, By expiry, Vanna & charm, Key levels) were collapsed into this canonical view in v1.1. v1.2.1 additionally **removes the GEX/Vanna/Charm three-way greek toggle** because UW Basic tier (§3.1) does not include the Vanna/Charm endpoints; both greeks return as a post-V1 iteration once the tool is live with Basic-tier data flowing.

### Controls row (top)
- Ticker dropdown: SPY / QQQ / SPX / NVDA / TSLA (dropdown, not pill toggle, for density)
- Expiry filter dropdown: All / 0DTE / Weekly / Monthly

**Explainer bar:** Color-coded strip below controls (blue) with a plain-English description of GEX (dealer gamma exposure, hedging pressure, vol suppression/amplification).

**5 metric cards:** Net GEX (OI) · Gamma flip (distance from spot) · Call wall · Put wall · Max pain

**Main two-column layout:**

Left — **Net GEX bar chart:**
- Horizontal bar chart, strikes on Y-axis, net exposure on X-axis
- **Single net bar per strike** (NOT separate call/put bars)
- Positive bars: dealer long (green)
- Negative bars: dealer short (red)
- ATM strike Y-label highlighted in blue
- Key level Y-labels color-coded (call wall green, put wall red, gamma flip amber)

**Dual-series toggle (multi-select, both on by default):**
- **Dir. volume** (blue) — computed from `call_gamma_ask - call_gamma_bid - (put_gamma_ask - put_gamma_bid)` per strike
- **Open interest** (purple) — computed from `call_gamma_oi - put_gamma_oi` per strike
- Both series overlay the same chart simultaneously. Cannot deselect both — one must always remain active.

Right — **Details panel (240px):**
- Ticker, ATM strike, spot price
- OI section: gamma per 1% move, net GEX (OI-based)
- Gamma regime badge (Positive/Negative gamma) + plain-English description
- Key levels list (sorted price-descending): call wall / spot / gamma flip / max pain / put wall — each rendered as a tinted row with a coloured dot and price

**AI explanation modal:**

Triggered by "AI explanation" button. v1 reads a **pre-computed daily summary** generated by the worker's 07:00 ET batch (one row in `ai_summaries` per ticker, `kind="gex-{TICKER}-{YYYY-MM-DD}"`) — no per-click Anthropic call. Modal renders the cached body plus a header note: *"Static summary as of market open — regime and key levels may change throughout the trading day."* On-demand regeneration moves to a later iteration.

Body content (adapts to ticker's regime as of the morning batch):
- Current regime explanation (positive vs negative gamma)
- Gamma flip level analysis (distance from spot, implications if breached)
- Key levels breakdown (call wall, put wall, max pain)
- Dir. volume insight (how DV differs from OI-based view)
- "Today's actionable read" callout (different for positive vs negative regime)

### Key levels — derivation

UW does not return call wall / put wall / gamma flip directly. The worker computes these from the per-strike rows after fetch:

```
call_wall    = strike with largest positive `combined` GEX above spot
put_wall     = strike with most-negative `combined` GEX below spot
gamma_flip   = strike where running cumulative `combined` (sorted ascending by strike) crosses zero
max_pain     = strike that minimizes total option-holder payoff at next major expiry
               (computed from per-strike OI; UW may return this in /options-volume)
```

### Price chart — removed from scope

The price chart with GEX level overlays was originally scoped as part of this module, then moved to a dedicated Charting module, and **fully removed from v1.1 scope**. The Options GEX page focuses purely on strike-level gamma exposure via the horizontal bar chart. If a time-series price view returns, it will be a new iteration decision post-sandbox.

---

## 9. Module 4 — Flow alerts

### Layout

Two-panel: **left filter panel** (210px fixed) + **feed area** (flex-1).

### Left filter panel

Panel header: "Filters" label + "Reset" link.

**Filter sections (top to bottom):**

1. **Type:** All types / Calls / Puts (single-select chips)
2. **Side:** All / Buy / Sell (single-select chips)
3. **Sentiment:** All / Bullish / Bearish (single-select chips)
4. **Execution type:** All / Sweep / Floor / Single / Block (single-select chips)
5. *[divider]*
6. **Min premium:** Any / ≥$500K / ≥$1M / ≥$5M (chips) + custom Min/Max text inputs
7. **Confidence:** All / High / Medium (chips)
8. **Expiry (DTE):** Dropdown — All / 0DTE / ≤7d / ≤30d / ≤60d / ≤90d
9. **Rule / alert type:** Dropdown — All / Repeated hits / Floor trade large cap / Floor trade mid cap / Unusual activity / Block print / Large hedge
10. *[divider]*
11. **Quick toggles:** Sweep only / OTM only / Multi-leg only / Opening prints only / Size > open interest (checkboxes)
12. **Size range:** Min/Max text inputs
13. **IV range (%):** Min/Max text inputs
14. **Sector:** Dropdown with all GICS sectors

**Chip color coding:**
- Selected "All" / neutral: blue (`#E6F1FB` bg, `#185FA5` border)
- Selected Calls/Buy/Bullish/High: green (`#EAF3DE` bg, `#3B6D11` border)
- Selected Puts/Sell/Bearish: red (`#FCEBEB` bg, `#A32D2D` border)
- Selected Sweep/Medium: amber (`#FAEEDA` bg, `#854F0B` border)

### Feed area — stats bar

Fixed strip above table. Stats:

`[N] ALERTS` · `[N] CALLS` `[N] PUTS` · `[$X.XM] PREMIUM` · `[X.XX] C/P RATIO` · `[Top Rule] TOP RULE · XX%`

### Feed area — toolbar

Ticker search input + Sort selector (Time ↓ / Premium ↓ / Size ↓)

### Feed table

**Columns:**

| Column | Notes |
|---|---|
| Time | `HH:MM AM/PM`, muted |
| Ticker | Bold, primary color |
| Type | CALL (green badge) / PUT (red badge) |
| Side | BUY (green badge) / SELL (red badge) |
| Sentiment | BULLISH (green text) / BEARISH (red text) |
| Exec | SWEEP (amber) / FLOOR (purple) / SINGLE (gray) / BLOCK (blue) badge + `ML` micro-badge if multi-leg |
| Contract | Bold, e.g. `$145P May 15` |
| Size | `N,NNN cts` |
| OI | Number |
| Premium | Bold green (bullish) / bold red (bearish put sell) |
| Spot | `$XXX.XX` muted |
| Rule | Muted, 10px |
| Conf. | HIGH (green) / MED (amber) / LOW (red) badge |

New rows flash blue on arrival (CSS animation, 0.8s fade).

**Data source:** `GET /api/option-trades/flow-alerts` from Unusual Whales API, polled every 30 seconds or streamed via WebSocket if available.

### Other tabs (Sweep scanner, 0DTE flow, Unusual activity)

Pre-filtered views of the same data with specific default filter presets applied. **Not built in v1.2** — the current demo only renders the Live feed tab; other tab entries exist in the PRD scope but aren't surfaced in the UI yet.

---

## 10. Module 5 — Dark pools

### Layout

Two-panel: **left filter panel** (200px fixed) + **feed area** (flex-1).

### Left filter panel

**Trade rank filter:**
- Min/Max number inputs (range: 1–100, both default to 1 and 100)
- Range slider controlling max rank
- Hint text: "Ranks sourced from Unusual Whales"

**Filters section (toggle switches, iOS-style):**
- Hide ETFs (default OFF)
- Intraday only (default OFF)
- Regular hour (default ON)
- Extended hour (default ON)

### Stats bar

`[N] PRINTS` · `[$X.XM] TOTAL PREMIUM` · `[XM] TOTAL VOLUME` · `[#N] TOP RANK`

### Feed toolbar

Live indicator dot (green, blinking) + "Live · updating" text + Ticker search + Sort selector (Time ↓ / Rank ↑ / Premium ↓ / Size ↓ / Volume ↓)

### Feed table

**Columns:**

| Column | Notes |
|---|---|
| Time | `MM/DD HH:MM:SS` + `EXT` amber badge if extended hours |
| Ticker | Blue for equities, purple for ETFs |
| Price | 4 decimal places |
| Size | Formatted with commas |
| Premium | Bold green, formatted (K/M/B) |
| Volume | Formatted (K/M/B) |
| Trade rank | Color-coded badge — #1–3: amber + 🔥, #4–10: green, #11–25: blue, #26–50: purple, #51–100: gray |

**Data source:** pending §3.5 decision — either **Polygon.io** (retained for DP ingestion only: WebSocket with `exchange: 4` + `trf_id` filter) or **Unusual Whales** (`GET /api/darkpool/recent` + `GET /api/darkpool/{ticker}`). In both cases, enriched with rank from PostgreSQL `dark_pool_prints` table.

**Rank source:** Rank and percentile fields come directly from the UW API response. No local recomputation.

**v1.2 demo scope:** Only the `Ranked feed` tab is built. 16 prints are mocked with ranks 1–74 across SPY/QQQ/NVDA/AAPL/META/TSLA/etc. The `DP levels` tab is a placeholder.

---

## 11. Module 6 — Market Pulse

*New in v1.2. Replaces the v1.0 Charting module (TradingView-based price chart with GEX/DP overlays), which was descoped in v1.1 and whose purpose is partially covered here instead.*

### Purpose

Give a single glance at market-wide options flow health: is capital leaning bullish or bearish right now, and which tickers are pulling the flow in either direction? Two charts stacked vertically (vs. UW's horizontal layout) to differentiate the presentation.

### Route
`/market-tide`  ·  sidebar label: **Market Pulse**  ·  icon: 🌀

### Page layout

Light theme, consistent with the rest of the app. Stacked vertically from top to bottom:

1. **Page header** — `Market Pulse` title + meta (`Apr 22, 2026 · 11:34 AM · SPY price vs net call/put premium flow, updated every 5 minutes`) + live pill + source attribution
2. **4 metric cards:**
   - SPY — current price + `+N.NN% vs prev close` subtitle
   - Volume (5-min bucket) — current bucket's share volume
   - Net call premium — cumulative today, green
   - Net put premium — cumulative today, red (negative)
3. **Market Tide chart card** (320px tall):
   - Dual Y-axis line chart
   - Left axis: SPY price (gold `#EF9F27`)
   - Right axis: Net call premium ($M, green `#3B6D11` with 10% fill) and Net put premium ($M, red `#E24B4A` with 8% fill)
   - X-axis: time in 5-min buckets (9:30 AM → current)
   - Tooltip: hover shows all three values at that minute
   - `1H / 4H / 1D` pill toggle (UI-only in v1.2, wiring to API deferred)
4. **Top Net Impact chart card** (auto-height, ~22px per ticker):
   - Horizontal bar chart, **10 tickers** ranked by `|Net Impact|`
   - Bars extend from 0 — positive = green, negative = red
   - Sorted most-positive → most-negative for chart readability (positive bars at top, negative at bottom)
   - Y-tick labels colored to match their bar's sign (green for bullish, red for bearish)
   - X-axis formatted as `+NNM` / `-NNM`

### Net Impact formula

```
Net Impact = (call_ask_premium − call_bid_premium)
           + (put_bid_premium − put_ask_premium)
```

i.e. *aggressive call buying* minus *aggressive put buying*. Bullish tape → positive; bearish tape → negative.

The **top 10 tickers by `|Net Impact|`** during the same calendar day are surfaced. Selecting by absolute magnitude (rather than top-positive + top-negative) means a fully-bearish session still shows the 10 loudest names; a fully-bullish session shows the 10 most-bid-up names. Net Impact is computed only from intraday flow within the calendar day shown in the chart — overnight / prior-day flow does not contribute.

### Data source

Per UW API:
- **Market Tide:** `GET /api/market/market-tide?interval_5m=1` — returns time-series of net call premium, net put premium, and SPY price at 5-min resolution.
- **Top Net Impact:** preferred path is a UW endpoint exposing the formula above directly (TBD — confirm with UW support whether `/api/option-trades/flow-alerts` rows include `*_bid_premium` / `*_ask_premium` per row, or whether `/api/screener/option-contracts` is the right source). Fallback: the worker aggregates intraday flow rows by ticker, applies the formula, and writes the top 10 by `|Net Impact|` to `net_impact_daily` on a 5-min cron.

### Mock data (v1.2.1 demo)

`/lib/mock/market-tide-data.ts`:
- `buildMarketTide()` — deterministic 5-min series from 9:30 AM to ~11:35 AM with SPY drifting 703 → 709.75, NCP climbing sigmoidally to $360M, NPP dipping to -$30M, volume tapering from open
- `buildNetImpact()` — **10-ticker snapshot** (top 8 bullish + 2 bearish: MU +$118M, AAPL +$82M, AVGO +$46M, AMD +$38M, SNDK +$34M, MRVL +$31M, LITE +$26M, BA +$22M, TSLA −$46M, CAR −$58M) mirroring the UW screenshot values, ranked by `|Net Impact|` and displayed positive→negative

---

## 12. Design system

### Colors (hex values)

All color variables from the design token system. Use CSS custom properties throughout. Key values for reference:

| Token | Light mode |
|---|---|
| `--color-background-primary` | `#FFFFFF` |
| `--color-background-secondary` | `#F6F5F2` |
| `--color-background-tertiary` | `#EFEDE8` |
| `--color-background-info` | `#E6F1FB` |
| `--color-text-primary` | `#1A1918` |
| `--color-text-secondary` | `#6B6965` |
| `--color-text-tertiary` | `#9B9890` |
| `--color-text-info` | `#185FA5` |
| `--color-border-tertiary` | `rgba(0,0,0,0.10)` |
| `--color-border-secondary` | `rgba(0,0,0,0.18)` |

**Named color ramps (use 50/600/800 stops for light mode fills):**

| Ramp | 50 (fill) | 600 (border) | 800 (text) |
|---|---|---|---|
| Blue | `#E6F1FB` | `#185FA5` | `#0C447C` |
| Green | `#EAF3DE` | `#3B6D11` | `#27500A` |
| Red | `#FCEBEB` | `#A32D2D` | `#791F1F` |
| Amber | `#FAEEDA` | `#854F0B` | `#633806` |
| Purple | `#EEEDFE` | `#534AB7` | `#3C3489` |
| Gray | `#F1EFE8` | `#5F5E5A` | `#444441` |
| Teal | `#E1F5EE` | `#0F6E56` | `#085041` |

### Typography

- Font: system sans-serif stack (Anthropic Sans or Inter as fallback)
- Weights: 400 (regular) and 500 (medium) only. Never 600 or 700.
- Heading sizes: h1=17px/500, h2=15px/500, h3=13px/500
- Body: 12px/400, line-height 1.6
- Labels/muted: 11px/400
- Micro-labels: 9–10px/500, uppercase, letter-spacing 0.05em

### Borders & radius

- Default border: `0.5px solid var(--color-border-tertiary)`
- Emphasis border: `0.5px solid var(--color-border-secondary)`
- Border radius — md: `8px`, lg: `12px`, xl: `16px`
- Single-sided accent borders (left/top): `border-radius: 0`

### Badges and pills

- Type badges (CALL/PUT, BUY/SELL): `border-radius: 3px`, no border
- Status pills (HIGH/MOD/LOW): same
- Filter chips: `border-radius: 20px` (full pill)
- Rank badges: `border-radius: 4px`

### Cards

- Background: `var(--color-background-primary)` (white)
- Border: `0.5px solid var(--color-border-tertiary)`
- Border radius: `var(--border-radius-lg)` (12px)
- Padding: `1rem 1.25rem`

### Metric cards

- Background: `var(--color-background-secondary)` (no border)
- Border radius: `var(--border-radius-md)` (8px)
- Padding: `0.75rem 1rem`
- Label: 11px/regular/secondary color
- Value: 16px/medium/primary color
- Sub-label: 10px/regular/semantic color (up/down/warn)

### Toggle switches

iOS-style: 34px × 19px track, 13px thumb. Active state track: `background: #185FA5`. Thumb: white circle, `transition: transform 0.2s`. Thumb moves 15px right when active.

---

## 13. Sandbox deployment

### Goal

Publicly accessible demo URL with realistic mock data for all modules. No real-money data required for demo — synthetic data that matches real data structure.

### Stack in production

```
Frontend:           Vercel Hobby tier, Next.js 16
Source:             github.com/buddybear8/flowdesk (auto-deploy on push to main)
Database:           Supabase or Neon (not yet connected — deferred until live data wired)
WebSocket server:   Railway or Fly.io (not yet deployed — deferred until live data wired)
Domain:             Vercel-provided subdomain
```

### Current state (v1.2) — deployed and running

**✅ Sandbox demo is live:** **https://flowdesk-puce.vercel.app** (try `/watches`, `/sentiment`, `/market-tide`, `/gex`, `/flow`, `/darkpool`). GitHub repo at `github.com/buddybear8/flowdesk` auto-deploys to Vercel on every push to `main`. `USE_MOCK_DATA=true` is set in the Vercel environment so every API route returns the static mock payload. Shareable with cofounder today — no login, no real API costs.

**What's done:**
- Next.js 16 App Router + Turbopack project scaffold (Chart.js 4, Tailwind 3, Prisma schema defined)
- Six modules wired to mock data via `USE_MOCK_DATA=true` env flag: Daily watches, Sentiment tracker (both tabs), Market Pulse, Options GEX, Flow alerts (Live feed), Dark pools (Ranked feed)
- 6 API route handlers under `/app/api/` gating real-API calls (added `/api/market-tide` in v1.2)
- Mock data fixtures under `/lib/mock/`
- Deployed to Vercel with auto-deploy from GitHub
- Security hardening landed 2026-04-22: XSS fix on Sentiment module (`renderPostBody` replaces `dangerouslySetInnerHTML`), HSTS + X-Frame-Options + X-Content-Type-Options headers via `next.config.mjs`, input validation on every API route (allowlist enums, range clamps, `NaN` checks)

**What's pending for live data (deferred until cofounder sign-off on the mock demo):**
- Wire API keys into Vercel env: UW, xAI, Anthropic (Finnhub only if you opt into the upgrade path in §3.2)
- Connect a PostgreSQL database (Neon or Supabase) and run `prisma db push`
- Replace the mock branches in each `route.ts` with real upstream calls
- Add authentication to API routes before flipping `USE_MOCK_DATA` off
- Wire the Market Pulse `1H / 4H / 1D` period toggle to the API (currently UI-only)
- Build the secondary tab views for Watches (Criteria config), Flow (Sweep scanner, 0DTE flow, Unusual activity), Dark pools (DP levels), GEX (By strike, By expiry, Vanna & charm, Key levels)
- Deferred: dependency upgrades (Prisma 5→7, Tailwind 3→4 — both have breaking changes, not blocking)

### Steps to reproduce the current local build

1. **Install Homebrew + Node:**
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install node
   ```

2. **Bootstrap Next.js project** (original command; skip if cloning existing repo):
   ```bash
   npx create-next-app@latest flowdesk --typescript --tailwind --app
   ```

3. **Install runtime dependencies:**
   ```bash
   npm install chart.js react-chartjs-2 @prisma/client lucide-react clsx
   npm install -D prisma
   ```

4. **Pin to Next 16 / React 19 to stay ahead of known CVEs:**
   ```bash
   npm install next@16 react@19 react-dom@19
   npm install -D @types/react@19 @types/react-dom@19
   ```

5. **Environment:** create `.env.local` with `USE_MOCK_DATA=true` plus placeholders for the keys in §15. The app runs end-to-end against mock data; no external API keys required during dev.

6. **Run dev server:**
   ```bash
   npm run dev
   ```

7. **(Sandbox deploy, later)** Set up Prisma + Supabase, backfill DP ranks, add real API keys, `vercel --prod`.

### Environment variables

See Section 15.

### Mock data strategy for sandbox

`/lib/mock/` is populated with the following fixtures (all built, v1.2):
- `gex-data.ts` — `GEXPayload` builder per ticker (SPY / QQQ / SPX / NVDA / TSLA); SPY uses verbatim netOI + netDV arrays from the mockup
- `flow-alerts.ts` — 13 static `FlowAlert` rows with `isNew` flash flags on the top 3
- `dark-pool-prints.ts` — 16 `DarkPoolPrint` rows at ranks 1–74 across a mix of equities + ETFs; ranks are display values (no historical DB behind them)
- `sentiment-data.ts` — display rows for the overview + 8 analyst profiles with per-analyst color themes; aggregate lists (most-mentioned, accuracy leaderboard, top buys/sells); individual-view portfolio/recent calls/ticker accuracy/recent posts
- `watches-data.ts` — 6 `HitListItem` rows (MRVL, IVZ, GLD, CDNS, SPY, NVDA) with full nested contracts / peers / theme
- `market-tide-data.ts` — `buildMarketTide()` produces a deterministic 5-min series; `buildNetImpact()` returns a 20-ticker snapshot (new in v1.2)

`USE_MOCK_DATA=true` env var routes every `/api/*` handler to the mock; setting it to anything else returns `501 Not implemented` from handlers pending real API wiring.

---

## 14. Backend API endpoints

All endpoints live under `/app/api/` in Next.js App Router. Each handler **checks `process.env.USE_MOCK_DATA === "true"` and returns a mock payload** from `/lib/mock/*.ts` if so; otherwise returns `501` pending real API wiring. Six routes are built in v1.2:

### 1. GEX

```
GET /api/gex?ticker=SPY&expiry=all&strikes=25
  → Mock: buildGEXPayload(ticker, expiry, strikes)
  → Production: calls UW /api/stock/{ticker}/spot-exposures/strike
  → Returns: GEXPayload { ticker, asOf, strikes[], keyLevels, netGexOI, netGexDV, gammaRegime }
  → Production cache: 30s
```

### 2. Flow alerts

```
GET /api/flow?type=CALL&side=BUY&minPrem=1000000&conf=HIGH
  → Mock: buildFlowAlerts() then applies filters from query params
  → Production: proxies UW /api/option-trades/flow-alerts
  → Returns: { alerts: FlowAlert[], stats: FlowStats }
  → Production cache: 30s (or WebSocket stream)
```

### 3. Dark pool

```
GET /api/darkpool?rankMin=1&rankMax=100&hideETF=false&regularHour=true&extendedHour=true
  → Mock: buildDarkPoolPrints() then applies filters
  → Production: proxies UW GET /api/darkpool/recent, passes through rank + percentile from UW response
  → Returns: { prints: DarkPoolPrint[] }
  → No cache (real-time)
```

### 4. Daily watches

```
GET /api/watches
  → Mock: buildWatchesPayload()
  → Production: UW flow alerts + DP confluence lookup per ticker
  → Returns: HitListPayload { sessionMeta, hits: HitListItem[], sectorFlow: SectorFlow[] }
  → Production cache: 5 minutes
```

### 5. Sentiment

```
GET /api/sentiment?view=overview      → SentimentOverview
GET /api/sentiment?view=analysts      → AnalystIntelligence
  → Mock: buildSentimentOverview() / buildAnalystIntelligence()
  → Production: reads from sentiment_snapshots DB cache (pre-computed daily)
```

### 6. Market Pulse *(new in v1.2)*

```
GET /api/market-tide
  → Mock: { tide: buildMarketTide(), netImpact: buildNetImpact() }
  → Production: UW GET /api/market/market-tide?interval_5m=1 for the tide series; Top Net Impact source TBD (§16 open question)
  → Returns: { tide: MarketTideSnapshot, netImpact: NetImpactSnapshot }
  → Production cache: 30s
```

### Input validation (added 2026-04-22)

Every route handler validates query params before calling the mock or upstream:
- Ticker symbols are regex-checked (`^[A-Z]{1,5}$`)
- Enum params (`type`, `side`, `conf`, `expiry`) are allowlisted
- Numeric params are coerced, clamped to sane ranges, and `NaN`-guarded before use
- Invalid inputs return `400` with a short error message

### Deferred for later iterations

- `GET /api/gex/static?ticker=SPY` — OI-only view, separate cache timing
- `GET /api/darkpool/confluence?ticker=SPY&hours=48` — lookup helper (once criteria config persistence lands)
- `GET /api/admin/criteria` + `POST /api/admin/criteria` — criteria config persistence

---

## 15. Environment variables & secrets

```bash
# ─── Required (Vercel + Railway worker) ──────────────────────
UW_API_TOKEN=your_uw_token_here
ANTHROPIC_API_KEY=your_anthropic_key_here
X_BEARER_TOKEN=your_x_api_v2_bearer_here          # Basic tier — see §3.3
DATABASE_URL=postgresql://user:password@host:5432/flowdesk
NEXT_PUBLIC_APP_URL=https://flowdesk.vercel.app
USE_MOCK_DATA=true    # true = use mock fixtures; false = hit Postgres
TZ=America/New_York   # worker only — required so node-cron expressions use ET

# ─── Required for historical DP backfill (worker only) ───────
# The Polygon→S3 extraction is handled outside this codebase. The worker
# reads pre-extracted dark-pool prints from S3 and imports them into
# `dark_pool_prints` via `worker/src/jobs/import-darkpool-history.ts`.
AWS_ACCESS_KEY_ID=your_iam_access_key
AWS_SECRET_ACCESS_KEY=your_iam_secret_key
AWS_REGION=us-east-1
DARKPOOL_S3_BUCKET=flowdesk-darkpool-history       # bucket holding extracted Parquet/CSV files
DARKPOOL_S3_PREFIX=watchlist/                      # optional prefix inside the bucket

# ─── Optional (not on the v1 critical path) ──────────────────
# Finnhub: add only if sub-second live price ticks become necessary.
# v1 runs on UW-embedded prices and does NOT require these.
FINNHUB_API_KEY=
FINNHUB_WS_URL=wss://ws.finnhub.io
WS_SERVER_URL=                                     # only needed if Finnhub is added

# Polygon.io live feed: not used by this codebase. Polygon is only
# touched by the out-of-scope extraction pipeline that lands data in S3.
```

Store all secrets in Vercel environment variables (not committed to git).

---

## 16. Open questions & future work

### Open questions

**Resolved in v1.2.1:**
- ~~UW API tier~~ → **Basic ($150/mo) confirmed** for V1; Vanna/Charm pill toggle removed (§8) and returns post-V1 if Advanced is needed.
- ~~Dark pool data source~~ → **UW for live feed; Polygon historical backfill via S3 import** (§3.5).
- ~~AI explanation caching~~ → **pre-computed daily** in 07:00 ET batch (§3.4 / §8); modal shows static-as-of-market-open header note.
- ~~Analyst data sourcing~~ → **X API v2 Basic confirmed**, used directly (xAI Grok dropped).

**Still open:**

1. **SPX vs SPY for GEX:** V1 ships **SPY only**. SpotGamma's Periscope tool uses verified SPX exchange data not available via UW. UW's SPX GEX uses reported tape data. Re-evaluate adding SPX once V1 MVP is live with real data flowing.

2. **API authentication:** Before flipping `USE_MOCK_DATA=false`, the Vercel API routes need at least an API key header so random visitors can't hammer the endpoints and burn the UW quota. NextAuth single-user (email magic link) is the recommended path.

3. **Disaster recovery / PITR:** Railway's default 4-day daily snapshots — sufficient for personal tool? Bumping retention or switching to a vendor with true PITR adds cost.

4. **Single worker vs multi-service architecture:** ARCHITECTURE.md specifies a single Node worker with `node-cron`. Repo also contains scaffolding for a Clerk-authenticated WebSocket server + Redis-backed data-ingestion service + named lambdas. Decision pending on which to keep.

5. **Sector enum strict vs freeform:** `Sector` is a strict union of 11 GICS sectors but `HitListItem.sector` is typed `string`, allowing mocks like `"Index"` / `"Commodities"` / `"Financial Ser."` through.

6. **Dark Pools "Intraday only" toggle semantics:** filter by `is_extended=false` or by time-of-day window?

7. **Divergence alert trigger rule:** PRD §7 lists divergence alerts but doesn't define when one fires. Need a codified threshold + price-window rule.

8. **Hit-list ranking — route handler vs worker job:** compute on-demand at API request time with a 5-min cache, or materialize via a `hit_list_daily` table updated by a worker cron?

9. **GEX key levels — UW response or worker computation:** assume worker derives call wall / put wall / gamma flip from per-strike rows; confirm whether UW returns max pain anywhere.

10. **AI summary prompt template:** locked input shape and output length not yet documented. Lock before live wiring so daily output stays consistent.

11. **Top Net Impact source:** confirm with UW support whether `/api/option-trades/flow-alerts` rows include `*_bid_premium` / `*_ask_premium` per row, or whether `/api/screener/option-contracts` is the right source. If neither exposes the bid/ask split, the worker's fallback aggregation needs a different input.

### Iteration priorities after sandbox demo

1. **Vanna & Charm greeks** — return the GEX/Vanna/Charm three-way pill toggle once UW Advanced tier ($375/mo) is on (or once the Basic tier is confirmed to expose those endpoints)
2. **SPX GEX** — primary index ticker for GEX analysis once a verified-exchange SPX feed is on
3. **On-demand GEX AI explanation** — replace the pre-computed 07:00 ET batch with per-click Anthropic generation (~1–2s latency) for live regime accuracy
4. **0DTE flow tab** — real-time 0DTE-only flow feed with 1-minute refresh
5. **DP levels page** — plot ranked dark pool print prices as support/resistance on a price chart
6. **Sweep scanner tab** — sweep-only feed with sweep speed and aggression metrics
7. **Watchlist integration** — save tickers to named lists, filter all modules by watchlist
8. **Alert system** — push notifications when a ticker meets user-defined criteria
9. **Historical GEX chart** — time-series view of net GEX over days/weeks per ticker
10. **Congressional trades module** — UW `/api/congress/recent-trades` endpoint
11. **Mobile layout** — responsive breakpoints for tablet/phone viewing

### Known limitations in v1 prototype

- Sentiment data in prototype is synthetic. Production uses xAI/X API batch.
- Dark pool ranks in prototype are deterministic fixtures. Production passes through rank + percentile from the Unusual Whales `/api/darkpool/*` response (no self-hosted historical index — removed in v1.2).
- The GEX bar chart in production must handle ~500 strike rows efficiently. Consider virtualisation if rendering slows below 60fps.

---

---

## 17. Current implementation status (v1.2)

### Deployment

| Target | Status | Notes |
|---|---|---|
| Live URL | ✅ | **https://flowdesk-puce.vercel.app** |
| GitHub repo | ✅ Live | `github.com/buddybear8/flowdesk` |
| Vercel production deploy | ✅ Live | Auto-deploys on push to `main` |
| Vercel env config | ✅ `USE_MOCK_DATA=true` set | Swap to `false` once live API keys are wired |
| Database (Prisma / PostgreSQL) | ⬜ Not connected | Schema defined; no live DB wired for demo |
| WebSocket fan-out server | ⬜ Not deployed | Only needed if Finnhub is added later (optional per §3.2) |

### Module build matrix

| Module | Route | Core built | Sub-tabs built | Consumes API | Notes |
|---|---|---|---|---|---|
| Daily watches | `/watches` | ✅ | Hit list only | `/api/watches` | Detail panel with functional "Return to overview" — left panel expands to fill when detail dismissed |
| Sentiment tracker | `/sentiment` | ✅ | Overview + Analyst intelligence | `/api/sentiment?view=…` | 8 analyst chips, sort pills, aggregate/individual toggle |
| Market Pulse *(new v1.2)* | `/market-tide` | ✅ | N/A (single page) | `/api/market-tide` | Stacked: tide line chart (dual Y) + Top Net Impact horizontal bars. Period toggle UI-only |
| Options GEX | `/gex` | ✅ | N/A (single page) | `/api/gex` | Dual-series bar chart (OI + DV), 240px details panel · Vanna/Charm pill toggle removed in v1.2.1 (returns post-V1) |
| Flow alerts | `/flow` | ✅ | Live feed only | `/api/flow` | 210px filter panel with chip groups + ranges + toggles |
| Dark pools | `/darkpool` | ✅ | Ranked feed only | `/api/darkpool` | 210px filter with rank range slider + iOS toggles |

### Known deferrals from original scope

1. **Options GEX sub-tabs** (By strike, By expiry, Vanna & charm, Key levels) — collapsed into single page in v1.1
2. **Options GEX greek toggle** (GEX | Vanna | Charm) — removed entirely in v1.2.1 because UW Basic tier (§3.1) does not expose Vanna/Charm endpoints. Returns post-V1 once a tier upgrade or Basic-tier confirmation lands
3. **Flow alerts sub-tabs** (Sweep scanner, 0DTE flow, Unusual activity) — Live feed shows all data; pre-filtered views revisit post-sandbox
4. **Dark pools DP levels tab** — deferred; Ranked feed is the primary view
5. **Charting module (Module 6)** — removed from v1.1 scope entirely; *replaced* in v1.2 by the Market Pulse module which covers the session-level flow-health question with two tailored charts instead of a generic price chart with overlays
6. **Historical dark-pool ranking database** — restored in v1.2.1 via Polygon-sourced S3 backfill (§3.5); top-100-per-ticker retained in perpetuity
7. **Criteria config persistence** (`/api/admin/criteria` endpoints) — schema ready (`WatchesCriteria` model) but no UI or endpoint yet
8. **Market Pulse period toggle** — UI renders 1H/4H/1D pills but the API returns the same payload regardless; wiring to UW `market-tide` interval param deferred until live data
9. **GEX AI explanation modal — on-demand generation** — v1 ships pre-computed daily summary with static-as-of-market-open header note (§8); per-click Anthropic call moves to a later iteration
10. **Real API wiring** — all 6 route handlers return mock data; flipping `USE_MOCK_DATA=false` yields `501` until keys are added
11. **Dependency upgrades** — Prisma 5→7 and Tailwind 3→4 both have breaking changes; pinned at current versions, revisit post-demo

### Local dev

```bash
cd /Users/Stefan/Documents/Coding/Champagne\ Room\ Software/flowdesk
npm run dev                    # http://localhost:3000
```

Dev server is running on Next.js 16 with Turbopack. Hot module replacement is active — edits to any component show up on refresh (often live).

### Security posture (as of v1.2)

Security hardening landed 2026-04-22:

- **XSS fix:** Sentiment module no longer uses `dangerouslySetInnerHTML` for notable-post bodies. Replaced with a `renderPostBody` helper that splits on cashtag regex and renders each segment as text (safe by default)
- **Security headers** added via `next.config.mjs` — applies to every route:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- **Input validation** on every API route handler:
  - Ticker symbols regex-checked (`^[A-Z]{1,5}$`)
  - Enum params allowlisted
  - Numeric params coerced + clamped + `NaN`-guarded
  - Invalid inputs → `400` with short error message
- **`.env.local` excluded from git** (gitignore confirmed before first push)
- **`npm audit` clean** — zero critical / high / moderate vulnerabilities after the Next 14.2.15 → 16.2.x migration
- Patched CVEs include middleware auth bypass (CVE-2025-29927) and five Next.js DoS-class advisories (image optimizer remotePatterns, RSC deserialization, HTTP request smuggling, `next/image` disk cache exhaustion, Server Components DoS)

**Still open:** API authentication — none of the six routes require auth right now. Needed before `USE_MOCK_DATA` is flipped off (otherwise the live API becomes a free proxy for the UW subscription).

### What's left before live data (punch list)

1. Wire API keys in Railway worker + Vercel env: `UW_API_TOKEN`, `X_BEARER_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, plus AWS S3 vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DARKPOOL_S3_BUCKET`) for the historical DP import
2. Provision Railway PostgreSQL, add the 6 missing Prisma models (`FlowAlert`, `GexSnapshot`, `MarketTideBar`, `NetImpactDaily`, `XPost`, `AnalystProfile`) per ARCHITECTURE §3, run `npx prisma migrate deploy`
3. Resolve single-worker vs multi-service architecture decision (still open) and stand up the worker
4. Implement the S3-to-Postgres dark-pool history import job
5. Implement retention sweeps (60-day flow, 30-day DP for ranks > 100, perpetual for top 100)
6. Replace mock branches in each `route.ts` with Prisma reads
7. Add authentication to API routes before flipping `USE_MOCK_DATA=false`
8. Build secondary tab views: Criteria config, Sweep scanner, 0DTE flow, Unusual activity, DP levels
9. Wire Market Pulse period toggle to the UW `market-tide` interval param
10. Confirm Top Net Impact endpoint availability with UW (or implement fallback aggregation per §11 formula)
11. Lock the AI summary prompt template before first Anthropic batch run

---

## 18. Shared type contracts

Defined in `/lib/types/index.ts` (plus `/lib/mock/market-tide-data.ts` for the Market Pulse shapes, which are mock-local until the live API contract is confirmed).

### Primary interfaces

| Interface | Role | Key fields |
|---|---|---|
| `FlowAlert` | One row in Flow alerts feed | `id, time, ticker, type, side, sentiment, exec, multiLeg, contract, strike, expiry, size, oi, premium, spot, rule, confidence, sector, isNew?` |
| `DarkPoolPrint` | One DP print | `executed_at, ticker, price, size, premium, volume, exchange_id, trf_id, is_etf, is_extended, all_time_rank, percentile` *(rank + percentile now pass through from UW; no local historical index in v1.2)* |
| `GEXLevel` | Per-strike GEX row | `strike, call_gamma_oi, put_gamma_oi, call/put_gamma_bid, call/put_gamma_ask, netDV, netOI, combined` |
| `HitListItem` | One row in Daily watches | `rank, ticker, price, direction, confidence, premium, contract, dpConf, dpRank?, dpAge?, dpPrem?, thesis, sector, contracts, peers, theme` |
| `SentimentTicker` | One top-tickers-by-velocity row | `ticker, velocityPct, sentiment (BULL/BEAR/MIX), mentions` |
| `AnalystProfile` | One analyst record | `handle, initials, followers, bio, bias, accuracy30d, bullBearRatio, postsPerDay, callsTracked, portfolio, recentCalls, accuracyByTicker` |

### Market Pulse interfaces *(new in v1.2)*

| Interface | Role | Key fields |
|---|---|---|
| `MarketTidePoint` | One 5-min bucket | `time, spyPrice, netCallPremium, netPutPremium, volume` |
| `MarketTideSnapshot` | Full tide response | `asOf, asOfLabel, spyCurrent, volumeCurrent, netCallPremiumCurrent, netPutPremiumCurrent, series: MarketTidePoint[]` |
| `NetImpactRow` | One ticker on the Top Net Impact bar chart | `ticker, netPremium` |
| `NetImpactSnapshot` | Full net-impact response | `asOf, period ("1D"\|"4H"\|"1H"), rows: NetImpactRow[]` |

### Supporting types

`GEXPayload`, `KeyLevels`, `HitListPayload`, `SectorFlow`, `SentimentOverview`, `AnalystIntelligence`, `NotablePost`, `NewEntrantFlip`, `DivergenceAlert`.

### Enums

`Direction` (BULLISH/BEARISH), `Confidence` (HIGH/MED/LOW), `OptionType` (CALL/PUT), `Side` (BUY/SELL), `ExecType` (SWEEP/FLOOR/SINGLE/BLOCK), `Sector`, `SentimentPill` (BULL/BEAR/MIX), `GammaRegime` (POSITIVE/NEGATIVE).

---

*Document prepared: April 29, 2026 · FlowDesk v1.2.1 PRD (revision of v1.2 — locks UW Basic tier, removes Vanna/Charm pill toggle, switches sentiment to X API direct, restores historical DP ranking via Polygon-sourced S3 import, locks retention rules, normalizes Confidence enum, top 10 by |Net Impact|)*
