# Build checklist

Resume point for development sessions. Update when a phase lands; keep in
sync with git history.

- [x] **Phase 1 — scaffold**: PWA shell (index.html, manifest, sw.js, css),
      tab bar, settings dialog, icons, vendored libs, docs, git repo
- [x] **Phase 2 — core GPS**: gps.js, trip.js (stats engine), sim.js,
      Drive screen live numerals, auto-start
- [x] **Phase 3 — persistence**: store.js (IndexedDB), auto-resume after
      restart, Trips screen (live stats, history, GPX/CSV export)
- [x] **Phase 4 — charts**: uPlot speed + elevation history
- [x] **Phase 5 — map/weather/radar**: Leaflet track, follow mode,
      Open-Meteo panel + Drive glance, RainViewer overlay
- [x] **Phase 6 — sky**: airplanes.live aircraft list with look-direction,
      sun/glare/moon card (adsb.lol rejected: no CORS headers)
- [x] **Phase 7 — milestones/polish**: state crossings, distance milestones,
      trip records, toasts, settings persistence
- [x] **Phase 8 — deploy**: GitHub repo (public — required for free-plan
      Pages), Pages enabled at https://swpricepersonal.github.io/road-trip-dashboard/
      — still needs on-iPhone verification (add to home screen, GPS permission)

## Deploy routine (after any change)

1. bump `APP_VERSION` in js/app.js and `CACHE` in sw.js
2. commit, `git push`
3. phone picks it up on next app launch (network-first shell)
