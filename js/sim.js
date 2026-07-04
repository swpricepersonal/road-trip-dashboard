/* Simulation mode (?sim=1): replays a synthetic drive so every feature can
   be exercised in a desktop browser with no GPS.

   Route: starts south of Huntsville, AL and drives north on a gently curving
   path across the Tennessee state line — real coordinates, so weather,
   aircraft, reverse-geocoding, and the map all return live plausible data.

   ?sim=1&fast=1 runs at 10x (each tick advances 10 simulated seconds).

   Ground truth is exposed at window.__sim for automated verification.
*/

import { emit } from './bus.js';

const START = { lat: 34.62, lon: -86.57 }; // south of Huntsville, AL
const TICK_MS = 1000;

let simT = Date.now();
let lat = START.lat;
let lon = START.lon;
let elapsed = 0;      // simulated seconds
let distM = 0;
let maxSpd = 0;

/* Speed profile (m/s) over simulated time: city start, highway cruise,
   a stop, then more cruising with variation. */
function targetSpeed(tSec) {
  if (tSec < 20) return tSec * 1.2;                    // accelerate 0→~24 m/s
  if (tSec < 240) return 30 + 4 * Math.sin(tSec / 25); // highway ~63-76 mph
  if (tSec < 270) return Math.max(0, 30 - (tSec - 240) * 1.5); // brake to stop
  if (tSec < 300) return 0;                            // stopped 30 s
  if (tSec < 320) return (tSec - 300) * 1.6;           // back up to speed
  return 31 + 3 * Math.sin(tSec / 30);
}

/* Elevation profile (m): rolling terrain with one big ridge. */
function elevation(tSec) {
  return 190 + 60 * Math.sin(tSec / 90) + 90 * Math.exp(-(((tSec - 500) / 120) ** 2));
}

/* Heading: mostly north with sweeping curves. */
function heading(tSec) {
  return (360 + 8 * Math.sin(tSec / 40) + 6 * Math.sin(tSec / 130)) % 360;
}

export function startSim({ fast = false } = {}) {
  const step = fast ? 10 : 1; // simulated seconds per tick
  console.log(`[sim] starting synthetic drive (${step}x)`);

  setInterval(() => {
    for (let i = 0; i < step; i++) tick(1);
    publish();
  }, TICK_MS);
}

function tick(dtSec) {
  elapsed += dtSec;
  const spd = targetSpeed(elapsed);
  const hdg = heading(elapsed);

  const dM = spd * dtSec;
  distM += dM;
  maxSpd = Math.max(maxSpd, spd);

  // Move along heading.
  const dLat = (dM * Math.cos((hdg * Math.PI) / 180)) / 111320;
  const dLon = (dM * Math.sin((hdg * Math.PI) / 180)) / (111320 * Math.cos((lat * Math.PI) / 180));
  lat += dLat;
  lon += dLon;
  simT += dtSec * 1000;
}

function publish() {
  const spd = targetSpeed(elapsed);
  const fix = {
    t: simT,
    lat,
    lon,
    altM: elevation(elapsed) + (Math.random() - 0.5) * 2,
    speedMps: Math.max(0, spd + (Math.random() - 0.5) * 0.4),
    heading: heading(elapsed),
    accM: 8 + Math.random() * 4,
    altAccM: 6,
  };
  window.__sim = { elapsed, distM, maxSpd, lat, lon };
  emit('gps-status', { state: 'good', accM: fix.accM });
  emit('fix', fix);
}
