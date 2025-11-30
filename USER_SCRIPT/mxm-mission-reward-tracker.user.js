// ==UserScript==
// @name         MxM Mission Reward Tracker (Fix v6.2.1)
// @namespace    mxm-tools
// @version      6.2.1
// @description  v6.2.0 Base + Critical Variable Reference Fix (CURRENCIES -> RATES).
// @author       Richard Mangezi Muketa
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  console.log('[MXM Tracker v6.2.1] Reference Fix Applied');

  // --- CONFIG ---
  const WIDGET_ID = 'mxm-dashboard-widget';
  const UPDATE_INTERVAL = 1000;
  const HUMAN_SPEED_LIMIT = 2;

  // RATES (Fallback values, updated via API)
  let RATES = {
    USD: 1,
    ZAR: 17.11,
    EUR: 0.86,
    NGN: 1441,
    KES: 129
  };

  const SETTINGS_KEY = 'mxmSettings_v6';
  const STATS_KEY = 'mxmStats_v6';

  // --- 1. LIVE RATES FETCHER ---
  async function updateRates() {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD');
      const data = await response.json();
      if (data && data.rates) {
        RATES.USD = 1;
        if (data.rates.ZAR) RATES.ZAR = data.rates.ZAR;
        if (data.rates.EUR) RATES.EUR = data.rates.EUR;
        if (data.rates.NGN) RATES.NGN = data.rates.NGN;
        if (data.rates.KES) RATES.KES = data.rates.KES;
        const widget = document.getElementById(WIDGET_ID);
        if (widget) updateUI();
      }
    } catch (e) {}
  }

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
        portfolio: {},
        lastGlobalCount: null,
        lastMissionId: null,
        lastRate: 1.0
      };
    }

    // Number Enforcer
    s.counts.day = Number(s.counts.day) || 0;
    s.counts.week = Number(s.counts.week) || 0;
    s.money.day = Number(s.money.day) || 0;
    s.money.week = Number(s.money.week) || 0;

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

        <div id="val-c-day" style="padding:8px 0 2px 0; font-size:16px; font-weight:bold; border-right:1px solid #222; transition: color 0.5s;">0</div>
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
      const keys = Object.keys(RATES);
      s.currency = keys[(keys.indexOf(s.currency) + 1) % keys.length];
      saveSettings(s);
      updateUI();
    });

    document.body.appendChild(div);
    return div;
  }

  function flashGreen() {
      const el = document.getElementById('val-c-day');
      if(el) {
          el.style.color = '#00ff00';
          setTimeout(()=> el.style.color = '', 400);
      }
  }

  // --- LOGIC (The Fix) ---
  function updateUI() {
    const widget = createWidget();
    const stats = loadStats();
    const settings = loadSettings();

    // THE FIX: Dynamic currency object construction
    const currency = {
        symbol: settings.currency === "USD" ? "$" :
                settings.currency === "ZAR" ? "R" :
                settings.currency === "EUR" ? "€" :
                settings.currency === "NGN" ? "₦" :
                settings.currency === "KES" ? "KSh" : "$",
        factor: RATES[settings.currency] || 1,
        flag:
          settings.currency === "USD" ? "🇺🇸" :
          settings.currency === "ZAR" ? "🇿🇦" :
          settings.currency === "EUR" ? "🇪🇺" :
          settings.currency === "NGN" ? "🇳🇬" :
          settings.currency === "KES" ? "🇰🇪" : "🇺🇸"
    };

    const count = getCompletedTaskCount() || 0;
    const rate = getMissionRewardRate() || 1.0;
    const pageTotal = (count * rate * currency.factor).toFixed(2);

    const portfolio = getPortfolioTotal(stats);

    document.getElementById('mxm-cur-flag').textContent = currency.flag;
    document.getElementById('mxm-page-total').textContent = `${currency.symbol}${pageTotal}`;

    document.getElementById('val-c-day').textContent = stats.counts.day;
    document.getElementById('val-c-week').textContent = stats.counts.week;
    document.getElementById('val-m-day').textContent = currency.symbol + (stats.money.day * currency.factor).toFixed(0);
    document.getElementById('val-m-week').textContent = currency.symbol + (stats.money.week * currency.factor).toFixed(0);

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

    if (count > 0) {
        stats.portfolio[missionId] = { usd: count * rate, tasks: count };
    }

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

      stats.counts.day += delta;
      stats.counts.week += delta;
      stats.money.day += earned;
      stats.money.week += earned;

      stats.lastGlobalCount = count;
      stats.lastRate = rate;

      saveStats(stats);
      flashGreen();
      updateUI();
    } else if (delta !== 0) {
      stats.lastGlobalCount = count;
      stats.lastRate = rate;
      saveStats(stats);
      updateUI();
    } else {
        saveStats(stats);
    }
  }

  // Init
  updateRates();
  setInterval(updateRates, 3600000);
  setInterval(check, UPDATE_INTERVAL);
  check();

})();
