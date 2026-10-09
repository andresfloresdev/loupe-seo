import { api } from '../../lib/api.js';
import { IS_CHROME } from '../../lib/platform.js';
import { setSetting } from '../../lib/settings.js';
import { GOOGLE_DOMAINS } from '../../lib/tools.js';
import { h, section, toast } from '../ui.js';

function toggle(checked, onChange, label) {
  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label });
  sw.addEventListener('click', () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return sw;
}

export function render(ctx, el) {
  const s = ctx.settings;

  const google = h('select', { class: 'select', 'aria-label': 'Google domain' }, GOOGLE_DOMAINS.map((d) => h('option', { value: d }, d.replace(/^www\./, ''))));
  google.value = s.googleDomain;
  google.addEventListener('change', async () => {
    await setSetting('googleDomain', google.value);
    s.googleDomain = google.value;
    ctx.rendered.delete('tools');
    toast(`Searches use ${google.value.replace(/^www\./, '')}`);
  });

  el.append(
    section(
      'Settings',
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'setting' },
          h('div', { class: 'setting-text' }, h('b', {}, 'Highlight nofollow links'), h('span', {}, 'Outlines links marked nofollow, ugc or sponsored on every page. Also in the right-click menu.')),
          toggle(
            s.highlightNofollow,
            async (on) => {
              await setSetting('highlightNofollow', on);
              s.highlightNofollow = on;
              toast(on ? 'Nofollow links highlighted' : 'Highlighting off');
            },
            'Highlight nofollow links',
          ),
        ),
        h(
          'div',
          { class: 'setting' },
          h('div', { class: 'setting-text' }, h('b', {}, 'Google for searches'), h('span', {}, 'Used by site: searches, duplicate checks and the right-click menu.')),
          google,
        ),
      ),
    ),
  );

  const version = api.runtime.getManifest?.().version ?? '';
  el.append(
    section(
      'About',
      h(
        'div',
        { class: 'card', style: { padding: '12px' } },
        h('div', {}, h('b', {}, `Loupe SEO ${version}`)),
        h('p', { class: 'note', style: { margin: '4px 0 0' } }, `Everything runs in your browser. No accounts, no analytics, no data leaves your ${IS_CHROME ? 'computer' : 'Mac'} except the requests Loupe makes to the site you are inspecting (headers, robots.txt, hreflang alternates).`),
        h(
          'p',
          { class: 'note' },
          'Shortcuts: press ',
          h('kbd', {}, '1'),
          '–',
          h('kbd', {}, '8'),
          ' to switch tabs. Right-click any page for Loupe SEO tools.',
        ),
      ),
    ),
  );
}
