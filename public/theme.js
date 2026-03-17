// Theme toggle + options (persisted)
// Works on all pages; safe for iOS Safari.

(function () {
  var STORAGE_KEY = 'da_theme';
  // Order matters: dropdown will follow insertion order.
  var THEMES = {
    bitcoin: {
      name: 'Bitcoin (Original)',
      vars: {
        '--accent': '#f7931a',
        '--accent-dim': 'rgba(247, 147, 26, 0.15)',
        '--accent-glow': 'rgba(247, 147, 26, 0.08)',
        '--bg-primary': '#0a0a0f',
        '--bg-secondary': '#111118',
        '--bg-card': '#16161f',
        '--bg-card-hover': '#1c1c28',
        '--border': '#252530',
        '--border-light': '#35354a',
        '--text-primary': '#e8e8f0',
        '--text-secondary': '#94a3b8',
        '--text-muted': '#64748b'
      }
    },
    midnight: {
      name: 'Midnight Lightning',
      vars: {
        '--accent': '#4da3ff',
        '--accent-dim': 'rgba(77, 163, 255, 0.16)',
        '--accent-glow': 'rgba(77, 163, 255, 0.10)',
        '--bg-primary': '#070a12',
        '--bg-secondary': '#0b1020',
        '--bg-card': '#0f1730',
        '--bg-card-hover': '#132045',
        '--border': '#1b2a4d',
        '--border-light': '#243763',
        '--text-primary': '#eaf0ff',
        '--text-secondary': '#b1c0e8',
        '--text-muted': '#7f93c8'
      }
    },
    purple: {
      name: 'Purple (Synth)',
      vars: {
        '--accent': '#a855f7',
        '--accent-dim': 'rgba(168, 85, 247, 0.16)',
        '--accent-glow': 'rgba(168, 85, 247, 0.10)',
        '--bg-primary': '#070712',
        '--bg-secondary': '#0d0a1e',
        '--bg-card': '#14102a',
        '--bg-card-hover': '#1b1538',
        '--border': '#2a1f4a',
        '--border-light': '#3b2b66',
        '--text-primary': '#f2eeff',
        '--text-secondary': '#c8b7ff',
        '--text-muted': '#9a86d6'
      }
    },
    green: {
      name: 'Green (Terminal)',
      vars: {
        '--accent': '#22c55e',
        '--accent-dim': 'rgba(34, 197, 94, 0.14)',
        '--accent-glow': 'rgba(34, 197, 94, 0.08)',
        '--bg-primary': '#070c0a',
        '--bg-secondary': '#0b1510',
        '--bg-card': '#0e1f16',
        '--bg-card-hover': '#112a1d',
        '--border': '#1d3a2a',
        '--border-light': '#2a533c',
        '--text-primary': '#eafff2',
        '--text-secondary': '#b7f2cf',
        '--text-muted': '#78c59f'
      }
    },
    shitcoin: {
      name: 'Shitcoin (Rainbow)',
      vars: {
        '--accent': '#ff4dd2',
        '--accent-dim': 'rgba(255, 77, 210, 0.18)',
        '--accent-glow': 'rgba(255, 77, 210, 0.12)',
        '--bg-primary': '#08040a',
        '--bg-secondary': '#12081a',
        '--bg-card': '#160b22',
        '--bg-card-hover': '#1d0f2f',
        '--border': '#3a1a49',
        '--border-light': '#52245f',
        '--text-primary': '#fff1fb',
        '--text-secondary': '#ffd1f1',
        '--text-muted': '#f0a9dd'
      }
    }
  };

  function safeGetThemeId() {
    try {
      var id = localStorage.getItem(STORAGE_KEY);
      if (id && THEMES[id]) return id;
    } catch (e) {}
    // Default to the original Bitcoin theme
    return 'bitcoin';
  }

  function safeSetThemeId(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
  }

  function applyTheme(id) {
    var t = THEMES[id] || THEMES.bitcoin;
    var root = document.documentElement;
    var vars = t.vars || {};
    Object.keys(vars).forEach(function (k) {
      root.style.setProperty(k, vars[k]);
    });
    root.setAttribute('data-theme', id);
    safeSetThemeId(id);

    // Update theme-color meta for nicer mobile chrome
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', vars['--bg-secondary'] || '#000000');
    } catch (e) {}

    // Update any UI controls
    try {
      var sel = document.getElementById('themeSelect');
      if (sel && sel.value !== id) sel.value = id;
    } catch (e) {}
  }

  function injectThemeControl() {
    // Put a small dropdown in the header-right on every page (if header exists)
    var headerRight = document.querySelector('.header .header-right');
    if (!headerRight) return;

    // Avoid double-inject
    if (document.getElementById('themeSelect')) return;

    var wrap = document.createElement('div');
    wrap.className = 'theme-control';

    var label = document.createElement('span');
    label.className = 'theme-label';
    label.textContent = 'Theme';

    var select = document.createElement('select');
    select.id = 'themeSelect';
    select.className = 'theme-select';

    Object.keys(THEMES).forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = THEMES[id].name;
      select.appendChild(opt);
    });

    select.addEventListener('change', function (e) {
      applyTheme(e.target.value);
    });

    wrap.appendChild(label);
    wrap.appendChild(select);

    // Insert at start so dashboard controls (refresh/currency) stay on the right
    headerRight.insertBefore(wrap, headerRight.firstChild);
  }

  // Expose for debugging
  window.DA_THEMES = THEMES;
  window.setTheme = applyTheme;

  // Init
  document.addEventListener('DOMContentLoaded', function () {
    injectThemeControl();
    applyTheme(safeGetThemeId());
  });
})();
