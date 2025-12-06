// ==UserScript==
// @name         MxM Mission Reward Tracker (v7.0.0 Network Only)
// @namespace    mxm-tools
// @version      7.0.0
// @description  Day/Week counters + Portfolio + Live Rates (ZAR/NGN/KES) using network-only submission tracking + safe daily sync.
// @author       Richard Mangezi Muketa
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL   https://raw.githubusercontent.com/AshtonLG3/MxM-Mission-Reward-Tracker/main/MxM-Tracker.user.js
// @updateURL     https://raw.githubusercontent.com/AshtonLG3/MxM-Mission-Reward-Tracker/main/MxM-Tracker.meta.js
// ==/UserScript==

(function () {
  'use strict';
  console.log('[MXM Tracker v7.0.0] Network-only Edition');

  // --- CONFIG ---
  const WIDGET_ID = 'mxm-dashboard-widget';

  // 2s global human-speed guard (for counted submissions)
  const HUMAN_MIN_INTERVAL_MS = 2000;

  // Brand colors
  const COLOR_NAVY_DARK = '#0b1018';
  const COLOR_GOLD = '#d4af37';

  // RATES
  const CURRENCIES = {
    USD: { symbol: '$',  factor: 1,     flag: '🇺🇸' },
    ZAR: { symbol: 'R',  factor: 17.06, flag: '🇿🇦' },
    EUR: { symbol: '€',  factor: 0.86,  flag: '🇪🇺' },
    NGN: { symbol: '₦',  factor: 1441,  flag: '🇳🇬' },
    KES: { symbol: 'KSh', factor: 129,  flag: '🇰🇪' }
  };

  const SETTINGS_KEY = 'mxmSettings_global';
  const STATS_KEY    = 'mxmStats_global';
  const OUTBOX_KEY   = 'mxmOutbox_global';

  // Cleanup legacy
  localStorage.removeItem('mxmStats_v6');

  const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';
  const FX_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 1 day

  const DAILY_ENDPOINT = 'https://bridgeangelscakes.co.za/mxm/daily.php?token=Kundiso10';

  // --- HELPERS ---
  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch (e) { return fallback; }
  }

  function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { console.error(e); }
  }

  function updateTextIfChanged(idOrEl, value) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    const str = String(value);
    if (el.textContent !== str) el.textContent = str;
  }

  function getIds() {
    const now = new Date();
    const dayId = now.toLocaleDateString('en-CA');
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    const day = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - day);
    const weekId = weekStart.toLocaleDateString('en-CA');
    return { dayId, weekId };
  }

  // --- OUTBOX FOR DAILY SNAPSHOTS ---
  function loadOutbox() {
    return safeParse(localStorage.getItem(OUTBOX_KEY), []);
  }

  function saveOutbox(items) {
    safeSetItem(OUTBOX_KEY, JSON.stringify(items));
  }

  function queueDailySnapshot(snapshot) {
    const outbox = loadOutbox();
    outbox.push(snapshot);
    saveOutbox(outbox);
  }

  async function flushOutbox() {
    let outbox = loadOutbox();
    if (!outbox || !outbox.length) return;
    const settings = loadSettings();
    const remaining = [];

    for (const snap of outbox) {
      try {
        await sendDailyStatsSnapshot(snap, settings);
        console.log('[MXM Tracker] Daily snapshot synced for', snap.ids && snap.ids.dayId);
      } catch (err) {
        console.error('[MXM Tracker] Outbox send failed, keeping snapshot:', err);
        remaining.push(snap);
      }
    }
    if (remaining.length !== outbox.length) {
      saveOutbox(remaining);
    }
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
        portfolio: {},
        lastGlobalCount: null,   // kept for backward compatibility, not used for counting
        lastMissionId: null,
        lastRate: 1.0,
        lastSubmissionTime: 0
      };
    }

    s.counts.day  = Number(s.counts.day)  || 0;
    s.counts.week = Number(s.counts.week) || 0;
    s.money.day   = Number(s.money.day)   || 0;
    s.money.week  = Number(s.money.week)  || 0;
    if (typeof s.lastSubmissionTime !== 'number') s.lastSubmissionTime = 0;
    if (!s.portfolio) s.portfolio = {};

    // DAY rollover: snapshot yesterday to outbox, then reset
    const idsNow = ids;
    if (s.ids.dayId !== idsNow.dayId) {
      const snapshot = JSON.parse(JSON.stringify(s)); // deep copy
      queueDailySnapshot(snapshot);

      s.ids.dayId = idsNow.dayId;
      s.counts.day = 0;
      s.money.day = 0;
      s.lastSubmissionTime = 0;
      s.lastGlobalCount = null;
    }

    // WEEK rollover
    if (s.ids.weekId !== idsNow.weekId) {
      s.ids.weekId = idsNow.weekId;
      s.counts.week = 0;
      s.money.week = 0;
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
    return { ...base, ...safeParse(raw, {}) };
  }

  function saveSettings(s) {
    safeSetItem(SETTINGS_KEY, JSON.stringify(s));
  }

  // --- DOM PARSING (UI ONLY, NOT FOR COUNTING) ---
  function getCompletedTaskCount() {
    // unchanged: used ONLY to show "Mission Value" for the page
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
    try {
      // Prefer targeted elements first
      let el =
        document.querySelector('[data-testid*="reward"], [class*="Reward"]') ||
        document.querySelector('[data-testid*="Reward"], [class*="reward"]');

      if (el && el.textContent) {
        let m = el.textContent.match(/(\d+(?:\.\d{1,2})?)\s*USD/i);
        if (m && m[1]) return parseFloat(m[1]);
      }

      // Fallback: light scan of first ~300 text nodes (no full body.innerText)
      const nodes = Array.from(document.querySelectorAll('span, div, p')).slice(0, 300);
      for (const node of nodes) {
        const txt = (node.textContent || '').trim();
        if (!txt) continue;
        const m = txt.match(/(\d+(?:\.\d{1,2})?)\s*USD/i);
        if (m && m[1]) return parseFloat(m[1]);
      }
    } catch (e) {
      console.warn('[MXM Tracker] Reward scrape failed:', e);
    }
    return 1.0;
  }

  function getCurrentMissionId() {
    const url = window.location.href;
    const m = url.match(/mission_id=([^&]+)/) || url.match(/\/(?:missions|tasks)\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : 'unknown';
  }

  // --- PORTFOLIO ---
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

  async function sendDailyStatsSnapshot(stats, settings) {
    const url = DAILY_ENDPOINT;
    const currencyKey = settings.currency || 'USD';
    const fx = CURRENCIES[currencyKey] || CURRENCIES.USD;
    const totals = getPortfolioTotal(stats);

    const payload = {
      date: stats.ids.dayId,
      tasks: stats.counts.day,
      earningsUSD: stats.money.day,
      currency: currencyKey,
      converted: stats.money.day * (fx.factor || 1),
      portfolioUsd: totals.usd,
      portfolioTasks: totals.tasks
    };

    await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    console.log("[MXM Tracker] Daily stats snapshot sent.", payload);
  }

  // --- WIDGET UI (UNCHANGED STYLE) ---
  const FLAG_ISO = { USD: "us", ZAR: "za", EUR: "eu", NGN: "ng", KES: "ke" };
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
          <img id="mxm-cur-flag" src="https://flagcdn.com/us.svg"
               style="cursor:pointer; width:22px; height:16px; border-radius:2px;" />
          <span id="mxm-toggle-view" style="cursor:pointer; font-size:14px; opacity:0.8; padding-left:4px;">▣</span>
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

    div.addEventListener('mousedown', e => {
      const target = e.target;
      if (target.id === 'mxm-cur-flag' || target.id === 'mxm-download-stats' || target.id === 'mxm-reset-portfolio') return;
      const rect = div.getBoundingClientRect();
      dragState = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });
    document.addEventListener('mouseup', () => { dragState = null; });
    document.addEventListener('mousemove', e => {
      if (dragState) {
        div.style.left = (e.clientX - dragState.x) + 'px';
        div.style.top = (e.clientY - dragState.y) + 'px';
        div.style.right = 'auto';
      }
    });

    let compact = false;
    div.querySelector('#mxm-toggle-view').addEventListener('click', e => {
      compact = !compact;
      div.style.height = compact ? '60px' : 'auto';
      div.style.overflow = compact ? 'hidden' : 'visible';
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

    div.querySelector('#mxm-cur-flag').addEventListener('click', e => {
      e.stopPropagation();
      const s = loadSettings();
      const keys = Object.keys(CURRENCIES);
      const idx = keys.indexOf(s.currency);
      s.currency = keys[(idx + 1 + keys.length) % keys.length];
      saveSettings(s);
      updateUI();
    });

    const dlBtn = div.querySelector('#mxm-download-stats');
    const resetBtn = div.querySelector('#mxm-reset-portfolio');
    if (dlBtn) {
      dlBtn.addEventListener('mousedown', e => e.stopPropagation());
      dlBtn.addEventListener('click', e => { e.stopPropagation(); downloadStats(); });
    }
    if (resetBtn) {
      resetBtn.addEventListener('mousedown', e => e.stopPropagation());
      resetBtn.addEventListener('click', e => { e.stopPropagation(); resetPortfolio(); });
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

  // --- LIVE FX ---
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
    } catch (e) { console.error(e); }
  }

  // --- NETWORK-BASED TASK REGISTRATION ---
  let lastSubmissionKey = null;
  let lastCountTs = 0;

  function registerTask(missionId, rate) {
    const now = Date.now();
    const stats = loadStats();

    const last = stats.lastSubmissionTime || 0;
    if (now - last < HUMAN_MIN_INTERVAL_MS) {
      console.warn('[MXM Tracker] ⛔ Ignored: too fast to be human:', now - last, 'ms');
      return;
    }

    if (!stats.portfolio[missionId]) {
      stats.portfolio[missionId] = { usd: 0, tasks: 0 };
    }

    stats.portfolio[missionId].tasks += 1;
    stats.portfolio[missionId].usd += rate;

    stats.counts.day += 1;
    stats.counts.week += 1;
    stats.money.day += rate;
    stats.money.week += rate;
    stats.lastSubmissionTime = now;

    saveStats(stats);
    lastCountTs = now;

    updateUI();

    // opportunistically flush any pending daily snapshots
    flushOutbox().catch(() => {});
  }

  function normalizeRequest(resource, config) {
    let url = '';
    let method = 'GET';

    try {
      if (resource instanceof Request) {
        url = resource.url || '';
        method = (resource.method || 'GET').toUpperCase();
      } else {
        url = (resource && resource.toString) ? resource.toString() : String(resource);
        if (config && config.method) {
          method = (config.method || 'GET').toUpperCase();
        } else {
          method = 'GET';
        }
      }
    } catch (e) {
      console.warn('[MXM Tracker] normalizeRequest error:', e);
    }

    return { url, method };
  }

  function isSubmissionUrl(url, method) {
    if (!url) return false;
    method = (method || 'GET').toUpperCase();
    if (!(method === 'POST' || method === 'PUT')) return false;

    // Adjust these patterns based on actual MxM endpoints you see in DevTools
    if (url.includes('/api/curation/tasks') && url.includes('/submit')) return true;
    if (url.match(/\/curation\/tasks\/\d+\/complete/)) return true;
    if (url.match(/\/tasks\/\d+\/submit/)) return true;

    return false;
  }

  function extractTaskId(url) {
    if (!url) return null;
    const m = url.match(/tasks\/(\d+)/);
    return m ? m[1] : null;
  }

  function buildSubmissionKey(url, method) {
    const taskId = extractTaskId(url) || 'unknown';
    return `${method}:${taskId}`;
  }

  function handleNetworkResponse(url, method, response) {
    if (!isSubmissionUrl(url, method)) return;
    if (!response || !response.ok) return;

    const now = Date.now();
    const key = buildSubmissionKey(url, method);

    // Extra dedupe: same key within HUMAN_MIN_INTERVAL_MS → ignore
    if (lastSubmissionKey === key && now - lastCountTs < HUMAN_MIN_INTERVAL_MS) {
      console.warn('[MXM Tracker] Duplicate submission key ignored:', key);
      return;
    }
    lastSubmissionKey = key;

    try {
      const clone = response.clone();
      clone.json().then(payload => {
        const clearlyError =
          payload &&
          (payload.error || payload.status === 'error' || payload.success === false);

        if (clearlyError) {
          console.warn('[MXM Tracker] Server payload indicates error, not counting:', payload);
          return;
        }

        const rate = getMissionRewardRate();
        const missionId = getCurrentMissionId() || 'unknown';
        registerTask(missionId, rate);
      }).catch(() => {
        // If no JSON / parse fails, rely purely on HTTP 200
        const rate = getMissionRewardRate();
        const missionId = getCurrentMissionId() || 'unknown';
        registerTask(missionId, rate);
      });
    } catch (e) {
      console.warn('[MXM Tracker] Response clone/json error, counting by HTTP only:', e);
      const rate = getMissionRewardRate();
      const missionId = getCurrentMissionId() || 'unknown';
      registerTask(missionId, rate);
    }
  }

  // Hook fetch
  (function hookFetch() {
    if (!window.fetch) return;
    const originalFetch = window.fetch;

    window.fetch = function (...args) {
      const { url, method } = normalizeRequest(args[0], args[1]);
      const p = originalFetch.apply(this, args);

      try {
        p.then(response => {
          handleNetworkResponse(url, method, response);
        }).catch(err => {
          console.warn('[MXM Tracker] Fetch promise error:', err);
        });
      } catch (e) {
        console.error('[MXM Tracker] Fetch hook error:', e);
      }

      return p;
    };
  })();

  // Hook XHR
  (function hookXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._mxm_url = url;
      this._mxm_method = method;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = this._mxm_url || '';
          const method = (this._mxm_method || 'GET').toUpperCase();
          const status = this.status;

          if (status >= 200 && status < 300) {
            const fakeResponse = {
              ok: true,
              clone: () => ({
                json: () => Promise.reject(new Error('No body for XHR fake response'))
              })
            };
            handleNetworkResponse(url, method, fakeResponse);
          }
        } catch (e) {
          console.error('[MXM Tracker] XHR hook error:', e);
        }
      });

      return originalSend.apply(this, args);
    };
  })();

  // --- UI / HEARTBEAT (for display ONLY) ---
  function updateUI() {
    const widget = createWidget();
    if (!widget) return;
    const stats = loadStats();
    const settings = loadSettings();
    const currency = CURRENCIES[settings.currency] || CURRENCIES.USD;

    // Mission Value (page-only, from DOM)
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
    updateTextIfChanged('val-m-day', currency.symbol + (stats.money.day * currency.factor).toFixed(0));
    updateTextIfChanged('val-m-week', currency.symbol + (stats.money.week * currency.factor).toFixed(0));
    updateTextIfChanged('val-c-total', portfolio.tasks);
    updateTextIfChanged('val-m-total', currency.symbol + (portfolio.usd * currency.factor).toFixed(0));
  }

  function check() {
    const isTaskPage = /\/(tasks|missions)\//.test(window.location.pathname);
    const widget = createWidget();
    if (!widget) return;
    widget.style.display = isTaskPage ? 'block' : 'none';
    updateUI();
  }

  // --- HEARTBEAT: simple interval, no MutationObserver needed for counting ---
  setInterval(check, 2000);
  window.addEventListener('storage', event => {
    if (event.key === STATS_KEY || event.key === SETTINGS_KEY) updateUI();
  });

  refreshRates();
  setInterval(refreshRates, FX_UPDATE_INTERVAL);
  check();
  flushOutbox().catch(() => {});

})();
