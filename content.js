// =============================================================================
// QuickSlots — content.js
// Injected into every page. Reads selected text and inserts pasted text.
// Guard prevents double-injection if background re-injects on demand.
// =============================================================================

if (!window.__quickSlotsInjected) {
  window.__quickSlotsInjected = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

    // ── Return the current text selection ────────────────────────────────────
    if (msg.action === 'getSelection') {
      const text = window.getSelection()?.toString() || '';
      sendResponse({ text });
      return true;
    }

    // ── Insert text at the cursor position ───────────────────────────────────
    if (msg.action === 'pasteText') {
      const { text } = msg;
      const el = document.activeElement;

      // Strategy 1: standard <input> or <textarea>
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        const start = el.selectionStart ?? el.value.length;
        const end   = el.selectionEnd   ?? el.value.length;
        el.value = el.value.slice(0, start) + text + el.value.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ ok: true });
        return true;
      }

      // Strategy 2: contenteditable (rich text editors, Google Docs, etc.)
      if (el && el.isContentEditable) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node);
          range.setEndAfter(node);
          sel.removeAllRanges();
          sel.addRange(range);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        sendResponse({ ok: true });
        return true;
      }

      // Strategy 3: fallback — write to clipboard and tell user to Ctrl+V
      navigator.clipboard.writeText(text)
        .then(() => sendResponse({ ok: true, info: 'Copied to clipboard — press Ctrl+V to paste.' }))
        .catch(() => sendResponse({ error: 'Click inside a text field first, then use the shortcut.' }));
      return true;
    }
  });
}
