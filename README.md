# ₿ Bitcoin Intelligence Dashboard

Real-time Bitcoin intelligence with technical analysis, Fear & Greed index, news feed, and market data.

**There is no second best.**

## Features

- **Live BTC Price** with interactive charts (24H / 7D / 30D / 90D / 1Y / ALL)
- **Technical Analysis** — RSI, MACD, Moving Averages, Bollinger Bands, Support/Resistance
- **Fear & Greed Index** with 30-day history and contextual quotes
- **Bitcoin Vitals** — Supply, halving countdown, volume ratios
- **Shitcoin Index** — Alt performance shown for context (with vs BTC comparison)
- **Bitcoin News Feed** — Live headlines from CryptoCompare
- **Auto-refresh** every 2 minutes

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3847
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3847` | Server port |
| `DASHBOARD_PASSWORD` | _(none)_ | Set to enable login protection |
| `TOOLS_DIR` | `/Users/alfred/...` | Path to crypto tools (for TA) |

## Deploy

### Railway (recommended)
```bash
railway login
railway init
railway up
```

### Docker
```bash
docker build -t bitcoin-intel .
docker run -p 3847:3847 bitcoin-intel
```

### VPS
```bash
git clone <repo> && cd bitcoin-intel
npm install --production
PORT=3847 node server.js
```

## Data Sources

- **CoinGecko** — Prices, charts, market data (free, no key)
- **Alternative.me** — Fear & Greed Index (free, no key)
- **CryptoCompare** — News headlines (free, no key)

## Stack

- Express.js backend with server-side caching
- Chart.js for all visualizations  
- Vanilla JS frontend (zero build step, zero framework)
- ~50KB total payload

Built by Alfred ⚡

<!-- redeploy ping 2026-02-13T04:46:47Z -->
