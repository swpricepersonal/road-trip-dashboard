/* Achievement badges: fun, one-time unlocks persisted in localStorage
   (independent of any single trip). Rendered as a tray on the Trips screen. */

import { emit, on } from './bus.js';
import { addTripEvent } from './trip.js';
import { getWeather } from './weather.js';
import { getRegion } from './milestones.js';

const KEY = 'rtd-badges';
const MOVING_MPS = 1.3; // ~3 mph
const SUMMIT_ALT_M = 3048; // 10,000 ft
const STORM_CODES = new Set([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

export const BADGES = [
  { id: 'night-owl', icon: '🦉', name: 'Night Owl', desc: 'Drive between midnight and 5am' },
  { id: 'storm-chaser', icon: '⛈️', name: 'Storm Chaser', desc: 'Drive through active rain or a storm' },
  { id: 'state-collector', icon: '🗺️', name: 'State Collector', desc: 'Cross into 3+ states in one trip' },
  { id: 'summit', icon: '⛰️', name: 'Summit', desc: 'Reach 10,000 ft elevation' },
];

const unlocked = new Set(load());
let statesThisTrip = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify([...unlocked]));
}

function unlock(id) {
  if (unlocked.has(id)) return;
  unlocked.add(id);
  save();
  const b = BADGES.find((x) => x.id === id);
  const msg = `🏆 Achievement unlocked: ${b.icon} ${b.name}`;
  emit('event', { msg, kind: 'achievement' });
  addTripEvent(msg);
  render();
}

on('trip-life', ({ type }) => {
  if (type === 'start' || type === 'resume') {
    // Seed with the state we're already in — "3+ states in one trip" should
    // count the starting state, not just crossings after departure.
    statesThisTrip = new Set();
    const s = getRegion().state;
    if (s) statesThisTrip.add(s);
  }
});

on('region-change', ({ state }) => {
  if (!state) return;
  statesThisTrip.add(state);
  if (statesThisTrip.size >= 3) unlock('state-collector');
});

on('fix', (fix) => {
  if ((fix.speedMps ?? 0) <= MOVING_MPS) return;

  const hour = new Date(fix.t).getHours();
  if (hour >= 0 && hour < 5) unlock('night-owl');

  const wx = getWeather();
  const code = wx?.current?.weather_code;
  if (code != null && STORM_CODES.has(code)) unlock('storm-chaser');
});

on('trip', ({ trip: t }) => {
  if (t?.stats?.maxAltM != null && t.stats.maxAltM >= SUMMIT_ALT_M) unlock('summit');
});

function render() {
  const el = document.getElementById('badgeTray');
  if (!el) return;
  el.innerHTML = BADGES.map((b) => `
    <div class="badge${unlocked.has(b.id) ? ' unlocked' : ''}" title="${b.desc}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-name">${b.name}</div>
    </div>`).join('');
}

on('screen', ({ name }) => { if (name === 'trips') render(); });
render();
