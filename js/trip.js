/* Trip engine: lifecycle, live stats, point sampling.

   A trip is:
     { id, startedAt, endedAt, status: 'active'|'done', stats: {...},
       events: [{t, msg}], points: [{t, lat, lon, altM, spd, hdg}] }

   Stats are recomputed incrementally from each accepted fix. Points are
   sampled (~every SAMPLE_MS) — that's what charts, the map track, storage,
   and exports all use.
*/

import { emit, on } from './bus.js';
import { haversineM } from './util.js';

const SAMPLE_MS = 3000;          // point sampling interval
const DIST_ACC_GATE_M = 50;      // ignore distance from fixes worse than this
const MOVING_SPEED_MPS = 1.3;    // ~3 mph: below this you're "stopped"
const CLIMB_HYSTERESIS_M = 5;    // altitude noise gate for climb/descent
const AUTO_START_MPS = 4.5;      // ~10 mph
const AUTO_START_FIXES = 5;      // sustained over this many fixes

export let trip = null;          // the active trip (or null)

let lastFix = null;
let lastSampleT = 0;
let altRef = null;               // hysteresis reference for climb/descent
let autoStartCount = 0;

function newStats() {
  return {
    distM: 0,
    maxSpdMps: 0,
    maxAltM: null, minAltM: null,
    climbM: 0, descentM: 0,
    movingMs: 0,
  };
}

export function startTrip(startedAt = Date.now()) {
  if (trip) return trip;
  trip = {
    id: 't' + startedAt,
    startedAt,
    endedAt: null,
    status: 'active',
    stats: newStats(),
    events: [],
    points: [],
  };
  lastFix = null;
  lastSampleT = 0;
  altRef = null;
  emit('trip-life', { type: 'start', trip });
  emit('trip', { trip });
  return trip;
}

export function endTrip() {
  if (!trip) return null;
  trip.endedAt = Date.now();
  trip.status = 'done';
  const ended = trip;
  emit('trip-life', { type: 'end', trip: ended });
  trip = null;
  lastFix = null;
  emit('trip', { trip: null });
  return ended;
}

/* Rehydrate an active trip from storage after an app restart. */
export function resumeTrip(saved, points) {
  trip = { ...saved, points: points || [] };
  lastFix = null;                // don't bridge distance across the gap
  altRef = null;
  const last = trip.points[trip.points.length - 1];
  lastSampleT = last ? last.t : 0;
  emit('trip-life', { type: 'resume', trip });
  emit('trip', { trip });
}

export function addTripEvent(msg, t = Date.now()) {
  if (!trip) return;
  trip.events.push({ t, msg });
}

on('fix', (fix) => {
  if (!trip) {
    maybeAutoStart(fix);
    return;
  }

  const s = trip.stats;
  const spd = fix.speedMps ?? 0;

  if (spd > s.maxSpdMps) s.maxSpdMps = spd;

  if (lastFix) {
    const dtMs = fix.t - lastFix.t;
    if (dtMs > 0 && dtMs < 60000) {
      if (spd > MOVING_SPEED_MPS) s.movingMs += dtMs;

      // Distance: only from good-accuracy fixes while actually moving,
      // so parking-lot GPS wander doesn't accumulate.
      if (fix.accM <= DIST_ACC_GATE_M && spd > MOVING_SPEED_MPS) {
        s.distM += haversineM(lastFix.lat, lastFix.lon, fix.lat, fix.lon);
      }
    }
  }

  if (fix.altM != null) {
    if (s.maxAltM == null || fix.altM > s.maxAltM) s.maxAltM = fix.altM;
    if (s.minAltM == null || fix.altM < s.minAltM) s.minAltM = fix.altM;

    if (altRef == null) altRef = fix.altM;
    const dAlt = fix.altM - altRef;
    if (dAlt > CLIMB_HYSTERESIS_M) { s.climbM += dAlt; altRef = fix.altM; }
    else if (dAlt < -CLIMB_HYSTERESIS_M) { s.descentM += -dAlt; altRef = fix.altM; }
  }

  if (fix.t - lastSampleT >= SAMPLE_MS) {
    lastSampleT = fix.t;
    trip.points.push({
      t: fix.t, lat: fix.lat, lon: fix.lon,
      altM: fix.altM, spd, hdg: fix.heading,
    });
  }

  lastFix = fix;
  emit('trip', { trip });
});

function maybeAutoStart(fix) {
  if ((fix.speedMps ?? 0) > AUTO_START_MPS) {
    autoStartCount++;
    if (autoStartCount >= AUTO_START_FIXES) {
      autoStartCount = 0;
      startTrip();
      addTripEvent('Trip auto-started (movement detected)');
      emit('event', { msg: 'Trip auto-started', kind: 'info' });
    }
  } else {
    autoStartCount = 0;
  }
}
