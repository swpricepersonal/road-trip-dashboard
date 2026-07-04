/* Weather via Open-Meteo (free, keyless, CORS-open).
   Refreshes every 10 min or after 15 km of movement, whichever first. */

import { emit, on } from './bus.js';
import { haversineM, imperial, esc } from './util.js';

const REFRESH_MS = 10 * 60 * 1000;
const REFRESH_DIST_M = 15000;

let lastFetch = 0;
let lastPos = null;
let current = null;

const WMO = {
  0: ['☀️', 'Clear'], 1: ['🌤', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫', 'Fog'], 48: ['🌫', 'Rime fog'],
  51: ['🌦', 'Light drizzle'], 53: ['🌦', 'Drizzle'], 55: ['🌧', 'Heavy drizzle'],
  61: ['🌧', 'Light rain'], 63: ['🌧', 'Rain'], 65: ['🌧', 'Heavy rain'],
  66: ['🌧', 'Freezing rain'], 67: ['🌧', 'Freezing rain'],
  71: ['🌨', 'Light snow'], 73: ['🌨', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['❄️', 'Snow grains'],
  80: ['🌦', 'Showers'], 81: ['🌧', 'Showers'], 82: ['⛈', 'Heavy showers'],
  85: ['🌨', 'Snow showers'], 86: ['🌨', 'Snow showers'],
  95: ['⛈', 'Thunderstorm'], 96: ['⛈', 'Storm + hail'], 99: ['⛈', 'Storm + hail'],
};

export function wmoInfo(code) {
  return WMO[code] || ['🌡', `Code ${code}`];
}

on('fix', (fix) => {
  const stale = Date.now() - lastFetch > REFRESH_MS;
  const moved = lastPos && haversineM(lastPos.lat, lastPos.lon, fix.lat, fix.lon) > REFRESH_DIST_M;
  if ((stale || moved) && Date.now() - lastFetch > 60000) {
    lastFetch = Date.now();
    lastPos = { lat: fix.lat, lon: fix.lon };
    fetchWeather(fix.lat, fix.lon);
  }
});

async function fetchWeather(lat, lon) {
  const imp = imperial();
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
    `&hourly=precipitation_probability,weather_code&forecast_hours=4&timezone=auto` +
    (imp ? `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` : `&wind_speed_unit=kmh`);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    current = j;
    render(j, imp);
    emit('weather', j);
  } catch (e) {
    console.warn('[weather]', e.message);
  }
}

function render(j, imp) {
  const c = j.current;
  const [icon, label] = wmoInfo(c.weather_code);
  const tU = imp ? '°F' : '°C';

  const glance = document.getElementById('wxGlance');
  if (glance) glance.textContent = `${icon} ${Math.round(c.temperature_2m)}${tU}`;

  const now = document.getElementById('wxNow');
  if (now) {
    now.textContent =
      `${icon} ${label} · ${Math.round(c.temperature_2m)}${tU} ` +
      `(feels ${Math.round(c.apparent_temperature)}${tU}) · wind ${Math.round(c.wind_speed_10m)} ${imp ? 'mph' : 'km/h'}`;
  }

  const next = document.getElementById('wxNext');
  if (next && j.hourly) {
    const probs = j.hourly.precipitation_probability || [];
    const maxProb = Math.max(0, ...probs.slice(0, 4));
    next.textContent = maxProb > 5
      ? `precip chance next 4 h: up to ${maxProb}%`
      : 'no precipitation expected next 4 h';
  }
}

export function getWeather() { return current; }
