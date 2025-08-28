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

  // Small query helper
  const $ = (sel) => document.querySelector(sel);

  const LIST_KEY = 'exerciseList';
  const HISTORY_MAX_DAYS = 366;
  const ACC_KEY = 'settingsAccordionOpen';

  // Debounced saver for hot paths
  const saveDebounced = (() => { let t; return (fn) => { clearTimeout(t); t = setTimeout(fn, 120); }; })();

  // Minimal text update helper
  function setText(el, value) { if (el && el.textContent !== String(value)) el.textContent = String(value); }

  // Streak memoization (keyed by exercise id + today)
  const streakCache = new Map();
  function invalidateStreak(exId) { try { streakCache.delete(`${exId}:${todayStrUTC()}`); } catch {} }

  // Settings accordion state
  function setAccOpen(key) { try { localStorage.setItem(ACC_KEY, key); } catch {} }
  function getAccOpen() { try { return localStorage.getItem(ACC_KEY) || 'exercise'; } catch { return 'exercise'; } }

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
      actOn((s) => { s.remaining -= dec; addDone(s, todayStrUTC(), dec); });
      toastMsg = `Logged −${dec}`;
    } else if (addStr) {
      const times = Math.max(1, parseInt(addStr, 10) || 0);
      actOn((s) => { const inc = (Number(s.dailyTarget || 0) * times); s.remaining += inc; addPlanned(s, todayStrUTC(), inc); });
      toastMsg = `Added +${times}× target`;
    }

    if (toastMsg) showToast(toastMsg);

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

  let editingId = null; // null => adding new

  function openModal(mode, exercise) {
    editingId = exercise ? exercise.id : null;
    el.modalTitle.textContent = mode === 'edit' ? 'Edit Exercise' : 'Add Exercise';
    el.name.value = exercise ? exercise.exerciseName : '';
    el.daily.value = exercise ? String(exercise.dailyTarget) : '';
    el.step.value = exercise ? String(exercise.decrementStep) : '';
    if (el.streakThreshold) {
      const thr = exercise ? (Number(exercise.completionThreshold ?? 1.0)) : 1.0;
      el.streakThreshold.value = String(Math.min(1, Math.max(0.5, Number.isFinite(thr) ? thr : 1.0)));
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
  }

  function closeModal() {
    el.modal.hidden = true;
    editingId = null;
    el.name.value = '';
    el.daily.value = '';
    el.step.value = '';
    if (el.streakThreshold) el.streakThreshold.value = '';
    if (el.quickStepsInput) el.quickStepsInput.value = '';
    if (el.weeklyGoalInput) el.weeklyGoalInput.value = '';
    clearErrors();
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
    const list = loadExercises();
    el.list.innerHTML = '';
    const containerFrag = document.createDocumentFragment();

    list.forEach((ex) => {
      // defaults for new fields
      if (ex.completionThreshold == null) ex.completionThreshold = 1.0;
      if (!ex.history) ex.history = {};
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

      // Stats strip
      const stats = document.createElement('div');
      stats.className = 'ex-stats';
      stats.innerHTML = `
        <span class="chip"><span class="lbl">Daily</span><span class="val ex-daily">${planned}</span></span>
        <span class="chip"><span class="lbl">Done</span><span class="val ex-done-today">${done}</span></span>
        <span class="chip"><span class="lbl">Left</span><span class="val ex-left">${leftToday}</span></span>
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
      card.append(header, progress, stats, spark);
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
        if ((ex.remaining ?? 0) <= 0) b.disabled = true;
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
    if (label) label.textContent = `This week: ${done} / ${goal}`;
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
      sparkTooltip.textContent = `${day}: ${val}`;
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
      const dec = Math.min(currentAmt, Math.max(0, Number(ex.remaining || 0)));
      ex.remaining = Math.max(0, Number(ex.remaining || 0) - dec);
      addDone(ex, today, dec);
      pruneHistory(ex);
      invalidateStreak(ex.id);
      persistExercise(ex);
      if (typeof updateCard === 'function') updateCard(ex);
      // Confetti + disable buttons when done
      if ((ex.remaining || 0) <= 0) {
        const today2 = todayStrUTC();
        if ((ex._confettiDoneForToday || '') !== today2) {
          try { ex._confettiDoneForToday = today2; } catch {}
          persistExercise(ex);
          try { launchConfetti(); } catch {}
        }
        const card = btn.closest('.ex-card');
        if (card) Array.from(card.querySelectorAll('.ex-buttons button')).forEach(b => b.disabled = true);
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
    el.historyStats.innerHTML = `
      <div class="stack">
        <div><strong>Last 7 days:</strong> Planned ${s7.planned}, Done ${s7.done} — ${r7}%</div>
        <div><strong>Last 30 days:</strong> Planned ${s30.planned}, Done ${s30.done} — ${r30}%</div>
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
        <div>Planned: ${ent.planned}</div>
        <div>Done: ${ent.done}</div>
        <div>${pct}%</div>
      `;
      el.historyList.appendChild(row);
    });

    // Render bar chart for last 14 days (planned vs done)
    if (window.__historyChart) {
      try { window.__historyChart.destroy(); } catch {}
      window.__historyChart = null;
    }
    await loadChartJs();
    const ctx = el.historyChart?.getContext('2d');
    if (ctx && window.Chart) {
      const cs = getComputedStyle(document.documentElement);
      const fg = (cs.getPropertyValue('--fg') || '#111').trim();
      const grid = (cs.getPropertyValue('--border') || '#ddd').trim();
      const days = recentDays; // already oldest -> newest
      const planned = days.map(d => Number((ex.history[d]?.planned) || 0));
      const done = days.map(d => Number((ex.history[d]?.done) || 0));
      window.__historyChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: days,
          datasets: [
            {
              label: 'Planned',
              data: planned,
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
              borderColor: 'rgba(59, 130, 246, 1)',
              borderWidth: 1,
            },
            {
              label: 'Done',
              data: done,
              backgroundColor: 'rgba(16, 185, 129, 0.5)',
              borderColor: 'rgba(16, 185, 129, 1)',
              borderWidth: 1,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: fg }, grid: { color: grid } },
            y: { beginAtZero: true, ticks: { color: fg }, grid: { color: grid } }
          },
          plugins: {
            legend: { position: 'top', labels: { color: fg } }
          }
        }
      });
    }

    el.historyModal.classList.remove('hidden');
  }

  // ---------- Init & Events ----------
  document.addEventListener('DOMContentLoaded', () => {
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
    const exerciseSelect = $('#exerciseSelect');
    const customAmount = $('#customAmount');
    const applyCustomBtn = $('#applyCustomBtn');
    const settingsAddTargetBtn = $('#settingsAddTargetBtn');
    const settingsHistoryBtn = $('#settingsHistoryBtn');
    const toggleDebugBtn = $('#toggleDebugBtn');
    const debugPanel = $('#debugPanel');

    if (darkToggle) darkToggle.checked = isDark;
    // Rollover for each exercise on load
    const list = loadExercises();
    let changed = false;
    list.forEach((ex) => { if (applyDailyRollover(ex)) changed = true; });
    if (changed) saveExercises(list);
    // Handle any URL quick actions before the first render
    handleURLQuickAction();
    renderDashboard();
    // Initialize storage size meter
    updateStorageSize();

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

    function openSettings() {
      populateExerciseSelect();
      // Initialize accordion
      const container = settingsModal?.querySelector('#settingsAccordion');
      if (container) {
        const sections = Array.from(container.querySelectorAll('.acc-section'));
        const desired = getAccOpen();
        sections.forEach((section) => {
          const key = section.getAttribute('data-key') || '';
          const header = section.querySelector('.acc-header');
          const panel = section.querySelector('.acc-panel');
          if (!header || !panel) return;
          if (!header.dataset.wired) {
            header.addEventListener('click', () => {
              sections.forEach((s) => {
                const h = s.querySelector('.acc-header');
                s.classList.remove('open');
                if (h) h.setAttribute('aria-expanded', 'false');
              });
              section.classList.add('open');
              header.setAttribute('aria-expanded', 'true');
              setAccOpen(key);
            });
            header.dataset.wired = '1';
          }
          if (key === desired) {
            section.classList.add('open');
            header.setAttribute('aria-expanded', 'true');
          } else {
            section.classList.remove('open');
            header.setAttribute('aria-expanded', 'false');
          }
        });
      }
      settingsModal?.classList.remove('hidden');
    }
    function closeSettings() {
      settingsModal?.classList.add('hidden');
    }

    settingsBtn?.addEventListener('click', openSettings);
    closeSettingsBtn?.addEventListener('click', closeSettings);
    exerciseSelect?.addEventListener('change', (e) => {
      currentExerciseId = e.target.value || null;
    });

    // Close on Escape and overlay click
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !settingsModal?.classList.contains('hidden')) closeSettings();
    });
    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettings();
    });

    // Global actions in modal
    addExerciseBtn?.addEventListener('click', () => {
      closeSettings();
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
            closeSettings();
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
      saveDebounced(() => saveExercises(items));
      updateExerciseCardView(ex);
      showToast(`−${amt} logged`);
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
      saveDebounced(() => saveExercises(items));
      updateExerciseCardView(ex);
      showToast(`+${inc} added`);
    });

    settingsHistoryBtn?.addEventListener('click', () => {
      if (!currentExerciseId) return;
      closeSettings();
      openHistory(currentExerciseId);
    });

    el.cancelBtn?.addEventListener('click', closeModal);

    el.saveBtn?.addEventListener('click', () => {
      const nameVal = (el.name.value || '').trim();
      const dailyVal = Number(el.daily.value);
      const stepRaw = el.step.value;
      const stepVal = Number(stepRaw);
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
          remaining: Math.max(1, dailyVal),
          lastAppliedDate: todayStrUTC(),
          history: {},
          completionThreshold: thresholdVal,
          quickSteps: undefined,
          weeklyGoal: 0,
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
      statsHTML += `<div><strong>${ex.exerciseName}:</strong> ${done}/${planned} reps (${rate}%)</div>`;
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
    if (dailyEl) setText(dailyEl, String(p));
    if (doneEl) setText(doneEl, String(d));
    if (leftEl) setText(leftEl, String(l));
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
    // enable/disable quick-step buttons based on remaining
    const qsBtns = card.querySelectorAll('.ex-buttons button');
    qsBtns.forEach(b => { b.disabled = (ex.remaining || 0) <= 0; });

    // Redraw sparkline (last 7 days done)
    const spark = card.querySelector('.ex-sparkline');
    if (spark) {
      const days7 = getRecentDays(7);
      const series = days7.map(d => Number(ex.history?.[d]?.done || 0));
      try { drawSparkline(spark, series); } catch {}
    }
    // Update weekly progress bar
    updateWeeklyBar(card, ex);
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
