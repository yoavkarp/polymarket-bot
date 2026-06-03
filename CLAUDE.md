# Polymarket Bot

A TypeScript bot that discovers Polymarket traders, scores them using Kelly Criterion and Kelly Efficiency, and mirrors trades from "smart" wallets.

## Commands

```bash
npm run dev -- --analyze   # Discover and rank smart wallets
npm run dev -- --test      # Paper trading: simulate copy-trades, track P&L + start API server
npm run dev -- --copy      # Live trading: mirror trades with real funds (not yet implemented)
npm run market <url>       # Side tool: analyze traders from a specific Polymarket market URL
npm run db:studio          # Browse DB in browser UI
npm run db:migrate         # Run pending Prisma migrations
```

## Environment Variables

```
POLYMARKET_PRIVATE_KEY=0x...     # Required for --copy mode only (L1 signer)
POLYMARKET_API_KEY=...           # Optional — for authenticated requests
KELLY_FRACTION=0.5               # Fractional Kelly multiplier (default: 0.5)
MAX_TOTAL_EXPOSURE=0.5           # Max fraction of portfolio deployed at once (default: 0.5 = 50%)
TEST_BANKROLL_USD=10000          # Starting virtual portfolio value for --test mode
PRICE_MATCH_TOLERANCE=0.02       # Max price drift to copy a pre-existing position on startup (default: 0.02)
POLL_INTERVAL_S=60               # How often to poll smart wallet positions in seconds (default: 60)
REFRESH_INTERVAL_H=24            # How often to re-run wallet discovery in hours (default: 24)
API_PORT=3000                    # Port for the REST + SSE API server (default: 3000)
```

Copy `.env.example` to `.env` and fill in values before running.

## Project Structure

```
src/
├── index.ts                   # CLI entry point (--analyze | --test | --copy)
├── clients/
│   ├── polymarket.ts          # Public client singleton (read-only)
│   └── securePolymarket.ts    # Authenticated client (live trading only)
├── services/
│   ├── walletDiscovery.ts     # Fetch wallets from WEEK + MONTH + ALL leaderboards, deduplicated
│   ├── tradeHistory.ts        # Fetch closed positions + trade history
│   ├── walletAnalysis.ts      # Compute per-wallet metrics
│   ├── copyTrader.ts          # Live trading (not yet implemented)
│   ├── paperTrader.ts         # Test mode: portfolio-value-anchored sizing, SSE event emitter
│   └── marketWallets.ts       # Fetch traders from a specific market/event URL
├── analysis/
│   ├── kelly.ts               # Kelly Criterion math
│   └── kellyEfficiency.ts     # Kelly Efficiency scoring + classification
├── api/
│   ├── events.ts              # Shared typed EventEmitter (botEvents)
│   └── server.ts              # Express REST + SSE API server
├── db/
│   ├── client.ts              # Prisma client singleton
│   ├── walletStore.ts         # DB helpers for wallet scores
│   ├── paperStore.ts          # DB helpers for paper trades
│   └── configStore.ts         # DB helpers for key-value config (e.g. lastRefreshAt)
├── models/
│   └── types.ts               # Shared TypeScript types
├── tools/
│   └── marketAnalysis.ts      # Standalone CLI tool: analyze traders from a market URL
├── utils/
│   └── evaluation.ts          # Pagination helpers, rate-limit wrapper
├── prisma/
│   └── schema.prisma          # Prisma schema (SQLite)
└── docs/
    └── api.md                 # REST + SSE API reference
```

## Key APIs (`@polymarket/client`)

```typescript
const client = createPublicClient();

// Discover traders
client.listTraderLeaderboard({ timePeriod: 'WEEK', orderBy: 'PNL', pageSize: 100 })

// Fetch wallet data
client.listClosedPositions({ user: address })
client.listTrades({ user: address })
client.listPositions({ user: address })

// Fetch market or event by URL/slug
client.fetchMarket({ url })
client.fetchMarket({ slug })
client.fetchEvent({ url })
client.fetchEvent({ slug })

// Pagination pattern (all list methods return async iterables)
for await (const page of client.listMarkets({ pageSize: 50 })) {
  page.items  // T[]
  page.hasMore // boolean
}
```

## Position Sizing

Bet size is anchored to `portfolioValue` (true wealth, updated only on realized P&L — not on entry):

```
sizeUsd = portfolioValue × walletFraction × KELLY_FRACTION
```

Where `walletFraction` = the smart wallet's position size / their total deployed capital.

A trade is skipped if `totalDeployed + sizeUsd > portfolioValue × MAX_TOTAL_EXPOSURE`.

On close: `portfolioValue += realizedPnl`, `totalDeployed -= closedPositionSize`.

This keeps bet sizes stable regardless of how many positions are open simultaneously, and correctly handles the simultaneous-bets problem with Kelly Criterion.

## Kelly Criterion

For a YES bet at market price `p` with estimated true probability `q`:

```
Full Kelly        f* = (q - p) / (1 - p)
Fractional Kelly  f  = KELLY_FRACTION × f*   (default: 0.5)
```

`KELLY_FRACTION` defaults to 0.5 (half Kelly) — captures ~75% of maximum long-run growth at ~25% of variance.

## Kelly Efficiency

Measures how well a trader's actual bet sizing matches Kelly-optimal across their closed trades:

```
Kelly Efficiency = mean(actual_fraction / kelly_fraction)  per closed trade
```

| KE Range   | Interpretation             |
|------------|----------------------------|
| 0.05–2.0   | Rational sizing (smart)    |
| > 2.0      | Overbetting (risky)        |
| < 0.05     | Underbetting / no strategy |

## Smart Wallet Classification

A wallet is classified **smart** if all of:
- At least 10 closed trades
- Win rate > 50%
- Average edge > 0
- Kelly Efficiency in [0.05, 2.0]
- Smart score ≥ 0.6

Only smart wallets are saved to the DB. Non-smart wallets are pruned on each refresh.

## Wallet Discovery

`walletDiscovery.ts` queries the leaderboard across three time periods in parallel (`WEEK`, `MONTH`, `ALL`) and deduplicates by address — up to ~300 unique wallets per run vs 100 previously.

Discovery runs automatically on first `--test` start if DB is empty, then every `REFRESH_INTERVAL_H` hours. The last refresh timestamp is persisted in the `Config` DB table so the schedule survives restarts.

The `npm run market <url>` tool runs the same analysis pipeline against traders from any specific Polymarket market or event URL, and saves found smart wallets to the DB immediately.

## Test Mode (Paper Trading)

`--test` mode:
- Starts the REST + SSE API server on `API_PORT`
- Resumes open positions from DB (restores `portfolioValue` and `totalDeployed`)
- Takes a **baseline snapshot** of current smart wallet positions on the first poll — only positions opened *after* startup trigger new entries (unless their price matches the wallet's entry price within `PRICE_MATCH_TOLERANCE`)
- Polls every `POLL_INTERVAL_S` seconds
- Refreshes smart wallet list every `REFRESH_INTERVAL_H` hours
- Newly added wallets after a refresh get a silent baseline snapshot on their first poll

**Console output:**
```
[TEST] BUY  "Will BTC > 100k by Dec 2026?" Yes @ 0.620 | $235.00 (wallet 4.7% × Kelly 0.5) | exposure 12.4% | tracked: 0xee00ba33
[TEST] Portfolio: $10235.00 | Deployed: $1270.00 (12.4%) | Closed P&L: +$0.00 | Win rate: —% (0 closed) | Open: 3
[WALLETS] 0xee00ba33: 6 positions | 0x94f199fb: 4 positions | ...
```

## Database (Prisma + SQLite)

### Schema

**`Wallet`** — current score for each smart wallet:

| Column | Type | Notes |
|---|---|---|
| `address` | String (PK) | EVM address |
| `userName` | String? | Polymarket display name |
| `classification` | String | `smart` \| `neutral` \| `dumb` |
| `smartScore` | Float | Composite score (0–1) |
| `kellyEfficiency` | Float | Mean KE across closed trades |
| `winRate` | Float | Fraction of profitable closed trades |
| `avgEdge` | Float | Mean (outcome − entry price) |
| `tradeCount` | Int | Total closed trades analyzed |
| `lastUpdated` | DateTime | Auto-updated on upsert |

**`ScoreSnapshot`** — append-only score history (new row only when smartScore changes):

Same numeric columns as `Wallet` plus `recordedAt` timestamp.

**`PaperTrade`** — paper trading positions:

| Column | Type | Notes |
|---|---|---|
| `conditionId` | String | Polymarket condition ID |
| `trackedWallet` | String | Address of the copied wallet |
| `title` | String | Market title |
| `outcome` | String | `Yes` \| `No` |
| `entryPrice` | Float | Price at entry |
| `sizeUsd` | Float | USD deployed |
| `kellyFrac` | Float | Wallet fraction used for sizing |
| `status` | String | `open` \| `closed` |
| `exitPrice` | Float? | Resolution price |
| `pnl` | Float? | Realized P&L in USD |

**`Config`** — key-value store for persistent bot state (e.g. `lastRefreshAt`).

### DB Helpers

```typescript
// walletStore.ts
upsertWallet(metrics)          // insert or update, snapshot only if score changed
getSmartWallets()              // classification = 'smart', ordered by smartScore
getWallet(address)
getScoreHistory(address)
pruneNonSmartWallets()         // delete wallets no longer classified smart

// paperStore.ts
openPaperTrade(data)
closePaperTrade(conditionId, exitPrice, pnl)
getOpenPaperTrades()
getPaperTradeHistory()
getPaperTradeSummary()         // { count, totalPnl, winRate, totalDeployed }

// configStore.ts
getConfig(key)                 // returns string | null
setConfig(key, value)
```

## API Server

Starts automatically with `--test`. See `docs/api.md` for full reference.

- REST: `/api/wallets`, `/api/trades`, `/api/trades/summary`, `/api/config`
- SSE: `/api/events` — real-time events: `trade-opened`, `trade-closed`, `portfolio-updated`, `wallets-updated`

## Rate Limits

| API      | Limit           |
|----------|-----------------|
| Data API | 1,000 req/10s   |
| Gamma    | 4,000 req/10s   |
| CLOB     | 9,000 req/10s   |

The `utils/evaluation.ts` rate limiter enforces a 10ms minimum gap between Data API calls. The trades API caps history at offset 3000 — `marketWallets.ts` handles this gracefully.
