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

app.use(express.static(path.join(__dirname, 'public')));

// ===== API ROUTES =====

// In-memory cache to avoid hammering free APIs
const apiCache = {};
function cached(key, ttlMs, fetchFn) {
  return async (req, res) => {
    const now = Date.now();
    if (apiCache[key] && (now - apiCache[key].ts) < ttlMs) {
      return res.json(apiCache[key].data);
    }
    try {
      const data = await fetchFn(req);
      apiCache[key] = { data, ts: now };
      res.json(data);
    } catch (e) {
      // Return stale cache if available
      if (apiCache[key]) return res.json(apiCache[key].data);
      res.status(500).json({ error: e.message });
    }
  };
}

// Prices — cache 60s
app.get('/api/prices', cached('prices', 60000, async () => {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,cardano,avalanche-2,chainlink,polkadot,dogecoin&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d,30d';
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
  return resp.json();
}));

// Chart — cache 120s per coin/days combo
app.get('/api/chart/:coin/:days', async (req, res) => {
  const { coin, days } = req.params;
  const key = `chart-${coin}-${days}`;
  const handler = cached(key, 120000, async () => {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin)}/market_chart?vs_currency=usd&days=${encodeURIComponent(days)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
    return resp.json();
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
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error('CoinGecko ' + resp.status);
  return resp.json();
}));

// Bitcoin News — cache 300s
app.get('/api/news', cached('news', 300000, async () => {
  const url = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular&categories=BTC,Bitcoin,Mining,Regulation';
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
    { sym: '^GSPC', key: 'spx', name: 'S&P 500' },
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
      const timestamps = (r.timestamp || []);
      const prev = meta.previousClose || (closes.length > 1 ? closes[closes.length - 2] : null);
      const price = meta.regularMarketPrice;
      const changePct = prev ? ((price - prev) / prev * 100) : null;

      results[t.key] = {
        name: t.name,
        price,
        prevClose: prev,
        changePct,
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

// TA — cache 300s
app.get('/api/ta/:coin', (req, res) => {
  const coin = req.params.coin;
  const cachePath = path.join(CACHE_DIR, `${coin}-ta.json`);
  try {
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      const age = Date.now() - stat.mtimeMs;
      if (age < 300000) {
        return res.json(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
      }
    }
    execSync(`python3 ${TOOLS_DIR}/technical-analysis.py ${coin} > /dev/null 2>&1`, { timeout: 20000 });
    if (fs.existsSync(cachePath)) {
      return res.json(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
    }
    res.status(500).json({ error: 'TA failed' });
  } catch (e) {
    if (fs.existsSync(cachePath)) {
      return res.json({ ...JSON.parse(fs.readFileSync(cachePath, 'utf8')), cached: true });
    }
    res.status(500).json({ error: 'TA unavailable' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), cache: Object.keys(apiCache).length });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`₿ Bitcoin Intelligence Dashboard running on port ${PORT}`);
  if (AUTH_PASSWORD) console.log('🔒 Password protection enabled');
  else console.log('🔓 No password set (public access)');
});
