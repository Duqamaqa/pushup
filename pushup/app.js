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

  function applyDailyRollover(exercise) {
    const today = todayStrUTC();
    const daysPassed = daysBetweenUTC(exercise.lastAppliedDate, today);
    if (daysPassed > 0) {
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

  // ---------- Elements ----------
  const el = {
    list: document.getElementById('exerciseListContainer'),
    addExerciseBtn: document.getElementById('addExerciseBtn'),
    // Modal
    modal: document.getElementById('setup-view'),
    modalTitle: document.getElementById('modal-title'),
    name: document.getElementById('exerciseName'),
    daily: document.getElementById('dailyTarget'),
    step: document.getElementById('decrementStep'),
    errName: document.getElementById('exerciseNameError'),
    errDaily: document.getElementById('dailyTargetError'),
    errStep: document.getElementById('decrementStepError'),
    saveBtn: document.getElementById('saveExerciseBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
  };

  let editingId = null; // null => adding new

  function openModal(mode, exercise) {
    editingId = exercise ? exercise.id : null;
    el.modalTitle.textContent = mode === 'edit' ? 'Edit Exercise' : 'Add Exercise';
    el.name.value = exercise ? exercise.exerciseName : '';
    el.daily.value = exercise ? String(exercise.dailyTarget) : '';
    el.step.value = exercise ? String(exercise.decrementStep) : '';
    clearErrors();
    el.modal.hidden = false;
  }

  function closeModal() {
    el.modal.hidden = true;
    editingId = null;
    el.name.value = '';
    el.daily.value = '';
    el.step.value = '';
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
      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.dataset.id = ex.id;

      const title = document.createElement('h2');
      title.textContent = ex.exerciseName || 'Exercise';

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

      const doBtn = document.createElement('button');
      doBtn.className = 'primary large btn-block';
      doBtn.textContent = `Do −${ex.decrementStep}`;

      const toolbar = document.createElement('div');
      toolbar.className = 'card-toolbar';
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      const addBtn = document.createElement('button');
      addBtn.textContent = 'Add target again';
      const resetBtn = document.createElement('button');
      resetBtn.className = 'danger';
      resetBtn.textContent = 'Reset';
      toolbar.append(editBtn, addBtn, resetBtn);

      card.append(title, remainingWrap, doneMsg, doBtn, toolbar);
      el.list.appendChild(card);

      // Handlers per card
      doBtn.addEventListener('click', () => {
        const items = loadExercises();
        const idx = items.findIndex((i) => i.id === ex.id);
        if (idx === -1) return;
        const step = Math.max(1, Number(items[idx].decrementStep || 1));
        items[idx].remaining = Math.max(0, Number(items[idx].remaining || 0) - step);
        saveExercises(items);
        // Flash
        remainingWrap.classList.remove('flash-success');
        void remainingWrap.offsetWidth;
        remainingWrap.classList.add('flash-success');
        setTimeout(() => remainingWrap.classList.remove('flash-success'), 350);
        renderDashboard();
      });

      addBtn.addEventListener('click', () => {
        const items = loadExercises();
        const idx = items.findIndex((i) => i.id === ex.id);
        if (idx === -1) return;
        items[idx].remaining = Number(items[idx].remaining || 0) + Math.max(1, Number(items[idx].dailyTarget || 0));
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
    });
  }

  // ---------- Init & Events ----------
  document.addEventListener('DOMContentLoaded', () => {
    // Rollover for each exercise on load
    const list = loadExercises();
    let changed = false;
    list.forEach((ex) => { if (applyDailyRollover(ex)) changed = true; });
    if (changed) saveExercises(list);
    renderDashboard();

    el.addExerciseBtn?.addEventListener('click', () => openModal('add'));

    el.cancelBtn?.addEventListener('click', closeModal);

    el.saveBtn?.addEventListener('click', () => {
      const nameVal = (el.name.value || '').trim();
      const dailyVal = Number(el.daily.value);
      const stepRaw = el.step.value;
      const stepVal = Number(stepRaw);

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
        };
        listNow.push(ex);
      } else {
        const idx = listNow.findIndex((i) => i.id === editingId);
        if (idx !== -1) {
          listNow[idx].exerciseName = nameVal;
          listNow[idx].dailyTarget = Math.max(1, dailyVal);
          listNow[idx].decrementStep = finalStep;
          // keep remaining as-is
        }
      }
      saveExercises(listNow);
      closeModal();
      renderDashboard();
    });

    // Register service worker for PWA/offline
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  });

  // Expose for debugging
  window.__exerciseApp = {
    loadExercises,
    saveExercises,
    todayStrUTC,
    daysBetweenUTC,
    applyDailyRollover,
  };
})();

