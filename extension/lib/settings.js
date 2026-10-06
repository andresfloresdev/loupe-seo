import { api } from './api.js';

export const DEFAULTS = {
  highlightNofollow: false,
  googleDomain: 'www.google.com',
  uaPreset: 'default',
  uaCustom: '',
};

export async function getSettings() {
  const stored = await api.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export function setSetting(key, value) {
  return api.storage.local.set({ [key]: value });
}
