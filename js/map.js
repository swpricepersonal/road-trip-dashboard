/* Map screen: Leaflet + OpenStreetMap tiles, live trip track polyline,
   position marker, and a RainViewer precipitation radar overlay.

   The map is initialized lazily the first time the tab is opened (Leaflet
   needs a visible container to size itself). */

import { on } from './bus.js';
import { trip } from './trip.js';

const RADAR_META_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_REFRESH_MS = 5 * 60 * 1000;

let map = null;
let track = null;
let marker = null;
let radarLayer = null;
let radarOn = false;
let radarTimer = null;
let follow = true;
let lastFix = null;
let drawnPoints = 0;

on('screen', ({ name }) => {
  if (name !== 'map') return;
  if (!map) initMap();
  else map.invalidateSize();
  syncTrack();
});

on('fix', (fix) => {
  lastFix = fix;
  if (!map) return;
  marker.setLatLng([fix.lat, fix.lon]);
  if (follow && document.getElementById('screen-map').classList.contains('active')) {
    map.setView([fix.lat, fix.lon]);
  }
  syncTrack();
});

on('trip-life', ({ type }) => {
  if (type === 'start' && track) { track.setLatLngs([]); drawnPoints = 0; }
});

function initMap() {
  const center = lastFix ? [lastFix.lat, lastFix.lon] : [39.5, -98.35]; // CONUS
  map = L.map('map', { zoomControl: false, attributionControl: true })
    .setView(center, lastFix ? 12 : 4);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  track = L.polyline([], { color: '#35d07f', weight: 4, opacity: 0.9 }).addTo(map);
  marker = L.circleMarker(center, {
    radius: 9, color: '#fff', weight: 2, fillColor: '#4db8ff', fillOpacity: 1,
  }).addTo(map);

  drawnPoints = 0;
  syncTrack();

  // Manual pan pauses follow mode.
  map.on('dragstart', () => setFollow(false));

  document.getElementById('radarToggle').addEventListener('click', () => setRadar(!radarOn));
  document.getElementById('followToggle').addEventListener('click', () => setFollow(!follow));
}

function syncTrack() {
  if (!map || !trip) return;
  const pts = trip.points;
  while (drawnPoints < pts.length) {
    track.addLatLng([pts[drawnPoints].lat, pts[drawnPoints].lon]);
    drawnPoints++;
  }
}

function setFollow(v) {
  follow = v;
  document.getElementById('followToggle').classList.toggle('chip-on', v);
  if (v && lastFix) map.setView([lastFix.lat, lastFix.lon]);
}

async function setRadar(v) {
  radarOn = v;
  document.getElementById('radarToggle').classList.toggle('chip-on', v);
  if (!v) {
    if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
    if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
    return;
  }
  await refreshRadar();
  radarTimer = setInterval(refreshRadar, RADAR_REFRESH_MS);
}

async function refreshRadar() {
  try {
    const r = await fetch(RADAR_META_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const frames = j.radar?.past || [];
    if (!frames.length) return;
    const latest = frames[frames.length - 1];
    const url = `${j.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;

    // RainViewer's radar mosaic has no real detail past zoom 7 (confirmed:
    // deeper zoom just crops/upscales the same z7 image). maxNativeZoom
    // stops network fetches there and lets Leaflet scale the cached tile
    // client-side for closer zooms, instead of re-downloading duplicates.
    const fresh = L.tileLayer(url, { opacity: 0.65, maxZoom: 19, maxNativeZoom: 7 });
    fresh.addTo(map);
    if (radarLayer) map.removeLayer(radarLayer);
    radarLayer = fresh;
  } catch (e) {
    console.warn('[radar]', e.message);
  }
}
