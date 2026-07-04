/* Milestones: state/county crossings (reverse geocoding), distance
   milestones, and trip records — surfaced as toasts + the Drive event feed.

   Reverse geocoding uses BigDataCloud's free client endpoint (keyless, CORS)
   and is polled sparingly: every 90 s, and only after ~2.5 km of movement.
*/

import { emit, on } from './bus.js';
import { haversineM, fmtAlt, altUnit, fmtSpeed, speedUnit, imperial, M2MI } from './util.js';
import { trip, addTripEvent } from './trip.js';

const GEO_MIN_MS = 90000;
const GEO_MIN_DIST_M = 2500;

let lastGeoT = 0;
let lastGeoPos = null;
let region = { state: null, county: null, city: null };

let lastMilestoneDist = 0;   // in display units (mi or km)
let bestMaxAltM = null;
let bestMaxSpdMps = 0;

on('trip-life', ({ type, trip: t }) => {
  if (type === 'start') {
    lastMilestoneDist = 0;
    bestMaxAltM = null;
    bestMaxSpdMps = 0;
  } else if (type === 'resume') {
    const s = t.stats;
    lastMilestoneDist = Math.floor((imperial() ? s.distM * M2MI : s.distM / 1000) / 50) * 50;
    bestMaxAltM = s.maxAltM;
    bestMaxSpdMps = s.maxSpdMps;
  }
});

on('fix', (fix) => {
  maybeGeocode(fix);
  if (trip) checkRecords(trip);
});

function announce(msg) {
  emit('event', { msg, kind: 'milestone' });
  addTripEvent(msg);
}

/* ── region change detection ─────────────────────────── */

async function maybeGeocode(fix) {
  const now = Date.now();
  if (now - lastGeoT < GEO_MIN_MS) return;
  if (lastGeoPos && haversineM(lastGeoPos.lat, lastGeoPos.lon, fix.lat, fix.lon) < GEO_MIN_DIST_M) return;
  lastGeoT = now;
  lastGeoPos = { lat: fix.lat, lon: fix.lon };

  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${fix.lat.toFixed(4)}&longitude=${fix.lon.toFixed(4)}&localityLanguage=en`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();

    const state = j.principalSubdivision || null;
    const city = j.city || j.locality || null;
    const county = (j.localityInfo?.administrative || [])
      .find((x) => /county|parish|borough/i.test(x.description || ''))?.name || null;

    if (state && region.state && state !== region.state) {
      announce(`Welcome to ${state}!`);
    }
    region = { state, county, city };
    updateLocationLine();
  } catch (e) {
    console.warn('[milestones] geocode:', e.message);
  }
}

function updateLocationLine() {
  const el = document.getElementById('tripState');
  if (el && !trip && region.city) el.title = `${region.city}, ${region.state}`;
  // Location context also feeds the Trips screen via getRegion().
}

export function getRegion() { return region; }

/* ── distance milestones + trip records ──────────────── */

function checkRecords(t) {
  const s = t.stats;

  // Every 50 mi (or 50 km in metric).
  const dist = imperial() ? s.distM * M2MI : s.distM / 1000;
  const unit = imperial() ? 'miles' : 'km';
  if (dist - lastMilestoneDist >= 50) {
    lastMilestoneDist = Math.floor(dist / 50) * 50;
    announce(`${lastMilestoneDist} ${unit} down the road 🛣`);
  }

  // New trip high point (only announce after beating the old one clearly).
  if (s.maxAltM != null) {
    if (bestMaxAltM == null) {
      bestMaxAltM = s.maxAltM;
    } else if (s.maxAltM > bestMaxAltM + 60) { // ~200 ft
      bestMaxAltM = s.maxAltM;
      announce(`New trip high point: ${fmtAlt(s.maxAltM)} ${altUnit()} ⛰`);
    }
  }

  // New top speed (after the trip is 5+ min old, so the first onramp
  // doesn't spam records).
  const tripAge = Date.now() - t.startedAt;
  if (tripAge > 5 * 60000 && s.maxSpdMps > bestMaxSpdMps + 2.2) { // +5 mph
    bestMaxSpdMps = s.maxSpdMps;
    announce(`New top speed: ${fmtSpeed(s.maxSpdMps)} ${speedUnit()} 🚀`);
  }
}
