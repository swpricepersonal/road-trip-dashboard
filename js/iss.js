/* ISS flyover spotting — same look-direction trick as planes.js, but for the
   space station. api.wheretheiss.at is free, keyless, CORS-open (confirmed
   live: Access-Control-Allow-Origin: *).

   "Look up!" only fires when: the ISS is reasonably high in the sky, the
   observer is in dusk/dawn twilight (sun -18°..-6° — the classic ISS-spotting
   window), and the station itself isn't in Earth's shadow. Otherwise it's
   just an ambient distance/bearing readout. */

import { on } from './bus.js';
import { haversineM, bearingDeg, compass, M2MI, EARTH_R_M } from './util.js';

const POLL_MS = 20000;
const ISS_ID = 25544;

let skyActive = false;
let lastFix = null;
let timer = null;

on('screen', ({ name }) => {
  skyActive = name === 'sky';
  if (skyActive) { poll(); timer ??= setInterval(poll, POLL_MS); }
  else if (timer) { clearInterval(timer); timer = null; }
});

on('fix', (fix) => { lastFix = fix; });

async function poll() {
  if (!skyActive || !lastFix) return;
  try {
    const r = await fetch(`https://api.wheretheiss.at/v1/satellites/${ISS_ID}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    render(await r.json());
  } catch (e) {
    console.warn('[iss]', e.message);
  }
}

function render(iss) {
  const el = document.getElementById('issInfo');
  if (!el || !lastFix) return;

  const { lat, lon, altM } = lastFix;
  const issAltM = iss.altitude * 1000;
  const groundDistM = haversineM(lat, lon, iss.latitude, iss.longitude);
  const brg = bearingDeg(lat, lon, iss.latitude, iss.longitude);
  // Elevation over a curved Earth. The naive atan2(height, distance) is only
  // valid for nearby objects (fine for aircraft in planes.js) — at ISS ranges
  // it claims "5° up" for a station 3,000 mi away that's actually far below
  // the horizon. Standard satellite-elevation formula instead: with c the
  // central angle to the subpoint, elev = atan2(cos c − R/(R+h), sin c).
  const c = groundDistM / EARTH_R_M;
  const elevDeg = (Math.atan2(Math.cos(c) - EARTH_R_M / (EARTH_R_M + issAltM), Math.sin(c)) * 180) / Math.PI;
  const distMi = Math.round(groundDistM * M2MI);

  let sunAltDeg = null;
  if (typeof SunCalc !== 'undefined') {
    sunAltDeg = (SunCalc.getPosition(new Date(), lat, lon).altitude * 180) / Math.PI;
  }

  const twilight = sunAltDeg != null && sunAltDeg < -6 && sunAltDeg > -18;
  const lit = iss.visibility !== 'eclipsed';
  const highEnough = elevDeg > 10;

  if (twilight && lit && highEnough) {
    el.innerHTML = `<span class="fun-fact">🛰️ Look up! ISS passing ${compass(brg)}, `
      + `${Math.round(elevDeg)}° up — good chance you can spot it right now.</span>`;
  } else {
    el.textContent = elevDeg > 0
      ? `🛰️ ISS: ${distMi} mi away, ${compass(brg)} · ${Math.round(elevDeg)}° up`
      : `🛰️ ISS: ${distMi} mi away, ${compass(brg)} (below horizon)`;
  }
}
