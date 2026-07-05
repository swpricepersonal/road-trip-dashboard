/* Voice announcements: speaks every bus 'event' (milestones, records, state
   crossings, achievements, bingos) via the Web Speech API — on-device, free,
   works offline. Toggle lives in Settings.

   iOS quirk: Safari blocks programmatic speech until at least one utterance
   has been triggered by a user gesture, so the first tap anywhere primes the
   engine with a silent utterance. */

import { on } from './bus.js';
import { settings } from './settings.js';

const supported = 'speechSynthesis' in window;
let primed = false;

// Strip emoji/symbols (some engines read them aloud as "rocket emoji") and
// expand unit abbreviations the synthesizer would otherwise spell out.
function clean(msg) {
  return msg
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\bmph\b/g, 'miles per hour')
    .replace(/\bkm\/h\b/g, 'kilometers per hour')
    .replace(/\bft\b/g, 'feet')
    .replace(/\bmi\b/g, 'miles')
    .replace(/\s+/g, ' ')
    .trim();
}

function speak(text) {
  if (!supported || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

function prime() {
  if (primed || !supported) return;
  primed = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}
document.body.addEventListener('click', prime, { once: true });

on('event', ({ msg }) => {
  if (settings.voice) speak(clean(msg));
});

// Immediate feedback (and a user-gesture prime) when the toggle turns on.
let prevVoice = settings.voice;
on('settings', () => {
  if (settings.voice && !prevVoice) speak('Voice announcements on');
  prevVoice = settings.voice;
});
