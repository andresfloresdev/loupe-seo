// Outlines nofollow / ugc / sponsored links when the setting is on.
// Styles go through CSSOM (element.style), which page CSP does not block,
// and a MutationObserver keeps up with links added after load.
(() => {
  if (window.__loupeNofollow) return;
  window.__loupeNofollow = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const SELECTOR = 'a[rel~="nofollow" i], a[rel~="ugc" i], a[rel~="sponsored" i]';
  const MARK = 'data-loupe-nofollow';
  let observer = null;

  function mark(a) {
    if (a.hasAttribute(MARK)) return;
    a.setAttribute(MARK, '');
    a.style.setProperty('outline', '2px dashed #e5484d', 'important');
    a.style.setProperty('outline-offset', '2px', 'important');
    a.style.setProperty('background-color', 'rgba(229, 72, 77, 0.14)', 'important');
  }

  function unmark(a) {
    a.removeAttribute(MARK);
    a.style.removeProperty('outline');
    a.style.removeProperty('outline-offset');
    a.style.removeProperty('background-color');
  }

  function enable() {
    document.querySelectorAll(SELECTOR).forEach(mark);
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          const a = r.target;
          if (a.matches?.(SELECTOR)) mark(a);
          else if (a.hasAttribute?.(MARK)) unmark(a);
          continue;
        }
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches(SELECTOR)) mark(node);
          node.querySelectorAll?.(SELECTOR).forEach(mark);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['rel'] });
  }

  function disable() {
    observer?.disconnect();
    observer = null;
    document.querySelectorAll(`[${MARK}]`).forEach(unmark);
  }

  const apply = (on) => (on ? enable() : disable());

  api.storage.local.get('highlightNofollow').then((s) => apply(Boolean(s.highlightNofollow)));
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.highlightNofollow) apply(Boolean(changes.highlightNofollow.newValue));
  });
})();
