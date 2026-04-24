# FlowDesk — Build Progress

Last updated: 2026-04-23

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
- ✅ Greek switcher (GEX / Vanna / Charm) with explainer tooltips
- ✅ Key levels panel (call wall, put wall, gamma flip, max pain, spot)
- ✅ Gamma regime indicator (Positive / Negative)
- ✅ Show/hide OI and DV series toggles
- ✅ Mock data (`lib/mock/gex-data.ts`)
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
- ⬜ Live data — Polygon dark pool feed not wired

---

## Infrastructure & Data Layer

| Item | Status | Notes |
|------|--------|-------|
| Prisma schema | ✅ Defined | `DarkPoolPrint`, `WatchesCriteria`, `SentimentSnapshot`, `AiSummary` models |
| Database migrations | ⬜ Not run | `prisma db push` needed when live DB is connected |
| `USE_MOCK_DATA` flag | ✅ Wired | All 6 API routes check this env var before hitting live sources |
| Live UW API integration | ⬜ Not started | Token placeholder in `.env.local` |
| Live Polygon integration | ⬜ Not started | Key placeholder in `.env.local` |
| Live Finnhub integration | ⬜ Not started | Key placeholder in `.env.local` |
| Live Anthropic (AI summaries) | ⬜ Not started | Key placeholder in `.env.local` |

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

1. Wire API keys in Vercel environment variables (UW, Polygon, Finnhub, Anthropic)
2. Connect a PostgreSQL database (Neon or Supabase) and run `prisma db push`
3. Replace mock return branches in each `route.ts` with real API calls
4. Add authentication to API routes before flipping `USE_MOCK_DATA` off
5. Build the secondary tab views (Criteria config, Sweep scanner, DP levels, etc.)
6. Wire the Market Pulse period toggle to the API
