/* Sun & sky card: sunrise/sunset/golden hour, sun position with windshield
   glare warning, moon phase. All computed locally via SunCalc — works with
   zero connectivity. */

import { on } from './bus.js';
import { compass, fmtClock } from './util.js';

const REFRESH_MS = 30000;
let lastRender = 0;

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

  const illum = SunCalc.getMoonIllumination(now);
  const name = MOON_NAMES[Math.round(illum.phase * 8) % 8];
  moonEl.textContent = `${name} · ${Math.round(illum.fraction * 100)}% lit · ${moonTimesText(now, fix.lat, fix.lon)}`;
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
