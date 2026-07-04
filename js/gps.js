/* GPS: wraps navigator.geolocation.watchPosition into clean 'fix' events.

   - Rejects position spikes (implied speed > 90 m/s between fixes).
   - Falls back to position-derived speed when coords.speed is null
     (some fixes, especially the first few, lack Doppler speed).
   - Publishes 'gps-status' so the UI can show fix quality.
*/

import { emit } from './bus.js';
import { haversineM, bearingDeg } from './util.js';

const MAX_IMPLIED_SPEED_MPS = 90; // ~200 mph: anything faster is a GPS spike
const POOR_ACCURACY_M = 50;

let watchId = null;
let prev = null; // previous accepted fix

export function startGPS() {
  if (!('geolocation' in navigator)) {
    emit('gps-status', { state: 'off', error: 'no geolocation support' });
    return;
  }
  if (watchId != null) return;

  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30000,
  });
}

export function stopGPS() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  prev = null;
  emit('gps-status', { state: 'off' });
}

function onPosition(pos) {
  const c = pos.coords;
  const fix = {
    t: pos.timestamp || Date.now(),
    lat: c.latitude,
    lon: c.longitude,
    altM: c.altitude,            // may be null
    speedMps: c.speed,           // may be null
    heading: c.heading,          // may be null (stationary)
    accM: c.accuracy,
    altAccM: c.altitudeAccuracy,
  };

  // Spike rejection: implied speed between consecutive fixes.
  if (prev && fix.t > prev.t) {
    const dt = (fix.t - prev.t) / 1000;
    const d = haversineM(prev.lat, prev.lon, fix.lat, fix.lon);
    if (dt > 0 && d / dt > MAX_IMPLIED_SPEED_MPS) return; // drop it

    // Derive speed/heading from movement when the receiver didn't supply them.
    if (fix.speedMps == null && dt > 0.5) fix.speedMps = d / dt;
    if (fix.heading == null && d > 5) {
      fix.heading = bearingDeg(prev.lat, prev.lon, fix.lat, fix.lon);
    }
  }

  // Carry last-known heading through stops so sun/plane guidance stays stable.
  if (fix.heading == null && prev) fix.heading = prev.heading;

  prev = fix;

  emit('gps-status', {
    state: fix.accM > POOR_ACCURACY_M ? 'poor' : 'good',
    accM: fix.accM,
  });
  emit('fix', fix);
}

function onError(err) {
  emit('gps-status', { state: 'off', error: err.message });
}
