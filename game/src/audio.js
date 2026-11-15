// audio.js — every sound is synthesised with WebAudio: no audio files, nothing
// to load, and the game stays a folder of text. A noise buffer through a
// band-pass makes a gunshot; a square blip makes the charge's beeper; a sine
// drop makes the blast. The context is created lazily on the first user
// gesture, which is also what the browser's autoplay policy wants.

let ctx = null;
let master = null;
let noiseBuffer = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const length = ctx.sampleRate * 1;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

function noise({ at = 0, dur = 0.12, freq = 1800, q = 0.8, gain = 0.5, type = 'bandpass' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function tone({ at = 0, dur = 0.1, from = 800, to = null, gain = 0.2, type = 'square' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// distance: 0 at the listener's ear, 1 at 60 metres. Far shots are a muffled
// crack, near ones are all crack and body.
export function sfxShot(kind, distance = 0) {
  if (!ctx) return;
  const near = 1 - Math.min(1, distance);
  const body = { pistol: 0.5, smg: 0.45, scatter: 0.8, carbine: 0.65, longshot: 1.0 }[kind] ?? 0.6;
  noise({ dur: 0.09 + body * 0.08, freq: 900 + near * 1600, gain: 0.12 + near * 0.4 * body });
  noise({ dur: 0.05, freq: 3200, gain: 0.1 * near });
  tone({ dur: 0.07, from: 160, to: 60, gain: 0.18 * near, type: 'triangle' });
}

export function sfxDryFire() {
  tone({ dur: 0.03, from: 1400, gain: 0.08, type: 'square' });
}

export function sfxReload() {
  tone({ dur: 0.03, from: 900, gain: 0.1 });
  tone({ at: 0.16, dur: 0.03, from: 620, gain: 0.12 });
  tone({ at: 0.34, dur: 0.04, from: 1100, gain: 0.14 });
}

export function sfxHit(kill) {
  tone({ dur: 0.05, from: kill ? 1560 : 1180, gain: 0.16, type: 'sine' });
  if (kill) tone({ at: 0.06, dur: 0.08, from: 1960, gain: 0.14, type: 'sine' });
}

export function sfxHurt() {
  noise({ dur: 0.1, freq: 500, gain: 0.25, type: 'lowpass' });
}

export function sfxBeep(final = false) {
  tone({ dur: final ? 0.3 : 0.07, from: final ? 1320 : 990, gain: 0.15, type: 'square' });
}

export function sfxExplosion() {
  if (!ctx) return;
  noise({ dur: 0.9, freq: 220, gain: 0.9, type: 'lowpass' });
  tone({ dur: 0.8, from: 120, to: 34, gain: 0.7, type: 'sine' });
}

export function sfxThrow() {
  noise({ dur: 0.08, freq: 2400, gain: 0.06 });
}

export function sfxRoundEnd(won) {
  if (!ctx) return;
  const notes = won ? [523, 659, 784] : [392, 330, 262];
  notes.forEach((f, i) => tone({ at: i * 0.13, dur: 0.22, from: f, gain: 0.12, type: 'triangle' }));
}
