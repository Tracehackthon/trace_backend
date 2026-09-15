export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  file:'<path d="M6 3h8l5 5v13H6zM14 3v6h5M9 13h6M9 17h6"/>',
  search:'<circle cx="10" cy="10" r="7"/><path d="m16 16 5 5"/>',
  close:'<path d="m5 5 14 14M19 5 5 19"/>',
  arrow:'<path d="M12 21V3M5 10l7-7 7 7"/>',
  back:'<path d="m14 5-7 7 7 7"/>',
  next:'<path d="m9 5 7 7-7 7"/>',
  collapse:'<path d="m5 11 7-7 7 7M5 19l7-7 7 7"/>',
  pen:'<path d="m16 3 5 5-13 13H3v-5L16 3Zm-3 3 5 5M3 21l6-2"/>',
  link:'<path d="m9 15 6-6M9 8l2-2a5 5 0 0 1 7 7l-2 2M15 16l-2 2a5 5 0 0 1-7-7l2-2"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  bulb:'<path d="M8 17c0-4-4-4-4-8a8 8 0 0 1 16 0c0 4-4 4-4 8M8 17h8M9 21h6M10 17v-6l-3-3M14 17v-6l3-3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v7l4 2"/>',
  stop:'<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2.5" fill="white" stroke="none"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  undo:'<path d="M3 9h11a7 7 0 1 1-5 12M3 9l6-6M3 9l6 6"/>',
  no:'<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  bookmark:'<path d="M6 3h12v19l-6-5-6 5V3Z"/>',
  branch:'<circle cx="12" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><path d="M12 6v5M4 18v-7h16v7"/>',
  balance:'<path d="M12 2v19M6 21h12M3 6h18M5 6l-4 9h8L5 6Zm14 0-4 9h8l-4-9Z"/>',
  question:'<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01"/>',
  message:'<path d="M3 3h18v14H9l-6 4V3Z"/><path d="M7 10h.01M12 10h.01M17 10h.01"/>',
};
export const icon = name => `<svg class="chain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
export const mark = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 11V7a3 3 0 1 0-3 3h16a3 3 0 1 0-3-3v18a3 3 0 1 0 3-3H8a3 3 0 1 0 3 3V11Z"/></svg>';

// Reconcile rather than replace: active textareas, IME composition and selection
// keep their DOM identity during controlled reducer updates.
export function patchDOM(parent, fresh, isComposing = () => false) {
  const desired = [...fresh.childNodes];
  desired.forEach((node, i) => {
    let old = parent.childNodes[i];
    const key = node.nodeType === 1 ? node.getAttribute('data-key') : null;
    if (key && (!old || old.nodeType !== 1 || old.getAttribute('data-key') !== key)) {
      const found = [...parent.childNodes].find(n => n.nodeType === 1 && n.getAttribute('data-key') === key);
      if (found) { parent.insertBefore(found, old || null); old = found; }
    }
    if (!old) { parent.append(node.cloneNode(true)); return; }
    if (node.nodeType !== old.nodeType || (node.nodeType === 1 && (node.tagName !== old.tagName || (key && old.getAttribute('data-key') !== key)))) {
      old.replaceWith(node.cloneNode(true)); return;
    }
    if (node.nodeType === 3) { if (old.data !== node.data) old.data = node.data; return; }
    if (node.nodeType !== 1) return;
    for (const attr of [...old.attributes]) if (!node.hasAttribute(attr.name)) old.removeAttribute(attr.name);
    for (const attr of [...node.attributes]) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
    if (node.hasAttribute('data-preserve')) return;
    if (old instanceof HTMLTextAreaElement || old instanceof HTMLInputElement) {
      const value = node.value;
      if (old.value !== value && !isComposing(old)) {
        const active = document.activeElement === old;
        const start = old.selectionStart, end = old.selectionEnd, direction = old.selectionDirection;
        old.value = value;
        if (active && start != null && end != null) old.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length), direction);
      }
      if (old instanceof HTMLInputElement) old.checked = node.checked;
    } else {
      patchDOM(old, node, isComposing);
      if (old instanceof HTMLSelectElement) old.value = node.value;
    }
  });
  while (parent.childNodes.length > desired.length) parent.lastChild.remove();
}

export function selectedRange(container) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(container); prefix.setEnd(range.startContainer, range.startOffset);
  return {start:prefix.toString().length, end:prefix.toString().length + range.toString().length, text:range.toString()};
}
