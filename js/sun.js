/* Sun & sky card: sunrise/sunset/golden hour, sun position with windshield
   glare warning, moon phase. All computed locally via SunCalc — works with
   zero connectivity. */

import { on } from './bus.js';
import { compass, fmtClock } from './util.js';

const REFRESH_MS = 30000;
let lastRender = 0;

// Earth's rotational surface speed at the equator (m/s) — the terminator
// line sweeps west across the ground at this speed times cos(latitude).
// Driving west subtracts from that closing speed, delaying your local
// sunset/sunrise — the same trick Concorde used to "outrun" sunsets.
const EARTH_ROT_MPS = 465.1;

const MOON_NAMES = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
];

on('fix', (fix) => {
  if (Date.now() - lastRender < REFRESH_MS) return;
  if (typeof SunCalc === 'undefined') return;
  lastRender = Date.now();
  render(fix);
});

function render(fix) {
  const now = new Date(fix.t);
  const times = SunCalc.getTimes(now, fix.lat, fix.lon);
  const pos = SunCalc.getPosition(now, fix.lat, fix.lon);

  const sunAltDeg = (pos.altitude * 180) / Math.PI;
  // SunCalc azimuth: 0 = south, positive west → convert to compass bearing.
  const sunAzDeg = ((pos.azimuth * 180) / Math.PI + 180) % 360;

  const timesEl = document.getElementById('sunTimes');
  const posEl = document.getElementById('sunPos');
  const moonEl = document.getElementById('moonInfo');
  if (!timesEl) return;

  const up = sunAltDeg > 0;
  const nextEvent = up
    ? `sunset ${fmtClock(times.sunset)}`
    : now < times.sunrise
      ? `sunrise ${fmtClock(times.sunrise)}`
      : `sunrise ${fmtClock(new Date(times.sunrise.getTime() + 86400000))}`;
  const golden = up && times.goldenHour ? ` · golden hour ${fmtClock(times.goldenHour)}` : '';
  timesEl.textContent = `${up ? '☀️ Sun is up' : '🌙 Sun is down'} · ${nextEvent}${golden}`;

  // Glare: sun low ahead of the windshield.
  let posText = up
    ? `sun: ${compass(sunAzDeg)} · ${Math.round(sunAltDeg)}° above horizon`
    : `sun below horizon`;
  let glare = false;
  if (up && fix.heading != null && sunAltDeg < 22) {
    // Angular distance between sun azimuth and car heading, 0..180.
    const rel = Math.abs((((sunAzDeg - fix.heading) % 360) + 540) % 360 - 180);
    if (rel < 35) { // sun within ~35° of straight ahead
      glare = true;
      posText = `⚠️ glare — sun low and dead ahead (${Math.round(sunAltDeg)}°)`;
    }
  }
  posEl.textContent = posText;
  posEl.classList.toggle('glare', glare);

  const termEl = document.getElementById('terminatorInfo');
  if (termEl) termEl.textContent = terminatorRace(fix, sunAzDeg, up);

  const illum = SunCalc.getMoonIllumination(now);
  const name = MOON_NAMES[Math.round(illum.phase * 8) % 8];
  moonEl.textContent = `${name} · ${Math.round(illum.fraction * 100)}% lit · ${moonTimesText(now, fix.lat, fix.lon)}`;

  const specialEl = document.getElementById('moonSpecial');
  if (specialEl) specialEl.textContent = moonSpecial(now, fix.lat, fix.lon, illum, times);
}

// Supermoon/micromoon (SunCalc gives the moon's distance in km; mean is
// ~384,400) and the "big orange moonrise" spectacle: a full-ish moon rising
// near sunset looks huge and amber on the horizon — worth a heads-up.
function moonSpecial(now, lat, lon, illum, times) {
  const full = illum.fraction > 0.97;
  const dist = SunCalc.getMoonPosition(now, lat, lon).distance;

  // 367,600 km = Espenak's perigee-syzygy cutoff; verified against the
  // Nov 2025 supermoon (SunCalc reports 364,131 km) and the Apr 2025
  // micromoon (405,835 km).
  if (full && dist < 367600) {
    const pct = Math.round((1 - dist / 384400) * 100);
    return `🌕 supermoon tonight — ${pct}% closer than average`;
  }
  if (full && dist > 405000) {
    return '🌑 micromoon — the moon is near its farthest point from Earth';
  }

  if (illum.fraction > 0.95 && times.sunset) {
    const mt = SunCalc.getMoonTimes(now, lat, lon);
    if (mt.rise && Math.abs(mt.rise - times.sunset) < 40 * 60000 && now < mt.rise) {
      return `🌕 watch east around ${fmtClock(mt.rise)} — big orange moonrise at sunset`;
    }
  }
  return '';
}

// How much of the terminator's westward sweep your driving is matching.
// Only worth mentioning above a highway-speed westward component.
function terminatorRace(fix, sunAzDeg, up) {
  if (fix.speedMps == null || fix.heading == null || fix.speedMps < 4.5) return '';
  const terminatorMps = EARTH_ROT_MPS * Math.cos((fix.lat * Math.PI) / 180);
  if (terminatorMps <= 0) return '';
  const headingRad = (fix.heading * Math.PI) / 180;
  const westMps = -(fix.speedMps * Math.sin(headingRad)); // positive = driving west
  if (westMps <= 0) return '';

  const pct = Math.round((westMps / terminatorMps) * 100);
  if (pct < 2) return '';
  // Driving west runs *with* the sun: it delays your local sunset (daytime)
  // or holds off the sunrise sweeping toward you from the east (pre-dawn).
  const label = up ? 'sunset' : 'sunrise';
  return pct >= 100
    ? `🌅 driving west faster than the terminator line — ${label} literally can't catch you!`
    : up
      ? `chasing the sunset: matching ${pct}% of the terminator's westward sweep`
      : `holding off the sunrise: matching ${pct}% of the terminator's westward sweep`;
}

// SunCalc.getMoonTimes only covers the given calendar day (local time) and
// omits rise or set entirely on days the moon doesn't cross the horizon
// (alwaysUp/alwaysDown), so fall back to tomorrow's times in that case.
function moonTimesText(now, lat, lon) {
  let t = SunCalc.getMoonTimes(now, lat, lon);
  if (t.alwaysUp) return 'moon up all day';
  if (t.alwaysDown) return 'moon down all day';
  if (!t.rise || !t.set) {
    const tomorrow = new Date(now.getTime() + 86400000);
    const t2 = SunCalc.getMoonTimes(tomorrow, lat, lon);
    if (!t.rise && t2.rise) t.rise = t2.rise;
    if (!t.set && t2.set) t.set = t2.set;
  }
  const parts = [];
  if (t.rise) parts.push(`moonrise ${fmtClock(t.rise)}`);
  if (t.set) parts.push(`moonset ${fmtClock(t.set)}`);
  return parts.join(' · ') || 'moon times n/a';
}
