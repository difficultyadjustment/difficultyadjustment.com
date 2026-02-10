const express = require('express');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3847;
const TOOLS_DIR = process.env.TOOLS_DIR || '/Users/alfred/.openclaw/workspace/tools/crypto';
const CACHE_DIR = path.join(TOOLS_DIR, 'cache');
const AUTH_PASSWORD = process.env.DASHBOARD_PASSWORD || null;

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
  return data.Data.slice(0, 20).map(a => ({
    title: a.title,
    url: a.url,
    source: a.source_info?.name || 'Unknown',
    body: (a.body || '').substring(0, 200),
    image: a.imageurl,
    published: a.published_on,
    categories: a.categories,
  }));
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
