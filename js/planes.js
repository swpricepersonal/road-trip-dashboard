/* Nearby aircraft via airplanes.live (free, keyless, CORS-open — adsb.lol
   was the original choice but sends no CORS headers, so browsers block it).

   Polls /v2/point/{lat}/{lon}/{radius_nm} while the Sky tab is visible and
   renders each plane with observer geometry from the car: distance, clock
   position relative to heading, which window to look out, and how far up.
   (Geometry approach ported from the wall-display ADSB module.)
*/

import { on } from './bus.js';
import {
  haversineM, bearingDeg, clockPos, sideOfCar, compass,
  M2MI, M2FT, esc,
} from './util.js';
import { settings } from './settings.js';

const POLL_MS = 10000;
const FT2M = 0.3048;

// US military ICAO24 allocation (from wall-display config)
const MIL_RANGES = [[0xae0000, 0xafffff]];

let skyActive = false;
let lastFix = null;
let timer = null;
let lastError = null;

// Aircraft photo lookup via Wikipedia's search API (keyless, CORS-open via
// origin=*). planespotters.net's per-tail photo API was the obvious choice
// but rejects any real browser User-Agent, and browsers won't let JS override
// it — no static-site workaround. Wikipedia gives a representative photo of
// the aircraft *model* instead of the exact tail, which is good enough here
// and is cached per type so repeat sightings cost nothing.
const IMG_CACHE = new Map(); // desc/type string -> photo URL or null (looked up, none found)
const IMG_PENDING = new Set();
const PLANE_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4a5a6b">'
  + '<path d="M22 16v-2l-8.5-5V3.5a1.5 1.5 0 0 0-3 0V9L2 14v2l8.5-2.5V19L8 20.5V22l4-1 4 1v-1.5L13.5 19v-5.5z"/></svg>',
);

on('screen', ({ name }) => {
  skyActive = name === 'sky';
  if (skyActive) { poll(); timer ??= setInterval(poll, POLL_MS); }
  else if (timer) { clearInterval(timer); timer = null; }
});

on('fix', (fix) => { lastFix = fix; });

async function poll() {
  if (!skyActive || !lastFix) return;
  const { lat, lon } = lastFix;
  const radius = settings.planeRadiusNm || 25;
  try {
    const r = await fetch(`https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radius}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    lastError = null;
    render(j.ac || []);
  } catch (e) {
    lastError = e.message;
    console.warn('[planes]', e.message);
    renderError();
  }
}

function planeImgKey(a) {
  return (a.desc || a.t || '').trim();
}

function ensurePlaneImage(key) {
  if (!key || IMG_CACHE.has(key) || IMG_PENDING.has(key)) return;
  IMG_PENDING.add(key);
  fetchPlaneImage(key);
}

async function fetchPlaneImage(key) {
  try {
    const q = encodeURIComponent(key);
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${q}&gsrlimit=1&prop=pageimages&pithumbsize=200`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    const j = await r.json();
    const page = Object.values(j?.query?.pages || {})[0];
    IMG_CACHE.set(key, page?.thumbnail?.source || null);
  } catch {
    IMG_CACHE.set(key, null);
  } finally {
    IMG_PENDING.delete(key);
    const src = IMG_CACHE.get(key);
    if (src) patchPlaneImages(key, src);
  }
}

function patchPlaneImages(key, src) {
  document.querySelectorAll('.plane-img').forEach((img) => {
    if (img.dataset.key === key) img.src = src;
  });
}

function isMilitary(hex) {
  const v = parseInt(hex, 16);
  return !Number.isNaN(v) && MIL_RANGES.some(([lo, hi]) => v >= lo && v <= hi);
}

function render(acList) {
  const listEl = document.getElementById('planeList');
  const countEl = document.getElementById('planeCount');
  if (!listEl) return;

  const { lat, lon, heading, altM } = lastFix;
  const carAlt = altM ?? 0;

  const planes = acList
    .filter((a) => a.lat != null && a.lon != null && a.alt_baro !== 'ground')
    .map((a) => {
      const pAltM = typeof a.alt_baro === 'number' ? a.alt_baro * FT2M : null;
      const gDistM = haversineM(lat, lon, a.lat, a.lon);
      const brg = bearingDeg(lat, lon, a.lat, a.lon);
      const elevDeg = pAltM != null
        ? (Math.atan2(pAltM - carAlt, gDistM) * 180) / Math.PI
        : null;
      return { a, pAltM, gDistM, brg, elevDeg };
    })
    .sort((x, y) => x.gDistM - y.gDistM)
    .slice(0, 12);

  countEl.textContent = planes.length ? `(${planes.length})` : '';

  if (!planes.length) {
    listEl.innerHTML = `<div class="muted">no aircraft within ${settings.planeRadiusNm} nm</div>`;
    return;
  }

  listEl.innerHTML = planes.map(({ a, pAltM, gDistM, brg, elevDeg }) => {
    const name = (a.flight || '').trim() || a.r || a.hex;
    const mil = isMilitary(a.hex) ? ' 🪖' : '';
    const altFt = pAltM != null ? Math.round(pAltM * M2FT / 100) * 100 : null;
    const distMi = (gDistM * M2MI).toFixed(1);
    const imgKey = planeImgKey(a);
    const imgSrc = IMG_CACHE.get(imgKey) || PLANE_PLACEHOLDER;
    ensurePlaneImage(imgKey);

    let look;
    if (heading != null) {
      const rel = ((brg - heading) % 360 + 360) % 360;
      look = `${clockPos(rel)} · ${sideOfCar(rel)}`;
    } else {
      look = `to the ${compass(brg)}`;
    }
    if (elevDeg != null && elevDeg > 1) look += ` · ${Math.round(elevDeg)}° up`;

    const detail = [
      altFt != null ? `${altFt.toLocaleString()} ft` : 'alt n/a',
      a.gs != null ? `${Math.round(a.gs)} kt` : null,
      `${distMi} mi away`,
      a.baro_rate > 300 ? 'climbing' : a.baro_rate < -300 ? 'descending' : null,
    ].filter(Boolean).join(' · ');

    const who = [a.ownOp, a.desc].filter(Boolean).join(' — ');

    return `<div class="plane-card">
      <img class="plane-img" data-key="${esc(imgKey)}" src="${imgSrc}" alt="" loading="lazy">
      <div class="plane-info">
        <div class="plane-head"><span>${esc(name)}${mil}</span><span class="ptype">${esc(a.t || '')}</span></div>
        ${who ? `<div class="plane-detail">${esc(who)}</div>` : ''}
        <div class="plane-detail">${detail}</div>
        <div class="plane-look">👀 ${look}</div>
      </div>
    </div>`;
  }).join('');
}

function renderError() {
  const listEl = document.getElementById('planeList');
  if (listEl) listEl.innerHTML = `<div class="muted">aircraft data unavailable (${esc(lastError)})</div>`;
}
