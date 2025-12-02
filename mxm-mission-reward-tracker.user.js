// ==UserScript==
// @name         MxM Mission Reward Tracker (v6.8.0 Stable)
// @namespace    mxm-tools
// @version      6.8.0
// @description  Day/Week counters + Portfolio + Live FX + Cross-Tab Sync (No Notion)
// @author       Richard Mangezi Muketa
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  console.log('[MXM Tracker v6.8.0] FX + Sync + Stability Fixes');

  // --- CONFIG ---
  const WIDGET_ID = 'mxm-dashboard-widget';
  const HUMAN_SPEED_LIMIT = 1; // Max tasks possible in one check interval

  // Brand colors
  const COLOR_NAVY_DARK = '#0b1018';
  const COLOR_GOLD = '#d4af37';

  // RATES (static base, factors updated from FX API)
  const CURRENCIES = {
    USD: { symbol: '$',  factor: 1,     flag: '🇺🇸' },
    ZAR: { symbol: 'R',  factor: 17.11, flag: '🇿🇦' },
    EUR: { symbol: '€',  factor: 0.86,  flag: '🇪🇺' },
    NGN: { symbol: '₦',  factor: 1441,  flag: '🇳🇬' },
    KES: { symbol: 'KSh', factor: 129,  flag: '🇰🇪' }
  };

  const SETTINGS_KEY = 'mxmSettings_v6';
  const STATS_KEY = 'mxmStats_v7';

  // Drop corrupted stats from the previous version
  localStorage.removeItem('mxmStats_v6');

  const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';
  const FX_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 1 day
  const MUTATION_DEBOUNCE_MS = 250;

  // --- SMALL HELPERS ---
  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch (e) { return fallback; }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error('[MXM Tracker] localStorage error for', key, e);
    }
  }

  function updateTextIfChanged(idOrEl, value) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    const str = String(value);
    if (el.textContent !== str) el.textContent = str;
  }

  // --- DATE HELPERS ---
  function getIds() {
    const now = new Date();

    // Day ID (resets every midnight)
    const dayId = now.toLocaleDateString('en-CA');

    // Week logic (Monday → Sunday)
    const d = new Date(now);
    const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
    const mondayOffset = (day === 0 ? -6 : 1 - day); // Move to Monday
    const monday = new Date(d.setDate(d.getDate() + mondayOffset));
    const weekId = monday.toLocaleDateString('en-CA');

    return { dayId, weekId };
  }

  // --- STORAGE ---
  function loadStats() {
    const ids = getIds();
    let s = safeParse(localStorage.getItem(STATS_KEY), null);

    if (!s || !s.ids) {
      s = {
        ids,
        counts: { day: 0, week: 0 },
        money: { day: 0, week: 0 },
        portfolio: {}, // { missionId: { usd, tasks } }
        lastGlobalCount: null,
        lastMissionId: null,
        lastRate: 1.0
      };
    }

    // Number safety
    s.counts.day  = Number(s.counts.day)  || 0;
    s.counts.week = Number(s.counts.week) || 0;
    s.money.day   = Number(s.money.day)   || 0;
    s.money.week  = Number(s.money.week)  || 0;

    // Day/Week reset (portfolio never auto-reset)
    if (s.ids.dayId !== ids.dayId) {
      s.counts.day = 0;
      s.money.day = 0;
      s.ids.dayId = ids.dayId;
      s.lastGlobalCount = null; // force re-baseline
    }
    if (s.ids.weekId !== ids.weekId) {
      s.counts.week = 0;
      s.money.week = 0;
      s.ids.weekId = ids.weekId;
    }

    return s;
  }

  function saveStats(s) {
    safeSetItem(STATS_KEY, JSON.stringify(s));
  }

  function loadSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const base = { currency: 'USD' };
    if (!raw) return base;
    const parsed = safeParse(raw, {});
    return { ...base, ...parsed };
  }

  function saveSettings(s) {
    safeSetItem(SETTINGS_KEY, JSON.stringify(s));
  }

  // --- DOM PARSING ---
  function getCompletedTaskCount() {
    const patterns = [
      /(?:Completed|Concluído|Terminé|Completado)\s*[·•]\s*(\d+)/i,
      /(?:Completed|Concluído)\s+(\d+)(?!\s*h)/i
    ];
    const elements = document.querySelectorAll('div, span, p');
    for (const el of elements) {
      if (!el.offsetParent) continue;
      const text = el.textContent.trim();
      if (text.length > 60) continue;
      for (const p of patterns) {
        const m = text.match(p);
        if (m && m[1]) return parseInt(m[1], 10);
      }
    }
    return null;
  }

  function getMissionRewardRate() {
    const bodyText = document.body.innerText || '';
    let m = bodyText.match(/(?:Reward|Recompensa).*?(\d+(?:\.\d{1,2})?)\s*USD/i);
    if (m && m[1]) return parseFloat(m[1]);

    const el = document.querySelector('[class*="Reward"]');
    if (el) {
      m = el.textContent.match(/(\d+(?:\.\d{1,2})?)\s*USD/i);
      if (m && m[1]) return parseFloat(m[1]);
    }
    return 1.0;
  }

  function getCurrentMissionId() {
    const url = window.location.href;
    const m = url.match(/mission_id=([^&]+)/) || url.match(/\/(?:missions|tasks)\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : 'unknown';
  }

  // --- PORTFOLIO CALCULATOR ---
  function getPortfolioTotal(stats) {
    let totalUSD = 0;
    let totalTasks = 0;
    for (const val of Object.values(stats.portfolio)) {
      if (!val) continue;
      totalUSD += Number(val.usd) || 0;
      totalTasks += Number(val.tasks) || 0;
    }
    return { usd: totalUSD, tasks: totalTasks };
  }

  // --- WIDGET UI ---
  const FLAG_ISO = {
    USD: "us",
    ZAR: "za",
    EUR: "eu",
    NGN: "ng",
    KES: "ke"
  };

  let dragState = null;

  function createWidget() {
    let widget = document.getElementById(WIDGET_ID);
    if (widget) return widget;

    const div = document.createElement('div');
    div.id = WIDGET_ID;
    div.style.cssText = `
      position: fixed; top: 80px; right: 20px; width: 290px;
      background: linear-gradient(135deg, ${COLOR_NAVY_DARK}, #111827);
      color: #f9fafb; border-radius: 10px;
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      z-index: 999999;
      box-shadow: 0 18px 45px rgba(0,0,0,0.8);
      cursor: default; user-select: none; font-size: 13px;
    `;

    div.innerHTML = `
      <div style="padding:10px 12px; display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.7); border-top-left-radius:10px; border-top-right-radius:10px;">
        <span id="mxm-compact-day" 
              style="font-weight:800; font-size:10px; letter-spacing:1px; color:${COLOR_GOLD}; text-transform:uppercase;">
           0 Today
        </span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span id="mxm-top-cur" style="font-size:11px; opacity:0.85;">USD</span>
          <img id="mxm-cur-flag" 
               src="https://flagcdn.com/us.svg"
               style="cursor:pointer; width:22px; height:16px; border-radius:2px;" />
          <span id="mxm-toggle-view" 
                style="cursor:pointer; font-size:14px; opacity:0.8; padding-left:4px;">▣</span>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr 1.2fr; text-align:center; background:rgba(15,23,42,0.94); border-bottom:1px solid #111827;">
        <div style="padding:8px 4px; font-size:9px; color:#9ca3af; font-weight:700; border-right:1px solid #111827;">TODAY</div>
        <div style="padding:8px 4px; font-size:9px; color:#9ca3af; font-weight:700; border-right:1px solid #111827;">WEEK</div>
        <div style="padding:8px 4px; font-size:9px; color:${COLOR_GOLD}; font-weight:700; background:rgba(0,0,0,0.35);">PORTFOLIO</div>

        <div id="val-c-day" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; border-right:1px solid #111827;">0</div>
        <div id="val-c-week" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; border-right:1px solid #111827;">0</div>
        <div id="val-c-total" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; color:#f9fafb; background:rgba(0,0,0,0.35);">0</div>

        <div id="val-m-day" style="padding:2px 0 10px 0; font-size:13px; color:#22c55e; border-right:1px solid #111827;">$0</div>
        <div id="val-m-week" style="padding:2px 0 10px 0; font-size:13px; color:#22c55e; border-right:1px solid #111827;">$0</div>
        <div id="val-m-total" style="padding:2px 0 10px 0; font-size:14px; font-weight:bold; color:${COLOR_GOLD}; background:rgba(0,0,0,0.35);">$0</div>
      </div>

      <div style="padding:8px 12px 10px 12px; background:#020617; border-bottom-left-radius:10px; border-bottom-right-radius:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color:#9ca3af; font-weight:600; font-size:10px;">MISSION VALUE</span>
          <span id="mxm-page-total" style="color:#ffffff; font-weight:700; font-size:12px;">$0.00</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <span style="font-size:9px; color:#4a5568;">(Page Tasks × Rate)</span>
          <div style="display:flex; gap:6px;">
            <button id="mxm-download-stats" style="padding:2px 6px; font-size:9px; border-radius:4px; border:1px solid #4b5563; background:transparent; color:#e2e8f0; cursor:pointer;">Download</button>
            <button id="mxm-reset-portfolio" style="padding:2px 6px; font-size:9px; border-radius:4px; border:none; background:${COLOR_GOLD}; color:#000; font-weight:600; cursor:pointer;">Reset</button>
          </div>
        </div>
      </div>
    `;

    // Drag handling
    div.addEventListener('mousedown', e => {
      const target = e.target;
      if (
        target.id === 'mxm-cur-flag' ||
        target.id === 'mxm-download-stats' ||
        target.id === 'mxm-reset-portfolio'
      ) return;
      const rect = div.getBoundingClientRect();
      dragState = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });

    document.addEventListener('mouseup', () => { dragState = null; });
    document.addEventListener('mousemove', e => {
      if (dragState) {
        div.style.left = (e.clientX - dragState.x) + 'px';
        div.style.top = (e.clientY - dragState.y) + 'px';
      }
    });

    // --- COMPACT / FULL TOGGLE ---
    let compact = false;

    div.querySelector('#mxm-toggle-view').addEventListener('click', e => {
      compact = !compact;
      div.style.height = compact ? '60px' : 'auto';
      div.style.overflow = compact ? 'hidden' : 'visible';

      // Hide main grid and mission section in compact mode
      const grid = div.querySelector('div[style*="grid-template-columns"]');
      const footer = div.querySelector('div[style*="MISSION VALUE"]')?.parentElement;

      if (compact) {
        if (grid) grid.style.display = 'none';
        if (footer) footer.style.display = 'none';
      } else {
        if (grid) grid.style.display = 'grid';
        if (footer) footer.style.display = 'block';
      }
    });

    // Currency cycle
    div.querySelector('#mxm-cur-flag').addEventListener('click', e => {
      e.stopPropagation();
      const s = loadSettings();
      const keys = Object.keys(CURRENCIES);
      const idx = keys.indexOf(s.currency);
      s.currency = keys[(idx + 1 + keys.length) % keys.length];
      saveSettings(s);
      updateUI();
    });

    // Buttons: Download + Reset
    const dlBtn = div.querySelector('#mxm-download-stats');
    const resetBtn = div.querySelector('#mxm-reset-portfolio');

    if (dlBtn) {
      dlBtn.addEventListener('mousedown', e => e.stopPropagation());
      dlBtn.addEventListener('click', e => {
        e.stopPropagation();
        downloadStats();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('mousedown', e => e.stopPropagation());
      resetBtn.addEventListener('click', e => {
        e.stopPropagation();
        resetPortfolio();
      });
    }

    document.body.appendChild(div);
    return div;
  }

  // --- EXPORT / RESET ---
  function downloadStats() {
    const stats = loadStats();
    const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `mxm-wallet-stats-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function resetPortfolio() {
    const stats = loadStats();
    stats.portfolio = {};
    saveStats(stats);
    updateUI();
  }

  // --- LIVE FX RATES (factors only) ---
  async function refreshRates() {
    try {
      const res = await fetch(FX_API_URL);
      const data = await res.json();
      if (!data || !data.rates) return;
      if (data.rates.ZAR) CURRENCIES.ZAR.factor = data.rates.ZAR;
      if (data.rates.EUR) CURRENCIES.EUR.factor = data.rates.EUR;
      if (data.rates.NGN) CURRENCIES.NGN.factor = data.rates.NGN;
      if (data.rates.KES) CURRENCIES.KES.factor = data.rates.KES;
      updateUI();
    } catch (e) {
      console.error('[MXM Tracker] FX fetch failed', e);
    }
  }

  // --- LOGIC ---
  function updateUI() {
    const widget = createWidget();
    if (!widget) return;

    const stats = loadStats();
    const settings = loadSettings();
    const currency = CURRENCIES[settings.currency] || CURRENCIES.USD;

    const count = getCompletedTaskCount() || 0;
    const rate = getMissionRewardRate() || 1.0;
    const pageTotal = (count * rate * currency.factor).toFixed(2);

    const portfolio = getPortfolioTotal(stats);

    const flagEl = document.getElementById('mxm-cur-flag');
    if (flagEl) flagEl.src = `https://flagcdn.com/${FLAG_ISO[settings.currency]}.svg`;
    updateTextIfChanged('mxm-top-cur', settings.currency);
    updateTextIfChanged('mxm-page-total', `${currency.symbol}${pageTotal}`);
    updateTextIfChanged('mxm-compact-day', `${stats.counts.day} Today`);

    updateTextIfChanged('val-c-day', stats.counts.day);
    updateTextIfChanged('val-c-week', stats.counts.week);
    updateTextIfChanged(
      'val-m-day',
      currency.symbol + (stats.money.day * currency.factor).toFixed(0)
    );
    updateTextIfChanged(
      'val-m-week',
      currency.symbol + (stats.money.week * currency.factor).toFixed(0)
    );

    updateTextIfChanged('val-c-total', portfolio.tasks);
    updateTextIfChanged(
      'val-m-total',
      currency.symbol + (portfolio.usd * currency.factor).toFixed(0)
    );
  }

  function check() {
    const isTaskPage = /\/(tasks|missions)\//.test(window.location.pathname);
    const widget = createWidget();
    if (!widget) return;
    if (!isTaskPage) {
      widget.style.display = 'none';
      return;
    }
    widget.style.display = 'block';

    const count = getCompletedTaskCount();
    const rate = getMissionRewardRate();
    const missionId = getCurrentMissionId();
    const stats = loadStats();
    updateUI();

    if (count === null || missionId === 'unknown') return;

    // Ensure portfolio entry
    if (!stats.portfolio[missionId]) {
      stats.portfolio[missionId] = { usd: 0, tasks: 0 };
    }

    // ─────────────────────────────────────
    // 1. Mission changed → reset baseline
    // ─────────────────────────────────────
    if (stats.lastMissionId !== missionId) {
      if (count > 0 && stats.portfolio[missionId].tasks === 0) {
        // First time ever seeing this mission with progress → seed it
        stats.portfolio[missionId].tasks = count;
        stats.portfolio[missionId].usd = count * rate;
      }
      stats.lastGlobalCount = count;
      stats.lastMissionId = missionId;
      stats.lastRate = rate;
      saveStats(stats);
      return;
    }

    // ─────────────────────────────────────
    // 2. Same mission – first stable read after load/reload
    // ─────────────────────────────────────
    if (stats.lastGlobalCount === null) {
      stats.lastGlobalCount = count;
      stats.lastRate = rate;
      saveStats(stats);
      return;
    }

    // ─────────────────────────────────────
    // 3. Glitch protection – ignore drops
    // ─────────────────────────────────────
    if (count < stats.lastGlobalCount) {
      console.log(`[MXM Tracker] Ignored glitch drop ${stats.lastGlobalCount} → ${count}`);
      return;
    }

    // ─────────────────────────────────────
    // 4. Only accept genuine forward progress
    // ─────────────────────────────────────
    const delta = count - stats.lastGlobalCount;

    if (delta > 0 && delta <= HUMAN_SPEED_LIMIT) {
      const earned = delta * rate;
      stats.portfolio[missionId].tasks += delta;
      stats.portfolio[missionId].usd += earned;
      stats.counts.day += delta;
      stats.counts.week += delta;
      stats.money.day += earned;
      stats.money.week += earned;

      stats.lastGlobalCount = count;       // ← ONLY update baseline when we actually accepted tasks
      stats.lastRate = rate;
      saveStats(stats);
      updateUI();
    }
    // delta ≤ 0 or too big → silently ignored (this is what kills the +2 on every reload)
  }

  // --- MUTATION OBSERVER + DEBOUNCE ---
  let mutationTimeout = null;
  function scheduleCheck() {
    if (mutationTimeout) clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(check, MUTATION_DEBOUNCE_MS);
  }

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, { childList: true, subtree: true });

  // --- CROSS-TAB SYNC ---
  window.addEventListener('storage', event => {
    if (event.key === STATS_KEY || event.key === SETTINGS_KEY) {
      updateUI();
    }
  });

  // Init
  refreshRates();
  setInterval(refreshRates, FX_UPDATE_INTERVAL);
  check();

})();
