# Road Trip Dashboard — Architecture

A phone dashboard for road trips: live speed / distance / elevation, history
charts, map with weather radar, overhead aircraft, sun info, and trip stats.

**Stack:** vanilla HTML/CSS/JS PWA. No build step, no framework — files are
served exactly as written. Hosted on GitHub Pages (GPS requires HTTPS).
On iPhone: open the Pages URL in Safari → Share → *Add to Home Screen* → runs
fullscreen like an app.

## How it works

- `navigator.geolocation.watchPosition()` supplies position, altitude, speed,
  and heading (`js/gps.js` adds spike rejection and derives speed/heading from
  movement when the receiver omits them).
- Everything communicates over a tiny event bus (`js/bus.js`). Feature modules
  are self-contained: they subscribe to `'fix'` / `'trip'` / `'screen'` events
  and render their own DOM. `js/app.js` handles boot, tabs, and shared UI.
- The trip engine (`js/trip.js`) accumulates stats (distance, max speed,
  max/min elevation, climb/descent with hysteresis, moving time) and samples
  points every 3 s. Trips auto-start on sustained movement (~10 mph).
- Persistence (`js/store.js`): IndexedDB, points flushed every 5 s. An active
  trip found at boot is auto-resumed (unless >12 h stale) — mid-trip restarts
  lose at most a few seconds. Past trips are kept; GPX/CSV export.
- Wake lock keeps the screen on (Settings toggle).
- Service worker (`sw.js`) caches the app shell network-first, so the app
  opens instantly and works offline (except live APIs/tiles). Bump `CACHE`
  in `sw.js` and `APP_VERSION` in `js/app.js` when deploying changes.

## Screens

| Tab | File | Content |
|---|---|---|
| Drive | app.js | big speed numeral, distance/elevation/heading cards, trip time, weather glance, event feed, start/end trip |
| Charts | charts.js | uPlot speed-vs-time + elevation-vs-time of active trip |
| Map | map.js | Leaflet + OSM tiles, trip track polyline, follow toggle, RainViewer radar overlay, weather panel |
| Sky | planes.js, sun.js | nearby aircraft (callsign, type, alt, distance, "10 o'clock · left window · 25° up"), sunrise/sunset/golden hour, glare warning, moon phase |
| Trips | app.js, store.js | live stats grid, GPX/CSV export, past-trip history with delete/export |

## External data (all free, keyless, CORS-open)

| Source | Module | Use | Cadence |
|---|---|---|---|
| airplanes.live `/v2/point/{lat}/{lon}/{nm}` | planes.js | nearby aircraft (incl. operator + type description) | 10 s, only while Sky tab open |
| Open-Meteo | weather.js | current conditions + precip outlook | 10 min or 15 km |
| RainViewer | map.js | radar tile overlay | 5 min while radar on |
| BigDataCloud reverse-geocode-client | milestones.js | state/city for crossing detection | 90 s + 2.5 km |

ADS-B source history (2026-07): OpenSky (user has an API key, see
`Documents\wall-display`) blocks cross-origin browser calls; adsb.lol turned
out to send no CORS headers either. airplanes.live allows `*` and returns the
richest data (operator, aircraft description), so it's the source.

## Dev / test

- Local: any static server, e.g. `python -m http.server 8123`, or the
  configured `.claude/launch.json`.
- **Simulation mode:** `index.html?sim=1` replays a synthetic drive starting
  south of Huntsville, AL heading north across the Tennessee line — real
  coordinates so weather/planes/geocoding return live data. `&fast=1` = 10×.
  Ground truth for assertions: `window.__sim` (`elapsed`, `distM`, `maxSpd`).
- GPS only works over HTTPS or localhost — on the phone, always via the
  Pages URL.

## Vendored libraries (`vendor/`, committed)

uPlot 1.6.32 · Leaflet 1.9.4 · SunCalc 1.9.0 (all fetched via npm)
