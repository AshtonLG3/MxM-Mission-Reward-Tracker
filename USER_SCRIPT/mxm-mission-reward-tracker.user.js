// ==UserScript==
// @name         MxM Mission Reward Tracker (Final Merge v6.3.1)
// @namespace    mxm-tools
// @version      6.3.1
// @description  v5.2.0 Day/Week Logic + Portfolio (One-Time Populate + Deltas) + Export/Reset buttons.
// @author       Richard Mangezi Muketa
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  console.log('[MXM Tracker v6.3.1] Final Merge + One-Time Portfolio + Export/Reset');

  // --- CONFIG ---
  const WIDGET_ID = 'mxm-dashboard-widget';
  const UPDATE_INTERVAL = 1000;
  const HUMAN_SPEED_LIMIT = 2;

  // Brand colors (based on In-Editor Formatter banner)
  const COLOR_NAVY = '#0e4f7a';
  const COLOR_NAVY_DARK = '#0b1018';
  const COLOR_GOLD = '#d4af37';

  // AUTO-UPDATING CURRENCIES (fallback factors)
const CURRENCIES = {
  USD: { symbol: '$', factor: 1, flag: '🇺🇸' },
  ZAR: { symbol: 'R', factor: 17.11, flag: '🇿🇦' },
  EUR: { symbol: '€', factor: 0.86, flag: '🇪🇺' },
  NGN: { symbol: '₦', factor: 1441, flag: '🇳🇬' },
  KES: { symbol: 'KSh', factor: 129, flag: '🇰🇪' }
};

// Fetches exchange rates once per day
async function updateExchangeRates() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();

    if (data && data.rates) {
      // Update ONLY the factor (keep symbol + flag untouched)
      if (data.rates.ZAR) CURRENCIES.ZAR.factor = data.rates.ZAR;
      if (data.rates.EUR) CURRENCIES.EUR.factor = data.rates.EUR;
      if (data.rates.NGN) CURRENCIES.NGN.factor = data.rates.NGN;
      if (data.rates.KES) CURRENCIES.KES.factor = data.rates.KES;

      // Refresh widget if visible
      updateUI();
    }
  } catch (e) {
    console.warn('Currency update failed:', e);
  }
}

// Run immediately + once per day
updateExchangeRates();
setInterval(updateExchangeRates, 24 * 60 * 60 * 1000); // every 24 hours


  const SETTINGS_KEY = 'mxmSettings_v6';
  const STATS_KEY = 'mxmStats_v6';

  // --- DATE HELPERS ---
  function getIds() {
    const now = new Date();
    const dayId = now.toLocaleDateString('en-CA');
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day;
    const weekStart = new Date(d.setDate(diff));
    const weekId = weekStart.toLocaleDateString('en-CA');
    return { dayId, weekId };
  }

  // --- STORAGE ---
  function loadStats() {
    const ids = getIds();
    let s;
    try { s = JSON.parse(localStorage.getItem(STATS_KEY)); } catch (e) {}

    if (!s || !s.ids) {
      s = {
        ids: ids,
        counts: { day: 0, week: 0 },
        money: { day: 0, week: 0 },
        portfolio: {}, // { mission_id: { usd, tasks } }
        lastGlobalCount: null,
        lastMissionId: null,
        lastRate: 1.0
      };
    }

    // Enforce numbers
    s.counts.day = Number(s.counts.day) || 0;
    s.counts.week = Number(s.counts.week) || 0;
    s.money.day = Number(s.money.day) || 0;
    s.money.week = Number(s.money.week) || 0;

    // STRICT v5.2.0 RESET LOGIC for Day/Week (but NOT portfolio)
    if (s.ids.dayId !== ids.dayId) {
      s.counts.day = 0; s.money.day = 0;
      s.ids.dayId = ids.dayId;
      s.lastGlobalCount = null;
    }
    if (s.ids.weekId !== ids.weekId) {
      s.counts.week = 0; s.money.week = 0;
      s.ids.weekId = ids.weekId;
    }
    return s;
  }

  function saveStats(s) {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  }

  function loadSettings() {
    try { return { currency: 'USD', ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
    catch (e) { return { currency: 'USD' }; }
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  // --- DOM PARSING (v5.2.0 Strict) ---
  function getCompletedTaskCount() {
    const patterns = [
      /(?:Completed|Concluído|Terminé|Completado)\s*[·•]\s*(\d+)/i,
      /(?:Completed|Concluído)\s+(\d+)(?!\s*h)/i
    ];
    const elements = document.querySelectorAll('div, span, p');
    for (const el of elements) {
      if (!el.offsetParent) continue;
      const text = el.textContent.trim();
      if (text.length > 50) continue;
      for (const p of patterns) {
        const m = text.match(p);
        if (m && m[1]) return parseInt(m[1], 10);
      }
    }
    return null;
  }

  function getMissionRewardRate() {
    const bodyText = document.body.innerText || '';
    const m = bodyText.match(/(?:Reward|Recompensa).*?(\d+(?:\.\d{1,2})?)\s*USD/i);
    if (m && m[1]) return parseFloat(m[1]);

    const el = document.querySelector('[class*="Reward"]');
    if (el) {
      const m2 = el.textContent.match(/(\d+(?:\.\d{1,2})?)\s*USD/i);
      if (m2) return parseFloat(m2[1]);
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
    for (const val of Object.values(stats.portfolio || {})) {
      const usd = Number(val.usd) || 0;
      const tasks = Number(val.tasks) || 0;
      totalUSD += usd;
      totalTasks += tasks;
    }
    return { usd: totalUSD, tasks: totalTasks };
  }

  // --- EXPORT & RESET HELPERS ---
  function downloadStats() {
    const stats = loadStats();
    const dataStr = JSON.stringify(stats, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `mxmStats_v6-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function resetPortfolio() {
    const stats = loadStats();
    stats.portfolio = {};         // Clear only portfolio
    stats.lastGlobalCount = null; // Force fresh first-visit logic
    stats.lastMissionId = null;
    saveStats(stats);
    updateUI();
  }

  // --- WIDGET UI ---
  let dragState = null;

  function createWidget() {
    let widget = document.getElementById(WIDGET_ID);
    if (widget) return widget;

    const div = document.createElement('div');
    div.id = WIDGET_ID;
    div.style.cssText = `
      position: fixed; top: 80px; right: 20px; width: 300px;
      background: radial-gradient(circle at top left, ${COLOR_NAVY} 0, ${COLOR_NAVY_DARK} 55%, #000 100%);
      color: #ffffff;
      border-top: 4px solid ${COLOR_GOLD};
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      z-index: 999999;
      box-shadow: 0 10px 40px rgba(0,0,0,0.85);
      border-radius: 10px;
      cursor: grab;
      user-select: none;
      font-size: 13px;
    `;

    div.innerHTML = `
      <div style="padding:10px 12px; display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.35); border-bottom:1px solid rgba(0,0,0,0.7); border-top-left-radius:10px; border-top-right-radius:10px;">
        <span style="font-weight:800; font-size:10px; opacity:0.7; letter-spacing:1px; color:#4caf50;">GLOBAL WALLET</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span id="mxm-top-cur" style="font-size:12px;">USD</span>
          <span id="mxm-cur-flag" style="cursor:pointer; font-size:18px;">🇺🇸</span>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr 1.2fr; text-align:center; background:rgba(0,0,0,0.4);">
        <div style="padding:8px 4px; font-size:9px; color:#a0aec0; font-weight:700; border-right:1px solid rgba(0,0,0,0.6); border-bottom:1px solid rgba(0,0,0,0.6);">TODAY</div>
        <div style="padding:8px 4px; font-size:9px; color:#a0aec0; font-weight:700; border-right:1px solid rgba(0,0,0,0.6); border-bottom:1px solid rgba(0,0,0,0.6);">WEEK</div>
        <div style="padding:8px 4px; font-size:9px; color:${COLOR_GOLD}; font-weight:700; border-bottom:1px solid rgba(0,0,0,0.6); background:rgba(0,0,0,0.45);">PORTFOLIO</div>

        <div id="val-c-day" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; border-right:1px solid rgba(0,0,0,0.6);">0</div>
        <div id="val-c-week" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; border-right:1px solid rgba(0,0,0,0.6);">0</div>
        <div id="val-c-total" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; color:#ffffff; background:rgba(0,0,0,0.45);">0</div>

        <div id="val-m-day" style="padding:2px 0 10px 0; font-size:13px; color:${COLOR_GOLD}; border-right:1px solid rgba(0,0,0,0.6);">$0</div>
        <div id="val-m-week" style="padding:2px 0 10px 0; font-size:13px; color:${COLOR_GOLD}; border-right:1px solid rgba(0,0,0,0.6);">$0</div>
        <div id="val-m-total" style="padding:2px 0 10px 0; font-size:14px; font-weight:bold; color:${COLOR_GOLD}; background:rgba(0,0,0,0.45);">$0</div>
      </div>

      <div style="padding:8px 12px 10px 12px; background:rgba(0,0,0,0.9); font-size:10px; border-bottom-left-radius:10px; border-bottom-right-radius:10px; border-top:1px solid rgba(0,0,0,0.7);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="color:#a0aec0; font-weight:600;">MISSION VALUE</span>
            <span id="mxm-page-total" style="color:#ffffff; font-weight:700; font-size:12px;">$0.00</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <span style="font-size:9px; color:#4a5568;">(Page Tasks × Rate)</span>
          <div style="display:flex; gap:6px;">
            <button id="mxm-download-stats" style="padding:2px 6px; font-size:9px; border-radius:4px; border:1px solid ${COLOR_NAVY}; background:transparent; color:#e2e8f0; cursor:pointer;">Download</button>
            <button id="mxm-reset-portfolio" style="padding:2px 6px; font-size:9px; border-radius:4px; border:1px solid ${COLOR_GOLD}; background:${COLOR_GOLD}; color:#000; font-weight:600; cursor:pointer;">Reset</button>
          </div>
        </div>
      </div>
    `;

    // Drag handling
    div.addEventListener('mousedown', e => {
      // Don't start drag when clicking buttons or flag
      const target = e.target;
      if (target.id === 'mxm-cur-flag' ||
          target.id === 'mxm-download-stats' ||
          target.id === 'mxm-reset-portfolio') return;
      const rect = div.getBoundingClientRect();
      dragState = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });
    document.addEventListener('mouseup', () => dragState = null);
    document.addEventListener('mousemove', e => {
      if (dragState) {
        div.style.left = (e.clientX - dragState.x) + 'px';
        div.style.top = (e.clientY - dragState.y) + 'px';
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
    if (flagEl) flagEl.textContent = currency.flag;

    const topCurEl = document.getElementById('mxm-top-cur');
    if (topCurEl) topCurEl.textContent = settings.currency;

    const pageTotalEl = document.getElementById('mxm-page-total');
    if (pageTotalEl) pageTotalEl.textContent = `${currency.symbol}${pageTotal}`;

    const cDay = document.getElementById('val-c-day');
    const cWeek = document.getElementById('val-c-week');
    const mDay = document.getElementById('val-m-day');
    const mWeek = document.getElementById('val-m-week');
    const cTotal = document.getElementById('val-c-total');
    const mTotal = document.getElementById('val-m-total');

    if (cDay) cDay.textContent = stats.counts.day;
    if (cWeek) cWeek.textContent = stats.counts.week;
    if (mDay) mDay.textContent = currency.symbol + (stats.money.day * currency.factor).toFixed(0);
    if (mWeek) mWeek.textContent = currency.symbol + (stats.money.week * currency.factor).toFixed(0);

    if (cTotal) cTotal.textContent = portfolio.tasks;
    if (mTotal) mTotal.textContent = currency.symbol + (portfolio.usd * currency.factor).toFixed(0);
  }

  function check() {
    const isTaskPage = /\/(tasks|missions)\//.test(window.location.pathname);
    const widget = createWidget();
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

    // Ensure portfolio entry exists
    if (!stats.portfolio[missionId]) {
      stats.portfolio[missionId] = { usd: 0, tasks: 0 };
    }

    // --- FIRST VISIT / MISSION SWITCH ---
    if (stats.lastGlobalCount === null || stats.lastMissionId !== missionId) {

      // ONE-TIME ABSOLUTE POPULATE:
      // Only if this mission's portfolio is zero AND MxM count > 0.
      if (count > 0 && (stats.portfolio[missionId].tasks === 0)) {
        stats.portfolio[missionId].tasks = count;
        stats.portfolio[missionId].usd = count * rate;
      }

      stats.lastGlobalCount = count;
      stats.lastMissionId = missionId;
      stats.lastRate = rate;
      saveStats(stats);
      updateUI();
      return;
    }

    // --- DELTA LOGIC (INCREMENTAL) ---
    const delta = count - stats.lastGlobalCount;

    if (delta > 0 && delta <= HUMAN_SPEED_LIMIT) {
      const earned = delta * rate;

      // Portfolio uses deltas AFTER initial populate
      stats.portfolio[missionId].tasks += delta;
      stats.portfolio[missionId].usd += earned;

      // Day/Week incremental
      stats.counts.day += delta;
      stats.counts.week += delta;
      stats.money.day += earned;
      stats.money.week += earned;

      stats.lastGlobalCount = count;
      stats.lastRate = rate;
      saveStats(stats);
      updateUI();
    } else if (delta !== 0) {
      // Large or negative jumps: just resync baseline, don't count
      stats.lastGlobalCount = count;
      stats.lastRate = rate;
      saveStats(stats);
      updateUI();
    } else {
      // No change but maybe portfolio or other state updated
      saveStats(stats);
    }
  }

  // Init loop
  setInterval(check, UPDATE_INTERVAL);
  check();

})();
