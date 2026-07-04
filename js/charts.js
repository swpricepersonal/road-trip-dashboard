/* Time-history charts (speed, elevation) rendered with uPlot from the
   active trip's sampled points. Only redrawn while the Charts tab is open. */

import { on } from './bus.js';
import { trip } from './trip.js';
import { MPS2MPH, MPS2KMH, M2FT, imperial, speedUnit, altUnit } from './util.js';

const REDRAW_MS = 2000;

let chartsActive = false;
let speedPlot = null;
let elevPlot = null;
let lastDraw = 0;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

on('screen', ({ name }) => {
  chartsActive = name === 'charts';
  if (chartsActive) { lastDraw = 0; redraw(); }
});

on('trip', () => { if (chartsActive) redraw(); });
on('settings', () => { destroy(); if (chartsActive) redraw(); });
window.addEventListener('resize', () => { destroy(); if (chartsActive) redraw(); });

function destroy() {
  speedPlot?.destroy(); speedPlot = null;
  elevPlot?.destroy(); elevPlot = null;
}

function redraw() {
  if (Date.now() - lastDraw < REDRAW_MS) return;
  lastDraw = Date.now();

  const note = document.getElementById('chartNote');
  document.querySelectorAll('.unit-hint').forEach((el) => {
    el.textContent = el.dataset.unit === 'speed' ? `(${speedUnit()})` : `(${altUnit()})`;
  });

  if (!trip || trip.points.length < 2) {
    destroy();
    note.textContent = 'charts appear once a trip is underway';
    return;
  }
  note.textContent = `${trip.points.length} samples`;

  const xs = [], spd = [], alt = [];
  for (const p of trip.points) {
    xs.push(p.t / 1000);
    spd.push(p.spd != null ? p.spd * (imperial() ? MPS2MPH : MPS2KMH) : null);
    alt.push(p.altM != null ? (imperial() ? p.altM * M2FT : p.altM) : null);
  }

  speedPlot = drawInto('chartSpeed', speedPlot, xs, spd, css('--accent'));
  elevPlot = drawInto('chartElev', elevPlot, xs, alt, css('--accent2'));
}

function drawInto(elId, plot, xs, ys, color) {
  const el = document.getElementById(elId);
  if (!el) return null;

  if (plot) {
    plot.setData([xs, ys]);
    return plot;
  }

  el.innerHTML = '';
  const opts = {
    width: el.clientWidth || 320,
    height: 210,
    cursor: { show: false },
    legend: { show: false },
    scales: { x: { time: true } },
    axes: [
      axisStyle(),
      { ...axisStyle(), size: 52 },
    ],
    series: [
      {},
      { stroke: color, width: 2, fill: color + '22', spanGaps: true },
    ],
  };
  return new uPlot(opts, [xs, ys], el);
}

function axisStyle() {
  return {
    stroke: css('--muted'),
    grid: { stroke: '#1d2936', width: 1 },
    ticks: { stroke: '#1d2936' },
    font: '11px -apple-system, sans-serif',
  };
}
