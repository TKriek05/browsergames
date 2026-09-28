// DOM helpers. Player data is only ever inserted as text (textContent),
// never via innerHTML.

// h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Tekst', childNode)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'text') el.textContent = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Re-render helper that keeps keyboard focus on the "same" element.
// Give focusable elements a data-key attribute.
export function preserveFocus(container, render) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.key : null;
  render();
  if (key) {
    const again = container.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }
}

// --- Toasts (announced to screen readers via aria-live) ---------------------
let toastRoot = null;
export function toast(message, { type = 'info', timeout = 3500, action = null } = {}) {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  const el = h('div', { class: `toast toast--${type}` }, h('span', {}, message));
  if (action) {
    el.append(
      h('button', { class: 'btn btn--small', type: 'button', onclick: () => { action.run(); el.remove(); } }, action.label),
    );
  }
  toastRoot.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

// --- Modal dialog using the native <dialog> element ----------------------------
// actions: [{ label, value, primary }] → resolves with the chosen value (or null on Esc).
export function dialog({ title, body, actions = [{ label: 'OK', value: true, primary: true }] }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' });
    const form = h('form', { method: 'dialog' });
    form.append(h('h2', { id: 'dlg-title', class: 'dialog__title' }, title));
    if (body) form.append(typeof body === 'string' ? h('p', {}, body) : body);
    const row = h('div', { class: 'dialog__actions' });
    for (const a of actions) {
      row.append(h('button', { class: `btn ${a.primary ? 'btn--primary' : ''}`, value: String(a.value), type: 'submit' }, a.label));
    }
    form.append(row);
    dlg.append(form);
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      const chosen = actions.find((a) => String(a.value) === dlg.returnValue);
      dlg.remove();
      resolve(chosen ? chosen.value : null);
    });
    dlg.showModal();
  });
}

export async function confirmDialog(title, text, okLabel = 'Ja') {
  return (await dialog({
    title,
    body: text,
    actions: [
      { label: 'Annuleer', value: false },
      { label: okLabel, value: true, primary: true },
    ],
  })) === true;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function formatMs(ms) {
  return `${Math.round(ms)} ms`;
}
