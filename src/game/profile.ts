import type { Route } from './types';

/**
 * The shape of the wall.
 *
 * A wall is not one plane. It can start vertical, kick back into a roof, and
 * come out over a lip onto something friendlier, and the physics and the
 * picture both have to agree on where those bends are. Positions on the wall
 * stay what they always were — x across, y measured up the wall's own surface
 * from the floor, as if it were unrolled flat — and the profile says how far
 * the surface leans at each y.
 *
 * Bends are rounded over a short distance rather than creased, so a body
 * sliding over a lip sees the angle change smoothly, and a hand reaching past
 * a bend lands where the picture says it does.
 */

export type WallProfile = {
  /** Lean below the first bend, radians past vertical. */
  base: number;
  /** From `y` (metres up the surface) on, the wall leans `angle` radians. In order. */
  bends: { y: number; angle: number }[];
};

/** How far a bend is rounded over, metres of surface either side of it. */
export const BEND_ROUND = 0.18;

/** Steeper than this, radians, and a wall is a roof: feet hang rather than stand. */
export const ROOF_ANGLE = (40 * Math.PI) / 180;

export const FLAT: WallProfile = { base: 0, bends: [] };

export function flatProfile(angle: number): WallProfile {
  return { base: angle, bends: [] };
}

/** The route's wall, in radians. */
export function profileOf(route: Pick<Route, 'overhang' | 'profile'>): WallProfile {
  const base = ((route.overhang ?? 0) * Math.PI) / 180;
  const bends = (route.profile ?? []).map((b) => ({ y: b.y, angle: (b.angle * Math.PI) / 180 }));
  return { base, bends };
}

/** How far the wall leans at a point on it, radians past vertical. */
export function angleAt(p: WallProfile, y: number): number {
  let a = p.base;
  let prev = p.base;
  for (const b of p.bends) {
    const t = (y - (b.y - BEND_ROUND)) / (2 * BEND_ROUND);
    if (t <= 0) break;
    // Smoothstep across the rounding, so the lean has no kink either.
    const k = t >= 1 ? 1 : t * t * (3 - 2 * t);
    a = prev + (b.angle - prev) * k;
    prev = b.angle;
  }
  return a;
}

/** Steepest point of the wall between two heights. */
export function steepestBetween(p: WallProfile, y0: number, y1: number): number {
  let most = angleAt(p, y0);
  for (let y = y0; y <= y1; y += 0.05) most = Math.max(most, angleAt(p, y));
  return most;
}

/**
 * One number for a wall that bends, for the parts of the game that only
 * understand one: the mean lean over the climbable height.
 */
export function meanAngle(p: WallProfile, y0 = 0.3, y1 = 4.1): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += 0.05) { sum += angleAt(p, y); n++; }
  return n ? sum / n : p.base;
}

/** How high a route goes: the standard wall, or higher if its holds do. */
export function routeTop(route: Pick<Route, 'holds'>): number {
  let top = 4.25;
  for (const h of route.holds) top = Math.max(top, h.pos.y + 0.2);
  return top;
}

export function isFolded(p: WallProfile): boolean {
  return p.bends.length > 0;
}
