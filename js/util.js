/* Geo math + unit formatting helpers. */

import { settings } from './settings.js';

export const EARTH_R_M = 6371000;
export const M2FT = 3.28084;
export const M2MI = 1 / 1609.344;
export const MPS2MPH = 2.23694;
export const MPS2KMH = 3.6;
export const M2NM = 1 / 1852;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export function compass(d) {
  return COMPASS[Math.round(((d % 360) / 22.5)) % 16];
}

/* Relative bearing (0-360, plane bearing minus car heading) → clock position. */
export function clockPos(relDeg) {
  let h = Math.round(relDeg / 30) % 12;
  if (h === 0) h = 12;
  return `${h} o'clock`;
}

export function sideOfCar(relDeg) {
  if (relDeg < 30 || relDeg > 330) return 'ahead';
  if (relDeg < 150) return 'right window';
  if (relDeg <= 210) return 'behind';
  return 'left window';
}

/* ── formatting (unit-aware) ─────────────────────────── */

export const imperial = () => settings.units !== 'metric';

export function fmtSpeed(mps, withUnit = false) {
  if (mps == null || Number.isNaN(mps)) return '--';
  const v = imperial() ? mps * MPS2MPH : mps * MPS2KMH;
  return Math.round(v) + (withUnit ? ` ${speedUnit()}` : '');
}
export const speedUnit = () => (imperial() ? 'mph' : 'km/h');

export function fmtDist(m, digits = 1) {
  if (m == null) return '--';
  const v = imperial() ? m * M2MI : m / 1000;
  return v.toFixed(digits);
}
export const distUnit = () => (imperial() ? 'mi' : 'km');

export function fmtAlt(m, withUnit = false) {
  if (m == null) return '--';
  const v = imperial() ? m * M2FT : m;
  return Math.round(v).toLocaleString() + (withUnit ? ` ${altUnit()}` : '');
}
export const altUnit = () => (imperial() ? 'ft' : 'm');

export function fmtDuration(ms) {
  if (ms == null || ms < 0) return '--';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtClock(tMs) {
  return new Date(tMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
