import type { Vec2 } from '../game/types';
import { HEAD_Z } from './depths';
import type { WallScene } from './scene';

/**
 * Bits of the 2D layer that are not about aiming: the colours it draws in,
 * the tap targets, the introductory labels, and the noise he makes.
 */

/**
 * The aiming furniture is deliberately not the route colour. Rings drawn in the
 * same hue as the holds read as holds, and on a green route every reticle
 * looked like somewhere you could put a hand.
 */
export const AIM_INK = '#ffffff';
export const AIM_TARGET = '#00e5ff';
export const AIM_HOT = '#ff4d3d';

export const LIMB_PIP_RADIUS = 21;
/** Fingers are wide. The tap target is much bigger than the thing it hits. */
export const LIMB_TOUCH_RADIUS = 40;

/** How long the introductory labels stay legible before they start to go. */
export const INTRO_HOLD_MS = 2600;
/** And how long they take to leave. Slow enough not to snatch them away. */
export const INTRO_FADE_MS = 1100;

/**
 * The labels are a one-time introduction, not permanent furniture. Every limb
 * and the hips get named when you pull on, then they fade, and what is left
 * is the wall.
 */
export function introAlpha(age: number): number {
  if (age <= INTRO_HOLD_MS) return 1;
  const t = (age - INTRO_HOLD_MS) / INTRO_FADE_MS;
  return t >= 1 ? 0 : 1 - t * t;
}

/** Something the climber is saying, drawn at their head. */
export type Shout = { text: string; at: Vec2; age: number };

/** How long the shout hangs in the air. Matches the fall, which is unhurried. */
export const SHOUT_MS = 2000;

/**
 * The climber's own commentary. There is one line and it is "Bruh", except that
 * it stretches the whole way down — the vowel grows as he falls, so a long fall
 * earns a longer Bruuuuuuh than a short one. No exclamation mark: he is not
 * exclaiming, he is observing.
 */
export function shoutText(age: number): string {
  const t = Math.min(Math.max(age, 0) / SHOUT_MS, 1);
  return `Br${'u'.repeat(1 + Math.floor(t * 8))}h`;
}

export function drawShout(ctx: CanvasRenderingContext2D, scene: WallScene, shout: Shout): void {
  const t = Math.min(shout.age / SHOUT_MS, 1);
  const p = scene.project(shout.at, HEAD_Z);
  const rise = -18 - t * 34;

  ctx.save();
  ctx.globalAlpha = t < 0.09 ? t / 0.09 : 1 - Math.max(0, (t - 0.78) / 0.22);
  ctx.translate(p.x, p.y + rise);
  ctx.scale(1 + (1 - Math.min(t * 6, 1)) * 0.4, 1 + (1 - Math.min(t * 6, 1)) * 0.4);
  ctx.font = `900 ${Math.round(28 + t * 10)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(12,14,19,0.92)';
  ctx.strokeText(shout.text, 0, 0);
  ctx.fillStyle = '#ff5e4d';
  ctx.fillText(shout.text, 0, 0);
  ctx.restore();
}
