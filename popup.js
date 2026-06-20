// =============================================================================
// QuickSlots — popup.js
// Renders 4 slots + Recent History + Settings (storage mode). Handles copy /
// edit / delete / clear-all / clear-history / search (slots + history) /
// modal / storage-mode toggle / sync status indicator.
// =============================================================================

// ─── State ───────────────────────────────────────────────────────────────────
let slots        = ['', '', '', ''];  // 4-item array, index 0-3
let history      = [];                // newest-first array of strings
let editingIndex = null;              // which slot is open in the modal
let searchQuery  = '';
let storageMode  = 'sync';            // 'sync' | 'local' — mirrors background.js setting
let hasFallback  = false;             // true if any key has overflowed to local while in sync mode

// Drag & drop reorder state — only ever set while a slot drag is in progress.
let dragSrcIndex = null;              // index (into `slots`) currently being dragged

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const slotList        = document.getElementById('slot-list');
const historyList      = document.getElementById('history-list');
const searchEl         = document.getElementById('search');
const searchX            = document.getElementById('search-x');
const overlay             = document.getElementById('overlay');
const modalNum             = document.getElementById('modal-num');
const modalTa                = document.getElementById('modal-ta');
const modalChars             = document.getElementById('modal-chars');
const modalSave                = document.getElementById('modal-save');
const modalCancel                = document.getElementById('modal-cancel');
const modalClose                   = document.getElementById('modal-close');
const btnClearAll                    = document.getElementById('btn-clear-all');
const btnClearHistory                  = document.getElementById('btn-clear-history');
const toastEl                            = document.getElementById('toast');
const syncStatusEl                       = document.getElementById('sync-status');
const syncStatusIco                      = document.getElementById('sync-status-ico');
const syncStatusText                     = document.getElementById('sync-status-text');
const modeSyncRadio                      = document.getElementById('mode-sync');
const modeLocalRadio                     = document.getElementById('mode-local');

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [slotsRes, historyRes, statusRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'getSlots' }),
      chrome.runtime.sendMessage({ action: 'getHistory' }),
      chrome.runtime.sendMessage({ action: 'getStorageStatus' })
    ]);
    slots       = slotsRes?.slots || ['', '', '', ''];
    history     = historyRes?.history || [];
    storageMode = statusRes?.mode || 'sync';
    hasFallback = !!statusRes?.anyFallback;
  } catch {
    slots       = ['', '', '', ''];
    history     = [];
    storageMode = 'sync';
    hasFallback = false;
  }
  render();
}
init();

// ─── Render (slots + history + settings/status) ────────────────────────────────
function render() {
  renderSlots();
  renderHistory();
  renderStorageStatus();
}

function renderStorageStatus() {
  // Radio buttons reflect current mode
  modeSyncRadio.checked  = storageMode === 'sync';
  modeLocalRadio.checked = storageMode === 'local';

  syncStatusEl.classList.remove('is-synced', 'is-local', 'is-fallback');

  if (storageMode === 'local') {
    syncStatusIco.textContent  = '💻';
    syncStatusText.textContent = 'Local Only';
    syncStatusEl.classList.add('is-local');
    syncStatusEl.title = 'Data is stored only on this device.';
  } else if (hasFallback) {
    syncStatusIco.textContent  = '☁';
    syncStatusText.textContent = 'Partial Sync';
    syncStatusEl.classList.add('is-fallback');
    syncStatusEl.title = 'Some items were too large to sync and are stored locally.';
  } else {
    syncStatusIco.textContent  = '☁';
    syncStatusText.textContent = 'Synced';
    syncStatusEl.classList.add('is-synced');
    syncStatusEl.title = 'Data syncs across your devices via your Google account.';
  }
}

function renderSlots() {
  slotList.innerHTML = '';

  const q = searchQuery.toLowerCase().trim();
  const reorderable = !q; // dragging is only meaningful on the full, unfiltered list
  let visible = 0;

  for (let i = 0; i < 4; i++) {
    const text  = slots[i] || '';
    const num   = i + 1;
    const empty = !text;

    // Filter by search query (skip empty slots when searching)
    if (q) {
      if (empty || !text.toLowerCase().includes(q)) continue;
    }

    visible++;

    // Preview: collapse newlines, truncate
    const preview = empty
      ? 'Empty — press Ctrl+Shift+' + num + ' to save'
      : text.replace(/\n/g, ' ↵ ').slice(0, 85) + (text.length > 85 ? '…' : '');

    // Meta stats
    const words = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    const meta  = text ? `${text.length} chars · ${words} words` : '';

    // Card HTML
    const card = document.createElement('div');
    card.className = 'slot-card' + (empty ? ' empty' : '') + (reorderable ? '' : ' search-disabled');
    card.dataset.index = i;

    // Only the handle is draggable-from; the card listens for the drag
    // events, but draggable="true" lives on the handle element itself so
    // clicks/selection elsewhere on the card (copy/edit/delete, text
    // selection in the preview) are completely unaffected.
    const canDrag = reorderable && !empty;

    card.innerHTML = `
      <div class="drag-handle" ${canDrag ? 'draggable="true"' : ''} title="${canDrag ? 'Drag to reorder' : ''}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/>
          <circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/>
          <circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/>
        </svg>
      </div>
      <div class="slot-key">${num}</div>
      <div class="slot-body">
        <div class="slot-label">Slot ${num}</div>
        <div class="slot-preview${empty ? ' placeholder' : ''}" title="${esc(text)}">${highlight(esc(preview), q)}</div>
        ${text ? `<div class="slot-meta">${esc(meta)}</div>` : ''}
      </div>
      <div class="slot-actions">
        ${text ? `
          <button class="act-btn copy" data-act="copy" data-index="${i}" title="Copy to clipboard">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>` : ''}
        <button class="act-btn edit" data-act="edit" data-index="${i}" title="${empty ? 'Add text' : 'Edit slot'}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        ${text ? `
          <button class="act-btn del" data-act="delete" data-index="${i}" title="Delete slot">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>` : ''}
      </div>
    `;

    slotList.appendChild(card);
  }

  // Empty state when search finds nothing among slots
  if (visible === 0) {
    const es = document.createElement('div');
    es.className = 'empty-state';
    es.innerHTML = `
      <div class="es-ico">📋</div>
      <p>${q ? 'No slots match your search.' : 'All slots are empty.'}</p>
    `;
    slotList.appendChild(es);
  }
}

function renderHistory() {
  historyList.innerHTML = '';

  const q = searchQuery.toLowerCase().trim();
  let visible = 0;

  history.forEach((text, i) => {
    if (q && !text.toLowerCase().includes(q)) return;
    visible++;

    const preview = text.replace(/\n/g, ' ↵ ').slice(0, 85) + (text.length > 85 ? '…' : '');
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const meta  = `${text.length} chars · ${words} words`;

    const card = document.createElement('div');
    card.className = 'history-card';
    card.dataset.index = i;

    card.innerHTML = `
      <div class="history-ico">🕒</div>
      <div class="history-body">
        <div class="history-preview" title="${esc(text)}">${highlight(esc(preview), q)}</div>
        <div class="history-meta">${esc(meta)}</div>
      </div>
      <div class="history-actions">
        <button class="act-btn copy" data-hact="copy" data-index="${i}" title="Copy to clipboard">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button class="act-btn del" data-hact="delete" data-index="${i}" title="Delete from history">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    `;

    historyList.appendChild(card);
  });

  if (visible === 0) {
    const es = document.createElement('div');
    es.className = 'empty-state';
    es.innerHTML = `
      <div class="es-ico">🕒</div>
      <p>${q ? 'No history matches your search.' : 'No history yet.'}</p>
    `;
    historyList.appendChild(es);
  }
}

// ─── Event delegation — Slot list ────────────────────────────────────────────
slotList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const idx = parseInt(btn.dataset.index, 10);
  if (act === 'copy')   doCopy(idx);
  if (act === 'edit')   openModal(idx);
  if (act === 'delete') doDelete(idx);
});

// ─── Drag & Drop — Slot reorder ──────────────────────────────────────────────
// Only the ☰ handle inside a card has draggable="true", so a drag gesture
// can only start from the handle. The events themselves are delegated on
// slotList (event bubbling) rather than bound per-card, since cards are
// torn down and rebuilt on every render().
//
// dragstart  → fires on the handle; we resolve the owning .slot-card and
//              remember its slots-array index as the drag source.
// dragenter/dragover → fire on whatever element the pointer is over; we walk
//              up to the nearest .slot-card to highlight it as a drop target.
// dragleave  → clears the highlight when the pointer exits that card.
// drop       → performs the actual array splice + persists the new order.
// dragend    → always fires last (success or cancel) — guaranteed cleanup.

slotList.addEventListener('dragstart', (e) => {
  const handle = e.target.closest('.drag-handle[draggable="true"]');
  if (!handle) return; // ignore drags that didn't originate on a handle

  const card = handle.closest('.slot-card');
  if (!card) return;

  dragSrcIndex = parseInt(card.dataset.index, 10);
  card.classList.add('dragging');

  // Use a transparent 1x1 drag image so the browser's default "ghost"
  // doesn't fight with our own CSS-driven dragging visual (scale + fade).
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', String(dragSrcIndex));
  } catch { /* some embedders restrict setData — non-fatal, we use dragSrcIndex directly */ }
});

slotList.addEventListener('dragenter', (e) => {
  if (dragSrcIndex === null) return;
  const card = e.target.closest('.slot-card');
  if (!card || card.classList.contains('empty')) return;
  e.preventDefault();
});

slotList.addEventListener('dragover', (e) => {
  if (dragSrcIndex === null) return;
  if (searchQuery.trim()) return; // search started mid-drag — bail out, dragend will clean up
  const card = e.target.closest('.slot-card');
  if (!card || card.classList.contains('empty')) return;

  e.preventDefault(); // required to allow dropping
  e.dataTransfer.dropEffect = 'move';

  const targetIndex = parseInt(card.dataset.index, 10);
  if (targetIndex === dragSrcIndex) {
    card.classList.remove('drag-over');
    return;
  }

  // Clear any other card's highlight before applying this one — only one
  // drop target should ever be highlighted at a time.
  slotList.querySelectorAll('.slot-card.drag-over').forEach(el => {
    if (el !== card) el.classList.remove('drag-over');
  });
  card.classList.add('drag-over');
});

slotList.addEventListener('dragleave', (e) => {
  const card = e.target.closest('.slot-card');
  if (!card) return;
  // Only clear if we've actually left the card (not just moved between its
  // children, which also fires dragleave on the inner element).
  if (card.contains(e.relatedTarget)) return;
  card.classList.remove('drag-over');
});

slotList.addEventListener('drop', async (e) => {
  if (dragSrcIndex === null) return;
  e.preventDefault();

  const card = e.target.closest('.slot-card');
  slotList.querySelectorAll('.slot-card.drag-over').forEach(el => el.classList.remove('drag-over'));

  if (!card || card.classList.contains('empty')) return;

  const targetIndex = parseInt(card.dataset.index, 10);
  if (targetIndex === dragSrcIndex) return; // dropped on itself — no-op

  await reorderSlot(dragSrcIndex, targetIndex);
});

slotList.addEventListener('dragend', () => {
  // Guaranteed to fire whether the drop succeeded, was cancelled, or the
  // user pressed Escape mid-drag — always reset all drag-related classes.
  slotList.querySelectorAll('.slot-card.dragging').forEach(el => el.classList.remove('dragging'));
  slotList.querySelectorAll('.slot-card.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragSrcIndex = null;
});

/**
 * Move the slot at `from` to position `to`, shifting everything between.
 * Updates the local `slots` array immediately (snappy UI), persists the
 * full new order to storage, and rolls back on failure. Because keyboard
 * shortcuts always read slots[0..3] directly, this single array mutation
 * is also what makes Alt+Shift+1..4 follow the new physical order with no
 * extra mapping layer needed.
 */
async function reorderSlot(from, to) {
  const previous = slots.slice(); // shallow copy for rollback

  const next = slots.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  slots = next;
  render();

  try {
    const res = await chrome.runtime.sendMessage({ action: 'reorderSlots', slots });
    if (!res?.ok) throw new Error(res?.error || 'Reorder failed');
    slots = res.slots || slots;
    refreshStorageStatus();
    playDropSettle(to);
    toast('Slot order updated', 'ok');
  } catch {
    slots = previous; // revert optimistic update
    render();
    toast('Failed to save new order', 'err');
  }
}

/** Briefly flashes the settle animation on the card now sitting at `index`. */
function playDropSettle(index) {
  const card = slotList.querySelector(`.slot-card[data-index="${index}"]`);
  if (!card) return;
  card.classList.add('drop-settle');
  card.addEventListener('animationend', () => card.classList.remove('drop-settle'), { once: true });
}

// ─── Event delegation — History list ─────────────────────────────────────────
historyList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-hact]');
  if (!btn) return;
  const act = btn.dataset.hact;
  const idx = parseInt(btn.dataset.index, 10);
  if (act === 'copy')   doCopyHistory(idx);
  if (act === 'delete') doDeleteHistory(idx);
});

// ─── Copy (slot) ──────────────────────────────────────────────────────────────
async function doCopy(idx) {
  const text = slots[idx];
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(`Slot ${idx + 1} copied to clipboard`, 'ok');
  } catch {
    toast('Clipboard write failed', 'err');
  }
}

// ─── Copy (history) ────────────────────────────────────────────────────────────
async function doCopyHistory(idx) {
  const text = history[idx];
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied from History', 'ok');
  } catch {
    toast('Clipboard write failed', 'err');
  }
}

// ─── Delete single slot ───────────────────────────────────────────────────────
async function doDelete(idx) {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'deleteSlot', index: idx });
    slots = res?.slots || slots;
    slots[idx] = '';
    render();
    toast(`Slot ${idx + 1} deleted`, 'ok');
  } catch {
    toast('Failed to delete slot', 'err');
  }
}

// ─── Delete single history item ────────────────────────────────────────────────
async function doDeleteHistory(idx) {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'deleteHistoryItem', index: idx });
    history = res?.history ?? history;
    render();
    toast('History Item Deleted', 'ok');
  } catch {
    toast('Failed to delete history item', 'err');
  }
}

// ─── Clear ALL slots ──────────────────────────────────────────────────────────
btnClearAll.addEventListener('click', async () => {
  const hasAny = slots.some(Boolean);
  if (!hasAny) { toast('All slots are already empty', 'err'); return; }

  if (!confirm('Delete all 4 slots? This cannot be undone.')) return;

  try {
    const res = await chrome.runtime.sendMessage({ action: 'clearAll' });
    slots = res?.slots || ['', '', '', ''];
    render();
    // Background sends ONE notification — no per-slot toasts here
    toast('All Slots Deleted Successfully', 'ok');
  } catch {
    toast('Failed to clear slots', 'err');
  }
});

// ─── Clear History ──────────────────────────────────────────────────────────────
btnClearHistory.addEventListener('click', async () => {
  if (!history.length) { toast('History is already empty', 'err'); return; }

  if (!confirm('Delete all Recent History? This cannot be undone.')) return;

  try {
    const res = await chrome.runtime.sendMessage({ action: 'clearHistory' });
    history = res?.history || [];
    render();
    // Exactly ONE toast for the whole clear operation
    toast('History Cleared Successfully', 'ok');
  } catch {
    toast('Failed to clear history', 'err');
  }
});

// ─── Search (slots + history) ───────────────────────────────────────────────────
// Search preferences (the last-used query + scope) are persisted via the
// storage helpers in background.js so they can also sync across devices.
let _searchPrefsTimer = null;
searchEl.addEventListener('input', () => {
  searchQuery = searchEl.value;
  searchX.hidden = !searchQuery;
  render();

  // Debounce persistence so we're not writing storage on every keystroke.
  if (_searchPrefsTimer) clearTimeout(_searchPrefsTimer);
  _searchPrefsTimer = setTimeout(() => {
    chrome.runtime.sendMessage({
      action: 'setSearchPrefs',
      prefs: { lastQuery: searchQuery, scope: 'all' }
    }).catch(() => {});
  }, 500);
});

searchX.addEventListener('click', () => {
  searchEl.value = '';
  searchQuery = '';
  searchX.hidden = true;
  render();
  searchEl.focus();
  chrome.runtime.sendMessage({
    action: 'setSearchPrefs',
    prefs: { lastQuery: '', scope: 'all' }
  }).catch(() => {});
});

// ─── Modal open ───────────────────────────────────────────────────────────────
function openModal(idx) {
  editingIndex = idx;
  modalNum.textContent = idx + 1;
  modalTa.value = slots[idx] || '';
  modalChars.textContent = modalTa.value.length;
  overlay.hidden = false;
  modalTa.focus();
  modalTa.setSelectionRange(modalTa.value.length, modalTa.value.length);
}

function closeModal() {
  overlay.hidden = true;
  editingIndex = null;
}

// ─── Modal char count ─────────────────────────────────────────────────────────
modalTa.addEventListener('input', () => {
  modalChars.textContent = modalTa.value.length;
});

// ─── Modal save ───────────────────────────────────────────────────────────────
modalSave.addEventListener('click', async () => {
  if (editingIndex === null) return;
  const text = modalTa.value;
  try {
    const res = await chrome.runtime.sendMessage({
      action: 'updateSlot',
      index: editingIndex,
      text
    });
    slots = res?.slots || slots;
    slots[editingIndex] = text;
    // Editing a slot also feeds Recent History (background.js handles the
    // storage write) — refresh our local copy so it shows immediately.
    if (text && text.trim()) {
      try {
        const hRes = await chrome.runtime.sendMessage({ action: 'getHistory' });
        history = hRes?.history || history;
      } catch { /* non-fatal */ }
    }
    // A write may have triggered a sync→local fallback — refresh status badge.
    refreshStorageStatus();
    render();
    toast(`Slot ${editingIndex + 1} saved`, 'ok');
    closeModal();
  } catch {
    toast('Failed to save', 'err');
  }
});

// ─── Modal cancel / close ─────────────────────────────────────────────────────
modalCancel.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !overlay.hidden) closeModal();
});

// ─── Settings: Storage Mode toggle ───────────────────────────────────────────
async function refreshStorageStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getStorageStatus' });
    storageMode = res?.mode || storageMode;
    hasFallback = !!res?.anyFallback;
    renderStorageStatus();
  } catch { /* non-fatal */ }
}

async function handleModeChange(mode) {
  if (mode === storageMode) return;
  const previous = storageMode;
  storageMode = mode; // optimistic UI update
  renderStorageStatus();

  try {
    await chrome.runtime.sendMessage({ action: 'setStorageMode', mode });
    toast('Storage mode updated successfully', 'ok');
    // Reload everything — switching modes can change where data lives.
    await init();
  } catch {
    storageMode = previous; // revert on failure
    renderStorageStatus();
    toast('Failed to update storage mode', 'err');
  }
}

modeSyncRadio.addEventListener('change', () => {
  if (modeSyncRadio.checked) handleModeChange('sync');
});
modeLocalRadio.addEventListener('change', () => {
  if (modeLocalRadio.checked) handleModeChange('local');
});

// ─── Listen for background-triggered updates ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  // Keyboard-shortcut saves/pastes changed slots or history — full reload.
  if (msg.action === 'slotsUpdated') {
    init();
    return;
  }

  // A write overflowed sync quota and fell back to local storage.
  if (msg.action === 'quotaFallback') {
    hasFallback = true;
    renderStorageStatus();
    toast('Sync quota exceeded. Using local storage.', 'err');
    return;
  }

  // Chrome Sync itself is unavailable (signed out, disabled, etc.) — the
  // background worker already force-switched the mode to 'local'.
  if (msg.action === 'syncDisabled') {
    storageMode = 'local';
    renderStorageStatus();
    toast('Chrome Sync is disabled. Using local storage.', 'err');
    return;
  }
});

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className   = 'toast show' + (type ? ' ' + type : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toastEl.classList.remove('show'); }, 2400);
}

// ─── Utility: HTML escape ─────────────────────────────────────────────────────
function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Utility: wrap matched search substring in <mark> (input must be pre-escaped) ──
function highlight(escapedText, q) {
  if (!q) return escapedText;
  const escQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escQ, 'ig');
  return escapedText.replace(re, (m) => `<mark class="qs-hl">${m}</mark>`);
}
