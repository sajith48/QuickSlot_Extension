// =============================================================================
// QuickSlots — background.js (Service Worker)
// Handles: keyboard commands → save/paste, storage I/O, Chrome notifications
// Features: 4 Slots · Recent History (max 20, dedup, newest-first)
// Storage: chrome.storage.sync (cross-device) with automatic chrome.storage.local
//          fallback per key when sync quota is exceeded or sync is unavailable.
// =============================================================================

const TOTAL_SLOTS   = 4;
const MAX_HISTORY    = 20;

const SLOTS_KEY     = 'qs_slots';
const HISTORY_KEY    = 'qs_history';
const SETTINGS_KEY   = 'qs_settings';        // { storageMode: 'sync' | 'local' }
const SEARCH_PREFS_KEY = 'qs_search_prefs';   // { lastQuery, scope, etc. }
const RESIDENCY_KEY  = 'qs_residency';        // local-only map: which keys live in local due to fallback

// Chrome's hard limits for storage.sync (used for pre-flight size checks)
const SYNC_QUOTA_BYTES_PER_ITEM = chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192;

// Map command names to 1-based slot numbers
const CMD_SLOT = {
  'save-slot-1': 1, 'save-slot-2': 2, 'save-slot-3': 3, 'save-slot-4': 4,
  'paste-slot-1': 1, 'paste-slot-2': 2, 'paste-slot-3': 3, 'paste-slot-4': 4
};

// =============================================================================
// STORAGE LAYER
//
// Design notes:
// - The user can force "Local Device Only" mode via Settings — when set, every
//   key is written straight to chrome.storage.local and sync is never touched.
// - In "Sync Across Devices" mode (default), every key is attempted on
//   chrome.storage.sync first. If that key is too large for sync's per-item
//   quota (8,192 bytes) or chrome.storage.sync.set() throws (quota exceeded,
//   sync disabled, no Google account, offline, etc.), that *specific key*
//   falls back to chrome.storage.local and we remember that fallback in a
//   small local-only residency map (qs_residency) so future reads know where
//   to look without guessing.
// - Reads always consult the residency map first; if a key isn't marked as
//   "local", we read from sync, otherwise local. This keeps behavior correct
//   even when only some keys (e.g. one oversized history entry) overflowed.
// =============================================================================

let _residencyCache = null; // in-memory cache of the residency map for this SW lifetime

async function getResidencyMap() {
  if (_residencyCache) return _residencyCache;
  const res = await chrome.storage.local.get(RESIDENCY_KEY);
  _residencyCache = res[RESIDENCY_KEY] || {};
  return _residencyCache;
}

async function markResidency(key, location) {
  const map = await getResidencyMap();
  if (location === 'sync') {
    delete map[key];
  } else {
    map[key] = 'local';
  }
  _residencyCache = map;
  await chrome.storage.local.set({ [RESIDENCY_KEY]: map });
}

/** Is Chrome Sync currently usable? (signed in + sync enabled + online) */
async function isSyncAvailable() {
  try {
    // A harmless probe write/read. chrome.storage.sync.set throws or the
    // extension's sync data silently never propagates when sync is off;
    // the most reliable signal is whether set() resolves without error.
    await chrome.storage.sync.set({ qs_sync_probe: Date.now() });
    return true;
  } catch (e) {
    return false;
  }
}

/** Get the user's storage-mode preference. Defaults to 'sync'. */
async function getStorageMode() {
  try {
    const res = await chrome.storage.local.get(SETTINGS_KEY);
    return (res[SETTINGS_KEY] && res[SETTINGS_KEY].storageMode) || 'sync';
  } catch {
    return 'sync';
  }
}

async function setStorageMode(mode) {
  const settings = await getData(SETTINGS_KEY) || {};
  settings.storageMode = mode;
  // Settings themselves always live in local — this is a device-level
  // preference, not something that should ping-pong through sync.
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

/**
 * Rough byte size of a value once JSON-serialized + key name, matching how
 * chrome.storage.sync counts quota (JSON.stringify(key) + JSON.stringify(value)).
 */
function byteSize(key, value) {
  return JSON.stringify(key).length + JSON.stringify(value).length;
}

/**
 * Read a value. Honors per-key residency (falls back to local automatically).
 * Returns undefined if not found in either store.
 */
async function getData(key) {
  const mode = await getStorageMode();

  if (mode === 'local') {
    const res = await chrome.storage.local.get(key);
    return res[key];
  }

  const residency = await getResidencyMap();
  if (residency[key] === 'local') {
    const res = await chrome.storage.local.get(key);
    return res[key];
  }

  try {
    const res = await chrome.storage.sync.get(key);
    if (res[key] !== undefined) return res[key];
    // Not in sync — check local as a safety net (e.g. pre-migration data)
    const localRes = await chrome.storage.local.get(key);
    return localRes[key];
  } catch {
    const res = await chrome.storage.local.get(key);
    return res[key];
  }
}

/**
 * Write a value. In 'sync' mode: tries chrome.storage.sync first; on quota
 * overflow (either a pre-flight size check or a thrown error from set()),
 * automatically falls back to chrome.storage.local for THAT key, marks the
 * residency map, and surfaces a one-time notification to the user.
 * In 'local' mode: writes straight to chrome.storage.local.
 */
async function setData(key, value) {
  const mode = await getStorageMode();

  if (mode === 'local') {
    await chrome.storage.local.set({ [key]: value });
    return { location: 'local' };
  }

  // Pre-flight size check — avoid a guaranteed-to-fail round trip to sync.
  const size = byteSize(key, value);
  if (size > SYNC_QUOTA_BYTES_PER_ITEM) {
    await chrome.storage.local.set({ [key]: value });
    await markResidency(key, 'local');
    notifyQuotaFallback();
    return { location: 'local', reason: 'quota-preflight' };
  }

  try {
    await chrome.storage.sync.set({ [key]: value });
    await markResidency(key, 'sync');
    return { location: 'sync' };
  } catch (e) {
    // QUOTA_BYTES_PER_ITEM, QUOTA_BYTES, MAX_ITEMS, MAX_WRITE_OPERATIONS_PER_MINUTE,
    // sync disabled, or any other sync failure — fall back to local for this key.
    await chrome.storage.local.set({ [key]: value });
    await markResidency(key, 'local');
    notifyQuotaFallback();
    return { location: 'local', reason: e.message };
  }
}

async function removeData(key) {
  const residency = await getResidencyMap();
  // Remove from both stores defensively — cheap, and avoids stale leftovers
  // if residency ever drifts (e.g. user toggled storage mode mid-session).
  await Promise.all([
    chrome.storage.sync.remove(key).catch(() => {}),
    chrome.storage.local.remove(key).catch(() => {})
  ]);
  if (residency[key]) {
    delete residency[key];
    _residencyCache = residency;
    await chrome.storage.local.set({ [RESIDENCY_KEY]: residency });
  }
}

// Throttle the quota-exceeded notification so a burst of oversized writes
// doesn't spam the user with duplicate system notifications.
let _lastQuotaNotifyAt = 0;
function notifyQuotaFallback() {
  const now = Date.now();
  if (now - _lastQuotaNotifyAt < 15000) return; // 15s cooldown
  _lastQuotaNotifyAt = now;
  notify('Sync quota exceeded.', 'Using local storage.');
  chrome.runtime.sendMessage({ action: 'quotaFallback' }).catch(() => {});
}

// =============================================================================
// SLOTS
// =============================================================================

async function getAllSlots() {
  const slots = await getData(SLOTS_KEY);
  return slots || Array(TOTAL_SLOTS).fill('');
}

async function setSlot(index, text) {
  const slots = await getAllSlots();
  slots[index] = text;
  await setData(SLOTS_KEY, slots);
  return slots;
}

/**
 * Replace the entire slots array at once (used by drag-and-drop reorder).
 * Goes through the same setData() path as every other slot write, so it
 * automatically respects the current storage mode and quota fallback.
 */
async function setAllSlots(newSlots) {
  if (!Array.isArray(newSlots) || newSlots.length !== TOTAL_SLOTS) {
    throw new Error('Invalid slots array');
  }
  await setData(SLOTS_KEY, newSlots);
  return newSlots;
}

async function clearSlot(index) {
  return setSlot(index, '');
}

// =============================================================================
// RECENT HISTORY
// =============================================================================

async function getHistory() {
  const history = await getData(HISTORY_KEY);
  return history || [];
}

/**
 * Add text to history. If the same text already exists, remove the old
 * occurrence first, then insert the new one at the top (index 0).
 * List is capped at MAX_HISTORY items.
 */
async function addToHistory(text) {
  if (!text || !text.trim()) return;
  let history = await getHistory();
  history = history.filter(item => item !== text); // de-dup exact match
  history.unshift(text);                            // newest at top
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  await setData(HISTORY_KEY, history);
  return history;
}

async function deleteHistoryItem(index) {
  const history = await getHistory();
  history.splice(index, 1);
  await setData(HISTORY_KEY, history);
  return history;
}

async function clearHistory() {
  await setData(HISTORY_KEY, []);
  return [];
}

// =============================================================================
// STARTUP: sync-availability check + one-time local → sync migration
// =============================================================================

/**
 * On every service-worker startup:
 *  1. If the user has forced 'local' mode, do nothing — respect their choice.
 *  2. Otherwise, check whether Chrome Sync is actually usable right now.
 *     If not, force mode to 'local' for this session and notify once.
 *  3. If sync data already exists for our keys, trust it as-is (multi-device
 *     case — another device already populated sync).
 *  4. Otherwise, if local data exists from before this migration shipped,
 *     copy it up to sync and then delete the old local copies so there's a
 *     single source of truth going forward.
 */
async function runStartupMigration() {
  const mode = await getStorageMode();

  if (mode === 'local') return; // user explicitly opted out of sync

  const syncOk = await isSyncAvailable();
  if (!syncOk) {
    await setStorageMode('local');
    notify('Chrome Sync is disabled.', 'Using local storage.');
    chrome.runtime.sendMessage({ action: 'syncDisabled' }).catch(() => {});
    return;
  }

  const keysToMigrate = [SLOTS_KEY, HISTORY_KEY, SEARCH_PREFS_KEY];

  for (const key of keysToMigrate) {
    try {
      const syncRes = await chrome.storage.sync.get(key);
      const syncHasData = syncRes[key] !== undefined &&
        !(Array.isArray(syncRes[key]) && syncRes[key].length === 0);

      if (syncHasData) continue; // sync already populated (e.g. by another device) — trust it

      const localRes = await chrome.storage.local.get(key);
      const localValue = localRes[key];
      const localHasData = localValue !== undefined &&
        !(Array.isArray(localValue) && localValue.length === 0);

      if (!localHasData) continue; // nothing to migrate for this key

      const result = await setData(key, localValue); // writes to sync, falls back automatically if oversized
      if (result.location === 'sync') {
        // Only delete the old local copy once we've confirmed it now lives in sync.
        await chrome.storage.local.remove(key);
      }
      // If result.location === 'local' (quota fallback during migration),
      // we deliberately leave the local copy in place — it's already the
      // canonical copy and markResidency() has flagged it correctly.
    } catch {
      // Leave local data untouched on any unexpected error — never lose data.
    }
  }
}

// =============================================================================
// Notification helper
// =============================================================================

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
    priority: 1
  });
}

// =============================================================================
// Send message to the active tab's content script
// =============================================================================

async function messageActiveTab(payload) {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { error: 'No active tab.' };

  const blocked = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'data:'];
  if (blocked.some(p => (tab.url || '').startsWith(p))) {
    return { error: 'Cannot run on this page.' };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tab.id, payload);
    } catch (e) {
      return { error: e.message };
    }
  }
}

// =============================================================================
// Run migration check on every service worker start (install, update, browser
// restart, or SW respawn after idle eviction).
// =============================================================================

chrome.runtime.onStartup.addListener(() => { runStartupMigration(); });
chrome.runtime.onInstalled.addListener(() => { runStartupMigration(); });
runStartupMigration(); // also run immediately for the current SW lifetime

// =============================================================================
// Keyboard command handler
// =============================================================================

chrome.commands.onCommand.addListener(async (command) => {
  const slot = CMD_SLOT[command];
  if (!slot) return;

  // ── SAVE ──
  if (command.startsWith('save-slot-')) {
    const res = await messageActiveTab({ action: 'getSelection' });

    if (res?.error) {
      notify('QuickSlots — Error', res.error);
      return;
    }

    const text = (res?.text || '').trim();
    if (!text) {
      notify(`Slot ${slot} — Nothing Selected`, 'Highlight some text first, then use the shortcut.');
      return;
    }

    await setSlot(slot - 1, text);
    await addToHistory(text); // ← Recent History capture

    const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
    notify(`Slot ${slot} Saved ✓`, `"${preview}"`);

    // Refresh popup if open (slots + history both changed)
    chrome.runtime.sendMessage({ action: 'slotsUpdated' }).catch(() => {});
  }

  // ── PASTE ──
  if (command.startsWith('paste-slot-')) {
    const slots = await getAllSlots();
    const text = slots[slot - 1];

    if (!text) {
      notify(`Slot ${slot} is Empty`, `Save text to Slot ${slot} first.`);
      return;
    }

    const res = await messageActiveTab({ action: 'pasteText', text });

    if (res?.error) {
      notify('QuickSlots — Paste Failed', res.error);
      return;
    }

    const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
    notify(`Slot ${slot} Pasted ✓`, `"${preview}"`);
  }
});

// =============================================================================
// React to sync changes coming from OTHER devices, so an open popup updates
// live without the user needing to reopen it.
// =============================================================================

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' && areaName !== 'local') return;
  if (changes[SLOTS_KEY] || changes[HISTORY_KEY]) {
    chrome.runtime.sendMessage({ action: 'slotsUpdated' }).catch(() => {});
  }
});

// =============================================================================
// Messages from popup.js
// =============================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Slots ──

  if (msg.action === 'getSlots') {
    getAllSlots().then(slots => sendResponse({ slots }));
    return true;
  }

  if (msg.action === 'updateSlot') {
    (async () => {
      const slots = await setSlot(msg.index, msg.text);
      if (msg.text && msg.text.trim()) await addToHistory(msg.text);
      sendResponse({ ok: true, slots });
    })();
    return true;
  }

  if (msg.action === 'deleteSlot') {
    const slotNum = msg.index + 1;
    clearSlot(msg.index).then(slots => {
      notify(`Slot ${slotNum} Deleted`, `Slot ${slotNum} has been cleared.`);
      sendResponse({ ok: true, slots });
    });
    return true;
  }

  if (msg.action === 'clearAll') {
    setData(SLOTS_KEY, Array(TOTAL_SLOTS).fill('')).then(() => {
      notify('QuickSlots', 'All Slots Deleted Successfully');
      sendResponse({ ok: true, slots: Array(TOTAL_SLOTS).fill('') });
    });
    return true;
  }

  if (msg.action === 'reorderSlots') {
    setAllSlots(msg.slots)
      .then(slots => sendResponse({ ok: true, slots }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // ── Recent History ──

  if (msg.action === 'getHistory') {
    getHistory().then(history => sendResponse({ history }));
    return true;
  }

  if (msg.action === 'deleteHistoryItem') {
    deleteHistoryItem(msg.index).then(history => {
      sendResponse({ ok: true, history });
    });
    return true;
  }

  if (msg.action === 'clearHistory') {
    clearHistory().then(history => {
      sendResponse({ ok: true, history });
    });
    return true;
  }

  // ── Search preferences ──

  if (msg.action === 'getSearchPrefs') {
    getData(SEARCH_PREFS_KEY).then(prefs => sendResponse({ prefs: prefs || {} }));
    return true;
  }

  if (msg.action === 'setSearchPrefs') {
    setData(SEARCH_PREFS_KEY, msg.prefs).then(() => sendResponse({ ok: true }));
    return true;
  }

  // ── Storage mode / settings ──

  if (msg.action === 'getStorageStatus') {
    (async () => {
      const mode = await getStorageMode();
      const residency = await getResidencyMap();
      const anyFallback = Object.keys(residency).length > 0;
      sendResponse({ mode, anyFallback });
    })();
    return true;
  }

  if (msg.action === 'setStorageMode') {
    (async () => {
      const previousMode = await getStorageMode();
      await setStorageMode(msg.mode);

      // Moving from local → sync: push current local data up to sync now,
      // rather than waiting for the next service-worker restart.
      if (previousMode === 'local' && msg.mode === 'sync') {
        await runStartupMigration();
      }

      // Moving from sync → local: copy current (possibly sync-resident)
      // data down into local so the user's data is fully available offline.
      if (previousMode === 'sync' && msg.mode === 'local') {
        const slots = await getAllSlots();
        const history = await getHistory();
        await chrome.storage.local.set({ [SLOTS_KEY]: slots, [HISTORY_KEY]: history });
      }

      sendResponse({ ok: true, mode: msg.mode });
    })();
    return true;
  }
});
