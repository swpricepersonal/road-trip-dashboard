/* IndexedDB persistence + export.

   Stores:
     trips  (keyPath 'id')  — trip meta: {id, startedAt, endedAt, status, stats, events}
     points (autoIncrement) — {tripId, t, lat, lon, altM, spd, hdg}, index on tripId

   Wiring: listens to trip events on the bus. Points are buffered and flushed
   every FLUSH_MS along with the trip meta, so a crash/restart loses at most
   a few seconds. An 'active' trip found at boot is offered for resume.
*/

import { on } from './bus.js';
import { trip, resumeTrip } from './trip.js';
import { fmtDist, distUnit, fmtSpeed, speedUnit, fmtAlt, altUnit, fmtDuration } from './util.js';

const FLUSH_MS = 5000;
const STALE_TRIP_MS = 12 * 3600 * 1000; // active trip older than 12 h → close it

let db = null;
let pendingPoints = [];
let savedPointCount = 0; // how many of trip.points are already persisted

export function initStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('rtd', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('trips', { keyPath: 'id' });
      const pts = d.createObjectStore('points', { autoIncrement: true });
      pts.createIndex('tripId', 'tripId');
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

const req2p = (req) =>
  new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const getTrips = () => req2p(tx('trips').getAll());
export const getTripPoints = (tripId) => req2p(tx('points').index('tripId').getAll(tripId));

export function putTripMeta(t) {
  const { points, ...meta } = t; // points live in their own store
  return req2p(tx('trips', 'readwrite').put(meta));
}

export async function deleteTrip(tripId) {
  await req2p(tx('trips', 'readwrite').delete(tripId));
  const store = tx('points', 'readwrite');
  const keys = await req2p(store.index('tripId').getAllKeys(tripId));
  for (const k of keys) store.delete(k);
}

/* ── boot-time resume ────────────────────────────────── */

export async function restoreActiveTrip() {
  const all = await getTrips();
  const active = all
    .filter((t) => t.status === 'active')
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!active) return false;

  const points = await getTripPoints(active.id);
  const lastT = points.length ? points[points.length - 1].t : active.startedAt;

  if (Date.now() - lastT > STALE_TRIP_MS) {
    // Ancient leftover — close it out rather than resuming a week-old trip.
    active.status = 'done';
    active.endedAt = lastT;
    await putTripMeta(active);
    return false;
  }

  savedPointCount = points.length;
  resumeTrip(active, points);
  return true;
}

/* ── continuous save ─────────────────────────────────── */

on('trip', ({ trip: t }) => {
  if (!t) return;
  while (savedPointCount < t.points.length) {
    pendingPoints.push({ tripId: t.id, ...t.points[savedPointCount] });
    savedPointCount++;
  }
});

on('trip-life', async ({ type, trip: t }) => {
  if (type === 'start') { savedPointCount = 0; pendingPoints = []; }
  if (type === 'start' || type === 'end') {
    await flush(t);
  }
});

async function flush(t) {
  if (!db) return;
  if (pendingPoints.length) {
    const store = tx('points', 'readwrite');
    for (const p of pendingPoints) store.put(p);
    pendingPoints = [];
  }
  if (t) await putTripMeta(t);
}

setInterval(() => { if (trip) flush(trip); }, FLUSH_MS);

/* ── export ──────────────────────────────────────────── */

export function tripToGPX(meta, points) {
  const pts = points
    .map((p) => {
      const ele = p.altM != null ? `<ele>${p.altM.toFixed(1)}</ele>` : '';
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${ele}<time>${new Date(p.t).toISOString()}</time></trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Road Trip Dashboard" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Trip ${new Date(meta.startedAt).toLocaleString()}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

export function tripToCSV(meta, points) {
  const rows = points.map((p) =>
    [new Date(p.t).toISOString(), p.lat, p.lon, p.altM ?? '', p.spd ?? '', p.hdg ?? ''].join(','));
  return 'time,lat,lon,alt_m,speed_mps,heading_deg\n' + rows.join('\n');
}

export function download(filename, text, mime = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* One-line stats summary used by the trip history list. */
export function statsSummary(stats, elapsedMs) {
  if (!stats) return '';
  const parts = [
    `${fmtDist(stats.distM)} ${distUnit()}`,
    `max ${fmtSpeed(stats.maxSpdMps)} ${speedUnit()}`,
  ];
  if (stats.maxAltM != null) parts.push(`peak ${fmtAlt(stats.maxAltM)} ${altUnit()}`);
  if (elapsedMs) parts.push(fmtDuration(elapsedMs));
  return parts.join(' · ');
}
