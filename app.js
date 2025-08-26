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

(function () {
  'use strict';

  const LIST_KEY = 'exerciseList';

  // ---------- Helpers: storage & date ----------
  function loadExercises() {
    try {
      const raw = localStorage.getItem(LIST_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('Failed to load exercises:', e);
      return [];
    }
  }

  function saveExercises(list) {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
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
    let count = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const { completed } = getCompletionForDate(ex, days[i]);
      if (completed) count++; else break;
    }
    return count;
  }

  function applyDailyRollover(exercise) {
    const today = todayStrUTC();
    const last = exercise.lastAppliedDate;
    const daysPassed = daysBetweenUTC(last, today);
    if (daysPassed > 0) {
      // Add planned for each missed day including today
      const base = last ? new Date(Date.UTC(...last.split('-').map((v, i) => i === 1 ? (Number(v) - 1) : Number(v)))) : null;
      for (let i = 1; i <= daysPassed; i++) {
        const dt = base ? new Date(base) : new Date();
        if (base) dt.setUTCDate(dt.getUTCDate() + i);
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        const ds = `${y}-${m}-${d}`;
        addPlanned(exercise, ds, Number(exercise.dailyTarget || 0));
      }
      exercise.remaining = Number(exercise.remaining || 0) + Number(exercise.dailyTarget || 0) * daysPassed;
      exercise.lastAppliedDate = today;
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
    addExerciseBtn: document.getElementById('addExerciseBtn'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    darkToggle: document.getElementById('darkToggle'),
    // Modal
    modal: document.getElementById('setup-view'),
    modalTitle: document.getElementById('modal-title'),
    name: document.getElementById('exerciseName'),
    daily: document.getElementById('dailyTarget'),
    step: document.getElementById('decrementStep'),
    streakThreshold: document.getElementById('streakThreshold'),
    quickStepsInput: document.getElementById('quickStepsInput'),
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

    list.forEach((ex) => {
      // defaults for new fields
      if (ex.completionThreshold == null) ex.completionThreshold = 1.0;
      if (!ex.history) ex.history = {};

      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.dataset.id = ex.id;

      const title = document.createElement('h2');
      title.textContent = ex.exerciseName || 'Exercise';

      const streak = document.createElement('div');
      streak.className = 'streak';
      const sCount = getStreak(ex);
      streak.innerHTML = `🔥 <span class="streakCount">${sCount}</span> day streak`;

      const remainingWrap = document.createElement('div');
      remainingWrap.className = 'remaining-wrap';
      const remaining = document.createElement('div');
      remaining.className = 'exercise-remaining';
      remaining.textContent = String(ex.remaining ?? 0);
      remainingWrap.appendChild(remaining);

      const doneMsg = document.createElement('div');
      doneMsg.className = 'done-msg';
      if ((ex.remaining ?? 0) <= 0) {
        doneMsg.textContent = 'Great job! ✅';
      } else {
        doneMsg.textContent = '';
        doneMsg.setAttribute('hidden', '');
      }

      // Quick steps buttons
      const quickSteps = getQuickStepsFor(ex);
      const qsWrap = document.createElement('div');
      qsWrap.className = 'quick-steps';
      quickSteps.forEach((n) => {
        const b = document.createElement('button');
        b.className = 'primary';
        b.textContent = `−${n}`;
        if ((ex.remaining ?? 0) <= 0) b.disabled = true;
        b.addEventListener('click', () => {
          const items = loadExercises();
          const idx = items.findIndex((i) => i.id === ex.id);
          if (idx === -1) return;
          const amount = Math.max(1, Number(n));
          items[idx].remaining = Math.max(0, Number(items[idx].remaining || 0) - amount);
          addDone(items[idx], todayStrUTC(), amount);
          saveExercises(items);
          remainingWrap.classList.remove('flash-success');
          void remainingWrap.offsetWidth;
          remainingWrap.classList.add('flash-success');
          setTimeout(() => remainingWrap.classList.remove('flash-success'), 350);
          renderDashboard();
        });
        qsWrap.appendChild(b);
      });
      const customBtn = document.createElement('button');
      customBtn.textContent = 'Custom';
      if ((ex.remaining ?? 0) <= 0) customBtn.disabled = true;
      customBtn.addEventListener('click', () => {
        const val = prompt('Enter custom amount (positive integer):');
        if (val == null) return;
        const amt = parseInt(String(val).trim(), 10);
        if (!(Number.isFinite(amt) && amt >= 1)) return;
        const items = loadExercises();
        const idx = items.findIndex((i) => i.id === ex.id);
        if (idx === -1) return;
        items[idx].remaining = Math.max(0, Number(items[idx].remaining || 0) - amt);
        addDone(items[idx], todayStrUTC(), amt);
        saveExercises(items);
        renderDashboard();
      });
      qsWrap.appendChild(customBtn);

      const toolbar = document.createElement('div');
      toolbar.className = 'card-toolbar';
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      const addBtn = document.createElement('button');
      addBtn.textContent = 'Add target again';
      const resetBtn = document.createElement('button');
      resetBtn.className = 'danger';
      resetBtn.textContent = 'Reset';
      const historyBtn = document.createElement('button');
      historyBtn.textContent = 'History';
      historyBtn.dataset.action = 'history';
      toolbar.append(editBtn, addBtn, resetBtn, historyBtn);

      card.append(title, streak, remainingWrap, doneMsg, qsWrap, toolbar);
      el.list.appendChild(card);

      // Handlers per card

      addBtn.addEventListener('click', () => {
        const items = loadExercises();
        const idx = items.findIndex((i) => i.id === ex.id);
        if (idx === -1) return;
        const inc = Math.max(1, Number(items[idx].dailyTarget || 0));
        items[idx].remaining = Number(items[idx].remaining || 0) + inc;
        addPlanned(items[idx], todayStrUTC(), inc);
        saveExercises(items);
        renderDashboard();
      });

      editBtn.addEventListener('click', () => {
        openModal('edit', ex);
      });

      resetBtn.addEventListener('click', () => {
        if (!confirm('Remove this exercise?')) return;
        const items = loadExercises().filter((i) => i.id !== ex.id);
        saveExercises(items);
        renderDashboard();
      });

      historyBtn.addEventListener('click', () => {
        openHistory(ex.id);
      });
    });
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

  function openHistory(exId) {
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
    if (el.darkToggle) el.darkToggle.checked = isDark;
    // Rollover for each exercise on load
    const list = loadExercises();
    let changed = false;
    list.forEach((ex) => { if (applyDailyRollover(ex)) changed = true; });
    if (changed) saveExercises(list);
    // Handle any URL quick actions before the first render
    handleURLQuickAction();
    renderDashboard();

    el.addExerciseBtn?.addEventListener('click', () => openModal('add'));

    // Theme toggle wiring
    el.darkToggle?.addEventListener('change', () => {
      const useDark = !!el.darkToggle.checked;
      document.documentElement.classList.toggle('dark', useDark);
      localStorage.setItem('theme', useDark ? 'dark' : 'light');
      // Update chart theme if open
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
        };
        // set quickSteps default or provided
        if (qs.length) ex.quickSteps = Array.from(new Set(qs)).sort((a,b)=>a-b).slice(0,4);
        else ex.quickSteps = getQuickStepsFor(ex);
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
        }
      }
      saveExercises(listNow);
      closeModal();
      renderDashboard();
    });

    // Export / Import wiring
    el.exportBtn?.addEventListener('click', () => {
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

    el.importBtn?.addEventListener('click', () => {
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
            // Basic validation and normalization
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
            }));
            saveExercises(norm);
            renderDashboard();
            showToast('Import successful');
          } catch (e) {
            alert('Failed to import JSON: ' + e.message);
          }
        };
        reader.readAsText(file);
      });
      input.click();
    });

    el.closeHistory?.addEventListener('click', () => {
      el.historyModal?.classList.add('hidden');
    });

    // Register service worker for PWA/offline (robust, waits for full load)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(console.error);
      });
    }
  });

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
})();
