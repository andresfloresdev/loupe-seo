import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../../extension/lib/platform.js';

test('Chrome, Brave, Edge and Arc: chrome-extension: URL with the downloads API', () => {
  assert.equal(detectPlatform({ extensionUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/', hasDownloads: true }), 'chrome');
});

test('Safari: safari-web-extension: URL, no downloads API', () => {
  assert.equal(detectPlatform({ extensionUrl: 'safari-web-extension://3F2A9C1E-0000-4000-8000-000000000000/', hasDownloads: false }), 'safari');
});

test('the Safari build loaded in Chromium (no downloads permission) takes the Safari path', () => {
  assert.equal(detectPlatform({ extensionUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/', hasDownloads: false }), 'safari');
});

test('a downloads API alone is not Chrome: the scheme must say so too', () => {
  assert.equal(detectPlatform({ extensionUrl: 'safari-web-extension://3F2A9C1E/', hasDownloads: true }), 'safari');
  assert.equal(detectPlatform({ extensionUrl: 'moz-extension://5d1a/', hasDownloads: true }), 'safari');
});

test('no extension URL (outside a browser) falls back to the Safari path', () => {
  assert.equal(detectPlatform({ extensionUrl: undefined, hasDownloads: false }), 'safari');
  assert.equal(detectPlatform({}), 'safari');
});

test('the scheme is read case-insensitively', () => {
  assert.equal(detectPlatform({ extensionUrl: 'Chrome-Extension://abc/', hasDownloads: true }), 'chrome');
});
