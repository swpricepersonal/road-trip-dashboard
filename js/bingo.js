/* Highway bingo: the classic road trip game. A 5x5 card of things to spot
   (free center square), tap to mark. Card + marks persist in localStorage;
   completing a row/column/diagonal fires a celebration toast. Rendered as
   the third view on the Plates screen (the games hub) — see plates.js.

   Fully offline: the sight pool is static, no APIs. */

import { emit } from './bus.js';
import { esc } from './util.js';

const KEY = 'rtd-bingo';
const FREE_IDX = 12; // center of the 5x5 grid

// [emoji, label] — 24 are drawn at random per card.
const POOL = [
  ['🐄', 'cows'], ['🚜', 'tractor'], ['💧', 'water tower'], ['🌾', 'silo'],
  ['🏚', 'red barn'], ['🌀', 'wind turbine'], ['☀️', 'solar farm'], ['🚌', 'school bus'],
  ['🏍', 'motorcycle'], ['🚔', 'police car'], ['🚒', 'fire truck'], ['🚑', 'ambulance'],
  ['🚂', 'train'], ['🌉', 'bridge over water'], ['🕳', 'tunnel'], ['🛥', 'boat on a trailer'],
  ['🏕', 'RV'], ['🐎', 'horses'], ['🦌', 'deer crossing sign'], ['🎆', 'fireworks billboard'],
  ['🍔', 'fast-food billboard'], ['🇺🇸', 'giant flag'], ['🚧', 'construction zone'], ['🛣', 'speed limit 75+'],
  ['🅿️', 'rest area'], ['👋', 'state welcome sign'], ['🐕', 'dog riding shotgun'], ['🚗', 'convertible, top down'],
  ['🏎', 'sports car'], ['🚙', 'out-of-state plate'], ['✈️', 'contrail'], ['🦅', 'bird of prey'],
  ['⛽', 'vintage gas station'], ['💬', 'funny vanity plate'],
];

// All 12 winning lines: 5 rows, 5 columns, 2 diagonals.
const LINES = [
  ...Array.from({ length: 5 }, (_, r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...Array.from({ length: 5 }, (_, c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

const BINGO_MSGS = ['🎉 BINGO!', '🎉🎉 Double bingo!', '🎉🎉🎉 Triple bingo!'];

let state = load() || newCard();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s?.cells?.length === 25 ? s : null;
  } catch { return null; }
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function newCard() {
  const pool = [...POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const cells = pool.slice(0, 24);
  cells.splice(FREE_IDX, 0, ['⭐', 'FREE']);
  return { cells, marked: [FREE_IDX] };
}

function lineCount() {
  const m = new Set(state.marked);
  return LINES.filter((line) => line.every((i) => m.has(i))).length;
}

function toggleCell(idx) {
  if (idx === FREE_IDX) return;
  const before = lineCount();
  const pos = state.marked.indexOf(idx);
  if (pos >= 0) state.marked.splice(pos, 1); else state.marked.push(idx);
  save();
  const after = lineCount();
  if (after > before) {
    emit('event', { msg: BINGO_MSGS[Math.min(after, BINGO_MSGS.length) - 1], kind: 'milestone' });
  }
  renderBingo();
}

export function renderBingo() {
  const card = document.getElementById('bingoCard');
  const status = document.getElementById('bingoStatus');
  if (!card) return;

  const m = new Set(state.marked);
  card.innerHTML = state.cells.map(([icon, label], i) => `
    <div class="bingo-cell${m.has(i) ? ' marked' : ''}${i === FREE_IDX ? ' free' : ''}" data-idx="${i}">
      <div class="bi">${icon}</div>
      <div>${esc(label)}</div>
    </div>`).join('');

  if (status) {
    const n = lineCount();
    status.textContent = n ? `${n} bingo ${n === 1 ? 'line' : 'lines'}!` : `${m.size - 1} / 24 spotted`;
  }
}

document.getElementById('bingoCard')?.addEventListener('click', (e) => {
  const cell = e.target.closest('.bingo-cell');
  if (cell) toggleCell(Number(cell.dataset.idx));
});

document.getElementById('bingoNew')?.addEventListener('click', () => {
  state = newCard();
  save();
  renderBingo();
});
