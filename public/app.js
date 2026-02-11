// Bitcoin Intelligence Dashboard
// There is no second best.

let btcChart = null;
let fngChart = null;
let btcPriceGlobal = 0;

// Formatters
const fmt = {
  price(n) {
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '$' + n.toFixed(6);
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
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    return '$' + (n / 1e6).toFixed(0) + 'M';
  },
  vol(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    return '$' + (n / 1e6).toFixed(0) + 'M';
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

// ===== FETCH FUNCTIONS =====

async function fetchPrices() {
  const res = await fetch('/api/prices');
  const data = await res.json();
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
  const res = await fetch('/api/fear-greed');
  const data = await res.json();
  if (data.data) renderFearGreed(data.data);
}

async function fetchGlobal() {
  const res = await fetch('/api/global');
  const json = await res.json();
  if (json.data) renderGlobal(json.data);
}

async function fetchTA() {
  const res = await fetch('/api/ta/bitcoin');
  const data = await res.json();
  if (data.rsi != null) renderTA(data);
}

async function fetchNews() {
  const res = await fetch('/api/news');
  const data = await res.json();
  if (Array.isArray(data) && data.length) renderNews(data);
}

async function fetchMining() {
  const res = await fetch('/api/mining');
  const data = await res.json();
  if (data.adjustment) renderMining(data);
}

async function fetchXPosts() {
  const res = await fetch('/api/x-posts');
  const data = await res.json();
  if (Array.isArray(data) && data.length) renderXPosts(data);
}

async function loadChart(coin, days, btn) {
  if (btn) {
    document.querySelectorAll('.chart-tabs .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }
  const res = await fetch('/api/chart/' + coin + '/' + days);
  const data = await res.json();
  if (data.prices) renderBTCChart(data.prices, days);
}

// ===== RENDER FUNCTIONS =====

function renderBTCHero(btc) {
  document.getElementById('btcLogo').src = btc.image;
  document.getElementById('btcPrice').textContent = fmt.price(btc.current_price);
  fmt.change(document.getElementById('btcChange'), btc.price_change_percentage_24h);

  // Dynamic page title with price
  document.title = fmt.price(btc.current_price) + ' — Bitcoin Intelligence Dashboard';

  // Sats per dollar
  const satsPerDollar = Math.round(100000000 / btc.current_price);
  const satsEl = document.getElementById('satsPerDollar');
  if (satsEl) satsEl.textContent = satsPerDollar.toLocaleString();

  const stats = document.getElementById('btcStats');
  stats.innerHTML = [
    { label: '24h High', value: fmt.price(btc.high_24h) },
    { label: '24h Low', value: fmt.price(btc.low_24h) },
    { label: 'ATH', value: fmt.price(btc.ath) },
    { label: 'From ATH', value: fmt.pct(btc.ath_change_percentage) },
  ].map(i => `
    <div class="btc-stat-item">
      <div class="label">${i.label}</div>
      <div class="value">${i.value}</div>
    </div>
  `).join('');
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
            callback: v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v),
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
  document.getElementById('totalMcap').textContent = fmt.mcap(data.total_market_cap?.usd || 0);
  const mcapPct = data.market_cap_change_percentage_24h_usd || 0;
  const mcapEl = document.getElementById('mcapChange');
  mcapEl.textContent = fmt.pct(mcapPct);
  mcapEl.className = 'stat-change ' + (mcapPct >= 0 ? 'positive' : 'negative');
  document.getElementById('totalVol').textContent = fmt.vol(data.total_volume?.usd || 0);
  document.getElementById('btcDom').textContent = (data.market_cap_percentage?.btc || 0).toFixed(1) + '%';

  // 24h market cap delta
  const mcap24h = data.market_cap_change_percentage_24h_usd || 0;
  const deltaEl = document.getElementById('mcap24hDelta');
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
      '<td class="mcap-cell">' + fmt.mcap(c.market_cap) + '</td>' +
      '<td class="sparkline-cell"><canvas id="' + sparkId + '" width="120" height="40"></canvas></td>' +
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

  feed.innerHTML = sorted.slice(0, 9).map(a => {
    const tags = (a.categories || '').split('|').filter(t => t && t !== 'N/A').slice(0, 3);
    const isBtc = btcNews.includes(a);
    // Hide default/repeated logos — only show unique editorial images
    const isDefaultImg = (imageCounts[a.image] || 0) > 1 || /\/default\.|resources\.cryptocompare/.test(a.image);
    const imgHtml = isDefaultImg
      ? '<div class="news-image-fallback">₿</div>'
      : '<img class="news-image" src="' + a.image + '" alt="" onerror="this.outerHTML=\'<div class=news-image-fallback>₿</div>\'">';

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
    loadChart('bitcoin', 1).catch(e => console.error('chart failed:', e)),
    fetchNews().catch(e => console.error('news failed:', e)),
    fetchMining().catch(e => console.error('mining failed:', e)),
  ];

  await Promise.allSettled(tasks);

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
