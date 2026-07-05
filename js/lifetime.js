/* Lifetime stats theater: total miles and climb across ALL saved trips,
   compared against famous journeys and mountains. Rendered as a section on
   the Trips screen; recomputed when the tab opens or a trip ends (cheap —
   it's a sum over trip metas already in IndexedDB, no points loaded). */

import { on } from './bus.js';
import { getTrips } from './store.js';
import { trip } from './trip.js';
import { M2MI, M2FT, imperial } from './util.js';

// [miles, journey] — ascending. The ladder shows the last one conquered and
// progress toward the next.
const JOURNEYS = [
  [800, 'the length of California'],
  [2170, 'the Oregon Trail'],
  [2448, 'all of Route 66'],
  [4350, 'the Silk Road'],
  [7400, "Lewis & Clark's round trip"],
  [19000, 'the Pan-American Highway'],
  [24901, 'around the world at the equator'],
  [238855, 'to the Moon'],
];

// [meters, mountain] — ascending; past Everest it becomes "N.N× Everest".
const CLIMBS = [
  [381, 'the Empire State Building'],
  [828, 'the Burj Khalifa'],
  [1345, 'Ben Nevis'],
  [3776, 'Mount Fuji'],
  [6190, 'Denali'],
  [8849, 'Mount Everest'],
];
const EVEREST_M = 8849;

async function render() {
  const el = document.getElementById('lifetimeStats');
  if (!el) return;

  let distM = 0;
  let climbM = 0;
  try {
    for (const t of await getTrips()) {
      if (t.status !== 'done') continue;
      distM += t.stats?.distM ?? 0;
      climbM += t.stats?.climbM ?? 0;
    }
  } catch { /* storage unavailable — show active trip only */ }
  if (trip) {
    distM += trip.stats.distM;
    climbM += trip.stats.climbM;
  }

  const miles = distM * M2MI;
  const km = distM / 1000;
  const distStr = imperial()
    ? `${Math.round(miles).toLocaleString()} mi`
    : `${Math.round(km).toLocaleString()} km`;

  // Journey ladder (thresholds are in miles regardless of display units).
  let conquered = null;
  let next = JOURNEYS[JOURNEYS.length - 1];
  for (const j of JOURNEYS) {
    if (miles >= j[0]) conquered = j; else { next = j; break; }
  }
  const pct = Math.min(100, (miles / next[0]) * 100);

  const climbFt = Math.round(climbM * M2FT);
  let climbLabel = null;
  if (climbM >= EVEREST_M) {
    climbLabel = `${(climbM / EVEREST_M).toFixed(1)}× Mount Everest`;
  } else {
    for (const [m, name] of CLIMBS) if (climbM >= m) climbLabel = name;
    if (climbLabel && climbLabel !== 'Mount Everest') climbLabel = `higher than ${climbLabel}`;
  }

  el.innerHTML = `
    <div class="lifetime-line"><span class="lifetime-num">${distStr}</span> driven all-time${
      conquered ? ` — farther than ${conquered[1]}` : ''}</div>
    <div class="plate-progress"><div class="lifetime-fill" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="lifetime-next">${Math.round(pct)}% of the way ${next[1] === 'to the Moon' ? '' : 'to driving '}${next[1]}</div>
    <div class="lifetime-line climb">⛰ ${climbFt.toLocaleString()} ft total climb${
      climbLabel ? ` — ${climbLabel}` : ''}</div>`;
}

on('screen', ({ name }) => { if (name === 'trips') render(); });
on('trip-life', ({ type }) => { if (type === 'end') render(); });
