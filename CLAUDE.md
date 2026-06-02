# Polymarket Bot

A TypeScript bot that discovers Polymarket traders, scores them using Kelly Criterion and Kelly Efficiency, and mirrors trades from "smart" wallets.

## Commands

```bash
npm run dev           # Run with hot-reload (nodemon)
npm run dev -- --analyze   # Discover and rank smart wallets
npm run dev -- --test      # Paper trading: simulate copy-trades, track hypothetical P&L
npm run dev -- --copy      # Live trading: analyze wallets + mirror trades with real funds
```

## Environment Variables

```
POLYMARKET_PRIVATE_KEY=0x...   # Required for --copy mode only (L1 signer)
POLYMARKET_API_KEY=...         # Optional — for authenticated requests
KELLY_FRACTION=0.5             # Fractional Kelly multiplier (default: 0.5)
MAX_POSITION_USD=500           # Max per-market exposure in copy/test mode
TEST_BANKROLL_USD=10000        # Starting virtual bankroll for --test mode
```

Copy `.env.example` to `.env` and fill in values before running in copy mode.

## Project Structure

```
src/
├── index.ts                   # CLI entry point (--analyze | --test | --copy)
├── clients/
│   ├── polymarket.ts          # Public client singleton (read-only)
│   └── securePolymarket.ts    # Authenticated client (live trading only)
├── services/
│   ├── walletDiscovery.ts     # Fetch top wallets from leaderboard
│   ├── tradeHistory.ts        # Fetch closed positions + trade history
│   ├── walletAnalysis.ts      # Compute per-wallet metrics
│   ├── copyTrader.ts          # Poll smart wallets and mirror positions
│   └── paperTrader.ts         # Test mode: simulate trades, track virtual P&L
├── analysis/
│   ├── kelly.ts               # Kelly Criterion math
│   └── kellyEfficiency.ts     # Kelly Efficiency scoring + classification
├── db/
│   ├── client.ts              # Prisma client singleton
│   └── walletStore.ts         # DB read/write helpers for wallet scores
├── models/
│   └── types.ts               # Shared TypeScript types
├── utils/
│   └── evaluation.ts          # Pagination helpers, rate-limit wrapper
└── prisma/
    └── schema.prisma          # Prisma schema (SQLite)
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

// Pagination pattern (all list methods return async iterables)
for await (const page of client.listMarkets({ pageSize: 50 })) {
  page.items // T[]
  page.hasMore // boolean
}
```

## Kelly Criterion

For a YES bet at market price `p` with estimated true probability `q`:

```
Full Kelly      f* = (q - p) / (1 - p)
Fractional Kelly  f = KELLY_FRACTION * f*   (default: 0.5)
Expected value  EV = q * (1-p)/p - (1-q)
```

`f*` is the theoretically optimal fraction of bankroll. We apply `KELLY_FRACTION` (half Kelly by default) because edge estimates from historical data are noisy — full Kelly on an overestimated edge causes severe drawdowns. Half Kelly captures ~75% of maximum long-run growth at ~25% of the variance.

Set `KELLY_FRACTION` in `.env` (range 0.1–1.0).

## Kelly Efficiency

Measures how well a trader's actual bet sizing matches the Kelly-optimal size across their closed trades:

```
Kelly Efficiency = mean(actual_fraction / kelly_fraction)  per closed trade
```

| KE Range   | Interpretation             |
|------------|----------------------------|
| 0.05–1.0   | Rational sizing (smart)    |
| > 2.0      | Overbetting (risky)        |
| < 0.05     | Underbetting / no strategy |

## Smart Wallet Classification

A wallet is classified **smart** if all of:
- At least 10 closed trades
- Win rate > 50%
- Average edge > 0
- Kelly Efficiency in [0.05, 2.0]

## Database (Prisma + SQLite)

### Schema

Two tables:

**`Wallet`** — current score for each discovered wallet:

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

**`ScoreSnapshot`** — append-only history, one row per scoring run:

Same numeric columns as `Wallet` plus `recordedAt` timestamp. Lets you track how a wallet's score evolves over time.

### Key Commands

```bash
npx prisma migrate dev --name init   # Create DB + run migrations
npx prisma studio                    # Browse wallet scores in browser UI
npx prisma generate                  # Regenerate client after schema changes
```

### DB Helpers (`src/db/walletStore.ts`)

```typescript
upsertWallet(metrics: WalletMetrics): Promise<void>   // insert or update
getSmartWallets(): Promise<Wallet[]>                  // classification = 'smart', ordered by smartScore
getWallet(address: string): Promise<Wallet | null>
getScoreHistory(address: string): Promise<ScoreSnapshot[]>
```

Every scoring run calls `upsertWallet()` (updates current row) **and** `createScoreSnapshot()` (appends history row).

## Test Mode (Paper Trading)

`--test` runs the full bot logic against live market data but never places real orders. Instead it maintains a virtual portfolio in memory and logs simulated fills at the current market price.

**What it tracks:**
- Virtual bankroll (starts at `TEST_BANKROLL_USD`)
- Simulated entries: price paid, Kelly-sized position, timestamp
- Simulated exits: when a smart wallet closes a position, close the mirror at current price
- Running P&L, win rate, and Kelly Efficiency of the simulated portfolio

**Output (printed every poll cycle):**
```
[TEST] New signal: 0xAbCd... → YES on "Will BTC > 100k by Dec 2026?" @ 0.62
[TEST] Simulated BUY: $247.00 (half-Kelly 0.247 × $10,000 bankroll)
[TEST] Open positions: 3 | Virtual P&L: +$183.40 (+1.83%)
```

No `POLYMARKET_PRIVATE_KEY` required in test mode — the public client is sufficient.

## Rate Limits

| API      | Limit           |
|----------|-----------------|
| Data API | 1,000 req/10s   |
| Gamma    | 4,000 req/10s   |
| CLOB     | 9,000 req/10s   |

The utils/evaluation.ts rate limiter enforces a 10ms minimum gap between Data API calls.
