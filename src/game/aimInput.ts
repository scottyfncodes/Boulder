import type { Vec2 } from './types';

/**
 * The finger, cleaned up.
 *
 * A pull is read off a thumb on glass, and a thumb shakes. Read raw, a
 * careful aim wobbles a few pixels every frame — which at the end of a short
 * drag is degrees of arc — and lifting off drags it a few more just as it
 * lets go. Two fixes, both about trusting what the player meant:
 *
 * - A one-euro filter on the drag: heavy smoothing while the finger creeps,
 *   almost none while it sweeps, so fine adjustment is steady and big
 *   corrections are not laggy.
 * - A release lock: the throw goes where the aim was a moment before the
 *   finger came up, not where lift-off smeared it to.
 *
 * Pure, no clock of its own: the caller passes time in milliseconds.
 */

/** Cutoff while the finger is still, Hz. Lower is steadier. */
const MIN_CUTOFF = 1.2;
/** How fast the cutoff opens up with speed. Higher is snappier on big moves. */
const BETA = 0.012;
/** Cutoff for the speed estimate itself, Hz. */
const D_CUTOFF = 1.0;
/** How far back the release looks for the aim the player settled on, ms. */
export const RELEASE_LOOKBACK_MS = 70;
/** Finger speed, px/s, above which the release is a flick and fires as it stands. */
const FLICK_SPEED = 900;
/** How much history to keep, ms. */
const HISTORY_MS = 200;

export type AimFilter = {
  value: Vec2 | null;
  speed: number;
  t: number;
  history: { t: number; v: Vec2 }[];
};

export function freshAimFilter(): AimFilter {
  return { value: null, speed: 0, t: 0, history: [] };
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Feeds the raw drag in, returns the steadied one. */
export function filterAim(f: AimFilter, raw: Vec2, tMs: number): Vec2 {
  if (!f.value) {
    f.value = { ...raw };
    f.speed = 0;
    f.t = tMs;
    f.history = [{ t: tMs, v: { ...raw } }];
    return { ...raw };
  }
  const dt = Math.max(1e-3, (tMs - f.t) / 1000);
  if (tMs <= f.t) return { ...f.value };
  const rawSpeed = Math.hypot(raw.x - f.value.x, raw.y - f.value.y) / dt;
  f.speed += alpha(D_CUTOFF, dt) * (rawSpeed - f.speed);
  const a = alpha(MIN_CUTOFF + BETA * f.speed, dt);
  f.value = { x: f.value.x + a * (raw.x - f.value.x), y: f.value.y + a * (raw.y - f.value.y) };
  f.t = tMs;
  f.history.push({ t: tMs, v: { ...f.value } });
  while (f.history.length > 2 && f.history[0].t < tMs - HISTORY_MS) f.history.shift();
  return { ...f.value };
}

/**
 * The aim to fire on release: the steadied drag as it was a moment ago, when
 * the player had settled on it. A finger still moving fast when it comes up
 * is a flick, and that fires as it stands.
 */
export function releaseAim(f: AimFilter, tMs: number): Vec2 | null {
  if (!f.value) return null;
  const want = tMs - RELEASE_LOOKBACK_MS;
  if (f.speed > FLICK_SPEED || !f.history.length || f.history[0].t > want) return { ...f.value };
  let pick = f.history[0]?.v ?? f.value;
  for (const h of f.history) {
    if (h.t <= want) pick = h.v;
    else break;
  }
  return { ...pick };
}
