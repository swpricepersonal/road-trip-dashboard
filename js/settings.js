/* Persistent app settings (localStorage). */

import { emit } from './bus.js';

const KEY = 'rtd-settings';

const defaults = {
  units: 'imperial',      // 'imperial' | 'metric'
  planeRadiusNm: 25,      // aircraft search radius
  keepAwake: true,        // screen wake lock
  voice: true,            // spoken milestone/event announcements
};

export const settings = { ...defaults, ...load() };

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  Object.assign(settings, patch);
  localStorage.setItem(KEY, JSON.stringify(settings));
  emit('settings');
}
