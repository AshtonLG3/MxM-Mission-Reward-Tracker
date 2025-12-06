// ==UserScript==
// @name         MxM Mission Reward Tracker (v6.9.8 Safe)
// @namespace    mxm-tools
// @version      6.9.8
// @description  Safe DOM Tracker: Burst-Proof + Human-Speed Enforcement + Daily Sync
// @author       Richard Mangezi Muketa
// @match        https://curators.musixmatch.com/*
// @match        https://curators-beta.musixmatch.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  console.log("[MXM Tracker v6.9.8] Loaded (Safe DOM Counting)");

  // -----------------------------
  // CONFIG
  // -----------------------------
  const HUMAN_MIN_INTERVAL = 8000;   // 8 sec = impossible human submission speed
  const DOM_DEBOUNCE_MS = 150;       // prevents burst-counting
  let debounceTimer = null;

  const STATS_KEY = "mxmStats_698";

  function nowTs() {
    return Date.now();
  }

  // -----------------------------
  // LOAD / SAVE STORAGE
  // -----------------------------
  function loadStats() {
    const raw = localStorage.getItem(STATS_KEY);
    let s = null;

    try { s = JSON.parse(raw); } catch (e) {}

    const today = new Date().toLocaleDateString("en-CA");
    const weekStart = getWeekStartId();

    if (!s || !s.dayId || !s.weekId) {
      s = {
        dayId: today,
        weekId: weekStart,
        day: 0,
        week: 0,
        lastTs: 0
      };
    }

    // Reset day
    if (s.dayId !== today) {
      s.dayId = today;
      s.day = 0;
    }

    // Reset week
    if (s.weekId !== weekStart) {
      s.weekId = weekStart;
      s.week = 0;
    }

    return s;
  }

  function saveStats(s) {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  }

  function getWeekStartId() {
    const d = new Date();
    const day = d.getDay();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d.toLocaleDateString("en-CA");
  }

  // -----------------------------
  // SAFE SUBMISSION HANDLER
  // -----------------------------
  function safeAttemptCount() {
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      const s = loadStats();
      const ts = nowTs();

      // Human-speed enforcement
      if (ts - s.lastTs < HUMAN_MIN_INTERVAL) {
        console.warn("⛔ Ignored submission: Too fast to be human.");
        return;
      }

      // VALID submission
      s.day += 1;
      s.week += 1;
      s.lastTs = ts;
      saveStats(s);
      updateUI(s);

      console.log("✅ Counted task. Day =", s.day, "Week =", s.week);
    }, DOM_DEBOUNCE_MS);
  }

  // -----------------------------
  // DOM OBSERVER (Triggers safeAttemptCount)
  // -----------------------------
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (!m.addedNodes) continue;

      // Look for the "Done" or "Thank you" panel indicating submission completed
      if ([...m.addedNodes].some(n => isSubmissionNode(n))) {
        safeAttemptCount();
      }
    }
  });

  function isSubmissionNode(node) {
    if (!node || !node.textContent) return false;
    const txt = node.textContent.toLowerCase();

    return txt.includes("done") ||
           txt.includes("thank") ||
           txt.includes("completed") ||
           txt.includes("success") ||
           txt.includes("good job") ||
           txt.includes("next task");
  }

  observer.observe(document.body, { childList: true, subtree: true });

  // -----------------------------
  // UI
  // -----------------------------
  function updateUI(stats) {
    const el = document.getElementById("mxm-tracker-box");
    if (!el) return;

    el.querySelector("#mxm-day").textContent = stats.day;
    el.querySelector("#mxm-week").textContent = stats.week;
  }

  function createUI() {
    if (document.getElementById("mxm-tracker-box")) return;

    const box = document.createElement("div");
    box.id = "mxm-tracker-box";
    box.style = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: #111827;
      padding: 10px 14px;
      border-radius: 8px;
      color: white;
      font-family: system-ui;
      z-index: 9999999;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    `;

    box.innerHTML = `
      <div style="font-size:12px; opacity:0.65;">MXM Tracker v6.9.8</div>
      <div style="margin-top:6px;">
        <div><b>Today:</b> <span id="mxm-day">0</span></div>
        <div><b>Week:</b> <span id="mxm-week">0</span></div>
      </div>
    `;

    document.body.appendChild(box);
    updateUI(loadStats());
  }

  // Wait until DOM ready for UI creation
  const uiInterval = setInterval(() => {
    if (document.body) {
      clearInterval(uiInterval);
      createUI();
    }
  }, 300);

})();
