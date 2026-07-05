/* License plate game: tap a state once you've spotted its plate. Seen state
   is permanent (localStorage), independent of any trip. Two views share the
   same toggle logic — a grid of state cards and a US map (vendored SVG,
   continental + AK/HI insets — see vendor/us-map/us-states.svg).

   Plate images come from Wikipedia's search API (same keyless/CORS-open
   trick as planes.js's aircraft photos), keyed on each state's "Vehicle
   registration plates of X" article. Successful lookups are cached to
   localStorage (the state list never changes, so there's no reason to
   re-query Wikipedia every time the tab opens); failed lookups are retried
   next session rather than cached as permanent misses.

   A handful of states (DIRECT_IMAGE below) have an empty infobox |image=
   in their Wikipedia article, so the search API never finds a page image
   even though the article has plenty of individual plate photos — those
   are hand-picked direct Commons URLs instead of a live search.
*/

import { on } from './bus.js';
import { esc } from './util.js';

const SEEN_KEY = 'rtd-plates-seen';
const IMG_CACHE_KEY = 'rtd-plates-img-cache';
const FETCH_STAGGER_MS = 150;

export const STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

// A few state names collide with other Wikipedia articles (a country, DC) —
// point those at the disambiguated title directly.
const SEARCH_OVERRIDE = {
  GA: 'Vehicle registration plates of Georgia (U.S. state)',
  WA: 'Vehicle registration plates of Washington (state)',
};

// These states' "Vehicle registration plates of X" article has an empty
// infobox |image= param, so Wikipedia's pageimages API returns nothing even
// though the article has plenty of individual plate photos further down —
// hand-picked directly from each article's image list (checked 2026-07).
const DIRECT_IMAGE = {
  AL: 'https://upload.wikimedia.org/wikipedia/commons/2/26/1996_Alabama_license_plate_11X9_130.jpg',
  AZ: 'https://upload.wikimedia.org/wikipedia/commons/0/0a/2005_Arizona_License_Plate.png',
  AR: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/Arkansas_2011_license_plate.jpg',
  ID: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Idaho_license_plate%2C_1987%E2%80%931991_series_with_March_1990_sticker.png',
  IL: 'https://upload.wikimedia.org/wikipedia/commons/b/b4/2017_Illinois_License_Plate.png',
  IN: 'https://upload.wikimedia.org/wikipedia/commons/2/25/Indiana_1991_license_plate.jpg',
  KS: 'https://upload.wikimedia.org/wikipedia/commons/b/ba/Kansas_License_Plate_Standard_Flat_September_2019.jpg',
  KY: 'https://upload.wikimedia.org/wikipedia/commons/0/03/Kentucky_License_Plate_1998.jpg',
  NE: 'https://upload.wikimedia.org/wikipedia/commons/b/bf/Nebraska_1953_License_Plate.jpg',
  NM: 'https://upload.wikimedia.org/wikipedia/commons/1/1e/2019_New_Mexico_License_Plate.jpg',
  NY: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/New_York_plate_4-2010.jpg',
  PA: 'https://upload.wikimedia.org/wikipedia/commons/0/07/2017_Pennsylvanian_license_plate.png',
  SC: 'https://upload.wikimedia.org/wikipedia/commons/d/d6/2023_South_Carolina_mail-out_series_passenger_car_rear_license_plate.png',
  WY: 'https://upload.wikimedia.org/wikipedia/commons/4/47/1983-1987_Wyoming_License_Plate.jpg',
};

const PLATE_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">'
  + '<rect x="4" y="4" width="92" height="42" rx="6" fill="none" stroke="#4a5a6b" stroke-width="4"/>'
  + '<circle cx="18" cy="25" r="3" fill="#4a5a6b"/><circle cx="82" cy="25" r="3" fill="#4a5a6b"/>'
  + '<text x="50" y="32" font-size="18" text-anchor="middle" fill="#4a5a6b" font-family="sans-serif">?</text>'
  + '</svg>',
);

const seen = new Set(loadJSON(SEEN_KEY, []));
const imgCache = new Map(Object.entries(loadJSON(IMG_CACHE_KEY, {})));
const imgPending = new Set();
let mapLoaded = false;
let view = 'grid';

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveSeen() {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

function saveImgCache() {
  localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(Object.fromEntries(imgCache)));
}

function toggleSeen(code) {
  if (seen.has(code)) seen.delete(code); else seen.add(code);
  saveSeen();
  updateCount();
  const card = document.querySelector(`.plate-card[data-code="${code}"]`);
  if (card) card.classList.toggle('seen', seen.has(code));
  const path = document.getElementById(code);
  if (path) path.classList.toggle('seen', seen.has(code));
}

function updateCount() {
  const el = document.getElementById('plateCount');
  if (el) el.textContent = `${seen.size} / ${STATES.length}`;
  const fill = document.getElementById('plateProgressFill');
  if (fill) fill.style.width = `${(seen.size / STATES.length) * 100}%`;
}

/* ── plate photo lookup ─────────────────────────────────── */

async function fetchPlateImage(code, name) {
  try {
    const q = encodeURIComponent(SEARCH_OVERRIDE[code] || `Vehicle registration plates of ${name}`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${q}&gsrlimit=1&prop=pageimages&pithumbsize=300`;
    const r = await fetch(url);
    const j = await r.json();
    const page = Object.values(j?.query?.pages || {})[0];
    const src = page?.thumbnail?.source || null;
    if (src) {
      imgCache.set(code, src);
      saveImgCache();
      document.querySelectorAll(`.plate-img[data-code="${code}"]`).forEach((img) => { img.src = src; });
    }
  } catch {
    // leave placeholder; retried next session since we don't cache failures
  } finally {
    imgPending.delete(code);
  }
}

function ensureImagesLoading() {
  const todo = STATES.filter(([code]) => !imgCache.has(code) && !imgPending.has(code));
  let searchCount = 0;
  todo.forEach(([code, name]) => {
    if (DIRECT_IMAGE[code]) {
      imgCache.set(code, DIRECT_IMAGE[code]);
      saveImgCache();
      return;
    }
    imgPending.add(code);
    const i = searchCount++;
    setTimeout(() => fetchPlateImage(code, name), i * FETCH_STAGGER_MS);
  });
}

/* ── grid view ────────────────────────────────────────── */

function renderGrid() {
  const el = document.getElementById('plateGrid');
  if (!el) return;
  el.innerHTML = STATES.map(([code, name]) => {
    const src = imgCache.get(code) || PLATE_PLACEHOLDER;
    return `<div class="plate-card${seen.has(code) ? ' seen' : ''}" data-code="${code}">
      <img class="plate-img" data-code="${code}" src="${src}" alt="" loading="lazy">
      <div class="plate-name">${esc(name)}</div>
    </div>`;
  }).join('');
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('.plate-card');
  if (card) toggleSeen(card.dataset.code);
});

/* ── map view ─────────────────────────────────────────── */

async function loadMap() {
  if (mapLoaded) return;
  mapLoaded = true;
  const wrap = document.getElementById('plateMapSvg');
  if (!wrap) return;
  try {
    const r = await fetch('vendor/us-map/us-states.svg');
    wrap.innerHTML = await r.text();
    const svg = wrap.querySelector('svg');
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
    }
    STATES.forEach(([code]) => {
      const path = document.getElementById(code);
      if (!path) return;
      path.classList.toggle('seen', seen.has(code));
      path.addEventListener('click', () => toggleSeen(code));
    });
  } catch (e) {
    mapLoaded = false; // retry on next visit rather than failing forever
    wrap.innerHTML = '<div class="muted">map unavailable — will retry</div>';
    console.warn('[plates] map load failed:', e.message);
  }
}

/* ── view toggle ──────────────────────────────────────── */

function setView(next) {
  view = next;
  document.getElementById('plateGrid').classList.toggle('hidden', view !== 'grid');
  document.getElementById('plateMapWrap').classList.toggle('hidden', view !== 'map');
  document.getElementById('plateViewGrid').classList.toggle('chip-on', view === 'grid');
  document.getElementById('plateViewMap').classList.toggle('chip-on', view === 'map');
  if (view === 'map') loadMap();
}

document.getElementById('plateViewGrid')?.addEventListener('click', () => setView('grid'));
document.getElementById('plateViewMap')?.addEventListener('click', () => setView('map'));

on('screen', ({ name }) => {
  if (name !== 'plates') return;
  updateCount();
  ensureImagesLoading(); // populates direct-image overrides synchronously before render
  renderGrid();
  if (view === 'map') loadMap();
});
