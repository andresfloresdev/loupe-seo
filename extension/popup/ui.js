import { api, runInTab } from '../lib/api.js';
import { IS_CHROME } from '../lib/platform.js';
import { flashElement, downloadFile } from '../lib/inject.js';

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- DOM ----------------------------------------------------------------
// Page data is untrusted. Everything goes through textContent / attributes,
// never innerHTML; the only markup parsed is the static icon set below.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    } else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

// ---- icons (static, trusted markup) ------------------------------------

const PATHS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  alert: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.6 3.5 5.6 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.6-3.5-8.5s1-5.9 3.5-8.5z"/>',
  file: '<path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z"/><path d="M14 3.5v4h4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};

export function icon(name, size = 14) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="ico ico-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
  return tpl.content.firstElementChild;
}

// ---- formatting --------------------------------------------------------

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n) => nf.format(n ?? 0);
export const chars = (s) => [...(s ?? '')].length;

export function safeHref(url) {
  return /^https?:\/\//i.test(url ?? '') ? url : null;
}

// ---- feedback ----------------------------------------------------------

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  clear(el);
  append(el, [icon(kind === 'error' ? 'alert' : 'check', 13), h('span', {}, message)]);
  el.dataset.kind = kind;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1700);
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label);
}

export function copyButton(getText, { label = 'Copy', title = 'Copy', toastText = 'Copied' } = {}) {
  const btn = h('button', { class: 'btn ghost sm copy', type: 'button', title }, icon('copy', 13), label ? h('span', {}, label) : null);
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = typeof getText === 'function' ? getText() : getText;
    await copyText(text ?? '', toastText);
    btn.classList.add('done');
    btn.querySelector('.ico')?.replaceWith(icon('check', 13));
    setTimeout(() => {
      btn.classList.remove('done');
      btn.querySelector('.ico')?.replaceWith(icon('copy', 13));
    }, 1200);
  });
  return btn;
}

export function button(label, onClick, { iconName, kind = 'ghost', size = 'sm', title, disabled } = {}) {
  return h(
    'button',
    { class: `btn ${kind} ${size}`, type: 'button', title, disabled, onClick },
    iconName ? icon(iconName, 13) : null,
    label ? h('span', {}, label) : null,
  );
}

// ---- motion ------------------------------------------------------------

export function countUp(el, to, duration = 560) {
  const target = Number(to) || 0;
  if (reducedMotion || target < 3) {
    el.textContent = fmt(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = fmt(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = '0';
  requestAnimationFrame(step);
}

// Staggered entrance for the first rows of a list.
export function stagger(el, i) {
  if (reducedMotion || i > 24) return el;
  el.classList.add('enter');
  el.style.setProperty('--i', String(i));
  return el;
}

// ---- building blocks ---------------------------------------------------

export function chip(text, kind = 'neutral', opts = {}) {
  return h('span', { class: `chip ${kind}`, title: opts.title }, opts.dot ? h('i', { class: 'dot' }) : null, text);
}

export function metric(label, value, { kind, onClick, title } = {}) {
  const num = h('b', { class: 'metric-num' }, '0');
  const el = h(
    onClick ? 'button' : 'div',
    { class: `metric${kind ? ' ' + kind : ''}${onClick ? ' clickable' : ''}`, type: onClick ? 'button' : null, onClick, title },
    num,
    h('span', { class: 'metric-label' }, label),
  );
  countUp(num, value);
  return el;
}

export function section(title, ...children) {
  return h('section', { class: 'block' }, title ? h('h3', { class: 'block-title' }, title) : null, ...children);
}

export function emptyState(title, text, iconName = 'search') {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, icon(iconName, 20)), h('b', {}, title), text ? h('p', {}, text) : null);
}

export function spinner() {
  return h('span', { class: 'spinner', 'aria-label': 'Loading' });
}

// Segmented control with a sliding thumb.
export function segmented(options, value, onChange, { small } = {}) {
  const wrap = h('div', { class: `seg${small ? ' small' : ''}`, role: 'tablist' });
  const thumb = h('span', { class: 'seg-thumb' });
  wrap.append(thumb);
  const buttons = options.map((opt) => {
    const b = h(
      'button',
      { type: 'button', role: 'tab', class: 'seg-btn', dataset: { value: opt.value } },
      opt.label,
      opt.count != null ? h('span', { class: 'seg-count' }, fmt(opt.count)) : null,
    );
    b.addEventListener('click', () => select(opt.value, true));
    wrap.append(b);
    return b;
  });
  const place = (instant) => {
    const active = buttons.find((b) => b.dataset.value === value);
    if (!active || !active.offsetWidth) return;
    if (instant) thumb.style.transition = 'none';
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.transform = `translateX(${active.offsetLeft - 2}px)`;
    if (instant) requestAnimationFrame(() => thumb.style.removeProperty('transition'));
  };
  function select(v, fire) {
    value = v;
    buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.value === v)));
    place(false);
    if (fire) onChange(v);
  }
  buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.value === value)));
  // Measure once laid out (the panel may still be hidden when this is built).
  const ro = new ResizeObserver(() => place(true));
  ro.observe(wrap);
  wrap.select = select;
  return wrap;
}

// ---- browser actions ---------------------------------------------------

export async function openUrl(url, { active = true } = {}) {
  if (!safeHref(url)) return;
  await api.tabs.create({ url, active });
  if (active) window.close();
}

export function extLink(url, text, cls = 'link') {
  const href = safeHref(url);
  if (!href) return h('span', { class: cls }, text ?? url ?? '');
  return h(
    'a',
    {
      class: cls,
      href,
      title: href,
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        openUrl(href, { active: !(e.metaKey || e.ctrlKey) });
      },
    },
    text ?? href,
  );
}

export async function flash(ctx, selector, index) {
  try {
    await runInTab(ctx.tab.id, flashElement, [selector, index]);
  } catch {
    toast('Could not reach the page', 'error');
  }
}

// Chrome saves through the downloads API. Safari has none, so the file is
// saved by a link clicked inside the inspected page. Either way, a failed save
// copies the CSV to the clipboard instead.
export async function saveCsv(ctx, csv, filename) {
  try {
    if (IS_CHROME) await downloadText(csv, filename, 'text/csv;charset=utf-8');
    else await runInTab(ctx.tab.id, downloadFile, [csv, filename, 'text/csv;charset=utf-8']);
    toast(`Saved ${filename}`);
  } catch {
    await copyText(csv, 'Download blocked, CSV copied instead');
  }
}

async function downloadText(text, filename, mime) {
  if (!IS_CHROME) throw new Error('The downloads API is Chrome only');
  // A Blob encodes the text as UTF-8, so the CSV's BOM and CRLFs reach the
  // file byte for byte. The download holds its own reference once started.
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    await api.downloads.download({ url, filename });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
