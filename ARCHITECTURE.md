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
| Sky | planes.js, sun.js, iss.js | nearby aircraft (callsign, type, alt, distance, "10 o'clock · left window · 25° up", Wikipedia photo of the aircraft model), sunrise/sunset/golden hour, glare warning, moon phase + rise/set, terminator-chasing fun line, ISS position + "look up" spotting callout |
| Trips | app.js, store.js, achievements.js | live stats grid, GPX/CSV export, past-trip history with delete/export, achievement badge tray |

Fun/flavor additions layered onto existing milestones (milestones.js): distance/altitude/speed
records get a real-world comparison ("farther than a marathon", "as high as the Burj Khalifa",
"faster than a cheetah's top sprint"), state crossings get a one-line trivia fact, and hitting
exactly 88 mph fires a Back to the Future easter egg.

## External data (all free, keyless, CORS-open)

| Source | Module | Use | Cadence |
|---|---|---|---|
| airplanes.live `/v2/point/{lat}/{lon}/{nm}` | planes.js | nearby aircraft (incl. operator + type description) | 10 s, only while Sky tab open |
| Wikipedia `action=query&generator=search` (`origin=*`) | planes.js | representative photo of each aircraft's type, cached per type string | on first sighting of a type |
| wheretheiss.at `/v1/satellites/25544` | iss.js | ISS position for distance/bearing/elevation + spotting callout | 20 s, only while Sky tab open |
| Open-Meteo | weather.js | current conditions + precip outlook | 10 min or 15 km |
| RainViewer | map.js | radar tile overlay | 5 min while radar on |

Radar zoom note: RainViewer's radar mosaic has no real detail past zoom 7 —
past that they literally serve a "Zoom Level Not Supported" placeholder PNG
(confirmed by downloading and viewing tiles at z=8/10/12). `maxNativeZoom: 7`
on the radar layer stops the app from requesting that placeholder as you
zoom in tighter; Leaflet scales the real z7 tile client-side instead. The
map itself still zooms freely — this only affects how tight the *radar*
gets before it's just a bigger blur of the same data.

Deploy caching gotcha: GitHub Pages serves JS/CSS with `Cache-Control:
max-age=600`. sw.js's "network-first" fetch didn't override this, so the
browser could silently serve a stale deploy for up to 10 min even though the
SW asked the network first. Fixed by adding `{ cache: 'no-cache' }` to the
SW's fetch call, forcing revalidation every load.
| BigDataCloud reverse-geocode-client | milestones.js | state/city for crossing detection | 90 s + 2.5 km |

ADS-B source history (2026-07): OpenSky (user has an API key, see
`Documents\wall-display`) blocks cross-origin browser calls; adsb.lol turned
out to send no CORS headers either. airplanes.live allows `*` and returns the
richest data (operator, aircraft description), so it's the source.

Aircraft photo source (2026-07): planespotters.net's per-tail photo API was
the obvious pick but rejects any real browser User-Agent (requires a contact
URL in the UA string, which JS can't override) — no static-site workaround.
Wikipedia's search API (`origin=*`, CORS-open) keyed on the aircraft type
description gives a representative photo of the *model* instead of the exact
tail, which is good enough and costs nothing extra since it's cached per type.

## Dev / test

- Local: `.claude/launch.json` runs `scripts/devserver.py` (not plain
  `python -m http.server`) — the plain server sends no `Cache-Control`
  header, so a browser tab can keep serving stale cached JS modules across
  reloads indefinitely even after files change on disk (cost real debugging
  time once — see the deploy caching gotcha above, same class of bug but for
  local testing). devserver.py just adds `Cache-Control: no-store`.
- **Simulation mode:** `index.html?sim=1` replays a synthetic drive starting
  south of Huntsville, AL heading north across the Tennessee line — real
  coordinates so weather/planes/geocoding return live data. `&fast=1` = 10×.
  Ground truth for assertions: `window.__sim` (`elapsed`, `distM`, `maxSpd`).
- GPS only works over HTTPS or localhost — on the phone, always via the
  Pages URL.

## Vendored libraries (`vendor/`, committed)

uPlot 1.6.32 · Leaflet 1.9.4 · SunCalc 1.9.0 (all fetched via npm)
