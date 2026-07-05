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
let egg88Fired = false;

// Fun-comparison ladders: [threshold (SI units), phrase]. Sorted ascending;
// pickFact() returns the largest threshold at or below the value, so these
// stay unit-agnostic (no display-unit conversion needed for the phrase itself).
const SPEED_FACTS = [ // m/s
  [12.5, "a sprinting Usain Bolt"],
  [17.9, "a racing greyhound"],
  [20.1, "a Thoroughbred at full gallop"],
  [24.6, "a pronghorn antelope, the fastest land animal over distance"],
  [31.3, "a cheetah's top sprint"],
];

const ALT_FACTS = [ // meters
  [381, "the Empire State Building"],
  [828, "the Burj Khalifa, the world's tallest building"],
  [1609, "a mile high — welcome to Denver's altitude"],
  [3350, "the treeline in the Colorado Rockies"],
  [4302, "Pikes Peak's summit"],
  [4348, "Mount Evans, the highest paved road in North America"],
  [8849, "Mount Everest's summit"],
];

const ODOMETER_FACTS = [ // miles
  [26.2, "a marathon"],
  [62, "the Kármán line — the edge of space — straight up"],
  [254, "the ISS's orbital altitude, straight up"],
  [277, "the length of the Grand Canyon"],
  [801, "the width of Texas"],
  [2340, "the length of the Mississippi River"],
  [2448, "the full length of Route 66"],
];

const MPH_88_MPS = 39.34; // 88 mph, exactly — Back to the Future's DeLorean threshold

const STATE_FACTS = {
  Alabama: "home to the rocket engines tested for the Apollo missions, in Huntsville",
  Alaska: "so big it spans four time zones and has more coastline than the rest of the US combined",
  Arizona: "home to the Grand Canyon, one of the seven natural wonders of the world",
  Arkansas: "the only US state with a diamond mine open to the public",
  California: "has the tallest trees, tallest lower-48 peak, and lowest point in North America",
  Colorado: "has the highest average elevation of any US state",
  Connecticut: "the first hamburger was reportedly served here in 1895",
  Delaware: "the first state to ratify the US Constitution",
  Florida: "the only place on Earth where alligators and crocodiles live side by side",
  Georgia: "home to the world's busiest airport, Atlanta's Hartsfield-Jackson",
  Hawaii: "the only US state made entirely of islands — and still growing from an active volcano",
  Idaho: "grows about a third of all potatoes in the United States",
  Illinois: "home to the first skyscraper, built in Chicago in 1885",
  Indiana: "home to the Indianapolis 500, the largest single-day sporting event in the world",
  Iowa: "produces more corn than any other US state",
  Kansas: "sits closer to the geographic center of the contiguous US than any other state",
  Kentucky: "home to Mammoth Cave, the longest known cave system on Earth",
  Louisiana: "Mardi Gras has been celebrated here since the 1830s",
  Maine: "gets the first sunrise in the continental US",
  Maryland: "home to the US Naval Academy and the oldest state house still in legislative use",
  Massachusetts: "home to the first subway system in the US, opened in Boston in 1897",
  Michigan: "touches four of the five Great Lakes",
  Minnesota: "known as the Land of 10,000 Lakes — it actually has over 11,000",
  Mississippi: "the birthplace of the blues, in the Mississippi Delta",
  Missouri: "the Gateway Arch here is the tallest man-made monument in the US",
  Montana: "home to Glacier National Park, once home to over 100 glaciers",
  Nebraska: "home to Kool-Aid, invented in Hastings in 1927",
  Nevada: "the driest US state, but home to Lake Tahoe, one of the clearest lakes on Earth",
  "New Hampshire": "hosts the first primary in the US presidential election",
  "New Jersey": "the first drive-in movie theater opened here in 1933",
  "New Mexico": "home to the Trinity Site, where the first atomic bomb was tested",
  "New York": "home to Niagara Falls, which straddles the US-Canada border",
  "North Carolina": "the Wright brothers made the first powered flight here, at Kitty Hawk",
  "North Dakota": "home to more oil wells per capita than any other US state",
  Ohio: "birthplace of more US astronauts than any other state, including Neil Armstrong",
  Oklahoma: "the shopping cart was invented here, in Oklahoma City in 1937",
  Oregon: "home to Crater Lake, the deepest lake in the United States",
  Pennsylvania: "home to the first US zoo and the first daily newspaper",
  "Rhode Island": "the smallest US state — Alaska could fit it inside over 400 times",
  "South Carolina": "the first shots of the Civil War were fired here, at Fort Sumter",
  "South Dakota": "home to Mount Rushmore, carved into the Black Hills",
  Tennessee: "reportedly has more songs written about it than any other state",
  Texas: "big enough that El Paso is closer to California than to Dallas",
  Utah: "home to the Bonneville Salt Flats, where dozens of land speed records have been set",
  Vermont: "banned billboards entirely in 1968 and never looked back",
  Virginia: "the birthplace of eight US presidents, more than any other state",
  Washington: "home to the world's first floating bridge with a permanent roadway",
  "West Virginia": "the only US state formed by seceding from a Confederate state during the Civil War",
  Wisconsin: "produces more cheese than any other US state",
  Wyoming: "home to Yellowstone, the world's first national park",
  "District of Columbia": "not part of any state — its license plates protest 'taxation without representation'",
};

function pickFact(table, value) {
  let label = null;
  for (const [thresh, text] of table) {
    if (value >= thresh) label = text; else break;
  }
  return label;
}

on('trip-life', ({ type, trip: t }) => {
  if (type === 'start') {
    lastMilestoneDist = 0;
    bestMaxAltM = null;
    bestMaxSpdMps = 0;
    egg88Fired = false;
  } else if (type === 'resume') {
    const s = t.stats;
    lastMilestoneDist = Math.floor((imperial() ? s.distM * M2MI : s.distM / 1000) / 50) * 50;
    bestMaxAltM = s.maxAltM;
    bestMaxSpdMps = s.maxSpdMps;
    egg88Fired = s.maxSpdMps >= MPH_88_MPS;
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
      const fact = STATE_FACTS[state];
      announce(`Welcome to ${state}!` + (fact ? ` Fun fact: ${fact}.` : ''));
      emit('region-change', { state });
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
    const fact = pickFact(ODOMETER_FACTS, s.distM * M2MI);
    announce(`${lastMilestoneDist} ${unit} down the road 🛣` + (fact ? ` — farther than ${fact}` : ''));
  }

  // New trip high point (only announce after beating the old one clearly).
  if (s.maxAltM != null) {
    if (bestMaxAltM == null) {
      bestMaxAltM = s.maxAltM;
    } else if (s.maxAltM > bestMaxAltM + 60) { // ~200 ft
      bestMaxAltM = s.maxAltM;
      const fact = pickFact(ALT_FACTS, s.maxAltM);
      announce(`New trip high point: ${fmtAlt(s.maxAltM)} ${altUnit()} ⛰` + (fact ? ` — as high as ${fact}` : ''));
    }
  }

  // 88 mph easter egg — checked independently of the 5-mph record gate
  // below, since that gate can jump straight past exactly 88.
  if (!egg88Fired && s.maxSpdMps >= MPH_88_MPS) {
    egg88Fired = true;
    announce(`88 mph — Great Scott! ⚡🕐`);
  }

  // New top speed (after the trip is 5+ min old, so the first onramp
  // doesn't spam records).
  const tripAge = Date.now() - t.startedAt;
  if (tripAge > 5 * 60000 && s.maxSpdMps > bestMaxSpdMps + 2.2) { // +5 mph
    bestMaxSpdMps = s.maxSpdMps;
    const fact = pickFact(SPEED_FACTS, s.maxSpdMps);
    announce(`New top speed: ${fmtSpeed(s.maxSpdMps)} ${speedUnit()} 🚀` + (fact ? ` — faster than ${fact}` : ''));
  }
}
