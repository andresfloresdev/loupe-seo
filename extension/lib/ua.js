import { api } from './api.js';

// The switch rewrites the User-Agent request header with a declarativeNetRequest
// rule (Safari 16.4+). Safari has no per-tab rule conditions, so it applies to
// every tab until it is reset, and the toolbar badge shows "UA" while it is on.

const CHROME = '141.0.7390.122';

export const UA_PRESETS = [
  { id: 'default', name: 'Browser default', ua: null },
  {
    id: 'googlebot-smartphone',
    name: 'Googlebot Smartphone',
    ua: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
  },
  {
    id: 'googlebot-desktop',
    name: 'Googlebot Desktop',
    ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/${CHROME} Safari/537.36`,
  },
  {
    id: 'bingbot',
    name: 'Bingbot',
    ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/${CHROME} Safari/537.36`,
  },
  {
    id: 'gptbot',
    name: 'GPTBot (OpenAI)',
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  },
  {
    id: 'claudebot',
    name: 'ClaudeBot (Anthropic)',
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  },
  {
    id: 'perplexitybot',
    name: 'PerplexityBot',
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  },
  {
    id: 'iphone',
    name: 'iPhone Safari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'android-chrome',
    name: 'Android Chrome',
    ua: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Mobile Safari/537.36`,
  },
  {
    id: 'windows-chrome',
    name: 'Windows Chrome',
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`,
  },
  { id: 'custom', name: 'Custom…', ua: null },
];

export const UA_RULE_ID = 1;

const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];

export function uaRule(ua) {
  return {
    id: UA_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'User-Agent', operation: 'set', value: ua }],
    },
    // Without resourceTypes, main_frame requests would not match.
    condition: { resourceTypes: RESOURCE_TYPES },
  };
}

export function resolveUA(presetId, custom) {
  if (presetId === 'custom') return (custom ?? '').trim() || null;
  return UA_PRESETS.find((p) => p.id === presetId)?.ua ?? null;
}

export async function activeUA() {
  const rules = await api.declarativeNetRequest.getDynamicRules();
  const rule = rules.find((r) => r.id === UA_RULE_ID);
  return rule?.action?.requestHeaders?.[0]?.value ?? null;
}

export async function applyUA(ua) {
  const update = { removeRuleIds: [UA_RULE_ID] };
  if (ua) update.addRules = [uaRule(ua)];
  await api.declarativeNetRequest.updateDynamicRules(update);
  await syncBadge(ua);
}

export async function syncBadge(ua) {
  const value = ua === undefined ? await activeUA() : ua;
  await api.action.setBadgeText({ text: value ? 'UA' : '' });
  if (value && api.action.setBadgeBackgroundColor) {
    try {
      await api.action.setBadgeBackgroundColor({ color: '#0B8F64' });
    } catch {}
  }
}
