/* App orchestrator: boot, tabs, top bar, Drive screen, Trips screen,
   toasts, settings, wake lock. Feature modules self-wire via the bus. */

import { emit, on } from './bus.js';
import { settings, saveSettings } from './settings.js';
import {
  fmtSpeed, speedUnit, fmtDist, distUnit, fmtAlt, altUnit,
  fmtDuration, fmtClock, compass, esc,
} from './util.js';
import { startGPS } from './gps.js';
import { trip, startTrip, endTrip, addTripEvent } from './trip.js';
import * as store from './store.js';
import { startSim } from './sim.js';
import './charts.js';
import './map.js';
import './weather.js';
import './planes.js';
import './sun.js';
import './milestones.js';

export const APP_VERSION = '0.1.0';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SIM = params.get('sim') === '1';

/* ── tabs ────────────────────────────────────────────── */

document.querySelectorAll('#tabbar button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabbar button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    $(`screen-${btn.dataset.screen}`).classList.add('active');
    emit('screen', { name: btn.dataset.screen });
  });
});

/* ── top bar ─────────────────────────────────────────── */

on('gps-status', ({ state, accM, error }) => {
  const dot = $('gpsDot');
  dot.className = 'dot ' + (state === 'good' ? 'dot-good' : state === 'poor' ? 'dot-poor' : 'dot-off');
  $('gpsAcc').textContent =
    state === 'off' ? (error ? 'GPS off' : 'no fix')
    : `±${Math.round(accM)}m`;
});

function renderTripState() {
  const el = $('tripState');
  if (trip) {
    el.textContent = `● REC · ${fmtDist(trip.stats.distM)} ${distUnit()}`;
    el.classList.add('rec');
  } else {
    el.textContent = 'no trip';
    el.classList.remove('rec');
  }
  const btn = $('tripBtn');
  btn.textContent = trip ? 'End Trip' : 'Start Trip';
  btn.classList.toggle('stop', !!trip);
}

/* ── drive screen ────────────────────────────────────── */

on('fix', (fix) => {
  $('speedVal').textContent = fmtSpeed(fix.speedMps);
  $('speedUnit').textContent = speedUnit();
  $('elevVal').innerHTML = fix.altM != null
    ? `${fmtAlt(fix.altM)}<span class="u"> ${altUnit()}</span>` : '--';
  $('headingVal').textContent = fix.heading != null
    ? `${compass(fix.heading)} ${Math.round(fix.heading)}°` : '--';
});

on('trip', () => {
  renderTripState();
  if (trip) {
    $('distVal').innerHTML = `${fmtDist(trip.stats.distM)}<span class="u"> ${distUnit()}</span>`;
  } else {
    $('distVal').textContent = '--';
  }
  renderLiveStats();
});

/* clock-driven bits (trip time) */
setInterval(() => {
  if (trip) {
    $('tripTime').textContent = fmtDuration(Date.now() - trip.startedAt);
    $('movingTime').textContent = fmtDuration(trip.stats.movingMs);
  } else {
    $('tripTime').textContent = '--';
    $('movingTime').textContent = '--';
  }
}, 1000);

$('tripBtn').addEventListener('click', async () => {
  if (trip) {
    if (!confirm('End this trip?')) return;
    endTrip();
    await renderHistory();
  } else {
    startTrip();
  }
});

/* ── events: toasts + drive feed ─────────────────────── */

on('event', ({ msg }) => {
  toast(msg);
  const feed = $('eventFeed');
  const div = document.createElement('div');
  div.className = 'event-item';
  div.innerHTML = `<time>${fmtClock(Date.now())}</time>${esc(msg)}`;
  feed.prepend(div);
  while (feed.children.length > 20) feed.lastChild.remove();
});

export function toast(msg, ms = 5000) {
  const box = document.createElement('div');
  box.className = 'toast';
  box.textContent = msg;
  $('toasts').appendChild(box);
  setTimeout(() => { box.classList.add('out'); setTimeout(() => box.remove(), 450); }, ms);
}

/* ── trips screen ────────────────────────────────────── */

function statCard(label, value) {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-num sm">${value}</div></div>`;
}

function renderLiveStats() {
  const el = $('liveStats');
  if (!trip) {
    el.innerHTML = '<div class="muted">no active trip</div>';
    return;
  }
  const s = trip.stats;
  const elapsed = Date.now() - trip.startedAt;
  const avgMoving = s.movingMs > 1000 ? s.distM / (s.movingMs / 1000) : null;
  el.innerHTML = [
    statCard('distance', `${fmtDist(s.distM)} ${distUnit()}`),
    statCard('max speed', `${fmtSpeed(s.maxSpdMps)} ${speedUnit()}`),
    statCard('avg moving', avgMoving ? `${fmtSpeed(avgMoving)} ${speedUnit()}` : '--'),
    statCard('elapsed', fmtDuration(elapsed)),
    statCard('moving time', fmtDuration(s.movingMs)),
    statCard('stopped', fmtDuration(elapsed - s.movingMs)),
    statCard('max elev', s.maxAltM != null ? `${fmtAlt(s.maxAltM)} ${altUnit()}` : '--'),
    statCard('min elev', s.minAltM != null ? `${fmtAlt(s.minAltM)} ${altUnit()}` : '--'),
    statCard('total climb', `${fmtAlt(s.climbM)} ${altUnit()}`),
    statCard('total descent', `${fmtAlt(s.descentM)} ${altUnit()}`),
  ].join('');
}

async function renderHistory() {
  const el = $('tripHistory');
  const all = (await store.getTrips())
    .filter((t) => t.status === 'done')
    .sort((a, b) => b.startedAt - a.startedAt);

  if (!all.length) {
    el.innerHTML = '<div class="muted">no saved trips</div>';
    return;
  }

  el.innerHTML = all.map((t) => {
    const d = new Date(t.startedAt);
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + fmtClock(t.startedAt);
    const elapsed = (t.endedAt || t.startedAt) - t.startedAt;
    return `<div class="trip-item" data-id="${t.id}">
      <div class="trip-item-head"><span>${dateStr}</span><span>${fmtDist(t.stats.distM)} ${distUnit()}</span></div>
      <div class="trip-item-stats">${store.statsSummary(t.stats, elapsed)}</div>
      <div class="trip-item-actions">
        <button class="chip" data-act="gpx">GPX</button>
        <button class="chip" data-act="csv">CSV</button>
        <button class="chip danger" data-act="del">delete</button>
      </div>
    </div>`;
  }).join('');
}

$('tripHistory').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.trip-item').dataset.id;
  const metas = await store.getTrips();
  const meta = metas.find((t) => t.id === id);
  if (!meta) return;

  if (btn.dataset.act === 'del') {
    if (!confirm('Delete this trip permanently?')) return;
    await store.deleteTrip(id);
    await renderHistory();
    return;
  }
  const points = await store.getTripPoints(id);
  const stamp = new Date(meta.startedAt).toISOString().slice(0, 10);
  if (btn.dataset.act === 'gpx') {
    store.download(`trip-${stamp}.gpx`, store.tripToGPX(meta, points), 'application/gpx+xml');
  } else {
    store.download(`trip-${stamp}.csv`, store.tripToCSV(meta, points), 'text/csv');
  }
});

$('exportGpxBtn').addEventListener('click', () => {
  if (!trip) return toast('no active trip to export');
  store.download(`trip-current.gpx`, store.tripToGPX(trip, trip.points), 'application/gpx+xml');
});
$('exportCsvBtn').addEventListener('click', () => {
  if (!trip) return toast('no active trip to export');
  store.download(`trip-current.csv`, store.tripToCSV(trip, trip.points), 'text/csv');
});

/* ── settings ────────────────────────────────────────── */

$('settingsBtn').addEventListener('click', () => {
  $('setUnits').value = settings.units;
  $('setPlaneRadius').value = String(settings.planeRadiusNm);
  $('setWake').checked = settings.keepAwake;
  $('verInfo').textContent = `v${APP_VERSION}${SIM ? ' · SIM' : ''}`;
  $('settings').showModal();
});

$('settingsClose').addEventListener('click', () => {
  saveSettings({
    units: $('setUnits').value,
    planeRadiusNm: Number($('setPlaneRadius').value),
    keepAwake: $('setWake').checked,
  });
  $('settings').close();
  renderTripState();
  renderLiveStats();
});

/* ── wake lock ───────────────────────────────────────── */

let wakeLock = null;

async function requestWakeLock() {
  if (!settings.keepAwake || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not fatal — e.g. low battery mode */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
// iOS requires a user gesture before granting a wake lock.
document.body.addEventListener('click', () => { if (!wakeLock) requestWakeLock(); }, { once: false });

/* ── boot ────────────────────────────────────────────── */

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e.message));
  }

  try {
    await store.initStore();
    const resumed = await store.restoreActiveTrip();
    if (resumed) toast('trip resumed');
  } catch (e) {
    console.warn('[store]', e.message);
    toast('storage unavailable — trip will not be saved');
  }

  renderTripState();
  renderLiveStats();
  await renderHistory();

  if (SIM) startSim({ fast: params.get('fast') === '1' });
  else startGPS();

  requestWakeLock();
  emit('screen', { name: 'drive' });
}

boot();
