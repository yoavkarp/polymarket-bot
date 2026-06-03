# Polymarket Bot — API Reference

Base URL: `http://localhost:3000` (configurable via `API_PORT` in `.env`)

---

## REST Endpoints

### Wallets

#### `GET /api/wallets`
Returns all smart wallets ordered by score descending.

**Response**
```json
[
  {
    "address": "0xabc...",
    "userName": "Rick-Ross",
    "classification": "smart",
    "smartScore": 0.965,
    "kellyEfficiency": 0.883,
    "winRate": 1.0,
    "avgEdge": 0.376,
    "tradeCount": 50,
    "firstSeen": "2026-06-01T10:00:00.000Z",
    "lastUpdated": "2026-06-03T08:00:00.000Z"
  }
]
```

---

#### `GET /api/wallets/all`
Returns all wallets regardless of classification (`smart`, `neutral`, `dumb`).

**Response** — same shape as `/api/wallets`

---

#### `GET /api/wallets/:address`
Returns a single wallet with its full score history.

**Parameters**
| Name | In | Description |
|------|----|-------------|
| `address` | path | EVM wallet address |

**Response**
```json
{
  "address": "0xabc...",
  "userName": "Rick-Ross",
  "classification": "smart",
  "smartScore": 0.965,
  "kellyEfficiency": 0.883,
  "winRate": 1.0,
  "avgEdge": 0.376,
  "tradeCount": 50,
  "firstSeen": "2026-06-01T10:00:00.000Z",
  "lastUpdated": "2026-06-03T08:00:00.000Z",
  "history": [
    {
      "id": "uuid",
      "walletAddress": "0xabc...",
      "classification": "smart",
      "smartScore": 0.965,
      "kellyEfficiency": 0.883,
      "winRate": 1.0,
      "avgEdge": 0.376,
      "tradeCount": 50,
      "recordedAt": "2026-06-03T08:00:00.000Z"
    }
  ]
}
```

**Errors**
| Status | Meaning |
|--------|---------|
| `404` | Wallet not found |

---

### Trades

#### `GET /api/trades`
Returns all paper trades. Optionally filter by status.

**Query Parameters**
| Name | Values | Description |
|------|--------|-------------|
| `status` | `open` \| `closed` | Filter by trade status (optional) |

**Response**
```json
[
  {
    "id": "uuid",
    "conditionId": "0x...",
    "trackedWallet": "0xabc...",
    "title": "Will BTC > 100k by Dec 2026?",
    "outcome": "Yes",
    "tokenId": "...",
    "entryPrice": 0.62,
    "sizeUsd": 235.0,
    "kellyFrac": 0.047,
    "status": "closed",
    "exitPrice": 1.0,
    "pnl": 145.97,
    "openedAt": "2026-06-01T12:00:00.000Z",
    "closedAt": "2026-06-03T09:00:00.000Z"
  }
]
```

---

#### `GET /api/trades/open`
Returns currently open positions only.

**Response** — same shape as `/api/trades`, all entries have `status: "open"`

---

#### `GET /api/trades/summary`
Returns aggregate P&L statistics across all closed trades.

**Response**
```json
{
  "count": 24,
  "totalPnl": 412.80,
  "winRate": 0.708,
  "totalDeployed": 3840.00
}
```

---

### Config

#### `GET /api/config`
Returns current bot configuration state.

**Response**
```json
{
  "lastRefreshAt": "2026-06-03T08:00:00.000Z"
}
```

---

## SSE Stream

#### `GET /api/events`
Opens a Server-Sent Events stream. The connection is kept alive indefinitely.

**Headers set by server**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Connecting (browser)**
```js
const es = new EventSource('http://localhost:3000/api/events');

es.addEventListener('trade-opened', (e) => {
  const trade = JSON.parse(e.data);
  console.log('New position:', trade.title, trade.sizeUsd);
});

es.addEventListener('portfolio-updated', (e) => {
  const portfolio = JSON.parse(e.data);
  console.log('Portfolio value:', portfolio.portfolioValue);
});
```

---

### Events

#### `connected`
Fired immediately when a client connects.

```json
{ "clients": 1 }
```

---

#### `trade-opened`
Fired when the bot enters a new position.

```json
{
  "conditionId": "0x...",
  "title": "Will BTC > 100k by Dec 2026?",
  "outcome": "Yes",
  "entryPrice": 0.62,
  "sizeUsd": 235.0,
  "walletFraction": 0.094,
  "trackedWallet": "0xabc12345...",
  "exposurePct": 12.4
}
```

| Field | Type | Description |
|-------|------|-------------|
| `conditionId` | string | Polymarket condition ID |
| `title` | string | Market title |
| `outcome` | string | `"Yes"` or `"No"` |
| `entryPrice` | number | Price paid (0–1) |
| `sizeUsd` | number | USD amount deployed |
| `walletFraction` | number | Fraction of smart wallet's deployed capital this trade represented |
| `trackedWallet` | string | Address of the copied wallet |
| `exposurePct` | number | Total portfolio exposure % after this trade |

---

#### `trade-closed`
Fired when a position resolves or the smart wallet exits.

```json
{
  "conditionId": "0x...",
  "title": "Will BTC > 100k by Dec 2026?",
  "exitPrice": 1.0,
  "pnl": 145.97
}
```

| Field | Type | Description |
|-------|------|-------------|
| `exitPrice` | number | Resolution price (`1.0` = YES won, `0.0` = NO won) |
| `pnl` | number | Realized profit/loss in USD (negative = loss) |

---

#### `portfolio-updated`
Fired after every trade open or close with the current portfolio state.

```json
{
  "portfolioValue": 10412.80,
  "totalDeployed": 2840.00,
  "exposurePct": 27.3,
  "openPositions": 6,
  "totalPnl": 412.80,
  "winRate": 0.708,
  "closedCount": 24
}
```

| Field | Type | Description |
|-------|------|-------------|
| `portfolioValue` | number | True portfolio value (initial bankroll + realized P&L) |
| `totalDeployed` | number | Capital currently at risk in open positions |
| `exposurePct` | number | `totalDeployed / portfolioValue × 100` |
| `openPositions` | number | Number of currently open positions |
| `totalPnl` | number | Total realized P&L across all closed trades |
| `winRate` | number | Fraction of closed trades that were profitable (0–1) |
| `closedCount` | number | Total number of closed trades |

---

#### `wallets-updated`
Fired after the daily wallet discovery and analysis refresh completes.

```json
{
  "smartCount": 21,
  "totalScored": 287
}
```

| Field | Type | Description |
|-------|------|-------------|
| `smartCount` | number | Number of smart wallets now in DB |
| `totalScored` | number | Total wallets analyzed in this refresh |
