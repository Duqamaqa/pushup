// Daily Exercise Counter — Multiple Exercises
// Persist list in localStorage under key "exerciseList".
// Each exercise shape:
// {
//   id: string (uuid),
//   exerciseName: string,
//   dailyTarget: number,
//   decrementStep: number,
//   remaining: number,
//   lastAppliedDate: "YYYY-MM-DD"
// }
// Performance checklist:
// - Lazy Chart.js load on demand (history modal)
// - Debounced saves for hot paths
// - Memoized streaks per day; invalidate on changes
// - Prune history > HISTORY_MAX_DAYS
// - Minimal DOM updates for quick/custom actions
// - SW caches v4 handles runtime SWR for Chart.js

(function () {
  'use strict';

  // Small query helpers
  const $ = (sel) => document.querySelector(sel);
  const qs = (root, sel) => (root && root.querySelector) ? root.querySelector(sel) : null;

  const LIST_KEY = 'exerciseList';
  const HISTORY_MAX_DAYS = 366;
  const ACC_KEY = 'settingsAccordionOpen';
  // Optional Supabase (configured via Settings)
  const SUPABASE_URL = '';
  const SUPABASE_ANON = '';
  const EX_TEMPLATES = [
    { name:'Push-ups', unit:'reps', daily:50, steps:[10,20] },
    { name:'Squats',   unit:'reps', daily:60, steps:[10,20] },
    { name:'Plank',    unit:'min',  daily:5,  steps:[1] },
    { name:'Running',  unit:'km',   daily:3,  steps:[1] },
  ];

  // Daily quotes/tips (stable per day)
  const QUOTES = [
    'Small steps add up. Keep going.',
    'Form first, speed second.',
    'Consistency beats intensity.',
    'Hydrate and breathe between sets.',
    'Perfect is the enemy of done.',
    'You only improve what you track.',
    'A little today beats a lot someday.',
    'Warm up. Cool down. Recover well.',
    'Focus on quality reps.',
    'Set the next micro‑goal now.',
    'Show up, even for five minutes.',
    'Don’t break the chain today.',
    'Your future self thanks you.',
    'Make it easy to start.',
    'Celebrate small wins.',
    'Just one more small push.',
    'Start light and progress steadily.',
    'Stack habits: pair with a routine.',
  ];

  function dailyQuote(seedStr) { // stable per day
    const s = (String(seedStr || '') + todayStrUTC())
      .split('')
      .reduce((a, c) => a + c.charCodeAt(0), 0);
    return QUOTES[s % QUOTES.length];
  }

  // Achievements definitions
  const ACHIEVEMENTS = [
    { id: 'first_day', title: 'First Day', rule: (ex) => getLifetimeDone(ex) >= 1 },
    { id: 'week100', title: 'Century Week', rule: (ex) => sumLastNDone(ex, 7) >= 100 },
    { id: 'streak3', title: '3-Day Streak', rule: (ex) => getStreak(ex) >= 3 },
    { id: 'streak7', title: '7-Day Streak', rule: (ex) => getStreak(ex) >= 7 },
    { id: 'total500', title: 'Total 500', rule: (ex) => getLifetimeDone(ex) >= 500 },
    { id: 'goal100', title: 'Perfect Days ×3', rule: (ex) => countPerfectDays(ex) >= 3 },
  ];

  function ensureBadges(ex){ if (!Array.isArray(ex.badges)) ex.badges = []; return ex.badges; }
  function getAchievementTitle(id){ const a = ACHIEVEMENTS.find(x => x.id === id); return a ? a.title : id; }
  function sumLastNDone(ex, n){ const days = getRecentDays(n); let s = 0; for (const d of days) s += Number(ex.history?.[d]?.done || 0); return s; }
  function getLifetimeDone(ex){ let s = 0; if (ex?.history) { for (const k in ex.history){ s += Number(ex.history[k]?.done || 0); } } return s; }
  function countPerfectDays(ex){ let c = 0; if (ex?.history){ for (const k in ex.history){ const ent = ex.history[k] || {}; const p = Number(ent.planned||0); const d = Number(ent.done||0); if (p>0 && d>=p) c++; } } return c; }
  function checkAchievements(ex){
    ensureBadges(ex);
    let awarded = false;
    for (const a of ACHIEVEMENTS){
      try {
        if (!ex.badges.includes(a.id) && a.rule(ex)) { ex.badges.push(a.id); awarded = true; }
      } catch {}
    }
    return awarded;
  }

  // Debounced saver for hot paths
  const saveDebounced = (() => { let t; return (fn) => { clearTimeout(t); t = setTimeout(fn, 120); }; })();

  // Minimal text update helper
  function setText(el, value) { if (el && el.textContent !== String(value)) el.textContent = String(value); }

  // Streak memoization (keyed by exercise id + today)
  const streakCache = new Map();
  const longestStreakCache = new Map();
  function invalidateStreak(exId) {
    try { streakCache.delete(`${exId}:${todayStrUTC()}`); } catch {}
    try { longestStreakCache.delete(exId); } catch {}
  }

  // Settings accordion state
  function setAccOpen(key) { try { localStorage.setItem(ACC_KEY, key); } catch {} }
  function getAccOpen() { try { return localStorage.getItem(ACC_KEY) || ''; } catch { return ''; } }

  // Lazy Chart.js loader
  let __chartJsReady = null;
  function loadChartJs() {
    if (__chartJsReady) return __chartJsReady;
    __chartJsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return __chartJsReady;
  }

  // ---------- Helpers: storage & date ----------
  function loadExercises() {
    try {
      const raw = localStorage.getItem(LIST_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.warn('Failed to load exercises, using empty list:', e);
      return [];
    }
  }

  // --- Debug utilities ---
  function updateStorageSize() {
    try {
      const data = JSON.stringify(loadExercises() || []);
      const bytes = new Blob([data]).size;
      const el = document.querySelector('#storageSize');
      if (el) el.textContent = `Storage: ${(bytes / 1024).toFixed(1)} KB`;
    } catch {}
  }

  async function updateCacheSize() {
    try {
      if (!('caches' in window)) return;
      const keys = await caches.keys();
      let total = 0;
      for (const k of keys) {
        const cache = await caches.open(k);
        const reqs = await cache.keys();
        for (const r of reqs) {
          const res = await cache.match(r);
          if (res) {
            const buf = await res.clone().arrayBuffer();
            total += buf.byteLength;
          }
        }
      }
      const el = document.querySelector('#cacheSize');
      if (el) el.textContent = `Cache: ${(total / 1024).toFixed(1)} KB`;
    } catch {}
  }

  function saveExercises(list) {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
      try { updateStorageSize(); } catch {}
    } catch (e) {
      console.error('Failed to save exercises:', e);
    }
  }

  function todayStrUTC() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function daysBetweenUTC(a, b) {
    if (!a || !b) return 0;
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    const aDate = Date.UTC(ay, (am || 1) - 1, ad || 1);
    const bDate = Date.UTC(by, (bm || 1) - 1, bd || 1);
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    return Math.floor((bDate - aDate) / MS_PER_DAY);
  }

  // History helpers
  function ensureHistory(ex, dateStr) {
    if (!ex.history) ex.history = {};
    if (!ex.history[dateStr]) ex.history[dateStr] = { planned: 0, done: 0 };
    return ex.history[dateStr];
  }

  function addPlanned(ex, dateStr, amount) {
    const entry = ensureHistory(ex, dateStr);
    entry.planned = Number(entry.planned || 0) + Math.max(0, Number(amount || 0));
  }

  function addDone(ex, dateStr, amount) {
    const entry = ensureHistory(ex, dateStr);
    entry.done = Number(entry.done || 0) + Math.max(0, Number(amount || 0));
  }

  function pruneHistory(exercise) {
    if (!exercise.history) return;
    const cutoff = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - HISTORY_MAX_DAYS);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();
    for (const k of Object.keys(exercise.history)) {
      if (k < cutoff) delete exercise.history[k];
    }
  }

  function getRecentDays(n) {
    const out = [];
    const d = new Date();
    for (let i = 0; i < n; i++) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      out.unshift(`${y}-${m}-${day}`);
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return out;
  }

  function lastSundayStr() {
    const d = new Date();
    const day = d.getUTCDay(); // 0=Sunday
    const diff = d.getUTCDate() - day;
    d.setUTCDate(diff);
    return d.toISOString().slice(0,10);
  }

  function getCompletionForDate(ex, dateStr) {
    const entry = (ex.history && ex.history[dateStr]) || { planned: 0, done: 0 };
    const planned = Number(entry.planned || 0);
    const done = Number(entry.done || 0);
    const threshold = Math.min(1, Math.max(0.5, Number(ex.completionThreshold ?? 1.0)));
    const completed = planned > 0 && done >= planned * threshold;
    return { planned, done, completed };
  }

  function getStreak(ex) {
    const days = getRecentDays(365); // look back up to a year
    const key = `${ex.id}:${todayStrUTC()}`;
    if (streakCache.has(key)) return streakCache.get(key);
    let count = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const { completed } = getCompletionForDate(ex, days[i]);
      if (completed) count++; else break;
    }
    streakCache.set(key, count);
    return count;
  }

  // Personal bests
  function maxDayDone(ex) {
    let bestDate = null;
    let best = 0;
    if (ex && ex.history) {
      for (const k in ex.history) {
        const v = Number(ex.history[k]?.done || 0);
        if (v > best) { best = v; bestDate = k; }
      }
    }
    return { date: bestDate || '—', value: best };
  }

  function longestStreak(ex) {
    if (!ex || !ex.history) return 0;
    if (longestStreakCache.has(ex.id)) return longestStreakCache.get(ex.id);
    const keys = Object.keys(ex.history).sort(); // YYYY-MM-DD lex sort is chronological
    let best = 0, cur = 0, prev = null;
    for (const k of keys) {
      const { completed } = getCompletionForDate(ex, k);
      if (prev) {
        const gap = daysBetweenUTC(prev, k);
        if (gap === 1) {
          cur = completed ? (cur + 1) : 0;
        } else {
          cur = completed ? 1 : 0;
        }
      } else {
        cur = completed ? 1 : 0;
      }
      if (cur > best) best = cur;
      prev = k;
    }
    longestStreakCache.set(ex.id, best);
    return best;
  }

  function applyDailyRollover(exercise) {
    const today = todayStrUTC();
    const last = exercise.lastAppliedDate;
    const daysPassed = daysBetweenUTC(last, today);
    if (daysPassed > 0) {
      // Add planned for each missed day including today
      const baseParts = last ? last.split('-').map(Number) : null;
      const baseDate = baseParts ? new Date(Date.UTC(baseParts[0], (baseParts[1] || 1) - 1, baseParts[2] || 1)) : new Date();
      const daily = Number(exercise.dailyTarget || 0);
      for (let i = 1; i <= daysPassed; i++) {
        const d = new Date(baseDate);
        d.setUTCDate(d.getUTCDate() + i);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        addPlanned(exercise, `${y}-${m}-${day}`, daily);
      }
      exercise.remaining = Number(exercise.remaining || 0) + daily * daysPassed;
      exercise.lastAppliedDate = today;
      // Reset per-day confetti trigger flag
      try { exercise._confettiDoneForToday = null; } catch {}
      pruneHistory(exercise);
      invalidateStreak(exercise.id);
      return true; // changed
    }
    return false;
  }

  function uuid() {
    try { return crypto.randomUUID(); } catch { /* ignore */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Toast helper
  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  // === URL Quick Actions ===
  function handleURLQuickAction() {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    if (![...params.keys()].length) return;

    const decStr = params.get('dec');
    const addStr = params.get('add');
    const exName = params.get('exercise');

    const multi = typeof loadExercises === 'function';
    const clamp0 = (n) => Math.max(0, n|0);

    const actOn = (applyFn) => {
      if (multi) {
        let list = loadExercises() || [];
        if (!list.length) return;
        let idx = 0;
        if (exName) {
          const toSlug = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, '-');
          const needleRaw = exName;
          const needle = needleRaw.trim();
          // 1) exact case-insensitive match (trimmed)
          let i = list.findIndex(e => ((e.exerciseName || '').toLowerCase().trim() === needle.toLowerCase()));
          // 2) slug compare if not found
          if (i < 0) {
            const nSlug = toSlug(needleRaw);
            i = list.findIndex(e => toSlug(e.exerciseName) === nSlug);
          }
          // 3) fallback to first exercise
          if (i >= 0) idx = i;
        }
        const ex = list[idx];
        applyDailyRollover(ex);
        applyFn(ex);
        ex.remaining = clamp0(ex.remaining);
        saveExercises(list);
        renderDashboard();
      } else {
        let s = loadState && loadState();
        if (!s) return;
        applyDailyRollover(s);
        applyFn(s);
        s.remaining = clamp0(s.remaining);
        saveState(s);
        showDashboard();
      }
    };

    let toastMsg = null;
    if (decStr) {
      const dec = Math.max(1, parseInt(decStr, 10) || 0);
      actOn((s) => { s.remaining -= dec; addDone(s, todayStrUTC(), dec); checkAchievements(s); });
      toastMsg = `Logged −${dec}`;
    } else if (addStr) {
      const times = Math.max(1, parseInt(addStr, 10) || 0);
      actOn((s) => { const inc = (Number(s.dailyTarget || 0) * times); s.remaining += inc; addPlanned(s, todayStrUTC(), inc); checkAchievements(s); });
      toastMsg = `Added +${times}× target`;
    }

    if (toastMsg) showToast(toastMsg);

    // If this was a decrement (i.e., logging reps), push weekly total
    try {
      if (decStr) {
        const cfg = getLbConfig?.();
        if (cfg && cfg.name && cfg.url && cfg.key) {
          upsertScore(cfg.name, computeWeeklyTotalAll());
        }
      }
    } catch {}

    // strip query so action won't repeat on refresh/back
    window.history.replaceState(null, '', url.pathname);

    // If running as a PWA in standalone mode, auto-close after a short delay
    if (toastMsg && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      setTimeout(() => window.close(), 700);
    }
  }

  // ---------- Elements ----------
  const el = {
    list: document.getElementById('exerciseListContainer'),
    // Setup/Add/Edit Modal
    modal: document.getElementById('setup-view'),
    modalTitle: document.getElementById('modal-title'),
    name: document.getElementById('exerciseName'),
    daily: document.getElementById('dailyTarget'),
    step: document.getElementById('decrementStep'),
    streakThreshold: document.getElementById('streakThreshold'),
    quickStepsInput: document.getElementById('quickStepsInput'),
    weeklyGoalInput: document.getElementById('weeklyGoalInput'),
    unitSel: document.getElementById('unitSel'),
    templateRow: document.getElementById('templateRow'),
    errName: document.getElementById('exerciseNameError'),
    errDaily: document.getElementById('dailyTargetError'),
    errStep: document.getElementById('decrementStepError'),
    saveBtn: document.getElementById('saveExerciseBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    // History modal
    historyModal: document.getElementById('historyModal'),
    historyTitle: document.getElementById('historyTitle'),
    historyStats: document.getElementById('historyStats'),
    historyList: document.getElementById('historyList'),
    historyChart: document.getElementById('historyChart'),
    closeHistory: document.getElementById('closeHistory'),
  };
  // Weekly Summary modal elements
  const weeklyModal = document.getElementById('weeklyModal');
  const closeWeekly = document.getElementById('closeWeekly');
  const weeklyStats = document.getElementById('weeklyStats');
  const weeklyChartEl = document.getElementById('weeklyChart');
  const sparkTooltip = document.getElementById('sparkTooltip');
  const HISTORY_TAB_KEY = 'historyTab';
  const shareCardBtn = document.getElementById('shareCardBtn');
  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardList = document.getElementById('leaderboardList');

  async function renderHistoryChart(mode, ex) {
    if (window.__historyChart) {
      try { window.__historyChart.destroy(); } catch {}
      window.__historyChart = null;
    }
    try { await loadChartJs(); } catch {}
    const ctx = el.historyChart?.getContext('2d');
    if (!ctx || !window.Chart) return;
    const cs = getComputedStyle(document.documentElement);
    const fg = (cs.getPropertyValue('--fg') || '#111').trim();
    const grid = (cs.getPropertyValue('--border') || '#ddd').trim();

    if (mode === 'trends') {
      const days = getRecentDays(30);
      const done = days.map(d => Number((ex.history?.[d]?.done) || 0));
      const planned = days.map(d => Number((ex.history?.[d]?.planned) || 0));
      window.__historyChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: days,
          datasets: [
            { label: 'Done', data: done, backgroundColor: 'rgba(16, 185, 129, 0.6)', borderColor: 'rgba(16, 185, 129, 1)', borderWidth: 1 },
            { label: 'Planned', data: planned, backgroundColor: 'rgba(59, 130, 246, 0.35)', borderColor: 'rgba(59, 130, 246, 1)', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { ticks: { color: fg }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: fg }, grid: { color: grid } } },
          plugins: { legend: { position: 'top', labels: { color: fg } } }
        }
      });
    } else {
      const days = getRecentDays(14);
      const planned = days.map(d => Number((ex.history?.[d]?.planned) || 0));
      const done = days.map(d => Number((ex.history?.[d]?.done) || 0));
      window.__historyChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: days,
          datasets: [
            { label: 'Planned', data: planned, backgroundColor: 'rgba(59, 130, 246, 0.5)', borderColor: 'rgba(59, 130, 246, 1)', borderWidth: 1 },
            { label: 'Done', data: done, backgroundColor: 'rgba(16, 185, 129, 0.5)', borderColor: 'rgba(16, 185, 129, 1)', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { ticks: { color: fg }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: fg }, grid: { color: grid } } },
          plugins: { legend: { position: 'top', labels: { color: fg } } }
        }
      });
    }
  }

  // --- Shareable Progress Card ---
  function renderShareCard(ex) {
    try {
      const unit = ex.unit || 'reps';
      const days7 = getRecentDays(7); // oldest -> newest
      const doneArr = days7.map(d => Number(ex.history?.[d]?.done || 0));
      const total7 = doneArr.reduce((a,b)=>a+b,0);
      const streakNow = getStreak(ex);
      const dateRange = `${days7[0]} – ${days7[days7.length-1]}`;

      const cs = getComputedStyle(document.documentElement);
      const fg = (cs.getPropertyValue('--fg') || '#111').trim();
      const bg = (cs.getPropertyValue('--card') || '#fff').trim();
      const muted = (cs.getPropertyValue('--muted') || '#888').trim();
      const accent = (cs.getPropertyValue('--accent') || '#4c8dff').trim();

      const W = 1080, H = 1080;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Background
      ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

      // Title
      ctx.fillStyle = fg;
      ctx.font = 'bold 72px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
      ctx.textAlign = 'left';
      ctx.fillText(ex.exerciseName || 'Exercise', 80, 150);

      // Totals and streak
      ctx.font = '600 40px Inter, system-ui, -apple-system';
      ctx.fillStyle = muted; ctx.fillText('Last 7 Days', 80, 210);
      ctx.fillStyle = fg; ctx.font = '800 90px Inter, system-ui, -apple-system';
      ctx.fillText(`${total7} ${unit}`, 80, 300);
      ctx.fillStyle = muted; ctx.font = '600 40px Inter, system-ui, -apple-system';
      ctx.fillText('Current Streak', 80, 360);
      ctx.fillStyle = fg; ctx.font = '800 72px Inter, system-ui, -apple-system';
      ctx.fillText(`${streakNow} day${streakNow===1?'':'s'}`, 80, 430);

      // Simple 7-day bar chart
      const chartX = 80, chartY = 520, chartW = W - 160, chartH = 420;
      const barGap = 24;
      const n = doneArr.length;
      const barW = (chartW - barGap * (n - 1)) / n;
      const maxVal = Math.max(1, ...doneArr);
      // axes baseline
      ctx.fillStyle = 'transparent';
      ctx.strokeStyle = muted; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(chartX, chartY + chartH); ctx.lineTo(chartX + chartW, chartY + chartH); ctx.stroke();
      // bars
      for (let i = 0; i < n; i++) {
        const v = doneArr[i];
        const h = Math.round((v / maxVal) * (chartH - 20));
        const x = chartX + i * (barW + barGap);
        const y = chartY + chartH - h;
        // bar background
        ctx.fillStyle = 'rgba(127,127,127,0.12)';
        ctx.fillRect(x, chartY + 20, barW, chartH - 20);
        // bar fill
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, barW, h);
      }
      // day labels (last 2 chars of date, or weekday initial)
      ctx.fillStyle = muted; ctx.font = 'bold 28px Inter, system-ui'; ctx.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        const label = days7[i].slice(5); // MM-DD
        const x = chartX + i * (barW + barGap) + barW/2;
        ctx.fillText(label, x, chartY + chartH + 40);
      }

      // Date range footer
      ctx.fillStyle = muted; ctx.font = '600 34px Inter, system-ui'; ctx.textAlign = 'left';
      ctx.fillText(dateRange, 80, H - 80);

      // Export
      const url = canvas.toDataURL('image/png');
      const fileName = `Progress-${(ex.exerciseName||'Exercise').replace(/\s+/g,'_')}-${todayStrUTC()}.png`;
      const a = document.createElement('a'); a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      // Fallback open new tab
      try { window.open(url, '_blank'); } catch {}
    } catch (e) {
      console.error('Share card render failed:', e);
      showToast('Could not create image');
    }
  }

  // --- Leaderboard helpers ---
  function getLbConfig() {
    try {
      const name = localStorage.getItem('lbName') || '';
      const url = (localStorage.getItem('lbUrl') || SUPABASE_URL || '').trim();
      const key = (localStorage.getItem('lbKey') || SUPABASE_ANON || '').trim();
      return { name, url, key };
    } catch { return { name:'', url: SUPABASE_URL || '', key: SUPABASE_ANON || '' }; }
  }
  function supaConfigured() {
    const { url, key, name } = getLbConfig();
    return !!(url && key && name);
  }
  function computeWeeklyTotalAll() {
    const items = loadExercises() || [];
    let total = 0;
    items.forEach(ex => { total += sumLast7Done(ex); });
    return total;
  }
  async function upsertScore(name, total) {
    const { url, key } = getLbConfig();
    if (!url || !key) return;
    const body = [{ name, total, week: lastSundayStr() }];
    try {
      await fetch(`${url}/rest/v1/leaderboard`, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.warn('upsertScore failed', e);
    }
  }
  async function loadLeaderboard() {
    const { url, key } = getLbConfig();
    if (!url || !key) return [];
    const week = lastSundayStr();
    try {
      const resp = await fetch(`${url}/rest/v1/leaderboard?select=*&week=eq.${week}&order=total.desc&limit=10`, {
        headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
      });
      if (!resp.ok) return [];
      return await resp.json();
    } catch (e) {
      console.warn('loadLeaderboard failed', e);
      return [];
    }
  }

  let editingId = null; // null => adding new

  function openModal(mode, exercise) {
    editingId = exercise ? exercise.id : null;
    el.modalTitle.textContent = mode === 'edit' ? 'Edit Exercise' : 'Add Exercise';
    // Templates: only show for Add mode
    if (el.templateRow) {
      el.templateRow.innerHTML = '';
      el.templateRow.hidden = mode !== 'add';
      if (mode === 'add') {
        const fillFrom = (tpl) => {
          el.name.value = tpl?.name || '';
          el.daily.value = tpl?.daily != null ? String(tpl.daily) : '';
          if (el.unitSel) el.unitSel.value = tpl?.unit || 'reps';
          if (el.quickStepsInput) el.quickStepsInput.value = Array.isArray(tpl?.steps) ? tpl.steps.join(',') : '';
          clearErrors();
        };
        EX_TEMPLATES.forEach((tpl) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tpl-btn';
          b.textContent = tpl.name;
          b.addEventListener('click', () => fillFrom(tpl));
          el.templateRow.appendChild(b);
        });
        const custom = document.createElement('button');
        custom.type = 'button';
        custom.className = 'tpl-btn';
        custom.textContent = 'Custom';
        custom.addEventListener('click', () => fillFrom(null));
        el.templateRow.appendChild(custom);
      }
    }
    el.name.value = exercise ? exercise.exerciseName : '';
    el.daily.value = exercise ? String(exercise.dailyTarget) : '';
    el.step.value = exercise ? String(exercise.decrementStep) : '';
    if (el.streakThreshold) {
      const thr = exercise ? (Number(exercise.completionThreshold ?? 1.0)) : 1.0;
      el.streakThreshold.value = String(Math.min(1, Math.max(0.5, Number.isFinite(thr) ? thr : 1.0)));
    }
    if (el.unitSel) {
      el.unitSel.value = (exercise && exercise.unit) ? exercise.unit : 'reps';
    }
    if (el.quickStepsInput) {
      const qs = Array.isArray(exercise?.quickSteps) ? exercise.quickSteps : [];
      el.quickStepsInput.value = qs.length ? qs.join(',') : '';
    }
    if (el.weeklyGoalInput) {
      const autoGoal = Math.max(0, Number(exercise ? (exercise.dailyTarget || 0) * 7 : 0));
      const wg = exercise ? Number(exercise.weeklyGoal || autoGoal) : '';
      el.weeklyGoalInput.value = exercise ? String(wg) : '';
    }
    clearErrors();
    el.modal.hidden = false;
    try { document.body.classList.add('no-scroll'); } catch {}
    try { el.modal.querySelector('.modal-card')?.scrollTo({ top: 0, behavior: 'instant' }); } catch {}
    try {
      const mc = el.modal.querySelector('.modal-card');
      const firstInput = mc?.querySelector('input, select, textarea, button');
      firstInput?.focus({ preventScroll: true });
    } catch {}
    // Ensure inputs scroll into view on focus (iOS)
    (function enhanceInputFocus(){
      const m = el.modal;
      if (!m || m.dataset.focusWired === '1') return;
      const mc = m.querySelector('.modal-card');
      m.querySelectorAll('input,select,textarea').forEach((node)=>{
        node.addEventListener('focus', ()=>{
          setTimeout(()=> { try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {} }, 100);
        });
      });
      m.dataset.focusWired = '1';
    })();
  }

  function closeModal() {
    el.modal.hidden = true;
    try { document.body.classList.remove('no-scroll'); } catch {}
    editingId = null;
    el.name.value = '';
    el.daily.value = '';
    el.step.value = '';
    if (el.streakThreshold) el.streakThreshold.value = '';
    if (el.quickStepsInput) el.quickStepsInput.value = '';
    if (el.weeklyGoalInput) el.weeklyGoalInput.value = '';
    if (el.unitSel) el.unitSel.value = 'reps';
    clearErrors();
  }

  // --- Add/Edit Modal helpers (wrappers) ---
  function openAddEditModal() {
    // Default to Add mode when invoked generically
    openModal('add');
  }
  function closeAddEditModal() {
    closeModal();
  }

  function setInvalid(input, errEl, invalid) {
    const container = input.closest('.field');
    if (invalid) {
      container?.classList.add('invalid');
      errEl?.removeAttribute('hidden');
    } else {
      container?.classList.remove('invalid');
      errEl?.setAttribute('hidden', '');
    }
  }

  function clearErrors() {
    setInvalid(el.name, el.errName, false);
    setInvalid(el.daily, el.errDaily, false);
    setInvalid(el.step, el.errStep, false);
  }

  // ---------- Rendering ----------
  function renderDashboard() {
    const list = loadExercises() || [];
    // Root dashboard/list container
    const dash = el.list || document.getElementById('exerciseListContainer');
    if (!dash) return;
    dash.innerHTML = '';

    // First-time onboarding view
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'onboarding';
      empty.innerHTML = `
        <h2>Welcome 👋</h2>
        <p>You don’t have any exercises yet.</p>
        <button id="addFirstExerciseBtn" class="btn primary big">Add New Exercise</button>
      `;
      dash.appendChild(empty);
      document.getElementById('addFirstExerciseBtn')?.addEventListener('click', () => {
        try { openAddEditModal(); } catch {}
      });
      return; // stop here
    }

    const containerFrag = document.createDocumentFragment();

    list.forEach((ex) => {
      // defaults for new fields
      if (ex.completionThreshold == null) ex.completionThreshold = 1.0;
      if (!ex.history) ex.history = {};
      if (!ex.unit) ex.unit = 'reps';
      ensureWeeklyGoal(ex);

      // Compute today's stats
      const today = todayStrUTC();
      const entry = (ex.history && ex.history[today]) || { planned: 0, done: 0 };
      const planned = Number(entry.planned || 0);
      const done = Number(entry.done || 0);
      const leftToday = Math.max(0, planned - done);
      const pct = planned > 0 ? Math.min(1, done / planned) : 0;

      const card = document.createElement('div');
      card.className = 'ex-card';
      card.dataset.id = ex.id;

      // Header
      const header = document.createElement('div');
      header.className = 'ex-header';
      const h3 = document.createElement('h3');
      h3.className = 'ex-title';
      setText(h3, ex.exerciseName || 'Exercise');
      // Optional PB pill
      const pbMeta = maxDayDone(ex);
      if (pbMeta.value > 0) {
        const pbPill = document.createElement('span');
        pbPill.className = 'pill ex-pb-pill';
        pbPill.textContent = `PB ${pbMeta.value}`;
        h3.appendChild(document.createTextNode(' '));
        h3.appendChild(pbPill);
      }
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn ex-edit';
      editBtn.title = 'Edit';
      editBtn.setAttribute('aria-label', 'Edit');
      editBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11Zm14.71-9.46a1 1 0 0 0 0-1.41l-1.59-1.59a1 1 0 0 0-1.41 0l-1.13 1.13 3 3 1.13-1.13Z"/>
        </svg>`;
      header.append(h3, editBtn);

      // Progress ring with remaining inside
      const progress = document.createElement('div');
      progress.className = 'ex-progress';
      const ring = document.createElement('div');
      ring.className = 'ring';
      const initPct = (pct * 100).toFixed(2);
      ring.style.background = `conic-gradient(var(--accent) ${initPct}%, var(--track) 0)`;
      const ringHole = document.createElement('div');
      ringHole.className = 'ring-hole';
      const remainingEl = document.createElement('div');
      remainingEl.className = 'ex-remaining';
      setText(remainingEl, String(ex.remaining ?? 0));
      ringHole.appendChild(remainingEl);
      ring.appendChild(ringHole);
      const doneMsg = document.createElement('div');
      doneMsg.className = 'done-msg';
      if ((ex.remaining ?? 0) <= 0) {
        setText(doneMsg, 'Great job! ✅');
      } else {
        doneMsg.setAttribute('hidden', '');
      }
      progress.append(ring, doneMsg);

      // Daily tip/quote under the big number
      const tipEl = document.createElement('div');
      tipEl.className = 'ex-tip';
      tipEl.id = `tip-${ex.id}`;
      setText(tipEl, dailyQuote(ex.exerciseName || ''));

      // Badges row (tiny)
      const badgesRow = document.createElement('div');
      badgesRow.className = 'ex-badges';
      const earned = Array.isArray(ex.badges) ? ex.badges.slice(0,3) : [];
      earned.forEach((id) => {
        const s = document.createElement('span');
        s.className = 'badge';
        s.title = getAchievementTitle(id);
        s.textContent = getAchievementTitle(id);
        badgesRow.appendChild(s);
      });

      // Stats strip
      const stats = document.createElement('div');
      stats.className = 'ex-stats';
      const over = Math.max(0, done - planned);
      const unit = ex.unit || 'reps';
      stats.innerHTML = `
        <span class="chip"><span class="lbl">Daily</span><span class="val ex-daily">${planned} ${unit}</span></span>
        <span class="chip"><span class="lbl">Done</span><span class="val ex-done-today">${done} ${unit}</span></span>
        <span class="chip"><span class="lbl">Left</span><span class="val ex-left">${leftToday} ${unit}</span></span>
        <span class="chip chip-over"${over > 0 ? '' : ' hidden'}>+<span class="ex-over">${over}</span> over</span>
      `;
      // Color-code chips based on progress
      {
        const plannedToday = Number(ex.history?.[today]?.planned || 0);
        const doneToday = Number(ex.history?.[today]?.done || 0);
        const left = Number(ex.remaining || 0);
        const dailyChip = card.querySelector('.ex-daily')?.closest('.chip');
        const doneChip = card.querySelector('.ex-done-today')?.closest('.chip');
        const leftChip = card.querySelector('.ex-left')?.closest('.chip');
        [dailyChip, doneChip, leftChip].forEach(c => c && c.classList.remove('ok','warn','danger'));
        const pct = plannedToday > 0 ? (doneToday / plannedToday) : 0;
        const k = (pct >= .8) ? 'ok' : (pct >= .4 ? 'warn' : 'danger');
        if (doneChip) doneChip.classList.add(k);
        if (leftChip) leftChip.classList.add(left === 0 ? 'ok' : (plannedToday ? (pct >= .5 ? 'warn' : 'danger') : 'warn'));
        // Over chip visibility
        const overVal = Math.max(0, doneToday - plannedToday);
        const overChip = card.querySelector('.chip-over');
        if (overChip) {
          const overSpan = overChip.querySelector('.ex-over');
          if (overSpan) setText(overSpan, String(overVal));
          if (overVal > 0) overChip.removeAttribute('hidden'); else overChip.setAttribute('hidden', '');
        }
      }

      // Quick step buttons
      const qsWrap = document.createElement('div');
      qsWrap.className = 'ex-buttons';
      const quickSteps = getQuickStepsFor(ex);
      // Sparkline (7-day done)
      const days7 = getRecentDays(7); // oldest -> newest
      const series = days7.map(d => Number(ex.history?.[d]?.done || 0));
      const spark = document.createElement('canvas');
      spark.className = 'ex-sparkline';
      // Append sections to card before drawing so clientWidth is correct
      card.append(header, badgesRow, progress, tipEl, stats, spark);
      // Ensure tip text set (stable per day)
      setText(qs(card, '#tip-' + ex.id), dailyQuote(ex.exerciseName || ''));
      // Draw sparkline now that it's in DOM
      try { drawSparkline(spark, series); } catch {}
      try { attachSparklineTooltip(spark, ex); } catch {}
      // Weekly goal progress bar
      const week = document.createElement('div');
      week.className = 'week-progress';
      week.innerHTML = '<div class="wp-bar"><div class="wp-fill" style="width:0%"></div></div><div class="wp-label">This week: 0 / 0</div>';
      card.append(week);
      updateWeeklyBar(card, ex);
      // Now continue with quick-step buttons
      quickSteps.forEach((n) => {
        const b = document.createElement('button');
        b.className = 'btn primary';
        b.dataset.amount = String(n);
        b.textContent = `−${n}`;
        attachQuickStepHandlers(b, ex, n, (updatedEx) => {
          // minimal per-card UI update
          updateExerciseCardView(updatedEx);
          updateWeeklyBar(card, updatedEx);
          // flash success on ring
          const ringEl = card.querySelector('.ring');
          if (ringEl) {
            ringEl.classList.remove('flash-success');
            requestAnimationFrame(() => {
              ringEl.classList.add('flash-success');
              setTimeout(() => ringEl.classList.remove('flash-success'), 350);
            });
          }
        });
        qsWrap.appendChild(b);
      });
      card.append(qsWrap);

      // Inline extra amount input row
      const extraWrap = document.createElement('div');
      extraWrap.className = 'ex-extra';
      extraWrap.innerHTML = `
        <input class="extra-input" type="number" min="1" placeholder="Add extra..." />
        <button class="btn extra-apply">+ Add</button>
      `;
      card.append(extraWrap);

      // Wire extra controls
      const extraInput = qs(card, '.extra-input');
      const extraBtn = qs(card, '.extra-apply');
      const applyExtra = () => {
        const v = parseInt(extraInput?.value, 10);
        if (!Number.isFinite(v) || v <= 0) return;
        const today = todayStrUTC();
        applyDailyRollover(ex);
        ex.remaining = Math.max(0, Number(ex.remaining || 0) - v);
        const ent = (ex.history[today] ||= { planned: 0, done: 0 });
        ent.done += v;
        if (extraInput) extraInput.value = '';
        // persist and update UI in place
        persistExercise(ex);
        updateExerciseCardView(ex);
        updateWeeklyBar(card, ex);
        // flash ring
        const ringEl = card.querySelector('.ring');
        if (ringEl) {
          ringEl.classList.remove('flash-success');
          requestAnimationFrame(() => {
            ringEl.classList.add('flash-success');
            setTimeout(() => ringEl.classList.remove('flash-success'), 350);
          });
        }
        // optional confetti when first completing for today
        if ((ex.remaining || 0) <= 0) {
          const today2 = todayStrUTC();
          if ((ex._confettiDoneForToday || '') !== today2) {
            try { ex._confettiDoneForToday = today2; } catch {}
            persistExercise(ex);
            try { launchConfetti(); } catch {}
          }
        }
        try { showToast && showToast(`+${v} logged`); } catch {}
      };
      if (extraBtn) extraBtn.addEventListener('click', applyExtra);
      if (extraInput) extraInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyExtra(); });
      containerFrag.appendChild(card);

      // Handlers per card
      editBtn.addEventListener('click', () => {
        openModal('edit', ex);
      });
    });
    el.list.appendChild(containerFrag);
  }

  function getQuickStepsFor(ex) {
    // Parse and sanitize quick steps; fallback derive from decrementStep
    const uniq = (arr) => Array.from(new Set(arr));
    let steps = [];
    if (Array.isArray(ex.quickSteps) && ex.quickSteps.length) {
      steps = ex.quickSteps.map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 999);
    }
    if (!steps.length) {
      const base = Math.max(1, Number(ex.decrementStep || 1));
      steps = [1, base, base * 2];
    }
    steps = uniq(steps).sort((a, b) => a - b).slice(0, 4);
    return steps;
  }

  // --- Sparkline ---
  function drawSparkline(canvas, values){
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 280;
    const cssH = canvas.clientHeight || 40;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const max = Math.max(1, ...values);
    const min = 0;
    const n = values.length;
    const step = cssW / ((n - 1) || 1);

    // grid baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cssH - 1.5);
    ctx.lineTo(cssW, cssH - 1.5);
    ctx.stroke();

    // line
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#4c8dff';
    ctx.strokeStyle = accent.trim() || '#4c8dff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const y = cssH - ((values[i] - min) / (max - min)) * (cssH - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // fill
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, 'rgba(100,150,255,0.25)');
    grad.addColorStop(1, 'rgba(100,150,255,0.00)');
    ctx.fillStyle = grad;
    ctx.lineTo(cssW, cssH);
    ctx.lineTo(0, cssH);
    ctx.closePath();
    ctx.fill();
  }

  // --- Weekly progress helpers ---
  function sumLast7Done(ex){
    const days = getRecentDays(7); // includes today, oldest->newest
    let s = 0;
    for (const d of days){ s += Number(ex.history?.[d]?.done || 0); }
    return s;
  }

  function ensureWeeklyGoal(ex){
    if (!ex.weeklyGoal || ex.weeklyGoal <= 0){
      ex.weeklyGoal = Math.max(0, Number(ex.dailyTarget || 0) * 7);
    }
    return ex.weeklyGoal;
  }

  function updateWeeklyBar(card, ex){
    if (!card) return;
    const container = card.querySelector('.week-progress');
    if (!container) return;
    const fill = container.querySelector('.wp-fill');
    const label = container.querySelector('.wp-label');
    const goal = ensureWeeklyGoal(ex);
    const done = sumLast7Done(ex);
    const pct = goal > 0 ? Math.min(1, done / goal) : 0;
    container.classList.remove('ok','warn','danger');
    const status = (pct >= 1) ? 'ok' : (pct >= 0.7 ? 'warn' : 'danger');
    container.classList.add(status);
    if (fill) fill.style.width = (pct * 100).toFixed(1) + '%';
    const unit = ex.unit || 'reps';
    if (label) label.textContent = `This week: ${done} / ${goal} ${unit}`;
  }

  function attachSparklineTooltip(canvas, ex){
    if (!canvas || !sparkTooltip) return;
    const days7 = getRecentDays(7); // oldest -> newest
    const values = days7.map(d => Number(ex.history?.[d]?.done || 0));

    function showTip(evt){
      const rect = canvas.getBoundingClientRect();
      const x = (evt.clientX ?? evt.pageX) - rect.left;
      const step = rect.width / ((values.length - 1) || 1);
      const idx = Math.min(values.length - 1, Math.max(0, Math.round(x / step)));
      const day = days7[idx];
      const val = values[idx];
      const unit = ex.unit || 'reps';
      sparkTooltip.textContent = `${day}: ${val} ${unit}`;
      sparkTooltip.style.left = (evt.pageX || (rect.left + x + window.scrollX)) + 'px';
      sparkTooltip.style.top = (rect.top + window.scrollY) + 'px';
      sparkTooltip.style.opacity = 1;
    }
    function hideTip(){ sparkTooltip.style.opacity = 0; }

    canvas.addEventListener('mousemove', showTip);
    canvas.addEventListener('mouseleave', hideTip);
    canvas.addEventListener('touchstart', (e)=>{ if(e.touches && e.touches[0]) showTip(e.touches[0]); }, {passive:true});
    canvas.addEventListener('touchend', hideTip);
  }

  // --- Quick-step edit helpers ---
  function editQuickStepValue(ex, oldVal){
    const next = prompt('New decrement value (1–999):', oldVal);
    if (next===null) return null;
    const n = Math.max(1, Math.min(999, parseInt(next,10)||oldVal));
    let steps = Array.isArray(ex.quickSteps) ? ex.quickSteps.slice() : [];
    const idx = steps.indexOf(oldVal);
    if (idx>=0) steps[idx] = n; else steps.push(n);
    steps = Array.from(new Set(steps)).sort((a,b)=>a-b).slice(0,4);
    ex.quickSteps = steps;
    return n;
  }

  function persistExercise(ex){
    const items = loadExercises();
    const idx = items.findIndex(i => i.id === ex.id);
    if (idx >= 0) {
      items[idx] = Object.assign({}, items[idx], ex);
      if (typeof saveDebounced === 'function') saveDebounced(() => saveExercises(items));
      else saveExercises(items);
    }
  }

  function attachQuickStepHandlers(btn, ex, amount, updateCard){
    // normal click = decrement
    btn.addEventListener('click', () => {
      if (btn.__editing) return; // ignore if coming from long-press edit
      const today = todayStrUTC();
      applyDailyRollover(ex);
      const currentAmt = Math.max(1, Number(btn.dataset.amount || amount));
      const dec = currentAmt; // do not clamp by remaining/planned
      ex.remaining = Math.max(0, Number(ex.remaining || 0) - dec);
      addDone(ex, today, dec);
      pruneHistory(ex);
      invalidateStreak(ex.id);
      checkAchievements(ex);
      persistExercise(ex);
      if (typeof updateCard === 'function') updateCard(ex);
      // Push updated weekly total to leaderboard (if configured)
      try {
        const cfg = getLbConfig();
        if (cfg.name && cfg.url && cfg.key) upsertScore(cfg.name, computeWeeklyTotalAll());
      } catch {}
      // Confetti when first reaching done today (do not disable buttons)
      if ((ex.remaining || 0) <= 0) {
        const today2 = todayStrUTC();
        if ((ex._confettiDoneForToday || '') !== today2) {
          try { ex._confettiDoneForToday = today2; } catch {}
          persistExercise(ex);
          try { launchConfetti(); } catch {}
        }
      }
    });

    // long-press = edit value
    let timer = null;
    const start = () => { timer = setTimeout(() => {
      btn.__editing = true;
      const currentAmt = Math.max(1, Number(btn.dataset.amount || amount));
      const newVal = editQuickStepValue(ex, currentAmt);
      if (newVal !== null){
        btn.textContent = `−${newVal}`;
        btn.dataset.amount = String(newVal);
        persistExercise(ex);
      }
      setTimeout(() => { btn.__editing = false; }, 250);
    }, 550); };
    const clear = () => { if (timer){ clearTimeout(timer); timer=null; } };

    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start, { passive: true });
    ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev => btn.addEventListener(ev, clear));
  }

  async function openHistory(exId) {
    const items = loadExercises();
    const ex = items.find((i) => i.id === exId);
    if (!ex) return;
    if (!ex.history) ex.history = {};

    el.historyTitle.textContent = `History — ${ex.exerciseName || 'Exercise'}`;

    const sumRange = (days) => {
      const keys = getRecentDays(days);
      let planned = 0, done = 0;
      keys.forEach((k) => {
        const entry = ex.history[k];
        if (entry) { planned += Number(entry.planned || 0); done += Number(entry.done || 0); }
      });
      return { planned, done };
    };

    const s7 = sumRange(7);
    const s30 = sumRange(30);
    const r7 = s7.planned > 0 ? Math.round((s7.done / s7.planned) * 100) : 0;
    const r30 = s30.planned > 0 ? Math.round((s30.done / s30.planned) * 100) : 0;
    const earnedTitles = (Array.isArray(ex.badges) ? ex.badges : []).map(getAchievementTitle);
    const pb = maxDayDone(ex);
    const ls = longestStreak(ex);
    const unit = ex.unit || 'reps';
    el.historyStats.innerHTML = `
      <div class="stack">
        <div><strong>PB Day:</strong> ${pb.date} ${pb.value} ${unit} • <strong>Longest Streak:</strong> ${ls}</div>
        <div><strong>Last 7 days:</strong> Planned ${s7.planned} ${unit}, Done ${s7.done} ${unit} — ${r7}%</div>
        <div><strong>Last 30 days:</strong> Planned ${s30.planned} ${unit}, Done ${s30.done} ${unit} — ${r30}%</div>
        ${earnedTitles.length ? `<div><strong>Achievements:</strong> ${earnedTitles.join(', ')}</div>` : ''}
      </div>`;

    const recentDays = getRecentDays(14);
    el.historyList.innerHTML = '';
    recentDays.forEach((ds) => {
      const ent = ex.history[ds] || { planned: 0, done: 0 };
      const pct = ent.planned > 0 ? Math.round((ent.done / ent.planned) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <div class="muted">${ds}</div>
        <div>Planned: ${ent.planned} ${unit}</div>
        <div>Done: ${ent.done} ${unit}</div>
        <div>${pct}%</div>
      `;
      el.historyList.appendChild(row);
    });

    // Tabs and chart
    const tabRecent = document.getElementById('tabRecent');
    const tabTrends = document.getElementById('tabTrends');
    const setActive = (mode) => {
      if (tabRecent && tabTrends) {
        tabRecent.classList.toggle('active', mode === 'recent');
        tabTrends.classList.toggle('active', mode === 'trends');
      }
    };
    let mode = localStorage.getItem(HISTORY_TAB_KEY) || 'recent';
    if (mode !== 'recent' && mode !== 'trends') mode = 'recent';
    setActive(mode);
    await renderHistoryChart(mode, ex);
    if (tabRecent) tabRecent.onclick = async () => {
      localStorage.setItem(HISTORY_TAB_KEY, 'recent');
      setActive('recent');
      await renderHistoryChart('recent', ex);
    };
    if (tabTrends) tabTrends.onclick = async () => {
      localStorage.setItem(HISTORY_TAB_KEY, 'trends');
      setActive('trends');
      await renderHistoryChart('trends', ex);
    };

    el.historyModal.classList.remove('hidden');
  }

  // ---------- Init & Events ----------
  document.addEventListener('DOMContentLoaded', () => {
    // About: set app version in Settings → Global
    try {
      const vEl = document.getElementById('appVersion');
      if (vEl) vEl.textContent = window.__APP_VERSION__ || '1.0';
    } catch {}

    (async function loadVersion(){
      try {
        const res = await fetch('version.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('missing version.json');
        const meta = await res.json();
        const vEl = document.getElementById('appVersion');
        const nEl = document.getElementById('aboutName');
        if (nEl && meta.name) nEl.textContent = meta.name;
        if (vEl && meta.version) vEl.textContent = meta.version;
        // Optional: store globally for other uses
        window.__APP_VERSION__ = meta.version;
      } catch (e) {
        // fallback: leave defaults
        console.warn('Version load failed:', e);
      }
    })();

    (async () => {
      const el = document.getElementById('commitHash');
      if (!el) return;
      // read any inline commit value first
      let sha = (window.__COMMIT_HASH__ || '').toString().trim();
      // If missing, try to find a script tag that matches commit.*.js and fetch it
      if (!sha) {
        try {
          const s = Array.from(document.scripts).find(sc => /commit\.[0-9a-f]+\.js$/.test(sc.src));
          if (s) {
            const txt = await fetch(s.src, { cache: 'no-store' }).then(r => r.text());
            const m = txt.match(/__COMMIT_HASH__\s*=\s*["']([0-9a-f]+)["']/i);
            if (m) sha = m[1];
          }
        } catch {}
      }
      el.textContent = sha || 'unknown';
      el.title = sha ? 'Current deployed commit' : 'Commit not found (likely cache or deploy issue)';
    })();

    // Commit message (if present)
    const msgEl = document.getElementById('commitMsg');
    if (msgEl && window.__COMMIT_MSG__) {
      msgEl.textContent = window.__COMMIT_MSG__;
    }

    // Diagnostics: commit file, SW caches, build time
    (async () => {
      const cf = document.getElementById('commitFile');
      const sc = document.getElementById('swCaches');
      const bt = document.getElementById('buildTime');

      try {
        const s = Array.from(document.scripts).find(x => /commit(\.[0-9a-f]+)?\.js$/.test(x.src || ''));
        if (cf) cf.textContent = s ? new URL(s.src).pathname.split('/').pop() : 'not found';
      } catch { if (cf) cf.textContent = 'error'; }

      if (sc && 'caches' in window) {
        try {
          const keys = await caches.keys();
          sc.textContent = (keys && keys.length) ? keys.join(', ') : 'none';
        } catch { sc.textContent = 'error'; }
      }

      try {
        const t = (window.__BUILD_TIME__ || new Date().toISOString());
        if (bt) bt.textContent = t;
      } catch { if (bt) bt.textContent = 'error'; }
    })();
    // Theme: detect and apply before rendering
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;
    document.documentElement.classList.toggle('dark', isDark);
    // Settings modal elements
    const settingsBtn = $('#settingsBtn');
    const settingsModal = $('#settingsModal');
    const closeSettingsBtn = $('#closeSettingsBtn');
    const exportBtn = $('#exportBtn');
    const importBtn = $('#importBtn');
    const darkToggle = $('#darkToggle');
    const addExerciseBtn = $('#addExerciseBtn');
    const showWeeklyNowBtn = document.getElementById('showWeeklyNowBtn');
    const lbName = document.getElementById('lbName');
    const lbUrl = document.getElementById('lbUrl');
    const lbKey = document.getElementById('lbKey');
    const saveLbCfgBtn = document.getElementById('saveLbCfgBtn');
    const openLeaderboardBtn = document.getElementById('openLeaderboardBtn');
    const forceReloadBtn = document.getElementById('forceReloadBtn');
    const exerciseSelect = $('#exerciseSelect');
    const customAmount = $('#customAmount');
    const applyCustomBtn = $('#applyCustomBtn');
    const settingsAddTargetBtn = $('#settingsAddTargetBtn');
    const settingsHistoryBtn = $('#settingsHistoryBtn');
    const shareCardBtnEl = $('#shareCardBtn');
    // Share modal elements
    const openShareBtn = document.getElementById('openShareBtn');
    const shareModal = document.getElementById('shareModal');
    const closeShareBtn = document.getElementById('closeShareBtn');
    const doShareBtn = document.getElementById('doShareBtn');
    const shareExerciseSel = document.getElementById('shareExercise');
    const shareDayBtn = document.getElementById('shareDayBtn');
    const shareWeekBtn = document.getElementById('shareWeekBtn');
    const shareMonthBtn = document.getElementById('shareMonthBtn');
    const toggleDebugBtn = $('#toggleDebugBtn');
    const debugPanel = $('#debugPanel');

    if (darkToggle) darkToggle.checked = isDark;
    // Rollover for each exercise on load
    const list = loadExercises();
    let changed = false;
    list.forEach((ex) => {
      if (applyDailyRollover(ex)) { checkAchievements(ex); changed = true; }
      else ensureBadges(ex);
    });
    if (changed) saveExercises(list);
    // Handle any URL quick actions before the first render
    handleURLQuickAction();
    renderDashboard();
    // Initialize storage size meter
    updateStorageSize();
    // Push initial weekly total to leaderboard (if configured)
    try {
      const cfg0 = getLbConfig();
      if (cfg0.name && cfg0.url && cfg0.key) upsertScore(cfg0.name, computeWeeklyTotalAll());
    } catch {}

    // Weekly Summary: show once per week (per Sunday)
    try {
      const lastShown = localStorage.getItem('lastWeeklyShown');
      const currentSunday = lastSundayStr();
      if (lastShown !== currentSunday) {
        showWeeklySummary();
        localStorage.setItem('lastWeeklyShown', currentSunday);
      }
    } catch {}

    // ----- Settings Modal Wiring -----
    let currentExerciseId = null;

    function getExerciseById(id) {
      const items = loadExercises();
      const idx = items.findIndex((i) => i.id === id);
      return { ex: idx >= 0 ? items[idx] : null, idx };
    }

    function populateExerciseSelect() {
      if (!exerciseSelect) return;
      const items = loadExercises();
      exerciseSelect.innerHTML = '';
      items.forEach((ex) => {
        const opt = document.createElement('option');
        opt.value = ex.id;
        opt.textContent = ex.exerciseName || 'Exercise';
        exerciseSelect.appendChild(opt);
      });
      // maintain or set default selection
      if (items.length) {
        if (!currentExerciseId || !items.some(i => i.id === currentExerciseId)) {
          currentExerciseId = items[0].id;
        }
        exerciseSelect.value = currentExerciseId;
      } else {
        currentExerciseId = null;
      }
    }

    function getSelectedExercise(){
      const sel = document.getElementById('exerciseSelect');
      if (!sel) return null;
      const id = sel.value;
      const list = loadExercises() || [];
      return list.find(e => String(e.id) === String(id)) || list[0] || null;
    }

    // Populate Share modal exercise list
    function populateShareExerciseSelect() {
      if (!shareExerciseSel) return;
      const items = loadExercises();
      shareExerciseSel.innerHTML = '';
      items.forEach((ex) => {
        const opt = document.createElement('option');
        opt.value = ex.id;
        opt.textContent = ex.exerciseName || 'Exercise';
        shareExerciseSel.appendChild(opt);
      });
      // default selection mirrors currentExerciseId or first item
      if (items.length) {
        const selId = (currentExerciseId && items.some(i => i.id === currentExerciseId)) ? currentExerciseId : items[0].id;
        shareExerciseSel.value = selId;
      }
    }

    // --- Share helpers (period summaries as image) ---
    function periodDates(period){
      const today = todayStrUTC();
      if (period==='day')   return [today];
      if (period==='week')  return getRecentDays(7);
      if (period==='month') return getRecentDays(30);
      return [today];
    }

    function sumDone(ex, days){
      let s=0; for (const d of days) s += (ex.history?.[d]?.done)||0; return s;
    }
    function sumPlanned(ex, days){
      let s=0; for (const d of days) s += (ex.history?.[d]?.planned)||0; return s;
    }

    async function renderShareCanvas(ex, period){
      const days = periodDates(period);
      const totalDone = sumDone(ex, days);
      const totalPlanned = sumPlanned(ex, days);
      const rate = totalPlanned>0 ? Math.round((totalDone/totalPlanned)*100) : 0;
      const unit = ex.unit || 'reps';

      // Canvas
      const W=1080, H=1080, P=64;
      const c = document.createElement('canvas'); c.width=W; c.height=H;
      const ctx = c.getContext('2d');

      // Colors from CSS
      const cs = getComputedStyle(document.documentElement);
      const bg  = cs.getPropertyValue('--bg') || '#0b0f1a';
      const fg  = cs.getPropertyValue('--fg') || '#ffffff';
      const acc = cs.getPropertyValue('--accent') || '#4c8dff';

      // background
      ctx.fillStyle = bg.trim(); ctx.fillRect(0,0,W,H);

      // title
      ctx.fillStyle = fg.trim(); ctx.font = 'bold 64px system-ui, -apple-system, Segoe UI, Roboto';
      ctx.fillText(ex.exerciseName || 'Exercise', P, P+40);

      // subtitle (period)
      ctx.font = '500 40px system-ui';
      const label = period==='day' ? 'Today' : (period==='week' ? 'This Week' : 'Last 30 Days');
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(label, P, P+100);

      // totals
      ctx.font = 'bold 120px system-ui';
      ctx.fillStyle = acc.trim();
      ctx.fillText(`${totalDone} ${unit}`, P, P+230);

      ctx.font = '500 36px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(totalPlanned>0 ? `of ${totalPlanned} ${unit} (${rate}%)` : `logged`, P, P+280);

      // little bars for each day
      const barW = Math.floor((W - P*2) / Math.max(7, days.length));
      const baseY = H - P - 60;
      const maxVal = Math.max(1, ...days.map(d => (ex.history?.[d]?.done)||0));
      ctx.save();
      for (let i=0;i<days.length;i++){
        const val = (ex.history?.[days[i]]?.done)||0;
        const h = Math.round((val / maxVal) * 260);
        const x = P + i*barW;
        ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x, baseY-260, barW-6, 260);
        ctx.fillStyle = acc.trim(); ctx.fillRect(x, baseY-h, barW-6, h);
      }
      ctx.restore();

      // footer
      ctx.font = '400 28px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const from = days[0], to = days[days.length-1];
      ctx.fillText(`${from} → ${to}`, P, H - P);

      return c;
    }

    async function shareProgress(ex, period){
      const canvas = await renderShareCanvas(ex, period);
      // Try Web Share with image file
      try {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], `${(ex.exerciseName||'exercise')}-${period}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files:[file] })) {
          await navigator.share({ files:[file], title: 'My progress', text: `${ex.exerciseName}: ${period} progress` });
          return;
        }
      } catch(_) {}

      // Text-only share fallback when files are not supported
      try {
        if (navigator.share) {
          const days = periodDates(period);
          const totalDone = sumDone(ex, days);
          const totalPlanned = sumPlanned(ex, days);
          const unit = ex.unit || 'reps';
          const label = period==='day' ? 'Today' : (period==='week' ? 'This Week' : 'Last 30 Days');
          const msg = `${ex.exerciseName} — ${label}\n${totalDone} ${unit}${totalPlanned?` of ${totalPlanned} ${unit}`:''}`;
          await navigator.share({ title: 'My progress', text: msg });
          return;
        }
      } catch(_) {}

      // Fallback: open image in new tab / download
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = `${(ex.exerciseName||'exercise')}-${period}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      try { showToast?.('Image downloaded'); } catch {}
    }

    // Settings accordion init: collapsed by default; toggle open/close on header click
    function initSettingsAccordion(){
      const sections = Array.from(document.querySelectorAll('#settingsModal .acc-section'));
      sections.forEach(sec=>{
        const header = sec.querySelector('.acc-header');
        const panel  = sec.querySelector('.acc-panel');
        if (!header || !panel) return;
        sec.classList.remove('open'); // start collapsed
        header.setAttribute('aria-expanded','false');
        if (!header.dataset.wired) {
          header.addEventListener('click', ()=>{
            const isOpen = sec.classList.contains('open');
            sections.forEach(s=>{ s.classList.remove('open'); s.querySelector('.acc-header')?.setAttribute('aria-expanded','false'); });
            if (!isOpen){ sec.classList.add('open'); header.setAttribute('aria-expanded','true'); }
          });
          header.dataset.wired = '1';
        }
      });
    }

    // Helpers
    function openSettingsModal() {
      const m = document.getElementById('settingsModal');
      if (!m) return;
      populateExerciseSelect?.();
      initSettingsAccordion?.();
      // Prefill leaderboard config and toggle leaderboard button
      try {
        const cfg = getLbConfig();
        if (lbName) lbName.value = cfg.name || '';
        if (lbUrl) lbUrl.value = cfg.url || '';
        if (lbKey) lbKey.value = cfg.key || '';
        if (openLeaderboardBtn) openLeaderboardBtn.style.display = (cfg.url && cfg.key && cfg.name) ? '' : 'none';
      } catch {}
      m.classList.remove('hidden');
      document.body.classList.add('no-scroll');
      const mc = m.querySelector('.modal-content');
      if (mc) mc.scrollTop = 0;
    }
    function closeSettingsModal() {
      const m = document.getElementById('settingsModal');
      if (!m) return;
      m.classList.add('hidden');
      document.body.classList.remove('no-scroll');
    }

    // Share Modal helpers
    function openShareModal() {
      populateShareExerciseSelect();
      // default period = day
      const segBtns = shareModal?.querySelectorAll('.seg-btn') || [];
      segBtns.forEach(b => b.classList.toggle('active', b.dataset.period === 'day'));
      // default destination = copy (no-op styling, but track state via class)
      const destBtns = shareModal?.querySelectorAll('.share-dests .dest') || [];
      let first = true;
      destBtns.forEach(b => { b.classList.toggle('active', b.dataset.dest === 'copy' && first); });
      shareModal?.classList.remove('hidden');
      document.body.classList.add('no-scroll');
    }
    function closeShareModal() {
      shareModal?.classList.add('hidden');
      document.body.classList.remove('no-scroll');
    }

    // Back-compat wrappers
    function openSettings() { openSettingsModal(); }
    function closeSettings() { closeSettingsModal(); }

    settingsBtn?.addEventListener('click', openSettingsModal);
    closeSettingsBtn?.addEventListener('click', closeSettingsModal);
    exerciseSelect?.addEventListener('change', (e) => {
      currentExerciseId = e.target.value || null;
    });

    // Close on Escape and overlay click
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!shareModal?.classList.contains('hidden')) { closeShareModal(); return; }
        if (!settingsModal?.classList.contains('hidden')) { closeSettingsModal(); return; }
        // Close Add/Edit if open
        const addEditOpen = el.modal && !el.modal.hidden;
        if (addEditOpen) { closeAddEditModal(); return; }
      }
    });
    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
    // Close Add/Edit when tapping overlay (not inside panel)
    el.modal?.addEventListener('click', (e) => {
      if (e.target === el.modal) closeAddEditModal();
    });

    // Global actions in modal
    addExerciseBtn?.addEventListener('click', () => {
      closeSettingsModal();
      openModal('add');
    });

    // Manual Weekly Summary trigger
    if (showWeeklyNowBtn) {
      showWeeklyNowBtn.addEventListener('click', async () => {
        if (typeof loadChartJs === 'function') {
          try { await loadChartJs(); } catch (_) {}
        }
        if (typeof showWeeklySummary === 'function') {
          showWeeklySummary();
        }
      });
    }

    // Force update: unregister SWs, clear caches, bust URL and reload
    forceReloadBtn?.addEventListener('click', async () => {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) { try { await r.unregister(); } catch {} }
        }
      } catch {}
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const k of keys) { try { await caches.delete(k); } catch {} }
        }
      } catch {}
      try {
        const v = Date.now();
        location.href = location.pathname + '?v=' + v;
      } catch {
        location.reload();
      }
    });

    // Theme toggle wiring (modal)
    darkToggle?.addEventListener('change', () => {
      const useDark = !!darkToggle.checked;
      document.documentElement.classList.toggle('dark', useDark);
      localStorage.setItem('theme', useDark ? 'dark' : 'light');
      if (window.__historyChart) {
        const cs = getComputedStyle(document.documentElement);
        const fg = (cs.getPropertyValue('--fg') || '#111').trim();
        const grid = (cs.getPropertyValue('--border') || '#ddd').trim();
        try {
          window.__historyChart.options.plugins.legend.labels.color = fg;
          if (window.__historyChart.options.scales?.x) {
            window.__historyChart.options.scales.x.ticks.color = fg;
            window.__historyChart.options.scales.x.grid.color = grid;
          }
          if (window.__historyChart.options.scales?.y) {
            window.__historyChart.options.scales.y.ticks.color = fg;
            window.__historyChart.options.scales.y.grid.color = grid;
          }
          window.__historyChart.update();
        } catch {}
      }
      // Redraw all sparklines with new theme-accent
      const listNow = loadExercises() || [];
      document.querySelectorAll('.ex-card').forEach((cardEl) => {
        const id = cardEl.getAttribute('data-id');
        const ex = listNow.find(e => e.id === id);
        const canvas = cardEl.querySelector('.ex-sparkline');
        if (ex && canvas) {
          const days7 = getRecentDays(7);
          const series = days7.map(d => Number(ex.history?.[d]?.done || 0));
          try { drawSparkline(canvas, series); } catch {}
        }
      });
    });

    // Debug: FPS meter
    (function () {
      const fpsEl = document.querySelector('#fpsMeter');
      if (!fpsEl) return;
      let last = performance.now();
      let frames = 0;
      function loop(ts) {
        frames++;
        if (ts - last >= 1000) {
          const fps = frames;
          frames = 0;
          last = ts;
          fpsEl.textContent = `FPS: ${fps}`;
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    })();

    // Debug: Toggle panel and refresh cache/storage sizes when opened
    toggleDebugBtn?.addEventListener('click', () => {
      if (!debugPanel) return;
      debugPanel.classList.toggle('hidden');
      const opened = !debugPanel.classList.contains('hidden');
      if (opened) {
        updateStorageSize();
        updateCacheSize();
      }
    });

    exportBtn?.addEventListener('click', () => {
      const data = JSON.stringify(loadExercises(), null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exercise-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    });

    importBtn?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result || 'null'));
            if (!Array.isArray(parsed)) throw new Error('Invalid format: expected array');
            const norm = parsed.map((ex) => ({
              id: String(ex.id || uuid()),
              exerciseName: String(ex.exerciseName || 'Exercise'),
              dailyTarget: Math.max(1, Number(ex.dailyTarget || 1)),
              decrementStep: Math.max(1, Number(ex.decrementStep || 1)),
              remaining: Math.max(0, Number(ex.remaining || 0)),
              lastAppliedDate: ex.lastAppliedDate || todayStrUTC(),
              history: ex.history && typeof ex.history === 'object' ? ex.history : {},
              completionThreshold: Number(ex.completionThreshold ?? 1.0),
              quickSteps: Array.isArray(ex.quickSteps) ? ex.quickSteps.map(Number) : undefined,
              weeklyGoal: Math.max(0, Number(ex.weeklyGoal ?? (Number(ex.dailyTarget || 0) * 7)))
            }));
            saveExercises(norm);
            renderDashboard();
            showToast('Import successful');
            closeSettingsModal();
          } catch (e) {
            alert('Failed to import JSON: ' + e.message);
          }
        };
        reader.readAsText(file);
      });
      input.click();
    });

    // Exercise actions in modal
    applyCustomBtn?.addEventListener('click', () => {
      const amt = parseInt(String(customAmount?.value || '').trim(), 10);
      if (!(Number.isFinite(amt) && amt >= 1)) return;
      const items = loadExercises();
      if (!items.length || !currentExerciseId) return;
      const idx = items.findIndex(i => i.id === currentExerciseId);
      if (idx < 0) return;
      const ex = items[idx];
      const today = todayStrUTC();
      applyDailyRollover(ex);
      ex.remaining = Math.max(0, Number(ex.remaining || 0) - amt);
      addDone(ex, today, amt);
      pruneHistory(ex);
      invalidateStreak(ex.id);
      checkAchievements(ex);
      saveDebounced(() => saveExercises(items));
      updateExerciseCardView(ex);
      showToast(`−${amt} logged`);
      // Push updated weekly total to leaderboard (if configured)
      try {
        const cfg = getLbConfig();
        if (cfg.name && cfg.url && cfg.key) upsertScore(cfg.name, computeWeeklyTotalAll());
      } catch {}
    });

    settingsAddTargetBtn?.addEventListener('click', () => {
      const items = loadExercises();
      if (!items.length || !currentExerciseId) return;
      const idx = items.findIndex(i => i.id === currentExerciseId);
      if (idx < 0) return;
      const ex = items[idx];
      const today = todayStrUTC();
      applyDailyRollover(ex);
      const inc = Math.max(1, Number(ex.dailyTarget || 0));
      ex.remaining = Number(ex.remaining || 0) + inc;
      addPlanned(ex, today, inc);
      pruneHistory(ex);
      invalidateStreak(ex.id);
      checkAchievements(ex);
      saveDebounced(() => saveExercises(items));
      updateExerciseCardView(ex);
      showToast(`+${inc} added`);
    });

    settingsHistoryBtn?.addEventListener('click', () => {
      if (!currentExerciseId) return;
      closeSettingsModal();
      openHistory(currentExerciseId);
    });

    // Save leaderboard settings
    saveLbCfgBtn?.addEventListener('click', () => {
      const name = (lbName?.value || '').trim();
      const url = (lbUrl?.value || '').trim();
      const key = (lbKey?.value || '').trim();
      try {
        localStorage.setItem('lbName', name);
        localStorage.setItem('lbUrl', url);
        localStorage.setItem('lbKey', key);
        if (openLeaderboardBtn) openLeaderboardBtn.style.display = (name && url && key) ? '' : 'none';
        showToast('Leaderboard settings saved');
      } catch {}
    });

    // Open leaderboard modal
    openLeaderboardBtn?.addEventListener('click', async () => {
      if (!supaConfigured()) { showToast('Configure Supabase first'); return; }
      const rows = await loadLeaderboard();
      if (leaderboardList) {
        leaderboardList.innerHTML = '';
        if (!rows.length) {
          leaderboardList.textContent = 'No scores yet for this week.';
        } else {
          rows.forEach((r, i) => {
            const div = document.createElement('div');
            div.className = 'row';
            const rank = i + 1;
            div.innerHTML = `<strong>#${rank}</strong> ${r.name || '—'} — ${r.total || 0}`;
            leaderboardList.appendChild(div);
          });
        }
      }
      leaderboardModal?.classList.remove('hidden');
    });

    document.getElementById('closeLeaderboard')?.addEventListener('click', () => {
      leaderboardModal?.classList.add('hidden');
    });

    // Share Progress Card
    shareCardBtnEl?.addEventListener('click', () => {
      if (!currentExerciseId) return;
      const items = loadExercises();
      const ex = items.find(i => i.id === currentExerciseId);
      if (!ex) return;
      try { renderShareCard(ex); } catch (e) { console.error(e); }
    });

    // Share summary buttons
    shareDayBtn?.addEventListener('click',  () => { const ex = getSelectedExercise(); if (ex) shareProgress(ex, 'day'); });
    shareWeekBtn?.addEventListener('click', () => { const ex = getSelectedExercise(); if (ex) shareProgress(ex, 'week'); });
    shareMonthBtn?.addEventListener('click',() => { const ex = getSelectedExercise(); if (ex) shareProgress(ex, 'month'); });

    // (Share modal wiring moved to wireShareModal IIFE)

    // Populate Share Exercise select and wire modal open/close + period
    function populateShareExercise(){
      const sel = document.getElementById('shareExercise');
      if (!sel) return;
      const list = loadExercises() || [];
      sel.innerHTML = '';
      list.forEach(ex=>{
        const opt = document.createElement('option');
        opt.value = ex.id; opt.textContent = ex.exerciseName || 'Exercise';
        sel.appendChild(opt);
      });
    }

    (function wireShareModal(){
      const openBtn  = document.getElementById('openShareBtn');
      const modal    = document.getElementById('shareModal');
      const closeBtn = document.getElementById('closeShareBtn');
      const segBtns  = () => Array.from(modal.querySelectorAll('.seg-btn'));
      let currentPeriod = 'day';

      function openShare(){
        populateShareExercise();
        currentPeriod = 'day';
        segBtns().forEach(b=> b.classList.toggle('active', b.dataset.period==='day'));
        modal.classList.remove('hidden');
      }
      function closeShare(){ modal.classList.add('hidden'); }

      openBtn?.addEventListener('click', openShare);
      closeBtn?.addEventListener('click', closeShare);
      modal?.addEventListener('click', (e)=>{ if(e.target===modal) closeShare(); });

      // period toggle
      modal.querySelectorAll('.seg-btn').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          currentPeriod = btn.dataset.period;
          segBtns().forEach(b=> b.classList.toggle('active', b===btn));
        });
      });

      // Expose selected period getter for the share action
      window.__getShareModalSelection = function(){
        const sel = document.getElementById('shareExercise');
        const id  = sel?.value;
        return { id, period: currentPeriod, close: closeShare };
      };
    })();

    // Helper: find exercise by id (non-indexed)
    function findExerciseById(id){
      const listNow = loadExercises() || [];
      return listNow.find(e => String(e.id) === String(id)) || null;
    }

    // Build site invite link
    function siteInviteURL(){
      try { return location.origin + location.pathname; } catch { return location.href; }
    }

    // Share to destination using existing renderShareCanvas
    async function doShareTo(dest, ex, period){
      const canvas = await renderShareCanvas(ex, period);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const fileName = `${(ex.exerciseName||'exercise')}-${period}.png`;
      const url = URL.createObjectURL(blob);
      const invite = siteInviteURL();

      // Try Web Share with file
      try {
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files:[file] })) {
          await navigator.share({ files:[file], title: 'My progress', text: `${ex.exerciseName} — ${period}\n${invite}` });
          URL.revokeObjectURL(url);
          return;
        }
      } catch(_) {}

      // App-specific intents / fallbacks
      if (dest === 'telegram') {
        const text = encodeURIComponent(`${ex.exerciseName} — ${period}\n${invite}`);
        window.open(`https://t.me/share/url?url=${encodeURIComponent(invite)}&text=${text}`, '_blank');
      } else if (dest === 'whatsapp') {
        const text = encodeURIComponent(`${ex.exerciseName} — ${period}\n${invite}`);
        window.open(`https://wa.me/?text=${text}`, '_blank');
      } else if (dest === 'instagram') {
        // No web image intent; download and instruct
        const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
        try { showToast?.('Image saved. Open Instagram and post the image manually.'); } catch {}
      } else if (dest === 'copy') {
        try {
          await navigator.clipboard.writeText(invite);
          try { showToast?.('Invite link copied. Downloading image…'); } catch {}
        } catch {}
        const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(()=> URL.revokeObjectURL(url), 30000);
    }

    // Wire destination buttons and final Share button
    (function wireShareActions(){
      const shareModal = document.getElementById('shareModal');
      if (!shareModal) return;
      const destBtns = shareModal.querySelectorAll('.share-dests .dest');
      let chosenDest = 'copy';
      // set default visual state
      destBtns.forEach(x=> { if (x.dataset.dest === 'copy') x.classList.add('primary'); else x.classList.remove('primary'); });
      destBtns.forEach(b=>{
        b.addEventListener('click', ()=>{
          chosenDest = b.dataset.dest;
          destBtns.forEach(x=> x.classList.toggle('primary', x===b));
        });
      });
      const doShareBtn = document.getElementById('doShareBtn');
      doShareBtn?.addEventListener('click', async ()=>{
        const sel = window.__getShareModalSelection?.();
        if (!sel) return;
        const ex = findExerciseById(sel.id);
        if (!ex) return;
        await doShareTo(chosenDest, ex, sel.period || 'day');
        try { sel.close?.(); } catch {}
      });
    })();

    el.cancelBtn?.addEventListener('click', closeModal);

    el.saveBtn?.addEventListener('click', () => {
      const nameVal = (el.name.value || '').trim();
      const dailyVal = Number(el.daily.value);
      const stepRaw = el.step.value;
      const stepVal = Number(stepRaw);
      const unitVal = (el.unitSel?.value || 'reps');
      const thresholdRaw = (el.streakThreshold?.value || '').trim();
      let thresholdVal = thresholdRaw === '' ? 1.0 : Number(thresholdRaw);
      if (!Number.isFinite(thresholdVal)) thresholdVal = 1.0;
      thresholdVal = Math.min(1, Math.max(0.5, thresholdVal));
      // Parse quick steps
      const qsRaw = (el.quickStepsInput?.value || '').trim();
      let qs = [];
      if (qsRaw) {
        qs = qsRaw.split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => Number.isFinite(n) && n >= 1 && n <= 999);
      }
      // Weekly goal
      const wgRaw = (el.weeklyGoalInput?.value || '').trim();
      const wgNum = parseInt(wgRaw, 10);

      let valid = true;
      if (!nameVal) { valid = false; setInvalid(el.name, el.errName, true); } else { setInvalid(el.name, el.errName, false); }
      if (!(Number.isFinite(dailyVal) && dailyVal >= 1)) { valid = false; setInvalid(el.daily, el.errDaily, true); } else { setInvalid(el.daily, el.errDaily, false); }

      // For add, allow blank step -> default 10; for edit, require >=1
      let finalStep;
      if (editingId === null) {
        if (stepRaw === '') { finalStep = 10; setInvalid(el.step, el.errStep, false); }
        else if (!(Number.isFinite(stepVal) && stepVal >= 1)) { valid = false; setInvalid(el.step, el.errStep, true); }
        else { finalStep = Math.max(1, stepVal); setInvalid(el.step, el.errStep, false); }
      } else {
        if (!(Number.isFinite(stepVal) && stepVal >= 1)) { valid = false; setInvalid(el.step, el.errStep, true); }
        else { finalStep = Math.max(1, stepVal); setInvalid(el.step, el.errStep, false); }
      }

      if (!valid) return;

      const listNow = loadExercises();
      if (editingId === null) {
      const ex = {
          id: uuid(),
          exerciseName: nameVal,
          dailyTarget: Math.max(1, dailyVal),
          decrementStep: finalStep,
          unit: unitVal || 'reps',
          remaining: Math.max(1, dailyVal),
          lastAppliedDate: todayStrUTC(),
          history: {},
          completionThreshold: thresholdVal,
          quickSteps: undefined,
          weeklyGoal: 0,
          badges: [],
        };
        // set quickSteps default or provided
        if (qs.length) ex.quickSteps = Array.from(new Set(qs)).sort((a,b)=>a-b).slice(0,4);
        else ex.quickSteps = getQuickStepsFor(ex);
        // set weekly goal
        const computedWG = Math.max(0, Math.floor(Math.max(1, dailyVal) * 7));
        ex.weeklyGoal = (Number.isFinite(wgNum) && wgRaw !== '') ? Math.max(0, wgNum) : computedWG;
        addPlanned(ex, todayStrUTC(), Math.max(1, dailyVal));
        listNow.push(ex);
      } else {
        const idx = listNow.findIndex((i) => i.id === editingId);
        if (idx !== -1) {
          listNow[idx].exerciseName = nameVal;
          listNow[idx].dailyTarget = Math.max(1, dailyVal);
          listNow[idx].decrementStep = finalStep;
          listNow[idx].unit = unitVal || 'reps';
          // keep remaining as-is
          if (listNow[idx].completionThreshold == null) listNow[idx].completionThreshold = 1.0;
          listNow[idx].completionThreshold = thresholdVal;
          if (!listNow[idx].history) listNow[idx].history = {};
          // update quick steps
          if (qs.length) listNow[idx].quickSteps = Array.from(new Set(qs)).sort((a,b)=>a-b).slice(0,4);
          else listNow[idx].quickSteps = getQuickStepsFor(listNow[idx]);
          // update weekly goal
          const computedWG = Math.max(0, Math.floor(Math.max(1, dailyVal) * 7));
          listNow[idx].weeklyGoal = (Number.isFinite(wgNum) && wgRaw !== '') ? Math.max(0, wgNum) : computedWG;
          invalidateStreak(listNow[idx].id);
        }
      }
      saveExercises(listNow);
      closeModal();
      renderDashboard();
    });

    // (Export/Import wired via settings modal)

    el.closeHistory?.addEventListener('click', () => {
      el.historyModal?.classList.add('hidden');
    });

    // Weekly Summary close handler
    closeWeekly?.addEventListener('click', () => weeklyModal?.classList.add('hidden'));

    // Register service worker for PWA/offline (robust, waits for full load)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(console.error);
      });
      // Update cache size when SW is ready
      navigator.serviceWorker.ready.then(() => {
        updateCacheSize();
      }).catch(() => {});
      // Listen for SW activation notifications
      try {
        navigator.serviceWorker.addEventListener('message', (e) => {
          if (e && e.data && e.data.type === 'sw-updated') {
            try { showToast?.('Updated — tap to reload'); } catch {}
            const t = document.getElementById('toast');
            t?.addEventListener('click', () => location.reload());
          }
        });
      } catch {}
    }
  });

  // --- Weekly Summary ---
  async function showWeeklySummary() {
    const list = loadExercises() || [];
    const today = todayStrUTC();
    const days = getRecentDays(7); // already oldest first

    let statsHTML = '';
    let datasets = [];

    list.forEach((ex) => {
      let planned = 0, done = 0;
      let doneArr = [], planArr = [];
      days.forEach((d) => {
        const ent = ex.history?.[d] || {};
        planned += ent.planned || 0;
        done += ent.done || 0;
        planArr.push(ent.planned || 0);
        doneArr.push(ent.done || 0);
      });
      const rate = planned > 0 ? Math.round((done / planned) * 100) : 0;
      const unit = ex.unit || 'reps';
      statsHTML += `<div><strong>${ex.exerciseName}:</strong> ${done}/${planned} ${unit} (${rate}%)</div>`;
      datasets.push({
        label: ex.exerciseName + ' planned',
        data: planArr,
        backgroundColor: 'rgba(200,200,200,0.2)',
        borderColor: 'rgba(200,200,200,0.5)',
        type: 'line'
      });
      datasets.push({
        label: ex.exerciseName + ' done',
        data: doneArr,
        backgroundColor: ex.color || '#36a2eb'
      });
    });

    if (weeklyStats) weeklyStats.innerHTML = statsHTML;

    await loadChartJs();
    if (window.__weeklyChart) { try { window.__weeklyChart.destroy(); } catch {} }
    const ctx = weeklyChartEl?.getContext('2d');
    if (ctx && window.Chart) {
      const cs = getComputedStyle(document.documentElement);
      const fg = (cs.getPropertyValue('--fg') || '#111').trim();
      window.__weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: days, datasets },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: fg } } },
          scales: {
            x: { ticks: { color: fg } },
            y: { ticks: { color: fg } }
          }
        }
      });
    }

    weeklyModal?.classList.remove('hidden');
  }

  // Expose for debugging
  window.__exerciseApp = {
    loadExercises,
    saveExercises,
    todayStrUTC,
    daysBetweenUTC,
    applyDailyRollover,
    ensureHistory,
    addPlanned,
    addDone,
    getRecentDays,
  };
  
  // Helper to update a single card's UI in place
  function updateExerciseCardView(ex) {
    const card = document.querySelector(`.ex-card[data-id="${ex.id}"]`);
    if (!card) { renderDashboard(); return; }
    const remainingEl = card.querySelector('.ex-remaining');
    if (remainingEl) setText(remainingEl, String(ex.remaining ?? 0));
    const doneMsg = card.querySelector('.done-msg');
    if (doneMsg) {
      if ((ex.remaining ?? 0) <= 0) { doneMsg.removeAttribute('hidden'); setText(doneMsg, 'Great job! ✅'); }
      else { doneMsg.setAttribute('hidden', ''); }
    }
    // Update today's stats and ring percentage
    const today = todayStrUTC();
    const entry = (ex.history && ex.history[today]) || { planned: 0, done: 0 };
    const p = Number(entry.planned || 0);
    const d = Number(entry.done || 0);
    const l = Math.max(0, p - d);
    const pct = p > 0 ? Math.min(1, d / p) : 0;
    const dailyEl = card.querySelector('.ex-daily');
    const doneEl = card.querySelector('.ex-done-today');
    const leftEl = card.querySelector('.ex-left');
    // Ensure over chip exists
    let overChip = card.querySelector('.chip-over');
    const statsWrap = card.querySelector('.ex-stats');
    if (!overChip && statsWrap) {
      overChip = document.createElement('span');
      overChip.className = 'chip chip-over';
      overChip.setAttribute('hidden', '');
      overChip.innerHTML = `+<span class="ex-over">0</span> over`;
      statsWrap.appendChild(overChip);
    }
    const unit = ex.unit || 'reps';
    if (dailyEl) setText(dailyEl, `${p} ${unit}`);
    if (doneEl) setText(doneEl, `${d} ${unit}`);
    if (leftEl) setText(leftEl, `${l} ${unit}`);
    if (overChip) {
      const overVal = Math.max(0, d - p);
      const overSpan = overChip.querySelector('.ex-over');
      if (overSpan) setText(overSpan, String(overVal));
      if (overVal > 0) overChip.removeAttribute('hidden'); else overChip.setAttribute('hidden', '');
    }
    const ring = card.querySelector('.ring');
    if (ring) {
      ring.style.setProperty('--pct', String(pct * 100));
      const newPct = (pct * 100).toFixed(2);
      ring.style.background = `conic-gradient(var(--accent) ${newPct}%, var(--track) 0)`;
    }
    // update chip colors
    {
      const dailyChip = dailyEl?.closest('.chip');
      const doneChip = doneEl?.closest('.chip');
      const leftChip = leftEl?.closest('.chip');
      [dailyChip, doneChip, leftChip].forEach(c => c && c.classList.remove('ok','warn','danger'));
      const k = (pct >= .8) ? 'ok' : (pct >= .4 ? 'warn' : 'danger');
      if (doneChip) doneChip.classList.add(k);
      const leftOverall = Number(ex.remaining || 0);
      if (leftChip) leftChip.classList.add(leftOverall === 0 ? 'ok' : (p ? (pct >= .5 ? 'warn' : 'danger') : 'warn'));
    }
    // Update badges (first 3)
    let badgesRow = card.querySelector('.ex-badges');
    if (!badgesRow) {
      badgesRow = document.createElement('div');
      badgesRow.className = 'ex-badges';
      const header = card.querySelector('.ex-header');
      if (header && header.nextSibling) card.insertBefore(badgesRow, header.nextSibling); else card.prepend(badgesRow);
    }
    badgesRow.innerHTML = '';
    const earned = Array.isArray(ex.badges) ? ex.badges.slice(0,3) : [];
    earned.forEach((id) => {
      const s = document.createElement('span');
      s.className = 'badge';
      s.title = getAchievementTitle(id);
      s.textContent = getAchievementTitle(id);
      badgesRow.appendChild(s);
    });

    // Keep quick-step buttons always enabled to allow over-goal logging

    // Redraw sparkline (last 7 days done)
    const spark = card.querySelector('.ex-sparkline');
    if (spark) {
      const days7 = getRecentDays(7);
      const series = days7.map(d => Number(ex.history?.[d]?.done || 0));
      try { drawSparkline(spark, series); } catch {}
    }
    // Update weekly progress bar
    updateWeeklyBar(card, ex);

    // Update PB pill in header
    const titleEl = card.querySelector('.ex-title');
    if (titleEl) {
      let pill = titleEl.querySelector('.ex-pb-pill');
      const pbMeta = maxDayDone(ex);
      if (pbMeta.value > 0) {
        if (!pill) {
          pill = document.createElement('span');
          pill.className = 'pill ex-pb-pill';
          titleEl.appendChild(document.createTextNode(' '));
          titleEl.appendChild(pill);
        }
        pill.textContent = `PB ${pbMeta.value}`;
      } else if (pill) {
        pill.remove();
      }
    }
  }

  // --- Confetti ---
  const confettiCanvas = document.getElementById('confettiCanvas');
  const ctx = confettiCanvas ? confettiCanvas.getContext('2d') : null;
  let confettiParticles = [];
  function resizeConfetti(){ if (!confettiCanvas) return; confettiCanvas.width = window.innerWidth; confettiCanvas.height = window.innerHeight; }
  if (confettiCanvas) { window.addEventListener('resize', resizeConfetti); resizeConfetti(); }

  function launchConfetti() {
    if (!confettiCanvas || !ctx) return;
    confettiParticles = [];
    for (let i = 0; i < 120; i++) {
      confettiParticles.push({
        x: Math.random() * confettiCanvas.width,
        y: Math.random() * confettiCanvas.height - confettiCanvas.height,
        r: 4 + Math.random() * 4,
        d: Math.random() * 5 + 2,
        color: `hsl(${Math.random() * 360},100%,50%)`,
        tilt: Math.random() * 10,
        tiltAngle: Math.random() * Math.PI
      });
    }
    requestAnimationFrame(updateConfetti);
  }

  function updateConfetti() {
    if (!confettiCanvas || !ctx) return;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles.forEach(p => {
      p.y += p.d;
      p.tiltAngle += 0.07;
      p.x += Math.sin(p.tiltAngle);
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
      ctx.fill();
    });
    confettiParticles = confettiParticles.filter(p => p.y < confettiCanvas.height + 20);
    if (confettiParticles.length > 0) requestAnimationFrame(updateConfetti);
  }
})();
