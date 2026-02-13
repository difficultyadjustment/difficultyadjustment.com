const express = require('express');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3847;
const TOOLS_DIR = process.env.TOOLS_DIR || '/Users/alfred/.openclaw/workspace/tools/crypto';
const CACHE_DIR = path.join(TOOLS_DIR, 'cache');
const AUTH_PASSWORD = process.env.DASHBOARD_PASSWORD || null;

// Try to load Brave API key from OpenClaw config
let BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
if (!BRAVE_API_KEY) {
  try {
    const ocConfig = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '', '.openclaw/openclaw.json'), 'utf8'));
    BRAVE_API_KEY = ocConfig?.tools?.web?.search?.apiKey || '';
  } catch (e) { /* no config available */ }
}

// Simple auth middleware (optional — set DASHBOARD_PASSWORD env to enable)
if (AUTH_PASSWORD) {
  app.use((req, res, next) => {
    // Allow API calls from authenticated sessions
    if (req.path.startsWith('/api/') && req.headers['x-auth'] === AUTH_PASSWORD) {
      return next();
    }
    // Basic auth
    const auth = req.headers.authorization;
    if (auth) {
      const [scheme, encoded] = auth.split(' ');
      if (scheme === 'Basic') {
        const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
        if (pass === AUTH_PASSWORD) return next();
      }
    }
    // Check cookie
    const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
      const [k, v] = c.trim().split('=');
      acc[k] = v;
      return acc;
    }, {});
    if (cookies['btcintel_auth'] === AUTH_PASSWORD) return next();

    // Serve login page for HTML requests
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      if (req.method === 'POST' && req.path === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const params = new URLSearchParams(body);
          if (params.get('password') === AUTH_PASSWORD) {
            res.setHeader('Set-Cookie', `btcintel_auth=${AUTH_PASSWORD}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
            res.redirect('/');
          } else {
            res.status(401).send(loginPage('Wrong password.'));
          }
        });
        return;
      }
      return res.status(401).send(loginPage());
    }

    res.status(401).json({ error: 'Unauthorized' });
  });
}

function loginPage(error = '') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bitcoin Intel — Login</title>
<style>
body{background:#0a0a0f;color:#e8e8f0;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.login{background:#16161f;border:1px solid #252530;border-radius:12px;padding:40px;width:360px;text-align:center}
.logo{font-size:48px;color:#f7931a;margin-bottom:16px}
h1{font-size:20px;margin-bottom:8px}h1 span{color:#f7931a}
.sub{color:#64748b;font-size:13px;margin-bottom:24px}
input{width:100%;padding:12px;background:#111118;border:1px solid #252530;border-radius:8px;color:#e8e8f0;font-size:14px;margin-bottom:16px;outline:none}
input:focus{border-color:#f7931a}
button{width:100%;padding:12px;background:#f7931a;border:none;border-radius:8px;color:#000;font-weight:700;font-size:14px;cursor:pointer}
button:hover{background:#e2711d}
.err{color:#ef4444;font-size:13px;margin-bottom:12px}
</style></head><body>
<div class="login"><div class="logo">₿</div><h1>Bitcoin<span>Intel</span></h1>
<p class="sub">Intelligence Dashboard</p>
${error ? '<p class="err">' + error + '</p>' : ''}
<form method="POST" action="/login"><input type="password" name="password" placeholder="Password" autofocus>
<button type="submit">Enter</button></form></div></body></html>`;
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Page routes
app.get('/history', (req, res) => {
  res.sendFile('history.html', { root: path.join(__dirname, 'public') });
});

app.get('/calculator', (req, res) => {
  res.sendFile('calculator.html', { root: path.join(__dirname, 'public') });
});

app.get('/learn', (req, res) => {
  res.sendFile('learn.html', { root: path.join(__dirname, 'public') });
});

app.get('/dca', (req, res) => {
  res.sendFile('dca.html', { root: path.join(__dirname, 'public') });
});

app.get('/converter', (req, res) => {
  res.sendFile('converter.html', { root: path.join(__dirname, 'public') });
});

app.get('/attack', (req, res) => {
  res.sendFile('attack.html', { root: path.join(__dirname, 'public') });
});

app.get('/inflation', (req, res) => {
  res.sendFile('inflation.html', { root: path.join(__dirname, 'public') });
});

app.get('/hodl', (req, res) => {
  res.sendFile('hodl.html', { root: path.join(__dirname, 'public') });
});

// ===== API ROUTES =====

// In-memory cache to avoid hammering free APIs
const apiCache = {};

// Global CoinGecko rate limiter (simple queue). Prevents bursts across endpoints.
let cgQueue = Promise.resolve();
let cgLastAt = 0;
const COINGECKO_MIN_INTERVAL_MS = parseInt(process.env.COINGECKO_MIN_INTERVAL_MS || '1500', 10);
async function coingeckoFetch(url, opts = {}) {
  cgQueue = cgQueue.then(async () => {
    const wait = Math.max(0, COINGECKO_MIN_INTERVAL_MS - (Date.now() - cgLastAt));
    if (wait) await new Promise(r => setTimeout(r, wait));
    cgLastAt = Date.now();
  }).catch(() => {});
  await cgQueue;
  return fetch(url, opts);
}

function cached(key, ttlMs, fetchFn) {
  return async (req, res) => {
    const now = Date.now();
    const entry = apiCache[key];
    if (entry && (now - entry.ts) < ttlMs) {
      return res.json(entry.data);
    }

    // Retry a few times on rate limits; prefer returning stale cache over hard failure.
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const data = await fetchFn(req);
        apiCache[key] = { data, ts: Date.now() };
        return res.json(data);
      } catch (e) {
        const msg = (e && e.message) ? String(e.message) : 'Request failed';
        const is429 = msg.includes('429');

        // If we have stale data, serve it.
        if (apiCache[key]) return res.json(apiCache[key].data);

        // Backoff on 429 and retry.
        if (is429 && attempt < maxAttempts - 1) {
          const delay = 3000 + attempt * 4000; // 3s, 7s, 11s...
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Propagate an honest status code (429 if rate limited, else 500)
        if (is429) return res.status(429).json({ error: 'CoinGecko 429' });
        return res.status(500).json({ error: msg });
      }
    }
  };
}

// Prices — cache 60s (with currency support)
app.get('/api/prices', async (req, res) => {
  const vs = (req.query.vs || 'usd').toLowerCase();
  const key = 'prices-' + vs;
  const handler = cached(key, 60000, async () => {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=' + encodeURIComponent(vs) + '&ids=bitcoin,ethereum,solana,cardano,avalanche-2,chainlink,polkadot,dogecoin&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d';
    const resp = await coingeckoFetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
    return resp.json();
  });
  return handler(req, res);
});

// Chart — cache 120s per coin/days/currency combo
app.get('/api/chart/:coin/:days', async (req, res) => {
  const { coin, days } = req.params;
  const vs = (req.query.vs || 'usd').toLowerCase();
  const key = `chart-${coin}-${days}-${vs}`;
  const handler = cached(key, 120000, async () => {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin)}/market_chart?vs_currency=${encodeURIComponent(vs)}&days=${encodeURIComponent(days)}`;
    const resp = await coingeckoFetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
    return resp.json();
  });
  return handler(req, res);
});

// Exchange rates for currency conversion (cache 600s)
app.get('/api/exchange-rate', async (req, res) => {
  const vs = (req.query.vs || 'usd').toLowerCase();
  if (vs === 'usd') return res.json({ rate: 1, currency: 'usd' });
  const key = 'exrate-' + vs;
  const handler = cached(key, 600000, async () => {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,' + encodeURIComponent(vs);
    const resp = await coingeckoFetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error('CoinGecko rate ' + resp.status);
    const data = await resp.json();
    const usdPrice = data.bitcoin?.usd || 1;
    const vsPrice = data.bitcoin?.[vs] || 1;
    return { rate: vsPrice / usdPrice, currency: vs };
  });
  return handler(req, res);
});

// Fear & Greed — cache 300s
app.get('/api/fear-greed', cached('fng', 300000, async () => {
  const url = 'https://api.alternative.me/fng/?limit=30';
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error('FNG ' + resp.status);
  return resp.json();
}));

// Global — cache 120s
app.get('/api/global', cached('global', 120000, async () => {
  const url = 'https://api.coingecko.com/api/v3/global';
  const resp = await coingeckoFetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
  return resp.json();
}));

// Bitcoin News — cache 300s
app.get('/api/news', cached('news', 300000, async () => {
  const url = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular';
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error('News ' + resp.status);
  const data = await resp.json();
  if (!data.Data) return [];
  
  // Server-side filtering: Bitcoin + macro only
  const shitcoinTitleRegex = /\b(XRP|ripple|solana|SOL|cardano|ADA|dogecoin|DOGE|shiba|SHIB|avalanche|AVAX|polkadot|DOT|chainlink|LINK|tron|TRX|meme.?coin|altcoin|NFT|airdrop|SNX|synthetix|aave|uniswap|pancake|pepe|bonk|floki|SEI|sui |aptos|arbitrum|optimism|base chain|polygon|matic|cosmos|ATOM|near protocol|hedera|HBAR|stellar|XLM|toncoin|TON |DYDX|dYdX|DEXE|DeXe|binance coin|BNB|stablecoin|USDT|USDC|tether(?! manipulat)|CZ:|Changpeng|manta|mantle|render|FET|INJ|injective|worldcoin|WLD|jupiter|JUP|ondo|ONDO|pendle|ethena|ENA|celestia|TIA|starknet|STRK|lido|eigenlayer|blur)\b/i;
  const irrelevantRegex = /\b(AUD\/USD|EUR\/USD|GBP\/USD|USD\/JPY|forex|figure skating|olympics|music|celebrity|dating|fashion|horoscope|astrology|sports|soccer|football|basketball|AI\.com|domain name)\b/i;
  
  const filtered = data.Data.filter(a => {
    const title = a.title || '';
    // Reject shitcoin-focused headlines
    if (shitcoinTitleRegex.test(title)) return false;
    // Reject irrelevant content
    if (irrelevantRegex.test(title)) return false;
    return true;
  });
  
  return filtered.slice(0, 20).map(a => ({
    title: a.title,
    url: a.url,
    source: a.source_info?.name || 'Unknown',
    body: (a.body || '').substring(0, 200),
    image: a.imageurl,
    published: a.published_on,
    categories: a.categories,
  }));
}));

// Macro data — cache 600s (10 min, with range support)
app.get('/api/macro', async (req, res) => {
  const range = req.query.range || '6mo';
  const allowed = ['1mo', '3mo', '6mo', '1y', '2y', '5y'];
  const safeRange = allowed.includes(range) ? range : '6mo';
  const key = 'macro-' + safeRange;
  const handler = cached(key, 600000, async () => {
  // Yahoo Finance tickers
  const tickers = [
    { sym: 'DX-Y.NYB', key: 'dxy', name: 'Dollar Index (DXY)' },
    { sym: 'GC=F', key: 'gold', name: 'Gold' },
    { sym: 'SI=F', key: 'silver', name: 'Silver' },
    { sym: '^GSPC', key: 'spx', name: 'S&P 500' },
    { sym: '^DJI', key: 'djia', name: 'Dow Jones' },
    { sym: '^TNX', key: 'yield10y', name: '10Y Treasury' },
    { sym: '^VIX', key: 'vix', name: 'VIX' },
    { sym: 'CL=F', key: 'oil', name: 'Crude Oil (WTI)' },
  ];

  const results = {};

  // Fetch Yahoo tickers in parallel
  const yahooPromises = tickers.map(async (t) => {
    try {
      const interval = (safeRange === '2y' || safeRange === '5y') ? '1wk' : '1d';
      const url = 'https://query2.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(t.sym) + '?interval=' + interval + '&range=' + safeRange;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const r = data.chart?.result?.[0];
      if (!r) return;
      const meta = r.meta || {};
      const closes = (r.indicators?.quote?.[0]?.close || []).filter(c => c != null);
      const price = meta.regularMarketPrice;
      
      // Calculate change over the FULL range (first close → current price)
      const firstClose = closes.length > 0 ? closes[0] : null;
      const rangePct = firstClose ? ((price - firstClose) / firstClose * 100) : null;

      results[t.key] = {
        name: t.name,
        price,
        firstPrice: firstClose,
        changePct: rangePct,
        sparkline: closes,
      };
    } catch (e) { /* skip failed ticker */ }
  });

  // Fetch M2 from FRED CSV
  const fredPromise = (async () => {
    try {
      const resp = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL', {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return;
      const text = await resp.text();
      const lines = text.trim().split('\n').slice(1); // skip header
      const values = lines.map(l => {
        const [date, val] = l.split(',');
        return { date, value: parseFloat(val) };
      }).filter(v => !isNaN(v.value));

      if (values.length >= 2) {
        const latest = values[values.length - 1];
        const prev = values[values.length - 2];
        const yoy = values.length >= 13 ? values[values.length - 13] : null;
        results.m2 = {
          name: 'M2 Money Supply',
          value: latest.value,
          date: latest.date,
          momChange: ((latest.value - prev.value) / prev.value * 100).toFixed(2),
          yoyChange: yoy ? ((latest.value - yoy.value) / yoy.value * 100).toFixed(1) : null,
          sparkline: values.slice(-24).map(v => v.value), // 24 months
        };
      }
    } catch (e) { /* skip */ }
  })();

  // Fetch Fed Funds from FRED
  const fedPromise = (async () => {
    try {
      const resp = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS', {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return;
      const text = await resp.text();
      const lines = text.trim().split('\n').slice(1);
      const values = lines.map(l => {
        const [date, val] = l.split(',');
        return { date, value: parseFloat(val) };
      }).filter(v => !isNaN(v.value));

      if (values.length) {
        const latest = values[values.length - 1];
        const prev = values.length >= 2 ? values[values.length - 2] : null;
        results.fedRate = {
          name: 'Fed Funds Rate',
          value: latest.value,
          date: latest.date,
          prevValue: prev ? prev.value : null,
          sparkline: values.slice(-24).map(v => v.value),
        };
      }
    } catch (e) { /* skip */ }
  })();

  await Promise.allSettled([...yahooPromises, fredPromise, fedPromise]);

  return results;
  });
  return handler(req, res);
});

// BTC long-range chart via Yahoo Finance (CoinGecko limits to 365 days)
app.get('/api/chart-long/:range', async (req, res) => {
  const range = req.params.range;
  const key = 'chart-long-' + range;
  const handler = cached(key, 600000, async () => {
    const interval = range === 'max' ? '1wk' : '1d';
    const url = 'https://query2.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=' +
      interval + '&range=' + encodeURIComponent(range);
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error('Yahoo ' + resp.status);
    const data = await resp.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('No data');
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) prices.push([timestamps[i] * 1000, closes[i]]);
    }
    return { prices };
  });
  return handler(req, res);
});

// Lightning Network stats — cache 600s (with range support)
app.get('/api/lightning', async (req, res) => {
  const range = req.query.range || '3m';
  const allowed = ['3m', '6m', '1y', '2y', '3y'];
  const safeRange = allowed.includes(range) ? range : '3m';
  const key = 'lightning-' + safeRange;
  const handler = cached(key, 600000, async () => {
    const [statsResp, histResp] = await Promise.all([
      fetch('https://mempool.space/api/v1/lightning/statistics/latest', { signal: AbortSignal.timeout(10000) }),
      fetch('https://mempool.space/api/v1/lightning/statistics/' + safeRange, { signal: AbortSignal.timeout(10000) }),
    ]);
  if (!statsResp.ok) throw new Error('LN stats ' + statsResp.status);
  const stats = await statsResp.json();
  const latest = stats.latest || {};

  let history = [];
  if (histResp.ok) {
    history = await histResp.json();
  }

  return {
    channels: latest.channel_count,
    nodes: latest.node_count,
    capacityBtc: latest.total_capacity ? latest.total_capacity / 1e8 : null,
    torNodes: latest.tor_nodes,
    clearnetNodes: latest.clearnet_nodes,
    avgCapacity: latest.avg_capacity ? latest.avg_capacity / 1e8 : null,
    medFeeRate: latest.med_fee_rate,
    avgFeeRate: latest.avg_fee_rate,
    capacityHistory: history.map(h => ({
      t: new Date(h.added).getTime(),
      cap: h.total_capacity / 1e8,
      channels: h.channel_count,
    })),
  };
  });
  return handler(req, res);
});

// Mining & Difficulty — cache 300s (with range support)
app.get('/api/mining', async (req, res) => {
  const range = req.query.range || '3m';
  const allowed = ['1m', '3m', '6m', '1y', '2y', '3y'];
  const safeRange = allowed.includes(range) ? range : '3m';
  const key = 'mining-' + safeRange;
  const handler = cached(key, 300000, async () => {
    const [diffResp, hashResp] = await Promise.all([
      fetch('https://mempool.space/api/v1/difficulty-adjustment', { signal: AbortSignal.timeout(10000) }),
      fetch('https://mempool.space/api/v1/mining/hashrate/' + safeRange, { signal: AbortSignal.timeout(10000) }),
    ]);
  if (!diffResp.ok) throw new Error('Mempool diff ' + diffResp.status);
  if (!hashResp.ok) throw new Error('Mempool hash ' + hashResp.status);
  const diff = await diffResp.json();
  const hash = await hashResp.json();
  
  // Get latest hashrate and build sparkline
  const hashrates = hash.hashrates || [];
  const difficulties = hash.difficulty || [];
  const latestHash = hashrates.length ? hashrates[hashrates.length - 1] : null;
  const latestDiff = difficulties.length ? difficulties[difficulties.length - 1] : null;
  
  // Hashrate sparkline (all points for the range)
  const hashSparkline = hashrates.map(h => ({
    t: h.timestamp * 1000,
    v: h.avgHashrate / 1e18 // EH/s
  }));
  
  // Difficulty sparkline
  const diffSparkline = difficulties.map(d => ({
    t: d.time * 1000,
    v: d.difficulty / 1e12 // T
  }));
  
  return {
    adjustment: {
      progressPercent: diff.progressPercent,
      difficultyChange: diff.difficultyChange,
      estimatedRetargetDate: diff.estimatedRetargetDate,
      remainingBlocks: diff.remainingBlocks,
      remainingTime: diff.remainingTime,
      previousRetarget: diff.previousRetarget,
      nextRetargetHeight: diff.nextRetargetHeight,
      timeAvg: diff.timeAvg,
    },
    hashrate: latestHash ? latestHash.avgHashrate / 1e18 : null, // EH/s
    difficulty: latestDiff ? latestDiff.difficulty / 1e12 : null, // T
    blockHeight: latestDiff ? latestDiff.height : null,
    hashSparkline,
    diffSparkline,
  };
  });
  return handler(req, res);
});

// Bitcoin Twitter / X posts — cache 600s (uses Brave Search, rate limited)
app.get('/api/x-posts', cached('xposts', 600000, async () => {
  if (!BRAVE_API_KEY) return [];
  
  const queries = [
    'bitcoin "on X" OR "posted on X" OR "tweeted" saylor OR btc',
    'bitcoin twitter trending opinion analysis'
  ];
  
  const allResults = [];
  for (const q of queries) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&freshness=pw&count=5`;
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_API_KEY },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.web?.results) {
          allResults.push(...data.web.results.map(r => ({
            title: r.title,
            url: r.url,
            description: r.description,
            published: r.age || null,
            source: new URL(r.url).hostname.replace('www.', ''),
          })));
        }
      }
      // Rate limit between queries
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) { /* skip failed query */ }
  }
  
  // Deduplicate by URL
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
  
  // Filter out irrelevant
  const shitcoinRegex = /\b(XRP|ripple|solana|dogecoin|shiba|cardano|altcoin)\b/i;
  return unique.filter(r => !shitcoinRegex.test(r.title)).slice(0, 8);
}));

// TA — pure JS implementation (no Python dependency), cache 300s
app.get('/api/ta/:coin', async (req, res) => {
  const coin = req.params.coin;
  const key = 'ta-' + coin;
  const handler = cached(key, 300000, async () => {
    // Fetch 90 days of daily data for TA calculations
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin)}/market_chart?vs_currency=usd&days=90`;
    const resp = await coingeckoFetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
    const data = await resp.json();
    const prices = (data.prices || []).map(p => p[1]);
    if (prices.length < 50) throw new Error('Not enough data');

    const price = prices[prices.length - 1];

    // RSI (14-period)
    const rsiPeriod = 14;
    let gains = 0, losses = 0;
    for (let i = prices.length - rsiPeriod; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    // SMA
    const sma = (arr, period) => {
      const slice = arr.slice(-period);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    };
    const sma_20 = sma(prices, 20);
    const sma_50 = sma(prices, 50);

    // EMA
    const ema = (arr, period) => {
      const k = 2 / (period + 1);
      let e = arr[0];
      for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
      return e;
    };
    const ema_12 = ema(prices, 12);
    const ema_26 = ema(prices, 26);

    // MACD
    const macd_line = ema_12 - ema_26;
    // Signal line (9-period EMA of MACD) - approximate
    const macdVals = [];
    for (let i = 26; i < prices.length; i++) {
      const e12 = ema(prices.slice(0, i + 1), 12);
      const e26 = ema(prices.slice(0, i + 1), 26);
      macdVals.push(e12 - e26);
    }
    const signal_line = macdVals.length >= 9 ? ema(macdVals, 9) : 0;

    // Bollinger Bands (20-period, 2 std dev)
    const bb_sma = sma_20;
    const bb_slice = prices.slice(-20);
    const bb_std = Math.sqrt(bb_slice.reduce((sum, p) => sum + Math.pow(p - bb_sma, 2), 0) / 20);
    const bb_upper = bb_sma + 2 * bb_std;
    const bb_lower = bb_sma - 2 * bb_std;

    // Support/Resistance (simple: recent lows/highs)
    const recent = prices.slice(-30);
    const supports = [];
    const resistances = [];
    for (let i = 2; i < recent.length - 2; i++) {
      if (recent[i] < recent[i-1] && recent[i] < recent[i-2] && recent[i] < recent[i+1] && recent[i] < recent[i+2]) {
        supports.push(recent[i]);
      }
      if (recent[i] > recent[i-1] && recent[i] > recent[i-2] && recent[i] > recent[i+1] && recent[i] > recent[i+2]) {
        resistances.push(recent[i]);
      }
    }

    return {
      price,
      rsi,
      sma_20,
      sma_50,
      ema_12,
      ema_26,
      macd_line,
      signal_line,
      bb_upper,
      bb_lower,
      bb_sma,
      supports,
      resistances,
    };
  });
  return handler(req, res);
});

// Historical difficulty adjustments — cache 1 hour
app.get('/api/difficulty-history', cached('diff-history', 3600000, async () => {
  const resp = await fetch('https://mempool.space/api/v1/mining/difficulty-adjustments/all', {
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error('Mempool ' + resp.status);
  const raw = await resp.json();
  // Format: [[timestamp, height, difficulty, change_ratio], ...]
  return raw.map((d, i) => {
    const prevDiff = i < raw.length - 1 ? raw[i + 1][2] : d[2];
    const changePct = prevDiff > 0 ? ((d[2] - prevDiff) / prevDiff * 100) : 0;
    return {
      timestamp: d[0] * 1000,
      height: d[1],
      difficulty: d[2],
      changePct: changePct,
    };
  });
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), cache: Object.keys(apiCache).length });
});

// Pre-warm cache on startup with staggered requests to avoid rate limits
async function warmCache() {
  // Non-CoinGecko endpoints first (no rate limit concerns)
  const safeFirst = ['/api/fear-greed', '/api/mining', '/api/news', '/api/lightning', '/api/x-posts'];
  // CoinGecko endpoints — space these out heavily
  const cgEndpoints = ['/api/macro', '/api/prices', '/api/global', '/api/chart/bitcoin/1', '/api/ta/bitcoin'];

  console.log('⏳ Warming cache (safe endpoints)...');
  for (const ep of safeFirst) {
    try {
      await fetch(`http://127.0.0.1:${PORT}${ep}`, { signal: AbortSignal.timeout(20000) });
      console.log('  ✅ ' + ep);
    } catch (e) {
      console.log('  ⚠️ ' + ep + ' (' + (e.message || 'failed') + ')');
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('⏳ Warming CoinGecko endpoints (5s spacing)...');
  for (const ep of cgEndpoints) {
    try {
      await fetch(`http://127.0.0.1:${PORT}${ep}`, { signal: AbortSignal.timeout(20000) });
      console.log('  ✅ ' + ep);
    } catch (e) {
      console.log('  ⚠️ ' + ep + ' (' + (e.message || 'failed') + ')');
    }
    // 5 second gap between CoinGecko calls
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('✅ Cache warm');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`₿ Difficulty Adjustment running on port ${PORT}`);
  if (AUTH_PASSWORD) console.log('🔒 Password protection enabled');
  else console.log('🔓 No password set (public access)');
  // Warm cache after 3 seconds
  setTimeout(warmCache, 3000);
});
