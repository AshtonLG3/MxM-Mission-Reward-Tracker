// ==UserScript==
// @name         MxM Mission Reward Tracker (Final Merge v6.0)
// @namespace    mxm-tools
// @version      6.0.1
// @description  v5.2.0 Day/Week Logic + v5.4.0 Portfolio Total (Best of both worlds).
// @author       Richard Mangezi Muketa
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  console.log('[MXM Tracker v6.0] Final Merge Active');

  // --- CONFIG ---
  const WIDGET_ID = 'mxm-dashboard-widget';
  const UPDATE_INTERVAL = 1000;
  const HUMAN_SPEED_LIMIT = 2;

  // RATES (Nov 30, 2025)
  const CURRENCIES = {
    USD: { symbol: '$', factor: 1, flag: '🇺🇸' },
    ZAR: { symbol: 'R', factor: 17.11, flag: '🇿🇦' },
    EUR: { symbol: '€', factor: 0.86, flag: '🇪🇺' },
    NGN: { symbol: '₦', factor: 1441, flag: '🇳🇬' },
    KES: { symbol: 'KSh', factor: 129, flag: '🇰🇪' }
  };

  const SETTINGS_KEY = 'mxmSettings_v6';
  const STATS_KEY = 'mxmStats_v6'; // New key to ensure clean slate

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
        portfolio: {}, // Registry: { "mission_id": { usd: 618.00, tasks: 206 } }
        lastGlobalCount: null,
        lastMissionId: null,
        lastRate: 1.0
      };
    }

    // STRICT v5.2.0 RESET LOGIC for Day/Week
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

  function saveStats(s) { localStorage.setItem(STATS_KEY, JSON.stringify(s)); }

  function loadSettings() {
    try { return { currency: 'USD', ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
    catch (e) { return { currency: 'USD' }; }
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

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
    for (const [mid, val] of Object.entries(stats.portfolio)) {
        totalUSD += val.usd;
        totalTasks += val.tasks;
    }
    return { usd: totalUSD, tasks: totalTasks };
  }

  // --- WIDGET UI ---
  let dragState = null;

  function createWidget() {
    let widget = document.getElementById(WIDGET_ID);
    if (widget) return widget;

    const div = document.createElement('div');
    div.id = WIDGET_ID;
    div.style.cssText = `
      position: fixed; top: 80px; right: 20px; width: 290px;
      background: #121212; color: #fff; border-top: 4px solid #4caf50;
      font-family: 'Segoe UI', sans-serif; z-index: 999999;
      box-shadow: 0 10px 40px rgba(0,0,0,0.8); border-radius: 8px;
      cursor: grab; user-select: none; font-size: 13px;
    `;

    div.innerHTML = `
      <div style="padding:10px 12px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.08); border-bottom:1px solid #333;">
        <span style="font-weight:800; font-size:10px; opacity:0.7; letter-spacing:1px; color:#4caf50;">GLOBAL WALLET</span>
        <span id="mxm-cur-flag" style="cursor:pointer; font-size:16px;">🇺🇸</span>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr 1.2fr; text-align:center; background:#1a1a1a;">
        <div style="padding:8px 4px; font-size:9px; color:#666; font-weight:700; border-right:1px solid #222; border-bottom:1px solid #222;">TODAY</div>
        <div style="padding:8px 4px; font-size:9px; color:#666; font-weight:700; border-right:1px solid #222; border-bottom:1px solid #222;">WEEK</div>
        <div style="padding:8px 4px; font-size:9px; color:#aaa; font-weight:700; border-bottom:1px solid #222; background:rgba(255,255,255,0.03);">PORTFOLIO</div>

        <div id="val-c-day" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; border-right:1px solid #222;">0</div>
        <div id="val-c-week" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; border-right:1px solid #222;">0</div>
        <div id="val-c-total" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; color:#fff; background:rgba(255,255,255,0.03);">0</div>

        <div id="val-m-day" style="padding:2px 0 12px 0; font-size:13px; color:#4caf50; border-right:1px solid #222;">$0</div>
        <div id="val-m-week" style="padding:2px 0 12px 0; font-size:13px; color:#4caf50; border-right:1px solid #222;">$0</div>
        <div id="val-m-total" style="padding:2px 0 12px 0; font-size:14px; font-weight:bold; color:#4caf50; background:rgba(255,255,255,0.03);">$0</div>
      </div>

      <div style="padding:8px 12px; background:#000; font-size:10px; border-top:2px solid #333; border-bottom-left-radius:8px; border-bottom-right-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
            <span style="color:#888; font-weight:600;">MISSION VALUE</span>
            <span id="mxm-page-total" style="color:#fff; font-weight:700; font-size:12px;">$0.00</span>
        </div>
        <div style="text-align:right; font-size:9px; color:#555;">(Page Tasks × Rate)</div>
      </div>
    `;

    div.addEventListener('mousedown', e => {
      if (e.target.id === 'mxm-cur-flag') return;
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

    div.querySelector('#mxm-cur-flag').addEventListener('click', () => {
      const s = loadSettings();
      const keys = Object.keys(CURRENCIES);
      s.currency = keys[(keys.indexOf(s.currency) + 1) % keys.length];
      saveSettings(s);
      updateUI();
    });

    document.body.appendChild(div);
    return div;
  }

  // --- LOGIC ---
  function updateUI() {
    const widget = createWidget();
    const stats = loadStats();
    const settings = loadSettings();
    const currency = CURRENCIES[settings.currency];

    const count = getCompletedTaskCount() || 0;
    const rate = getMissionRewardRate() || 1.0;
    const pageTotal = (count * rate * currency.factor).toFixed(2);

    // Calculate Portfolio (Sum of all stored missions)
    const portfolio = getPortfolioTotal(stats);

    document.getElementById('mxm-cur-flag').textContent = currency.flag;
    document.getElementById('mxm-page-total').textContent = `${currency.symbol}${pageTotal}`;

    // Columns 1 & 2 (v5.2.0 Logic: Incremental Work)
    document.getElementById('val-c-day').textContent = stats.counts.day;
    document.getElementById('val-c-week').textContent = stats.counts.week;
    document.getElementById('val-m-day').textContent = currency.symbol + (stats.money.day * currency.factor).toFixed(0);
    document.getElementById('val-m-week').textContent = currency.symbol + (stats.money.week * currency.factor).toFixed(0);

    // Column 3 (New Logic: Portfolio Total)
    document.getElementById('val-c-total').textContent = portfolio.tasks;
    document.getElementById('val-m-total').textContent = currency.symbol + (portfolio.usd * currency.factor).toFixed(0);
  }

  function check() {
    const isTaskPage = /\/(tasks|missions)\//.test(window.location.pathname);
    const widget = createWidget();
    if (!isTaskPage) { widget.style.display = 'none'; return; }
    widget.style.display = 'block';

    const count = getCompletedTaskCount();
    const rate = getMissionRewardRate();
    const missionId = getCurrentMissionId();
    const stats = loadStats();

    updateUI();

    if (count === null || missionId === 'unknown') return;

   // --- Portfolio safer initialization ---
if (!stats.portfolio[missionId]) {
    stats.portfolio[missionId] = { usd: 0, tasks: 0 };
}

    // --- 2. Update Incremental Stats (v5.2.0 logic) ---
    if (stats.lastGlobalCount === null || stats.lastMissionId !== missionId) {
      stats.lastGlobalCount = count;
      stats.lastMissionId = missionId;
      stats.lastRate = rate;
      saveStats(stats);
      return;
    }

    const delta = count - stats.lastGlobalCount;

    if (delta > 0 && delta <= HUMAN_SPEED_LIMIT) {
      const earned = delta * rate;
        // Portfolio increment (only new work)
stats.portfolio[missionId].tasks += delta;
stats.portfolio[missionId].usd += earned;

      // Update Day/Week (New Work Only)
      stats.counts.day += delta;
      stats.counts.week += delta;
      stats.money.day += earned;
      stats.money.week += earned;

      stats.lastGlobalCount = count;
      stats.lastRate = rate;
      saveStats(stats);
      updateUI();
    } else if (delta !== 0) {
      stats.lastGlobalCount = count;
      stats.lastRate = rate;
      saveStats(stats);
    } else {
        // Just save in case portfolio updated
        saveStats(stats);
    }
  }

  setInterval(check, UPDATE_INTERVAL);
  check();

})();
