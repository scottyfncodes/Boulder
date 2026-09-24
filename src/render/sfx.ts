import type { MoveGrade } from '../game/types';

/**
 * Sound, made on the spot.
 *
 * Nothing is fetched at runtime, so there are no samples: every noise here is
 * an oscillator or a burst of filtered noise shaped by an envelope. That keeps
 * the whole thing a few kilobytes and means the pitch of a grab can follow the
 * player's streak, which a sample library would make awkward.
 *
 * Browsers refuse to start audio until the page has been touched, so the
 * context is created lazily and resumed from the first pointer or key event.
 * Until then every call is a silent no-op, which is also what happens on
 * anything without Web Audio at all.
 */

const MUTE_KEY = 'bruh.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try { localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch { /* play on */ }
  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.8, ctx.currentTime, 0.02);
}

/** Call from inside a user gesture. Safe to call as often as you like. */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    // A gentle limiter, so a fanfare on top of a thud does not clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function ready(): AudioContext | null {
  return ctx && master && ctx.state === 'running' && !muted ? ctx : null;
}

/** Short buzz on phones that support it. iOS ignores this; nothing breaks. */
export function buzz(pattern: number | number[]): void {
  if (muted) return;
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// --- primitives ------------------------------------------------------------

type Env = { at?: number; attack?: number; hold?: number; release: number; peak: number };

function envelope(g: GainNode, c: AudioContext, e: Env): number {
  const t0 = c.currentTime + (e.at ?? 0);
  const a = e.attack ?? 0.004;
  const h = e.hold ?? 0;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(e.peak, t0 + a);
  g.gain.setValueAtTime(e.peak, t0 + a + h);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + h + e.release);
  return t0 + a + h + e.release + 0.02;
}

function tone(
  c: AudioContext, type: OscillatorType, freq: number, e: Env, glideTo?: number,
): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const t0 = c.currentTime + (e.at ?? 0);
  o.frequency.setValueAtTime(freq, t0);
  const end = envelope(g, c, e);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, end - 0.02);
  o.connect(g).connect(master!);
  o.start(t0);
  o.stop(end);
}

function noise(
  c: AudioContext, filter: BiquadFilterType, freq: number, q: number, e: Env, sweepTo?: number,
): void {
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  const t0 = c.currentTime + (e.at ?? 0);
  f.frequency.setValueAtTime(freq, t0);
  const g = c.createGain();
  const end = envelope(g, c, e);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, end - 0.02);
  s.connect(f).connect(g).connect(master!);
  s.start(t0, Math.random() * 0.5);
  s.stop(end);
}

// --- the palette -----------------------------------------------------------

/** A major pentatonic, so any run of grabs sounds like it meant to. */
const PENTA = [0, 2, 4, 7, 9];
function note(step: number, base = 523.25): number {
  const oct = Math.floor(step / PENTA.length);
  const deg = PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length];
  return base * 2 ** (oct + deg / 12);
}

/** The limb leaving. Harder throws are louder and brighter. */
export function sfxThrow(power: number): void {
  const c = ready(); if (!c) return;
  noise(c, 'bandpass', 380 + power * 400, 1.4,
    { attack: 0.03, release: 0.16 + power * 0.08, peak: 0.12 + power * 0.22 }, 1800 + power * 1600);
}

/**
 * The hand arriving. A slap for the contact, and a chime that climbs the scale
 * with every clean placement in a row — the streak is audible before anyone
 * looks at a number.
 */
export function sfxGrab(grade: MoveGrade, streak: number): void {
  const c = ready(); if (!c) return;
  // The slap: skin on plastic.
  noise(c, 'lowpass', grade === 'PERFECT' ? 2600 : 1800, 0.8, { attack: 0.002, release: 0.07, peak: 0.55 });
  tone(c, 'sine', 150, { attack: 0.002, release: 0.09, peak: 0.35 }, 70);

  if (grade === 'PERFECT') {
    const f = note(Math.min(streak, 14));
    tone(c, 'triangle', f, { at: 0.01, attack: 0.004, release: 0.32, peak: 0.22 });
    tone(c, 'sine', f * 2, { at: 0.01, attack: 0.004, release: 0.22, peak: 0.08 });
    if (streak >= 3) tone(c, 'triangle', f * 1.5, { at: 0.07, attack: 0.004, release: 0.26, peak: 0.12 });
  } else if (grade === 'GOOD') {
    tone(c, 'triangle', note(Math.min(streak, 14), 392), { at: 0.01, release: 0.2, peak: 0.13 });
  } else if (grade === 'SCRAPE') {
    // Fingertips skidding before they bite.
    noise(c, 'highpass', 3000, 0.7, { attack: 0.01, release: 0.18, peak: 0.16 }, 1400);
  }
}

/** The reticle finding something to hold. Barely there, on purpose. */
export function sfxLock(): void {
  const c = ready(); if (!c) return;
  tone(c, 'sine', 1320, { attack: 0.002, release: 0.04, peak: 0.05 });
}

/** A foot skating or a hand peeling. */
export function sfxSlip(): void {
  const c = ready(); if (!c) return;
  noise(c, 'bandpass', 2400, 3, { attack: 0.005, release: 0.25, peak: 0.2 }, 500);
  tone(c, 'sawtooth', 420, { attack: 0.005, release: 0.28, peak: 0.05 }, 180);
}

/** The long cartoon whistle of a man accepting gravity. */
export function sfxFall(ms: number): void {
  const c = ready(); if (!c) return;
  const dur = Math.max(ms / 1000, 0.4);
  tone(c, 'sine', 1150, { attack: 0.05, hold: dur * 0.8, release: dur * 0.2, peak: 0.13 }, 240);
  tone(c, 'sine', 1156, { attack: 0.05, hold: dur * 0.8, release: dur * 0.2, peak: 0.06 }, 236);
}

/** Crash pad. The heavier the fall, the deeper. */
export function sfxThud(height: number): void {
  const c = ready(); if (!c) return;
  const h = Math.min(Math.max(height, 0.3), 3.5) / 3.5;
  tone(c, 'sine', 110 - h * 40, { attack: 0.002, release: 0.35 + h * 0.2, peak: 0.7 }, 38);
  noise(c, 'lowpass', 700, 0.7, { attack: 0.002, release: 0.22, peak: 0.5 + h * 0.3 }, 120);
  // The pad sighing out its air.
  noise(c, 'bandpass', 900, 0.9, { at: 0.06, attack: 0.04, release: 0.4, peak: 0.07 }, 300);
}

/** The top. A little fanfare and a cymbal. */
export function sfxSend(): void {
  const c = ready(); if (!c) return;
  const steps = [0, 2, 4, 5, 7];
  steps.forEach((s, i) => {
    const f = note(s, 523.25);
    tone(c, 'triangle', f, { at: i * 0.075, attack: 0.005, release: i === steps.length - 1 ? 0.9 : 0.18, peak: 0.2 });
    tone(c, 'square', f / 2, { at: i * 0.075, attack: 0.005, release: 0.12, peak: 0.035 });
  });
  noise(c, 'highpass', 5000, 0.5, { at: 0.3, attack: 0.005, release: 1.1, peak: 0.16 });
  tone(c, 'sine', note(7, 523.25) * 2, { at: 0.34, attack: 0.02, release: 1.0, peak: 0.07 });
}

/** Pulling on. The chalk clap. */
export function sfxChalk(): void {
  const c = ready(); if (!c) return;
  noise(c, 'bandpass', 1400, 0.6, { attack: 0.003, release: 0.12, peak: 0.35 }, 700);
  noise(c, 'bandpass', 1300, 0.6, { at: 0.16, attack: 0.003, release: 0.14, peak: 0.3 }, 600);
}

/** The forearms, when they are nearly done. */
export function sfxHeartbeat(level: number): void {
  const c = ready(); if (!c) return;
  const peak = 0.25 + level * 0.35;
  tone(c, 'sine', 62, { attack: 0.006, release: 0.12, peak }, 45);
  tone(c, 'sine', 58, { at: 0.17, attack: 0.006, release: 0.16, peak: peak * 0.7 }, 42);
}

/** A button. */
export function sfxTap(): void {
  const c = ready(); if (!c) return;
  tone(c, 'sine', 880, { attack: 0.002, release: 0.05, peak: 0.08 }, 660);
}
