import type { Grade, Hold, Route } from './types';
import { gradeIndex } from './types';
import { contactRadius } from './holds';
import { clamp01 } from './vec';

/**
 * The pump.
 *
 * One pool, for the whole climb. It starts full when you pull on and drains
 * the entire time you are on the wall, faster on a steep route with small
 * holds than on a vertical ladder of jugs. Run it out and your hands open —
 * not because you did anything wrong, but because you took too long, which is
 * the honest reason most people fall off most problems.
 *
 * What is new is where the effort comes from: the physics. Every hand on the
 * wall reads the load through it in body weights, so hanging on one arm burns
 * far faster than standing on two feet with slack arms, a fling costs a burst
 * on top, and a dyno costs a proper chunk. Body position is not a score any
 * more, it is what the bar is measuring.
 */

export type Endurance = {
  /** 0..1 of capacity. The whole climb. */
  base: number;
  /** Seconds of hanging the pool is worth at this player's fitness. */
  capacity: number;
};

/** Base capacity in seconds before any progression bonus. */
export const BASE_CAPACITY = 95;

/** What a fling costs, as a fraction of capacity, at full pull. */
export const FLING_COST = 0.018;
/** What a dyno costs, as a fraction of capacity. It is the whole body. */
export const DYNO_COST = 0.06;

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
  /**
   * Load through the hands, body weights. Two straight arms hanging read
   * about one; feet on with slack arms read nearly nothing.
   */
  handLoad: number;
  /** How many hands are on. One arm is worse than the same load shared. */
  handsOn: number;
  /** True while a limb is in the air looking for a hold. */
  reaching: boolean;
  /** True while the climber is settled on a hold that gives something back. */
  resting: boolean;
};

export type DrainResult = {
  endurance: Endurance;
  /** Set when the pool ran out this tick. */
  pumped: boolean;
};

/** Seconds-per-second of the pool spent, before the route multiplier. */
export function effortRate(handLoad: number, handsOn: number, reaching: boolean): number {
  // Standing costs a little — you are on a wall. Hanging costs by the weight
  // in your hands, and one arm holding it all costs more than two sharing it.
  const load = Math.max(0, handLoad);
  const lonely = handsOn === 1 ? 1.35 : 1;
  return (0.32 + 0.95 * Math.min(load, 1.6) * lonely) * (reaching ? 1.4 : 1);
}

export function drainEndurance(input: DrainInput): DrainResult {
  const { endurance, dtMs, drain, handLoad, handsOn, reaching, resting } = input;
  const dt = dtMs / 1000;

  let base = endurance.base - (dt * drain * effortRate(handLoad, handsOn, reaching)) / endurance.capacity;
  if (resting) {
    // A proper rest gives it back, but never faster than it went.
    base += (dt * 0.9) / endurance.capacity;
  }
  base = clamp01(base);

  return {
    endurance: { ...endurance, base },
    pumped: base <= 0,
  };
}

/** A fling or a dyno takes a bite out of the pool on the spot. */
export function spend(endurance: Endurance, fraction: number): DrainResult {
  const base = clamp01(endurance.base - fraction);
  return { endurance: { ...endurance, base }, pumped: base <= 0 };
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
