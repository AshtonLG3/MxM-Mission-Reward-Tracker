// ==UserScript==
// @name         MxM Mission Reward Tracker (USD → ZAR / EUR / NGN / KES)
// @namespace    mxm-tools
// @version      2.0.0
// @description  Shows total completed mission earnings (daily / weekly / monthly) in USD and converts to multiple currencies with a draggable, compact/full widget.
// @author       Richard Mangezi Muketa
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  console.log('[MXM Mission Tracker] Script v2.0.0 initialised.');

  const TOTAL_WIDGET_ID = 'mxm-draggable-total-widget';

  const FALLBACK_REWARD_RATE = 0.5;

  // ---- Currency config: base is USD, others are multiplier from USD ----
  const CURRENCIES = {
    USD: {
      name: 'US Dollar',
      symbol: '$',
      factorFromUSD: 1,
      flag: 'https://flagcdn.com/us.svg'
    },
    ZAR: {
      name: 'South African Rand',
      symbol: 'R',
      factorFromUSD: 18.2, // adjust if you want a different estimate
      flag: 'https://flagcdn.com/za.svg'
    },
    EUR: {
      name: 'Euro',
      symbol: '€',
      factorFromUSD: 0.92,
      flag: 'https://flagcdn.com/eu.svg'
    },
    NGN: {
      name: 'Nigerian Naira',
      symbol: '₦',
      factorFromUSD: 1600,
      flag: 'https://flagcdn.com/ng.svg'
    },
    KES: {
      name: 'Kenyan Shilling',
      symbol: 'KSh',
      factorFromUSD: 130,
      flag: 'https://flagcdn.com/ke.svg'
    }
  };

  const SUPPORTED_CURRENCIES = ['USD', 'ZAR', 'EUR', 'NGN', 'KES'];

  // Colours
  const WIDGET_BG_COLOR = 'rgba(52, 52, 52, 0.95)';
  const WIDGET_TEXT_COLOR = 'rgba(233, 233, 233, 0.98)';
  const BORDER_COLOR_SUCCESS = '#28a745';
  const BORDER_COLOR_PENDING = '#dc3545';

  // Storage keys
  const STATS_KEY = 'mxmMissionTrackerStats_v2';
  const SETTINGS_KEY = 'mxmMissionTrackerSettings_v2';

  // ------ Helpers: dates for daily / weekly / monthly tracking ------

  function getDayId(date) {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  // Week start is Sunday 00:00
  function getWeekStartId(date) {
    const d = new Date(date.getTime());
    const day = d.getDay(); // 0 = Sunday
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }

  function getMonthId(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`; // YYYY-MM
  }

  // ------ Storage helpers ------

  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (e) {
      console.error('[MXM Mission Tracker] Failed to parse stats from storage:', e);
      return null;
    }
  }

  function saveStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {
      console.error('[MXM Mission Tracker] Failed to save stats:', e);
    }
  }

  function createEmptyStats(now) {
    const dayId = getDayId(now);
    const weekId = getWeekStartId(now);
    const monthId = getMonthId(now);
    return {
      day: { id: dayId, totalUSD: 0 },
      week: { id: weekId, totalUSD: 0 },
      month: { id: monthId, totalUSD: 0 },
      lastSnapshot: { totalUSD: 0, count: 0 }
    };
  }

  function ensureStats(stats, now) {
    if (!stats) {
      stats = createEmptyStats(now);
      return stats;
    }

    const dayId = getDayId(now);
    const weekId = getWeekStartId(now);
    const monthId = getMonthId(now);

    if (!stats.day || stats.day.id !== dayId) {
      stats.day = { id: dayId, totalUSD: 0 };
    }
    if (!stats.week || stats.week.id !== weekId) {
      stats.week = { id: weekId, totalUSD: 0 };
    }
    if (!stats.month || stats.month.id !== monthId) {
      stats.month = { id: monthId, totalUSD: 0 };
    }
    if (!stats.lastSnapshot) {
      stats.lastSnapshot = { totalUSD: 0, count: 0 };
    }

    return stats;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return {
          currency: 'ZAR',
          mode: 'full'
        };
      }
      const parsed = JSON.parse(raw);
      if (!SUPPORTED_CURRENCIES.includes(parsed.currency)) {
        parsed.currency = 'ZAR';
      }
      if (parsed.mode !== 'compact' && parsed.mode !== 'full') {
        parsed.mode = 'full';
      }
      return parsed;
    } catch (e) {
      console.error('[MXM Mission Tracker] Failed to parse settings from storage:', e);
      return {
        currency: 'ZAR',
        mode: 'full'
      };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('[MXM Mission Tracker] Failed to save settings:', e);
    }
  }

  let stats = ensureStats(loadStats(), new Date());
  let settings = loadSettings();

  // ------ Draggable widget helper ------

  function makeDraggable(element) {
    let offsetX = 0,
      offsetY = 0,
      isDragging = false;

    element.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mxm-close-btn') || e.target.closest('.mxm-currency-select')) return;
      isDragging = true;
      offsetX = e.clientX - element.getBoundingClientRect().left;
      offsetY = e.clientY - element.getBoundingClientRect().top;
      element.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      element.style.left = `${e.clientX - offsetX}px`;
      element.style.top = `${e.clientY - offsetY}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.cursor = 'grab';
    });
  }

  // ------ Mission reward rate (USD) ------

  function getMissionRewardRate() {
    try {
      const xpath =
        "//*[contains(text(), 'USD') and (contains(text(), 'Reward:') or contains(text(), 'Recompensa:'))]";
      const results = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      for (let i = results.snapshotLength - 1; i >= 0; i--) {
        const rewardElement = results.snapshotItem(i);

        if (rewardElement && rewardElement.textContent) {
          const style = window.getComputedStyle(rewardElement);
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rewardElement.offsetParent !== null;

          if (visible) {
            const text = rewardElement.textContent;
            const match =
              text.match(/Reward:\s*([\d.]+)\s*USD/i) ||
              text.match(/Recompensa:\s*([\d.]+)\s*USD/i);

            if (match && match[1]) {
              const rate = parseFloat(match[1]);
              if (!isNaN(rate)) {
                return rate;
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[MXM Mission Tracker] Error fetching reward rate:', e);
    }

    return FALLBACK_REWARD_RATE;
  }

  // ------ Read mission count & totals ------

  function calculateGlobalTotal() {
    let currentRewardRate = FALLBACK_REWARD_RATE;
    let totalTasksFound = 0;

    try {
      currentRewardRate = getMissionRewardRate();

      try {
        const divs = document.querySelectorAll('div');
        const validDivs = Array.from(divs).filter((div) => {
          const style = window.getComputedStyle(div);
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            div.offsetParent !== null;
          return visible && /(?:Concluído|Completed)\s*·\s*\d+/i.test(div.textContent);
        });

        if (validDivs.length > 0) {
          const last = validDivs[validDivs.length - 1];
          const match =
            last.textContent.match(/Completed\s*·\s*(\d+)/i) ||
            last.textContent.match(/Concluído\s*·\s*(\d+)/i);
          if (match) totalTasksFound = parseInt(match[1], 10);
        }
      } catch (e) {
        console.error('[MXM Mission Tracker] Error reading task count:', e);
        totalTasksFound = 0;
      }

      const totalUSDNumber = currentRewardRate * totalTasksFound;
      const totalUSD = totalUSDNumber.toFixed(2);

      return {
        totalUSD,
        totalUSDNumber,
        count: totalTasksFound,
        rate: currentRewardRate
      };
    } catch (e) {
      console.error('[MXM Mission Tracker] Fatal error in calculateGlobalTotal:', e);
      return { totalUSD: '0.00', totalUSDNumber: 0, count: 0, rate: currentRewardRate };
    }
  }

  // ------ Currency conversion ------

  function convertFromUSD(amountUSD, currencyCode) {
    const cfg = CURRENCIES[currencyCode] || CURRENCIES.USD;
    return amountUSD * cfg.factorFromUSD;
  }

  function formatCurrency(amount, currencyCode) {
    const cfg = CURRENCIES[currencyCode] || CURRENCIES.USD;
    return `${cfg.symbol}${amount.toFixed(2)} ${currencyCode}`;
  }

  // ------ Widget creation & updates ------

  function applyMode(widget) {
    const fullBody = widget.querySelector('.mxm-full-body');
    const compactBody = widget.querySelector('.mxm-compact-body');

    if (settings.mode === 'compact') {
      fullBody.style.display = 'none';
      compactBody.style.display = 'flex';
      widget.style.minWidth = '190px';
      widget.style.padding = '8px 14px 10px 14px';
    } else {
      fullBody.style.display = 'block';
      compactBody.style.display = 'none';
      widget.style.minWidth = '260px';
      widget.style.padding = '15px 22px 18px 22px';
    }
  }

  function createWidget(borderStyle) {
    const widget = document.createElement('div');
    widget.id = TOTAL_WIDGET_ID;
    widget.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 10001;
      color: ${WIDGET_TEXT_COLOR};
      border-radius: 15px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      text-align: left;
      cursor: grab;
      line-height: 1.4;
      transition: all 0.25s ease;
      user-select: none;
      backdrop-filter: blur(6px);
      background-color: ${WIDGET_BG_COLOR};
      ${borderStyle}
    `;

    const closeBtn = document.createElement('div');
    closeBtn.textContent = '×';
    closeBtn.className = 'mxm-close-btn';
    closeBtn.style.cssText = `
      position: absolute;
      top: 4px;
      right: 8px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      color: ${WIDGET_TEXT_COLOR};
    `;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      widget.remove();
    });
    widget.appendChild(closeBtn);

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="mxm-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;font-size:12px;font-weight:600;">
        <span>Mission earnings</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <img class="mxm-currency-flag" src="${CURRENCIES[settings.currency].flag}" style="width:18px;height:12px;border-radius:2px;box-shadow:0 0 3px rgba(0,0,0,0.4);">
          <select class="mxm-currency-select" style="background:transparent;border:1px solid #666;border-radius:4px;color:${WIDGET_TEXT_COLOR};font-size:11px;padding:1px 4px;outline:none;">
            ${SUPPORTED_CURRENCIES.map(
              (c) => `<option value="${c}">${c}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="mxm-compact-body" style="display:none;align-items:center;justify-content:space-between;gap:10px;font-size:12px;">
        <span class="mxm-compact-label" style="opacity:0.85;">Today</span>
        <span class="mxm-compact-amount" style="font-weight:700;"></span>
      </div>

      <div class="mxm-full-body" style="display:block;margin-top:4px;">
        <div style="font-size:13px;margin-bottom:4px;">
          <span style="opacity:0.9;">Today:</span>
          <span class="mxm-today-amount" style="font-weight:700;"></span>
        </div>
        <div style="font-size:11px;display:flex;flex-direction:column;gap:1px;opacity:0.9;">
          <div><span style="opacity:0.85;">Week:</span> <span class="mxm-week-amount"></span></div>
          <div><span style="opacity:0.85;">Month:</span> <span class="mxm-month-amount"></span></div>
        </div>
        <div style="font-size:10px;margin-top:5px;opacity:0.8;" class="mxm-footer-line"></div>
      </div>
    `;
    widget.appendChild(container);

    document.body.appendChild(widget);

    const currencySelect = widget.querySelector('.mxm-currency-select');
    currencySelect.value = settings.currency;
    currencySelect.addEventListener('click', (e) => e.stopPropagation());
    currencySelect.addEventListener('change', (e) => {
      settings.currency = e.target.value;
      saveSettings(settings);
      const flagImg = widget.querySelector('.mxm-currency-flag');
      flagImg.src = CURRENCIES[settings.currency].flag;
    });

    widget.addEventListener('click', (e) => {
      if (e.target.closest('.mxm-close-btn') || e.target.closest('.mxm-currency-select')) {
        return;
      }
      settings.mode = settings.mode === 'full' ? 'compact' : 'full';
      saveSettings(settings);
      applyMode(widget);
    });

    makeDraggable(widget);
    applyMode(widget);

    return widget;
  }

  function updateWidget() {
    try {
      if (!window.location.href.includes('/tasks')) {
        const existing = document.getElementById(TOTAL_WIDGET_ID);
        if (existing) existing.remove();
        return;
      }

      const now = new Date();
      stats = ensureStats(stats, now);

      const { totalUSD, totalUSDNumber, count, rate } = calculateGlobalTotal();

      // Calculate incremental delta for this update
      const previous = stats.lastSnapshot || { totalUSD: 0, count: 0 };
      let deltaUSD = 0;

      if (
        totalUSDNumber >= previous.totalUSD &&
        count >= previous.count
      ) {
        deltaUSD = totalUSDNumber - previous.totalUSD;
      } else {
        // Probably navigated to a different mission or the page changed.
        // Do not add delta, just reset snapshot baseline.
        deltaUSD = 0;
      }

      if (deltaUSD > 0) {
        stats.day.totalUSD += deltaUSD;
        stats.week.totalUSD += deltaUSD;
        stats.month.totalUSD += deltaUSD;
      }

      stats.lastSnapshot = { totalUSD: totalUSDNumber, count };
      saveStats(stats);

      const isGoalAchieved = totalUSDNumber >= 50.0;
      const borderStyle = isGoalAchieved
        ? `border: 3px solid ${BORDER_COLOR_SUCCESS};`
        : `border: 3px solid ${BORDER_COLOR_PENDING};`;

      let widget = document.getElementById(TOTAL_WIDGET_ID);

      if (!widget || !document.body.contains(widget)) {
        if (widget) widget.remove();
        widget = createWidget(borderStyle);
      } else {
        widget.style.setProperty(
          'border',
          isGoalAchieved
            ? `3px solid ${BORDER_COLOR_SUCCESS}`
            : `3px solid ${BORDER_COLOR_PENDING}`
        );
      }

      const currency = settings.currency;
      const cfg = CURRENCIES[currency];

      const todayConverted = convertFromUSD(stats.day.totalUSD, currency);
      const weekConverted = convertFromUSD(stats.week.totalUSD, currency);
      const monthConverted = convertFromUSD(stats.month.totalUSD, currency);

      const todayElement = widget.querySelector('.mxm-today-amount');
      const weekElement = widget.querySelector('.mxm-week-amount');
      const monthElement = widget.querySelector('.mxm-month-amount');
      const footerLine = widget.querySelector('.mxm-footer-line');
      const compactAmount = widget.querySelector('.mxm-compact-amount');
      const currencyFlag = widget.querySelector('.mxm-currency-flag');

      if (todayElement) {
        todayElement.textContent = formatCurrency(todayConverted, currency);
      }
      if (compactAmount) {
        compactAmount.textContent = formatCurrency(todayConverted, currency);
      }
      if (weekElement) {
        weekElement.textContent = formatCurrency(weekConverted, currency);
      }
      if (monthElement) {
        monthElement.textContent = formatCurrency(monthConverted, currency);
      }
      if (footerLine) {
        footerLine.textContent = `On-page total: $${totalUSD} USD · ${count} tasks · Rate: $${rate.toFixed(
          2
        )} USD`;
      }
      if (currencyFlag) {
        currencyFlag.src = cfg.flag;
      }
    } catch (e) {
      console.error('[MXM Mission Tracker] Fatal error in updateWidget:', e);
    }
  }

  // ------ Init ------

  try {
    setTimeout(() => {
      updateWidget();
      setInterval(updateWidget, 2000);
    }, 1000);
  } catch (e) {
    console.error('[MXM Mission Tracker] Error starting timers:', e);
  }
})();
