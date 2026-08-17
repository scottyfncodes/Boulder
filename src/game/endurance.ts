import type { Grade, Hold, Route } from './types';
import { gradeIndex } from './types';
import { contactRadius } from './holds';
import { clamp, clamp01 } from './vec';

/**
 * Endurance.
 *
 * One pool, for the whole climb. It starts full when you pull on and drains the
 * entire time you are on the wall, faster on a steep route with small holds
 * than on a vertical ladder of jugs. Run it out and you come off — not because
 * you did anything wrong, but because you took too long, which is the honest
 * reason most people fall off most problems.
 *
 * Holding a limb in the air still costs you: reaching drains faster than
 * hanging does. That pressure is real, it just comes out of the same bar rather
 * than a second one, so there is one number to watch instead of two.
 */

export type Endurance = {
  /** 0..1 of capacity. The whole climb. */
  base: number;
  /** Seconds of climbing the base pool is worth at this player's fitness. */
  capacity: number;
};

/** How much faster the bar drains with a limb off the wall and hunting. */
export const REACH_PENALTY = 2.1;

/** Base capacity in seconds before any progression bonus. */
export const BASE_CAPACITY = 105;

/**
 * How hard a route is on the forearms, independent of whether you can do the
 * moves. Steepness dominates, hold size matters, and the grade carries whatever
 * the first two do not explain.
 */
export function routeDrain(route: Route): number {
  const steep = Math.sin(((route.overhang ?? 0) * Math.PI) / 180);
  const grade = gradeIndex(route.grade) / 17;

  const hand = route.holds.filter((h) => h.type !== 'foothold');
  const meanRadius = hand.length
    ? hand.reduce((s, h) => s + contactRadius(h.size, h.type), 0) / hand.length
    : 0.11;
  // A 0.11m contact radius is a comfortable jug; anything meaner costs more.
  const small = clamp01((0.115 - meanRadius) / 0.06);

  return 1 + steep * 1.5 + small * 0.85 + grade * 0.9;
}

/** Capacity in seconds for a player who has sent up to `topGrade`. */
export function capacityFor(topGrade: Grade | null, sends: number): number {
  // Fitness comes with mileage. A V5 climber is not just better at moves, they
  // can stay on the wall longer, and the bar should show that growing.
  const fromGrade = topGrade ? gradeIndex(topGrade) * 7 : 0;
  const fromMileage = Math.min(sends, 40) * 1.2;
  return BASE_CAPACITY + fromGrade + fromMileage;
}

export function freshEndurance(capacity: number): Endurance {
  return { base: 1, capacity };
}

export type DrainInput = {
  endurance: Endurance;
  dtMs: number;
  /** Route difficulty multiplier from `routeDrain`. */
  drain: number;
  /** 0..1 — a composed stance costs less than fighting to stay on. */
  stability: number;
  /** True while a limb is off the wall looking for a hold. */
  reaching: boolean;
  /** True while the climber is resting on a hold that gives something back. */
  resting: boolean;
};

export type DrainResult = {
  endurance: Endurance;
  /** Set when the pool ran out this tick. */
  pumped: boolean;
};

export function drainEndurance(input: DrainInput): DrainResult {
  const { endurance, dtMs, drain, stability, reaching, resting } = input;
  const dt = dtMs / 1000;

  // A bad stance burns endurance faster than a good one, and a limb held in
  // the air burns faster still. This is what makes body position worth spending
  // time on rather than a cosmetic score, and what stops you dithering with one
  // hand out.
  const effort = drain
    * (1.45 - 0.55 * clamp01(stability))
    * (reaching ? REACH_PENALTY : 1);

  let base = endurance.base - (dt * effort) / endurance.capacity;
  if (resting) {
    // A proper rest gives it back, but never faster than it went.
    base += (dt * 0.55) / endurance.capacity * 4;
  }
  base = clamp01(base);

  return {
    endurance: { ...endurance, base },
    pumped: base <= 0,
  };
}

/** Holds that give endurance back. Set by the route, not by the shape. */
export function isRest(hold: Hold): boolean {
  return hold.rest === true;
}

/** Copy for the endurance readout. No numbers — a climber feels this. */
export function pumpWord(base: number): string {
  if (base > 0.72) return 'fresh';
  if (base > 0.48) return 'working';
  if (base > 0.28) return 'getting pumped';
  if (base > 0.12) return 'pumped';
  return 'about to come off';
}

export const clampEnd = clamp;
