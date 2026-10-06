import { h, chip, section, copyButton, emptyState, extLink, icon } from '../ui.js';
import { missingSocial, firstValue } from '../../lib/analysis.js';

function absolute(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

function previewImage(src, onSize) {
  const box = h('div', { class: 'preview-img' });
  if (src && /^https?:/i.test(src)) {
    const img = h('img', { alt: '', referrerpolicy: 'no-referrer', decoding: 'async' });
    img.addEventListener('load', () => {
      img.classList.add('loaded');
      onSize?.(img.naturalWidth, img.naturalHeight);
    });
    img.addEventListener('error', () => {
      box.replaceChildren(h('span', { class: 'muted' }, 'Image failed to load'));
      onSize?.(0, 0, true);
    });
    img.src = src;
    box.append(img);
  } else {
    box.append(icon('file', 22));
  }
  return box;
}

function table(pairs, base) {
  return h(
    'table',
    { class: 'kv' },
    h(
      'tbody',
      {},
      pairs.map((p) =>
        h(
          'tr',
          {},
          h('td', {}, p.key),
          h('td', {}, /^https?:\/\//i.test(p.value) || (/image|url/i.test(p.key) && p.value) ? extLink(absolute(p.value, base) ?? p.value, p.value) : p.value || h('span', { class: 'muted' }, '(empty)')),
        ),
      ),
    ),
  );
}

export function render(ctx, el) {
  const { page } = ctx;
  const { og, twitter, head } = page;
  let host = '';
  try {
    host = new URL(page.url).hostname.replace(/^www\./, '');
  } catch {}

  const ogTitle = firstValue(og, 'og:title');
  const ogDesc = firstValue(og, 'og:description');
  const ogImage = absolute(firstValue(og, 'og:image') || firstValue(og, 'og:image:url') || firstValue(og, 'og:image:secure_url'), page.url);
  const ogSite = firstValue(og, 'og:site_name');

  const twCard = firstValue(twitter, 'twitter:card');
  const twTitle = firstValue(twitter, 'twitter:title') ?? ogTitle;
  const twDesc = firstValue(twitter, 'twitter:description') ?? ogDesc;
  const twImage = absolute(firstValue(twitter, 'twitter:image') || firstValue(twitter, 'twitter:image:src'), page.url) ?? ogImage;

  const missing = missingSocial(og, twitter);
  el.append(
    h(
      'div',
      { class: 'toolbar' },
      h('div', { class: 'chips' }, missing.length ? missing.map((m) => chip(`No ${m}`, 'warn', { dot: true })) : chip('All key tags present', 'good', { dot: true })),
    ),
  );

  // ---- Facebook / LinkedIn style preview
  const sizeChip = h('span');
  const ogCard = h(
    'div',
    { class: 'card preview' },
    previewImage(ogImage, (w, hgt, failed) => {
      if (failed) return sizeChip.replaceChildren(chip('og:image failed to load', 'bad', { dot: true }));
      const ok = w >= 1200 && Math.abs(w / hgt - 1.91) < 0.15;
      const small = w < 600;
      sizeChip.replaceChildren(chip(`${w}×${hgt}${ok ? '' : small ? ' · too small' : ' · aim for 1200×630'}`, ok ? 'good' : small ? 'bad' : 'warn', { dot: true }));
    }),
    h(
      'div',
      { class: 'preview-body' },
      h('div', { class: 'preview-site' }, ogSite || host),
      h('div', { class: 'preview-title' }, ogTitle || head.title || ''),
      h('div', { class: 'preview-desc' }, ogDesc || head.description || ''),
    ),
  );
  el.append(
    section(
      null,
      h('h3', { class: 'block-title' }, h('span', { class: 'grow' }, 'Facebook · LinkedIn'), sizeChip),
      ogCard,
      !ogTitle || !ogDesc ? h('p', { class: 'note' }, 'Missing Open Graph values fall back to the page title and description here; platforms may do the same, or show nothing.') : null,
    ),
  );

  // ---- X preview
  const large = twCard === 'summary_large_image' || (!twCard && twImage);
  const xCard = h(
    'div',
    { class: `card preview${large ? '' : ' summary'}` },
    previewImage(twImage),
    h(
      'div',
      { class: 'preview-body' },
      h('div', { class: 'preview-title' }, twTitle || head.title || ''),
      h('div', { class: 'preview-desc' }, twDesc || head.description || ''),
      h('div', { class: 'preview-site', style: { 'margin-top': '4px' } }, host),
    ),
  );
  el.append(section(null, h('h3', { class: 'block-title' }, h('span', { class: 'grow' }, 'X'), chip(twCard ? `card: ${twCard}` : 'No twitter:card', twCard ? 'neutral' : 'warn')), xCard));

  // ---- raw tags
  el.append(
    section(
      null,
      h('h3', { class: 'block-title' }, h('span', { class: 'grow' }, `Open Graph (${og.length})`), og.length ? copyButton(() => og.map((p) => `${p.key}: ${p.value}`).join('\n'), { label: null, title: 'Copy Open Graph tags' }) : null),
      og.length ? h('div', { class: 'card' }, table(og, page.url)) : h('div', { class: 'card' }, emptyState('No Open Graph tags', null, 'file')),
    ),
  );
  el.append(
    section(
      null,
      h('h3', { class: 'block-title' }, h('span', { class: 'grow' }, `X / Twitter (${twitter.length})`), twitter.length ? copyButton(() => twitter.map((p) => `${p.key}: ${p.value}`).join('\n'), { label: null, title: 'Copy Twitter tags' }) : null),
      twitter.length ? h('div', { class: 'card' }, table(twitter, page.url)) : h('div', { class: 'card' }, emptyState('No Twitter tags', 'X falls back to Open Graph tags.', 'file')),
    ),
  );
}
