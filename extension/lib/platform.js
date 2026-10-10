import { api } from './api.js';

// The one place that decides which browser Loupe runs in. It reads the
// extension itself, never the page:
// - the scheme of its own URLs: chrome-extension: in Chrome, Brave, Edge and
//   Arc, safari-web-extension: in Safari;
// - whether the downloads API exists, which only the Chrome build's manifest
//   asks for (Safari has no such API).
// Both must say Chrome. Anything else takes the Safari path, which only uses
// APIs every browser has. Loading the Safari build in Chromium (how the e2e
// suite covers Safari's fallbacks) therefore runs the Safari path everywhere.
//
// Chrome-only calls sit behind IS_CHROME. The compat gate
// (scripts/check-safari-compat.mjs) fails on any Safari-unsupported call or
// rule feature that is not behind it.

export function detectPlatform({ extensionUrl, hasDownloads }) {
  const scheme = String(extensionUrl ?? '').split(':')[0].toLowerCase();
  return scheme === 'chrome-extension' && hasDownloads ? 'chrome' : 'safari';
}

export const PLATFORM = detectPlatform({
  extensionUrl: api?.runtime?.getURL?.('/'),
  hasDownloads: typeof api?.downloads?.download === 'function',
});

export const IS_CHROME = PLATFORM === 'chrome';
