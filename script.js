import { getFriendsExercises } from './getFriendsExercises.js';

const PANEL_ID = 'friendsHoloPanel';
const PANEL_TITLE = 'Allied Hunters';
const PANEL_SUBTITLE = 'Squad Uplinks';

function getCurrentUser() {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.currentUser || globalThis.user || null;
}

function ensurePanel() {
  if (typeof document === 'undefined') return null;
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'quest-panel';
    document.body.appendChild(panel);
  }
  return panel;
}

function renderPanelSkeleton(panel, subtitleText) {
  if (!panel) return { body: null };
  panel.innerHTML = '';

  const strip = document.createElement('div');
  strip.className = 'quest-header-strip';
  strip.textContent = subtitleText;
  panel.appendChild(strip);

  const body = document.createElement('div');
  body.className = 'quest-body';
  panel.appendChild(body);

  const title = document.createElement('h3');
  title.className = 'quest-goals-title';
  title.textContent = PANEL_TITLE;
  body.appendChild(title);

  return { body };
}

function createExerciseRow(exercise) {
  const row = document.createElement('div');
  row.className = 'quest-history-row';

  const label = document.createElement('span');
  label.className = 'quest-history-label';
  label.textContent = exercise?.name || 'Unknown';

  const value = document.createElement('span');
  value.className = 'quest-history-value';
  value.textContent = `${exercise?.reps ?? 0} reps`;

  row.append(label, value);
  return row;
}

function createFriendCard(friend) {
  const safeExercises = Array.isArray(friend.exercises) ? friend.exercises : [];
  const totalReps = safeExercises.reduce((sum, current) => sum + Number(current?.reps || 0), 0);
  const item = document.createElement('li');
  item.className = 'quest-history-item';

  const headerRow = document.createElement('div');
  headerRow.className = 'quest-history-row';

  const nameEl = document.createElement('span');
  nameEl.className = 'quest-goal-name';
  nameEl.textContent = friend.friend_name || friend.friend_id || 'Unknown Hunter';

  const repsEl = document.createElement('span');
  repsEl.className = 'quest-goal-count';
  repsEl.textContent = `${totalReps} reps`;

  headerRow.append(nameEl, repsEl);
  item.appendChild(headerRow);

  const history = document.createElement('div');
  history.className = 'quest-history';

  if (safeExercises.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'quest-empty';
    empty.textContent = 'No recent logs';
    history.appendChild(empty);
  } else {
    safeExercises.forEach((exercise) => {
      history.appendChild(createExerciseRow(exercise));
    });
  }

  item.appendChild(history);
  return item;
}

function renderFriends(panel, friends) {
  const { body } = renderPanelSkeleton(panel, PANEL_SUBTITLE);
  if (!body) return;

  if (!friends.length) {
    const empty = document.createElement('p');
    empty.className = 'quest-empty';
    empty.textContent = 'Add allies to see their progress.';
    body.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'quest-history-list';
  friends.forEach((friend) => {
    list.appendChild(createFriendCard(friend));
  });
  body.appendChild(list);
}

function renderError(panel, message) {
  const { body } = renderPanelSkeleton(panel, PANEL_SUBTITLE);
  if (!body) return;
  const warning = document.createElement('p');
  warning.className = 'quest-warning';
  warning.textContent = message;
  body.appendChild(warning);
}

export async function showFriends() {
  const currentUser = getCurrentUser();
  if (!currentUser?.id) {
    console.warn('showFriends: current user is missing an id');
    return [];
  }

  const panel = ensurePanel();
  renderPanelSkeleton(panel, 'Syncing Squad');

  try {
    const friends = await getFriendsExercises(currentUser.id);
    renderFriends(panel, friends || []);
    return friends;
  } catch (error) {
    console.error('showFriends: failed to load friends', error);
    renderError(panel, 'Unable to reach guild hall. Try again later.');
    throw error;
  }
}
