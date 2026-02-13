// Bitcoin Intelligence Dashboard
// There is no second best.

// PWA: register service worker (force update on deploy)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').then(function(reg) {
      try { reg.update(); } catch (e) {}
    }).catch(function() { /* ignore */ });
  });
}

let btcChart = null;
let fngChart = null;
let btcPriceGlobal = 0;

// Currency state
var currentCurrency = localStorage.getItem('btcintel_currency') || 'usd';
var currencySymbols = {
  usd: '$', cad: 'CA$', eur: '€', gbp: '£', aud: 'A$', jpy: '¥',
  chf: 'CHF ', cny: '¥', inr: '₹', brl: 'R$', mxn: 'MX$', sek: 'kr ',
  nok: 'kr ', nzd: 'NZ$', sgd: 'S$', hkd: 'HK$', krw: '₩', zar: 'R',
  sats: '', btc: '₿'
};
var exchangeRate = 1; // vs USD rate for macro conversion

function csym() { return currencySymbols[currentCurrency] || '$'; }

// Formatters
const fmt = {
  price(n) {
    if (currentCurrency === 'sats') {
      return Math.round(n).toLocaleString() + ' sats';
    }
    var s = csym();
    if (n >= 1000) return s + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (n >= 1) return s + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 0.01) return s + n.toFixed(4);
    return s + n.toFixed(6);
  },
  // Format macro values (always USD, convert with exchangeRate)
  usdToLocal(n) {
    if (currentCurrency === 'usd') return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    var converted = n * exchangeRate;
    var s = csym();
    if (converted >= 1000) return s + converted.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return s + converted.toFixed(2);
  },
  sats(usdPrice) {
    if (!btcPriceGlobal || !usdPrice) return '--';
    const sats = Math.round((usdPrice / btcPriceGlobal) * 100000000);
    return sats.toLocaleString() + ' sats';
  },
  pct(n) {
    if (n == null) return '--';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  },
  mcap(n) {
    var s = csym();
    if (currentCurrency === 'sats') { s = ''; n = n; } // sats mcap doesn't make sense, keep as-is with $
    if (currentCurrency === 'sats') s = '$';
    if (n >= 1e12) return s + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return s + (n / 1e9).toFixed(1) + 'B';
    return s + (n / 1e6).toFixed(0) + 'M';
  },
  vol(n) {
    var s = (currentCurrency === 'sats') ? '$' : csym();
    if (n >= 1e9) return s + (n / 1e9).toFixed(1) + 'B';
    return s + (n / 1e6).toFixed(0) + 'M';
  },
  supply(n) {
    return (n / 1e6).toFixed(2) + 'M';
  },
  change(el, val) {
    el.textContent = fmt.pct(val);
    el.className = 'change ' + (val >= 0 ? 'positive' : 'negative');
  }
};

// Chart.js defaults
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.legend.display = false;

function createGradient(ctx, color, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color + '40');
  gradient.addColorStop(1, color + '00');
  return gradient;
}

// Mobile: allow tapping Tools dropdown to open/close
function toggleMobileToolsMenu(e) {
  try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
  const dd = (e && e.target) ? e.target.closest('.nav-dropdown') : null;
  if (!dd) return;
  dd.classList.toggle('open');
}

function closeAllNavDropdowns() {
  document.querySelectorAll('.nav-dropdown.open').forEach(function(dd) {
    dd.classList.remove('open');
  });
}

document.addEventListener('click', closeAllNavDropdowns);
// iOS Safari can be picky about click delay; also listen for touchstart
document.addEventListener('touchstart', closeAllNavDropdowns, { passive: true });

function setPwaStatus(mode) {
  var bar = document.getElementById('pwaStatus');
  if (!bar) return;
  var text = document.getElementById('pwaStatusText');
  var tag = document.getElementById('pwaStatusTag');
  bar.classList.add('show');
  tag.className = 'tag';

  if (mode === 'offline') {
    if (text) text.textContent = 'offline';
    if (tag) { tag.textContent = 'OFFLINE'; tag.classList.add('offline'); }
    return;
  }

  if (mode === 'cached') {
    if (text) text.textContent = 'online (cached data)';
    if (tag) { tag.textContent = 'CACHED'; tag.classList.add('cached'); }
    return;
  }

  // online
  if (text) text.textContent = 'online';
  if (tag) tag.textContent = '';
  // hide after a moment to reduce clutter
  setTimeout(function() { bar.classList.remove('show'); }, 1200);
}

window.addEventListener('online', function() { setPwaStatus('online'); });
window.addEventListener('offline', function() { setPwaStatus('offline'); });

// Hard refresh: bypass service worker cache for key API calls
var hardRefreshNonce = 0;
function apiUrl(path) {
  if (!hardRefreshNonce) return path;
  const sep = path.indexOf('?') >= 0 ? '&' : '?';
  return path + sep + '__hr=' + hardRefreshNonce;
}

async function hardRefreshData() {
  hardRefreshNonce = Date.now();
  setPwaStatus('online');

  // Try to clear SW caches too (best-effort)
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
    }
  } catch (e) {}

  // Force reload all visible data
  refreshAll();
}

// ===== FETCH FUNCTIONS =====

async function fetchPrices() {
  const res = await fetch(apiUrl('/api/prices?vs=' + currentCurrency));
  const data = await res.json();
  if (res && res.headers && res.headers.get('X-Cache') === 'HIT') setPwaStatus('cached');
  if (Array.isArray(data)) {
    const btc = data.find(c => c.id === 'bitcoin');
    if (btc) {
      btcPriceGlobal = btc.current_price;
      renderBTCHero(btc);
      renderVitals(btc);
    }
    // Filter BTC out for the shitcoin table
    const alts = data.filter(c => c.id !== 'bitcoin');
    renderPriceTable(alts, btc);
  }
}

async function fetchFearGreed() {
  const res = await fetch(apiUrl('/api/fear-greed'));
  const data = await res.json();
  if (data.data) renderFearGreed(data.data);
}

async function fetchGlobal() {
  const res = await fetch(apiUrl('/api/global'));
  const json = await res.json();
  if (json.data) renderGlobal(json.data);
}

async function fetchTA() {
  const res = await fetch(apiUrl('/api/ta/bitcoin'));
  const data = await res.json();
  if (data.rsi != null) renderTA(data);
}

async function fetchNews() {
  const res = await fetch(apiUrl('/api/news'));
  const data = await res.json();
  if (Array.isArray(data) && data.length) renderNews(data);
}

async function fetchMining(range) {
  var url = apiUrl('/api/mining' + (range ? '?range=' + range : ''));
  var res = await fetch(url);
  var data = await res.json();
  if (data.adjustment) renderMining(data);
}

function loadMining(range, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
  }
  fetchMining(range).catch(function(e) { console.error('mining failed:', e); });
}

async function fetchMacro(range) {
  var url = apiUrl('/api/macro' + (range ? '?range=' + range : ''));
  var res = await fetch(url);
  var data = await res.json();
  if (data && typeof data === 'object') renderMacro(data);
}

function loadMacro(range, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
  }
  fetchMacro(range).catch(function(e) { console.error('macro failed:', e); });
}

async function fetchLightning(range) {
  var url = apiUrl('/api/lightning' + (range ? '?range=' + range : ''));
  var res = await fetch(url);
  var data = await res.json();
  if (data.channels) renderLightning(data);
}

function loadLightning(range, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
  }
  fetchLightning(range).catch(function(e) { console.error('lightning failed:', e); });
}

async function fetchXPosts() {
  const res = await fetch(apiUrl('/api/x-posts'));
  const data = await res.json();
  if (Array.isArray(data) && data.length) renderXPosts(data);
}

var lastChartRange = { type: 'short', value: 1 };

async function loadChart(coin, days, btn) {
  if (btn) {
    document.querySelectorAll('.btc-hero .chart-tabs .tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
  }
  lastChartRange = { type: 'short', value: days };
  var res = await fetch(apiUrl('/api/chart/' + coin + '/' + days + '?vs=' + currentCurrency));
  var data = await res.json();
  if (data.prices) renderBTCChart(data.prices, days);
}

async function loadChartLong(range, btn) {
  if (btn) {
    document.querySelectorAll('.btc-hero .chart-tabs .tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
  }
  lastChartRange = { type: 'long', value: range };
  var res = await fetch(apiUrl('/api/chart-long/' + range));
  var data = await res.json();
  if (data.prices) renderBTCChart(data.prices, range);
}

// ===== RENDER FUNCTIONS =====

function renderBTCHero(btc) {
  document.getElementById('btcLogo').src = btc.image;
  document.getElementById('btcPrice').textContent = fmt.price(btc.current_price);
  fmt.change(document.getElementById('btcChange'), btc.price_change_percentage_24h);

  // Dynamic page title with price
  document.title = fmt.price(btc.current_price) + ' — Difficulty Adjustment';

  // Sats per unit of currency
  var satsPerUnit = Math.round(100000000 / btc.current_price);
  var satsEl = document.getElementById('satsPerDollar');
  if (satsEl) satsEl.textContent = satsPerUnit.toLocaleString();
  var satsLabel = document.getElementById('satsLabel');
  if (satsLabel) satsLabel.textContent = 'Sats / ' + currentCurrency.toUpperCase();

  // Days since ATH
  var daysSinceATH = '--';
  if (btc.ath_date) {
    var athDate = new Date(btc.ath_date);
    daysSinceATH = Math.floor((Date.now() - athDate.getTime()) / 86400000) + 'd';
  }

  var stats = document.getElementById('btcStats');
  stats.innerHTML = [
    { label: '24h High', value: fmt.price(btc.high_24h) },
    { label: '24h Low', value: fmt.price(btc.low_24h) },
    { label: 'ATH', value: fmt.price(btc.ath) },
    { label: 'From ATH', value: fmt.pct(btc.ath_change_percentage) },
    { label: 'Days Since ATH', value: daysSinceATH },
    { label: 'ATH Date', value: btc.ath_date ? new Date(btc.ath_date).toLocaleDateString() : '--' },
  ].map(function(i) {
    return '<div class="btc-stat-item">' +
      '<div class="label">' + i.label + '</div>' +
      '<div class="value">' + i.value + '</div>' +
    '</div>';
  }).join('');

  // Render BTC/Gold ratio if gold data is cached
  renderBtcGold(btc);
}

function renderVitals(btc) {
  const container = document.getElementById('vitalsContent');
  const supplyPct = ((btc.circulating_supply / btc.max_supply) * 100).toFixed(1);
  const halvingEst = '~April 2028';
  const satsPerDollar = Math.round(100000000 / btc.current_price);

  const supplyBar = '<div class="supply-bar-wrapper">' +
    '<div class="supply-bar-labels">' +
      '<span>' + fmt.supply(btc.circulating_supply) + ' mined</span>' +
      '<span class="mined">' + supplyPct + '% of 21M</span>' +
    '</div>' +
    '<div class="supply-bar"><div class="supply-bar-fill" style="width:' + supplyPct + '%"></div></div>' +
  '</div>';

  const rows = [
    { label: 'Market Cap', val: fmt.mcap(btc.market_cap) },
    { label: 'Market Cap Rank', val: '#' + btc.market_cap_rank },
    { label: '24h Volume', val: fmt.vol(btc.total_volume) },
    { label: 'Vol/MCap Ratio', val: (btc.total_volume / btc.market_cap * 100).toFixed(2) + '%' },
    { label: 'Next Halving', val: halvingEst },
    { label: 'ATH Date', val: btc.ath_date ? new Date(btc.ath_date).toLocaleDateString() : '--' },
  ];

  container.innerHTML = supplyBar + rows.map(function(r) {
    return '<div class="vital-row">' +
      '<span class="vital-label">' + r.label + '</span>' +
      '<span class="vital-val">' + r.val + '</span>' +
    '</div>';
  }).join('');
}

function renderBTCChart(prices, days) {
  const ctx = document.getElementById('btcChart').getContext('2d');
  const labels = prices.map(p => new Date(p[0]));
  const values = prices.map(p => p[1]);
  const isUp = values[values.length - 1] >= values[0];
  // Always use orange for BTC
  const lineColor = '#f7931a';
  const chartHeight = ctx.canvas.parentElement?.clientHeight || 380;

  if (btcChart) btcChart.destroy();

  btcChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: lineColor,
        borderWidth: 2,
        backgroundColor: createGradient(ctx, lineColor, chartHeight),
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHitRadius: 10,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          grid: { display: false },
          ticks: { maxTicksLimit: 8, font: { size: 11 } }
        },
        y: {
          grid: { color: '#25253020' },
          ticks: {
            callback: function(v) { return csym() + (v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v); },
            font: { size: 11, family: "'JetBrains Mono', monospace" }
          }
        }
      },
      plugins: {
        tooltip: {
          backgroundColor: '#16161f',
          borderColor: '#252530',
          borderWidth: 1,
          titleFont: { size: 12 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 14, weight: 'bold' },
          callbacks: {
            label: ctx => fmt.price(ctx.parsed.y)
          }
        }
      }
    }
  });
}

function renderFearGreed(data) {
  const current = data[0];
  const value = parseInt(current.value);
  const cls = current.value_classification;

  document.getElementById('fngValue').textContent = value;
  document.getElementById('fngClass').textContent = cls;

  // Bitcoin maxi context
  const ctx = document.getElementById('fngContext');
  if (value < 15) ctx.textContent = '"Be greedy when others are fearful." — Warren Buffett';
  else if (value < 25) ctx.textContent = 'Historically strong accumulation zone for Bitcoin.';
  else if (value < 45) ctx.textContent = 'Fear in the market. Smart money is paying attention.';
  else if (value < 55) ctx.textContent = 'Neutral. No clear signal.';
  else if (value < 75) ctx.textContent = 'Getting greedy. Consider your time preference.';
  else ctx.textContent = 'Extreme greed. Euphoria never lasts.';

  const circle = document.getElementById('fngCircle');
  let color;
  if (value < 25) color = '#ef4444';
  else if (value < 45) color = '#f97316';
  else if (value < 55) color = '#eab308';
  else if (value < 75) color = '#22c55e';
  else color = '#15803d';

  circle.style.borderColor = color;
  document.getElementById('fngValue').style.color = color;
  document.getElementById('fngClass').style.color = color;

  const banner = document.getElementById('fngBanner');
  banner.classList.remove('extreme-fear', 'extreme-greed');
  if (value < 20) banner.classList.add('extreme-fear');
  else if (value > 80) banner.classList.add('extreme-greed');

  // FNG 30-day chart
  const chartCtx = document.getElementById('fngChart').getContext('2d');
  const reversed = [...data].reverse();

  if (fngChart) fngChart.destroy();
  fngChart = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: reversed.map(d => new Date(d.timestamp * 1000)),
      datasets: [{
        data: reversed.map(d => parseInt(d.value)),
        borderColor: color,
        borderWidth: 2,
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } },
      plugins: { tooltip: { enabled: false } }
    }
  });
}

function renderGlobal(data) {
  // BTC market cap (from total * dominance), currency-aware
  var cur = currentCurrency === 'sats' ? 'usd' : currentCurrency;
  var btcDom = (data.market_cap_percentage?.btc || 0) / 100;
  var totalMcap = (data.total_market_cap?.[cur] || data.total_market_cap?.usd || 0);
  var btcMcapVal = totalMcap * btcDom;
  document.getElementById('btcMcap').textContent = fmt.mcap(btcMcapVal);
  var totalVol = (data.total_volume?.[cur] || data.total_volume?.usd || 0);
  document.getElementById('totalVol').textContent = fmt.vol(totalVol);
  document.getElementById('btcDom').textContent = (data.market_cap_percentage?.btc || 0).toFixed(1) + '%';

  // 24h market cap delta
  var mcap24h = data.market_cap_change_percentage_24h_usd || 0;
  var deltaEl = document.getElementById('mcap24hDelta');
  deltaEl.textContent = fmt.pct(mcap24h);
  deltaEl.className = 'stat-value ' + (mcap24h >= 0 ? 'positive' : 'negative');
}

function renderPriceTable(coins, btc) {
  const tbody = document.getElementById('priceTableBody');
  const btc7d = btc?.price_change_percentage_7d_in_currency || 0;

  tbody.innerHTML = coins.map((c, i) => {
    const pct1h = c.price_change_percentage_1h_in_currency;
    const pct24h = c.price_change_percentage_24h_in_currency;
    const pct7d = c.price_change_percentage_7d_in_currency;
    // vs BTC performance
    const vsBtc = pct7d != null ? (pct7d - btc7d) : null;
    const sparkId = 'spark-' + c.id;

    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><div class="coin-cell">' +
        '<img src="' + c.image + '" alt="' + c.symbol + '">' +
        '<span class="coin-name">' + c.name + '<span class="coin-ticker">' + c.symbol.toUpperCase() + '</span></span>' +
      '</div></td>' +
      '<td class="price-cell">' + fmt.price(c.current_price) + '</td>' +
      '<td class="' + (pct1h >= 0 ? 'positive' : 'negative') + '">' + fmt.pct(pct1h) + '</td>' +
      '<td class="' + (pct24h >= 0 ? 'positive' : 'negative') + '">' + fmt.pct(pct24h) + '</td>' +
      '<td class="' + (pct7d >= 0 ? 'positive' : 'negative') + '">' + fmt.pct(pct7d) + '</td>' +
      '<td class="' + (vsBtc >= 0 ? 'positive' : 'negative') + '">' + fmt.pct(vsBtc) + '</td>' +
      '<td class="mcap-cell mcap-col">' + fmt.mcap(c.market_cap) + '</td>' +
      '<td class="sparkline-cell sparkline-col"><canvas id="' + sparkId + '" width="120" height="40"></canvas></td>' +
    '</tr>';
  }).join('');

  // Sparklines
  coins.forEach(c => {
    const el = document.getElementById('spark-' + c.id);
    if (el && c.sparkline_in_7d?.price) {
      const prices = c.sparkline_in_7d.price;
      const isUp = prices[prices.length - 1] >= prices[0];
      new Chart(el.getContext('2d'), {
        type: 'line',
        data: {
          labels: prices.map((_, i) => i),
          datasets: [{
            data: prices,
            borderColor: isUp ? '#22c55e' : '#ef4444',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
          }]
        },
        options: {
          responsive: false,
          animation: false,
          scales: { x: { display: false }, y: { display: false } },
          plugins: { tooltip: { enabled: false } }
        }
      });
    }
  });
}

function renderTA(data) {
  const container = document.getElementById('taContent');
  const signalBadge = document.getElementById('taSignal');

  let score = 0, total = 0;
  if (data.rsi != null) {
    total++;
    if (data.rsi < 30) score += 1;
    else if (data.rsi < 45) score += 0.5;
    else if (data.rsi > 70) score -= 1;
    else if (data.rsi > 55) score -= 0.5;
  }
  if (data.macd_line != null) { total++; score += data.macd_line > 0 ? 1 : -1; }
  if (data.sma_20 != null) { total++; score += data.price > data.sma_20 ? 1 : -1; }
  if (data.sma_50 != null) { total++; score += data.price > data.sma_50 ? 1 : -1; }

  const finalScore = total > 0 ? score / total : 0;
  let signalText, signalClass;
  if (finalScore > 0.3) { signalText = 'BULLISH'; signalClass = 'bullish'; }
  else if (finalScore > -0.3) { signalText = 'NEUTRAL'; signalClass = 'neutral'; }
  else { signalText = 'BEARISH'; signalClass = 'bearish'; }

  signalBadge.textContent = signalText;
  signalBadge.className = 'badge ' + signalClass;

  const rsiColor = data.rsi < 30 ? '#22c55e' : data.rsi > 70 ? '#ef4444' : data.rsi < 45 ? '#eab308' : '#94a3b8';

  let supportVal = '--', resistVal = '--';
  if (data.supports?.length) {
    const below = data.supports.filter(s => s < data.price);
    if (below.length) supportVal = fmt.price(Math.max(...below));
  }
  if (data.resistances?.length) {
    const above = data.resistances.filter(r => r > data.price);
    if (above.length) resistVal = fmt.price(Math.min(...above));
  }

  container.innerHTML = `
    <div class="ta-section">
      <h4>Momentum</h4>
      <div class="ta-indicator">
        <span class="name">RSI (14)</span>
        <span class="val" style="color:${rsiColor}">${data.rsi?.toFixed(1) || '--'}</span>
      </div>
      <div class="ta-meter">
        <div class="ta-meter-fill" style="width:${data.rsi || 0}%;background:${rsiColor}"></div>
      </div>
      <div class="ta-indicator">
        <span class="name">MACD</span>
        <span class="val ${data.macd_line > 0 ? 'positive' : 'negative'}">${data.macd_line?.toFixed(0) || '--'}</span>
      </div>
    </div>
    <div class="ta-section">
      <h4>Moving Averages</h4>
      <div class="ta-indicator">
        <span class="name">SMA 20</span>
        <span class="val">${data.sma_20 ? fmt.price(data.sma_20) : '--'} ${data.price > data.sma_20 ? '✅' : '⚠️'}</span>
      </div>
      <div class="ta-indicator">
        <span class="name">SMA 50</span>
        <span class="val">${data.sma_50 ? fmt.price(data.sma_50) : '--'} ${data.price > data.sma_50 ? '✅' : '⚠️'}</span>
      </div>
    </div>
    <div class="ta-section">
      <h4>Bollinger Bands</h4>
      <div class="ta-indicator">
        <span class="name">Upper</span>
        <span class="val">${data.bb_upper ? fmt.price(data.bb_upper) : '--'}</span>
      </div>
      <div class="ta-indicator">
        <span class="name">Lower</span>
        <span class="val">${data.bb_lower ? fmt.price(data.bb_lower) : '--'}</span>
      </div>
    </div>
    <div class="ta-section">
      <h4>Key Levels</h4>
      <div class="ta-indicator">
        <span class="name">Support</span>
        <span class="val positive">${supportVal}</span>
      </div>
      <div class="ta-indicator">
        <span class="name">Resistance</span>
        <span class="val negative">${resistVal}</span>
      </div>
    </div>
    <div class="ta-section">
      <h4>Overall Signal</h4>
      <div class="ta-meter">
        <div class="ta-meter-fill" style="width:${((finalScore + 1) / 2) * 100}%;background:${signalClass === 'bullish' ? '#22c55e' : signalClass === 'bearish' ? '#ef4444' : '#eab308'}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <span style="font-size:11px;color:var(--red)">🐻 Bearish</span>
        <span style="font-size:13px;font-weight:700;color:${signalClass === 'bullish' ? '#22c55e' : signalClass === 'bearish' ? '#ef4444' : '#eab308'}">${signalText} (${(finalScore * 100).toFixed(0)}%)</span>
        <span style="font-size:11px;color:var(--green)">Bullish 🐂</span>
      </div>
    </div>
  `;
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function renderNews(articles) {
  const feed = document.getElementById('newsFeed');
  document.getElementById('newsCount').textContent = articles.length + ' articles';

  // Filter: Bitcoin-first. Deprioritize shitcoin-focused articles.
  const shitcoinRegex = /\b(XRP|ripple|solana|SOL|cardano|ADA|dogecoin|DOGE|shiba|SHIB|avalanche|AVAX|polkadot|DOT|chainlink|LINK|tron|TRX|meme.?coin|altcoin season)\b/i;
  const btcRegex = /bitcoin|btc|halving|saylor|strategy|mining|lightning|layer.?2|taproot|ordinal|satoshi|blockstream|bisq|mempool|hashrate/i;
  const macroRegex = /fed|interest rate|inflation|treasury|regulation|sec |etf|wall street|macro|dollar|tariff/i;

  const btcNews = articles.filter(a => {
    const text = a.title + ' ' + a.body + ' ' + a.categories;
    // Must be BTC or macro related, NOT primarily about a shitcoin
    const isBtc = btcRegex.test(text) || macroRegex.test(text);
    const isShitcoin = shitcoinRegex.test(a.title); // only check title — body might mention them in passing
    return isBtc && !isShitcoin;
  });
  const otherNews = articles.filter(a => {
    if (btcNews.includes(a)) return false;
    const isShitcoin = shitcoinRegex.test(a.title);
    return !isShitcoin; // allow macro/general, just not shitcoin headlines
  });
  const sorted = [...btcNews, ...otherNews];

  // Detect repeated/default images and hide them
  const imageCounts = {};
  sorted.forEach(a => { imageCounts[a.image] = (imageCounts[a.image] || 0) + 1; });

  // Show top 3 with images, rest as compact list
  var top3 = sorted.slice(0, 3);
  var rest = sorted.slice(3, 15);

  var topHtml = top3.map(function(a) {
    var isBtc = btcNews.includes(a);
    var isDefaultImg = (imageCounts[a.image] || 0) > 1 || /\/default\.|resources\.cryptocompare/.test(a.image);
    var imgHtml = isDefaultImg
      ? '<div class="news-image-fallback">₿</div>'
      : '<img class="news-image" src="' + a.image + '" alt="" onerror="this.outerHTML=\'<div class=news-image-fallback>₿</div>\'">';
    var tags = (a.categories || '').split('|').filter(function(t) { return t && t !== 'N/A'; }).slice(0, 3);

    return '<div class="news-item' + (isBtc ? ' btc-news' : '') + '">' +
      '<a href="' + a.url + '" target="_blank" rel="noopener">' +
        imgHtml +
        '<div class="news-content">' +
          '<div class="news-meta">' +
            '<span class="news-source">' + a.source + '</span>' +
            '<span class="news-time">' + timeAgo(a.published) + '</span>' +
          '</div>' +
          '<div class="news-title">' + a.title + '</div>' +
          '<div class="news-body">' + a.body + '</div>' +
          (tags.length ? '<div class="news-tags">' + tags.map(function(t) { return '<span class="news-tag">' + t + '</span>'; }).join('') + '</div>' : '') +
        '</div>' +
      '</a>' +
    '</div>';
  }).join('');

  var listHtml = rest.length ? '<div class="news-list">' + rest.map(function(a) {
    var isBtc = btcNews.includes(a);
    return '<a href="' + a.url + '" target="_blank" rel="noopener" class="news-list-item' + (isBtc ? ' btc-news' : '') + '">' +
      '<span class="news-list-time">' + timeAgo(a.published) + '</span>' +
      '<span class="news-list-title">' + a.title + '</span>' +
      '<span class="news-list-source">' + a.source + '</span>' +
    '</a>';
  }).join('') + '</div>' : '';

  feed.innerHTML = '<div class="news-top-grid">' + topHtml + '</div>' + listHtml;
}

// ===== MINING & DIFFICULTY =====

let hashrateChart = null;

function renderMining(data) {
  const adj = data.adjustment;
  const diffContent = document.getElementById('diffContent');
  const diffBadge = document.getElementById('diffBadge');

  // Badge
  const change = adj.difficultyChange;
  const isUp = change >= 0;
  diffBadge.textContent = (isUp ? '+' : '') + change.toFixed(1) + '%';
  diffBadge.className = 'badge ' + (isUp ? 'negative' : 'bullish'); // harder = bullish for miners' commitment

  // Progress gauge (SVG donut)
  const progress = adj.progressPercent;
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (progress / 100) * circumference;
  const gaugeColor = isUp ? '#f7931a' : '#22c55e';

  // Estimated retarget date
  const retargetDate = new Date(adj.estimatedRetargetDate);
  const retargetStr = retargetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Remaining time
  const remainDays = Math.floor(adj.remainingTime / 86400000);
  const remainHrs = Math.floor((adj.remainingTime % 86400000) / 3600000);

  // Avg block time (mempool returns milliseconds)
  const avgBlock = (adj.timeAvg / 1000 / 60).toFixed(1);

  diffContent.innerHTML =
    '<div class="diff-hero">' +
      '<div class="diff-gauge">' +
        '<svg viewBox="0 0 100 100">' +
          '<circle class="diff-gauge-bg" cx="50" cy="50" r="40"></circle>' +
          '<circle class="diff-gauge-fill" cx="50" cy="50" r="40" ' +
            'stroke="' + gaugeColor + '" ' +
            'stroke-dasharray="' + circumference + '" ' +
            'stroke-dashoffset="' + offset + '"></circle>' +
        '</svg>' +
        '<div class="diff-gauge-text">' + progress.toFixed(1) + '%</div>' +
      '</div>' +
      '<div class="diff-info">' +
        '<div class="diff-projected" style="color:' + (isUp ? '#f7931a' : '#22c55e') + '">' +
          (isUp ? '↑ ' : '↓ ') + Math.abs(change).toFixed(2) + '% projected' +
        '</div>' +
        '<div class="diff-est-date">Est. ' + retargetStr + '</div>' +
        '<div class="diff-remaining">' + adj.remainingBlocks.toLocaleString() + ' blocks · ~' + remainDays + 'd ' + remainHrs + 'h remaining</div>' +
      '</div>' +
    '</div>' +
    [
      { label: 'Next Retarget Height', val: adj.nextRetargetHeight.toLocaleString() },
      { label: 'Avg Block Time', val: avgBlock + ' min' + (avgBlock < 10 ? ' ⚡' : '') },
      { label: 'Previous Adjustment', val: (adj.previousRetarget >= 0 ? '+' : '') + adj.previousRetarget.toFixed(2) + '%' },
      { label: 'Current Hashrate', val: data.hashrate ? data.hashrate.toFixed(1) + ' EH/s' : '--' },
      { label: 'Current Difficulty', val: data.difficulty ? data.difficulty.toFixed(2) + ' T' : '--' },
      { label: 'Block Height', val: data.blockHeight ? data.blockHeight.toLocaleString() : '--' },
    ].map(function(r) {
      return '<div class="diff-row">' +
        '<span class="diff-label">' + r.label + '</span>' +
        '<span class="diff-val">' + r.val + '</span>' +
      '</div>';
    }).join('');

  // Hashrate chart
  if (data.hashSparkline && data.hashSparkline.length) {
    renderHashrateChart(data.hashSparkline, data.hashrate);
  }

  // Hashrate stats
  if (data.hashSparkline && data.hashSparkline.length > 1) {
    const sparkArr = data.hashSparkline;
    const oldest = sparkArr[0].v;
    const newest = sparkArr[sparkArr.length - 1].v;
    const change3m = ((newest - oldest) / oldest * 100).toFixed(1);
    const max = Math.max(...sparkArr.map(s => s.v));
    const min = Math.min(...sparkArr.map(s => s.v));

    document.getElementById('hashrateStats').innerHTML =
      '<div class="hashrate-stat"><div class="label">Current</div><div class="value">' + newest.toFixed(1) + ' EH/s</div></div>' +
      '<div class="hashrate-stat"><div class="label">3M Change</div><div class="value ' + (change3m >= 0 ? 'positive' : 'negative') + '">' + (change3m >= 0 ? '+' : '') + change3m + '%</div></div>' +
      '<div class="hashrate-stat"><div class="label">3M Range</div><div class="value">' + min.toFixed(0) + ' – ' + max.toFixed(0) + '</div></div>';
  }
}

function renderHashrateChart(sparkline, currentRate) {
  const ctx = document.getElementById('hashrateChart').getContext('2d');
  const labels = sparkline.map(s => new Date(s.t));
  const values = sparkline.map(s => s.v);

  if (hashrateChart) hashrateChart.destroy();

  hashrateChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#f7931a',
        borderWidth: 2,
        backgroundColor: createGradient(ctx, '#f7931a', 200),
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHitRadius: 10,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          grid: { display: false },
          ticks: { maxTicksLimit: 6, font: { size: 10 } }
        },
        y: {
          grid: { color: '#25253020' },
          ticks: {
            callback: function(v) { return v.toFixed(0) + ' EH/s'; },
            font: { size: 10, family: "'JetBrains Mono', monospace" }
          }
        }
      },
      plugins: {
        tooltip: {
          backgroundColor: '#16161f',
          borderColor: '#252530',
          borderWidth: 1,
          callbacks: {
            label: function(ctx) { return ctx.parsed.y.toFixed(1) + ' EH/s'; }
          }
        }
      }
    }
  });
}

// ===== X POSTS =====

function renderXPosts(posts) {
  if (!posts.length) return;
  const section = document.getElementById('xPostsSection');
  const feed = document.getElementById('xPostsFeed');
  section.style.display = 'block';

  feed.innerHTML = posts.slice(0, 6).map(function(p) {
    return '<div class="x-post">' +
      '<a href="' + p.url + '" target="_blank" rel="noopener">' +
        '<div class="x-post-source">' + p.source + '</div>' +
        '<div class="x-post-title">' + p.title + '</div>' +
        '<div class="x-post-desc">' + (p.description || '') + '</div>' +
        (p.published ? '<div class="x-post-time">' + p.published + '</div>' : '') +
      '</a>' +
    '</div>';
  }).join('');
}

// ===== BTC / GOLD RATIO =====

var btcGoldChart = null;
var cachedGoldPrice = null;

function renderBtcGold(btc) {
  // Need gold price from macro data
  if (!cachedGoldPrice || !btc) return;
  var ratio = btc.current_price / cachedGoldPrice;
  document.getElementById('btcGoldValue').textContent = ratio.toFixed(1) + ' oz';

  var badge = document.getElementById('btcGoldBadge');
  badge.textContent = ratio.toFixed(1) + ' oz/BTC';
  badge.className = 'badge bullish';
}

function loadGoldChart(range, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    btn.classList.add('active');
  }
  fetchMacro(range).catch(function(e) { console.error('gold chart reload failed:', e); });
}

function renderBtcGoldChart(goldSparkline) {
  if (!goldSparkline || goldSparkline.length < 2 || !btcPriceGlobal) return;
  // We can only show the gold sparkline since we don't have synced BTC data
  // Instead, just show gold price trend
  var el = document.getElementById('btcGoldChart');
  if (!el) return;
  var ctx = el.getContext('2d');

  if (btcGoldChart) btcGoldChart.destroy();

  var vals = goldSparkline;
  btcGoldChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: vals.map(function(_, i) { return i; }),
      datasets: [{
        label: 'Gold Price (30d)',
        data: vals,
        borderColor: '#FFD700',
        borderWidth: 2,
        backgroundColor: 'rgba(255, 215, 0, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { display: false }, y: { display: false } },
      plugins: {
        tooltip: {
          callbacks: { label: function(ctx) { return '$' + ctx.parsed.y.toFixed(0); } }
        }
      }
    }
  });
}

// ===== HALVING CYCLE =====

function renderCycle() {
  var container = document.getElementById('cycleContent');

  // Halving dates (block heights)
  var halvings = [
    { date: new Date('2012-11-28'), block: 210000, reward: 25 },
    { date: new Date('2016-07-09'), block: 420000, reward: 12.5 },
    { date: new Date('2020-05-11'), block: 630000, reward: 6.25 },
    { date: new Date('2024-04-20'), block: 840000, reward: 3.125 },
  ];
  var nextHalving = { date: new Date('2028-04-01'), block: 1050000, reward: 1.5625 }; // estimated

  var lastHalving = halvings[halvings.length - 1];
  var now = new Date();

  // Days since last halving
  var daysSinceLast = Math.floor((now - lastHalving.date) / 86400000);

  // Estimated days until next
  var daysUntilNext = Math.floor((nextHalving.date - now) / 86400000);

  // Total cycle length (approx 4 years = 1461 days)
  var cycleLength = Math.floor((nextHalving.date - lastHalving.date) / 86400000);
  var cyclePct = Math.min(100, (daysSinceLast / cycleLength * 100)).toFixed(1);

  // Determine phase
  var phase, phaseClass;
  var pctNum = parseFloat(cyclePct);
  if (pctNum < 25) { phase = 'Accumulation'; phaseClass = 'accumulation'; }
  else if (pctNum < 55) { phase = 'Expansion'; phaseClass = 'expansion'; }
  else if (pctNum < 75) { phase = 'Distribution'; phaseClass = 'distribution'; }
  else { phase = 'Markdown'; phaseClass = 'markdown'; }

  // Gradient for cycle bar
  var gradient = 'linear-gradient(90deg, #22c55e 0%, #f7931a 40%, #ef4444 70%, #a855f7 100%)';

  container.innerHTML =
    '<div class="cycle-progress-wrapper">' +
      '<div class="cycle-bar-outer">' +
        '<div class="cycle-bar-fill" style="width:' + cyclePct + '%;background:' + gradient + '"></div>' +
      '</div>' +
      '<div class="cycle-bar-labels">' +
        '<span>Halving #4</span>' +
        '<span>' + cyclePct + '%</span>' +
        '<span>Halving #5</span>' +
      '</div>' +
    '</div>' +
    '<div class="cycle-stats">' +
      '<div class="cycle-row"><span class="cycle-label">Current Phase</span><span class="cycle-val"><span class="cycle-phase ' + phaseClass + '">' + phase + '</span></span></div>' +
      '<div class="cycle-row"><span class="cycle-label">Days Since Halving</span><span class="cycle-val">' + daysSinceLast.toLocaleString() + '</span></div>' +
      '<div class="cycle-row"><span class="cycle-label">Days Until Next</span><span class="cycle-val">' + daysUntilNext.toLocaleString() + '</span></div>' +
      '<div class="cycle-row"><span class="cycle-label">Current Reward</span><span class="cycle-val">3.125 BTC</span></div>' +
      '<div class="cycle-row"><span class="cycle-label">Next Reward</span><span class="cycle-val">1.5625 BTC</span></div>' +
      '<div class="cycle-row"><span class="cycle-label">Cycle #</span><span class="cycle-val">5 of ∞</span></div>' +
    '</div>';
}

// ===== LIGHTNING NETWORK =====

var lnCapChart = null;

function renderLightning(data) {
  var container = document.getElementById('lightningContent');

  container.innerHTML =
    '<div class="ln-hero">' +
      '<div class="ln-stat-big"><div class="label">Capacity</div><div class="value">' +
        (data.capacityBtc ? data.capacityBtc.toLocaleString(undefined, {maximumFractionDigits: 0}) + ' BTC' : '--') + '</div></div>' +
      '<div class="ln-stat-big"><div class="label">Channels</div><div class="value">' +
        (data.channels ? data.channels.toLocaleString() : '--') + '</div></div>' +
      '<div class="ln-stat-big"><div class="label">Nodes</div><div class="value">' +
        (data.nodes ? data.nodes.toLocaleString() : '--') + '</div></div>' +
    '</div>' +
    [
      { label: 'Tor Nodes', val: data.torNodes ? data.torNodes.toLocaleString() : '--' },
      { label: 'Clearnet Nodes', val: data.clearnetNodes ? data.clearnetNodes.toLocaleString() : '--' },
      { label: 'Avg Channel Size', val: data.avgCapacity ? (data.avgCapacity * 1e8).toLocaleString(undefined, {maximumFractionDigits: 0}) + ' sats' : '--' },
      { label: 'Median Fee Rate', val: data.medFeeRate ? data.medFeeRate + ' ppm' : '--' },
    ].map(function(r) {
      return '<div class="ln-row"><span class="ln-label">' + r.label + '</span><span class="ln-val">' + r.val + '</span></div>';
    }).join('');

  // Capacity history chart
  if (data.capacityHistory && data.capacityHistory.length > 1) {
    var el = document.getElementById('lnCapChart');
    if (!el) return;
    var ctx = el.getContext('2d');
    if (lnCapChart) lnCapChart.destroy();

    var labels = data.capacityHistory.map(function(h) { return new Date(h.t); });
    var values = data.capacityHistory.map(function(h) { return h.cap; });

    lnCapChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: '#f7931a',
          borderWidth: 2,
          backgroundColor: createGradient(ctx, '#f7931a', 120),
          fill: true,
          tension: 0.4,
          pointRadius: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { type: 'time', grid: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 10 } } },
          y: {
            grid: { color: '#25253020' },
            ticks: {
              callback: function(v) { return v.toFixed(0) + ' BTC'; },
              font: { size: 10, family: "'JetBrains Mono', monospace" }
            }
          }
        },
        plugins: {
          tooltip: {
            callbacks: { label: function(ctx) { return ctx.parsed.y.toFixed(0) + ' BTC capacity'; } }
          }
        }
      }
    });
  }
}

// ===== MACRO =====

var macroSparkCharts = [];

function renderMacro(data) {
  var grid = document.getElementById('macroGrid');

  // Destroy old spark charts
  macroSparkCharts.forEach(function(c) { c.destroy(); });
  macroSparkCharts = [];

  var tiles = [];

  // DXY
  if (data.dxy) {
    var d = data.dxy;
    var sentiment = d.changePct < 0 ? 'bullish-btc' : 'bearish-btc';
    var context = d.changePct < 0 ? 'Weakening dollar = bullish for BTC' : 'Strengthening dollar = headwind for BTC';
    tiles.push({ key: 'dxy', name: 'DXY (Dollar Index)', value: d.price.toFixed(2), change: d.changePct, spark: d.sparkline, cls: sentiment, context: context });
  }

  // M2
  if (data.m2) {
    var m = data.m2;
    var m2Sent = parseFloat(m.yoyChange) > 4 ? 'bullish-btc' : parseFloat(m.yoyChange) > 0 ? 'neutral-btc' : 'bearish-btc';
    var m2Ctx = 'YoY: ' + (m.yoyChange > 0 ? '+' : '') + m.yoyChange + '% · Expanding M2 = BTC fuel';
    tiles.push({ key: 'm2', name: 'M2 Money Supply', value: '$' + (m.value / 1000).toFixed(1) + 'T', change: parseFloat(m.momChange), spark: m.sparkline, cls: m2Sent, context: m2Ctx, isMonthly: true });
  }

  // Fed Rate
  if (data.fedRate) {
    var f = data.fedRate;
    var fedChg = f.prevValue ? f.value - f.prevValue : 0;
    var fedSent = fedChg < 0 ? 'bullish-btc' : fedChg > 0 ? 'bearish-btc' : 'neutral-btc';
    var fedCtx = fedChg < 0 ? 'Rates falling = liquidity expanding' : fedChg > 0 ? 'Rates rising = tightening' : 'Rates unchanged';
    tiles.push({ key: 'fed', name: 'Fed Funds Rate', value: f.value.toFixed(2) + '%', change: fedChg, spark: f.sparkline, cls: fedSent, context: fedCtx, isMonthly: true });
  }

  // Gold
  if (data.gold) {
    var g = data.gold;
    cachedGoldPrice = g.price;
    tiles.push({ key: 'gold', name: 'Gold', value: '$' + g.price.toLocaleString(undefined, {maximumFractionDigits:0}), change: g.changePct, spark: g.sparkline, cls: 'neutral-btc', context: 'Digital gold vs physical gold' });
    // Update BTC/Gold ratio
    if (btcPriceGlobal) {
      var ratio = btcPriceGlobal / g.price;
      document.getElementById('btcGoldValue').textContent = ratio.toFixed(1) + ' oz';
      var badge = document.getElementById('btcGoldBadge');
      badge.textContent = ratio.toFixed(1) + ' oz/BTC';
      badge.className = 'badge bullish';
    }
    renderBtcGoldChart(g.sparkline);
  }

  // Silver
  if (data.silver) {
    var sv = data.silver;
    tiles.push({ key: 'silver', name: 'Silver', value: '$' + sv.price.toFixed(2), change: sv.changePct, spark: sv.sparkline, cls: 'neutral-btc', context: 'Precious metals bellwether' });
  }

  // SPX
  if (data.spx) {
    var s = data.spx;
    var spxSent = s.changePct > 0 ? 'neutral-btc' : 'bearish-btc';
    tiles.push({ key: 'spx', name: 'S&P 500', value: s.price.toLocaleString(undefined, {maximumFractionDigits:0}), change: s.changePct, spark: s.sparkline, cls: spxSent, context: 'Risk appetite gauge' });
  }

  // DJIA
  if (data.djia) {
    var dj = data.djia;
    var djSent = dj.changePct > 0 ? 'neutral-btc' : 'bearish-btc';
    tiles.push({ key: 'djia', name: 'Dow Jones', value: dj.price.toLocaleString(undefined, {maximumFractionDigits:0}), change: dj.changePct, spark: dj.sparkline, cls: djSent, context: 'Traditional market health' });
  }

  // 10Y
  if (data.yield10y) {
    var y = data.yield10y;
    var ySent = y.changePct < 0 ? 'bullish-btc' : 'bearish-btc';
    tiles.push({ key: 'yield', name: '10Y Treasury', value: y.price.toFixed(3) + '%', change: y.changePct, spark: y.sparkline, cls: ySent, context: y.changePct < 0 ? 'Yields falling = bullish risk' : 'Yields rising = tightening' });
  }

  // VIX
  if (data.vix) {
    var v = data.vix;
    var vSent = v.price > 25 ? 'bearish-btc' : v.price < 15 ? 'bullish-btc' : 'neutral-btc';
    var vCtx = v.price > 25 ? 'High fear — risk-off mode' : v.price < 15 ? 'Low vol — complacency' : 'Normal volatility';
    tiles.push({ key: 'vix', name: 'VIX (Fear)', value: v.price.toFixed(2), change: v.changePct, spark: v.sparkline, cls: vSent, context: vCtx });
  }

  // Oil
  if (data.oil) {
    var o = data.oil;
    tiles.push({ key: 'oil', name: 'Crude Oil (WTI)', value: '$' + o.price.toFixed(2), change: o.changePct, spark: o.sparkline, cls: 'neutral-btc', context: 'Energy cost / inflation signal' });
  }

  grid.innerHTML = tiles.map(function(t, i) {
    var chgClass = t.change > 0 ? 'positive' : t.change < 0 ? 'negative' : '';
    var chgStr = t.change != null ? ((t.change >= 0 ? '+' : '') + t.change.toFixed(2) + '%') : '';
    return '<div class="macro-tile ' + t.cls + '">' +
      '<div class="macro-tile-header">' +
        '<span class="macro-tile-name">' + t.name + '</span>' +
        '<span class="macro-tile-change ' + chgClass + '">' + chgStr + '</span>' +
      '</div>' +
      '<div class="macro-tile-value">' + t.value + '</div>' +
      '<div class="macro-tile-spark"><canvas id="macroSpark' + i + '" height="40"></canvas></div>' +
      '<div class="macro-tile-context">' + t.context + '</div>' +
    '</div>';
  }).join('');

  // Render sparklines
  tiles.forEach(function(t, i) {
    var el = document.getElementById('macroSpark' + i);
    if (el && t.spark && t.spark.length > 1) {
      var vals = t.spark;
      var isUp = vals[vals.length - 1] >= vals[0];
      var chart = new Chart(el.getContext('2d'), {
        type: 'line',
        data: {
          labels: vals.map(function(_, j) { return j; }),
          datasets: [{
            data: vals,
            borderColor: isUp ? '#22c55e' : '#ef4444',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          scales: { x: { display: false }, y: { display: false } },
          plugins: { tooltip: { enabled: false } }
        }
      });
      macroSparkCharts.push(chart);
    }
  });
}

// ===== SETTINGS / SECTION TOGGLES =====

function getHiddenSections() {
  try { return JSON.parse(localStorage.getItem('btcintel_hidden') || '[]'); }
  catch (e) { return []; }
}

function saveHiddenSections(arr) {
  localStorage.setItem('btcintel_hidden', JSON.stringify(arr));
}

function applySectionVisibility() {
  var hidden = getHiddenSections();
  document.querySelectorAll('.section-panel').forEach(function(el) {
    var section = el.getAttribute('data-section');
    if (hidden.indexOf(section) !== -1) {
      el.classList.add('section-hidden');
    } else {
      el.classList.remove('section-hidden');
    }
  });
  // Sync checkboxes
  document.querySelectorAll('#settingsDropdown input[type="checkbox"]').forEach(function(cb) {
    cb.checked = hidden.indexOf(cb.getAttribute('data-section')) === -1;
  });
}

function toggleSection(cb) {
  var section = cb.getAttribute('data-section');
  var hidden = getHiddenSections();
  var idx = hidden.indexOf(section);
  if (cb.checked && idx !== -1) {
    hidden.splice(idx, 1);
  } else if (!cb.checked && idx === -1) {
    hidden.push(section);
  }
  saveHiddenSections(hidden);
  applySectionVisibility();
}

function toggleSettings() {
  var dd = document.getElementById('settingsDropdown');
  var btn = document.getElementById('settingsBtn');
  dd.classList.toggle('open');
  btn.classList.toggle('active');
}

function resetSections() {
  saveHiddenSections([]);
  applySectionVisibility();
}

// Close settings when clicking outside
document.addEventListener('click', function(e) {
  var dd = document.getElementById('settingsDropdown');
  var btn = document.getElementById('settingsBtn');
  if (dd.classList.contains('open') && !dd.contains(e.target) && e.target !== btn) {
    dd.classList.remove('open');
    btn.classList.remove('active');
  }
});

// Apply saved visibility on load
applySectionVisibility();

// ===== NAVIGATION =====

function scrollToSection(name) {
  var el = document.querySelector('[data-section="' + name + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return false;
}

// ===== CURRENCY =====

async function changeCurrency(currency) {
  currentCurrency = currency;
  localStorage.setItem('btcintel_currency', currency);

  // Fetch exchange rate for macro conversion
  if (currency !== 'usd') {
    try {
      var res = await fetch('/api/exchange-rate?vs=' + currency);
      var data = await res.json();
      exchangeRate = data.rate || 1;
    } catch (e) { exchangeRate = 1; }
  } else {
    exchangeRate = 1;
  }

  // Reload all data with new currency
  refreshAll();
}

// Restore saved currency on load
(function() {
  var saved = localStorage.getItem('btcintel_currency');
  if (saved) {
    currentCurrency = saved;
    var sel = document.getElementById('currencySelect');
    if (sel) sel.value = saved;
    // Fetch exchange rate
    if (saved !== 'usd') {
      fetch('/api/exchange-rate?vs=' + saved)
        .then(function(r) { return r.json(); })
        .then(function(d) { exchangeRate = d.rate || 1; })
        .catch(function() {});
    }
  }
})();

// ===== INIT =====

function updateTimestamp() {
  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

async function refreshAll() {
  updateTimestamp();

  const tasks = [
    fetchPrices().catch(e => console.error('prices failed:', e)),
    fetchFearGreed().catch(e => console.error('fng failed:', e)),
    fetchGlobal().catch(e => console.error('global failed:', e)),
    (lastChartRange.type === 'long'
      ? loadChartLong(lastChartRange.value).catch(function(e) { console.error('chart failed:', e); })
      : loadChart('bitcoin', lastChartRange.value).catch(function(e) { console.error('chart failed:', e); })
    ),
    fetchNews().catch(e => console.error('news failed:', e)),
    fetchMining().catch(e => console.error('mining failed:', e)),
    fetchMacro().catch(e => console.error('macro failed:', e)),
    fetchLightning().catch(e => console.error('lightning failed:', e)),
  ];

  await Promise.allSettled(tasks);

  // Render cycle (local calculation, no API)
  renderCycle();

  // TA and X posts after main data (rate-limited sources)
  setTimeout(() => {
    fetchTA().catch(e => console.error('ta failed:', e));
    fetchXPosts().catch(e => console.error('x-posts failed:', e));
  }, 2000);

  updateTimestamp();
}

// Initial load
refreshAll();

// Auto-refresh every 2 minutes
setInterval(refreshAll, 120000);
