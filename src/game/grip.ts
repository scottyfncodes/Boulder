import type { Hold, HoldType, LimbId, Vec2 } from './types';
import { isHand } from './types';
import { HOLD_PROFILES } from './holds';

/**
 * What a hold can take.
 *
 * Every hold used to be as strong as every other, which made the only real
 * question "is it in reach". Climbing does not work like that: a jug holds a
 * swinging body on one hand, a crimp holds a still one with the feet on, and a
 * sloper holds almost nothing unless the body hangs straight under it on a
 * wall that is not tipping it away. This file is the one place that answers
 * "how many body weights can this limb put through this hold, right now".
 *
 * Everything is in body weights, and everything is continuous: a hold that is
 * a bit too small or loaded a bit off its line is a bit worse, never a cliff.
 * The numbers here are the tuning surface; the sim and the route grader both
 * read them, so the grader is judging the same physics the player climbs.
 */

/** The physical character of a shape. */
export type GripPhysics = {
  /**
   * Body weights the shape takes at its reference size, loaded perfectly,
   * fresh, on a vertical wall. A jug takes a swinging body on one arm.
   */
  strength: number;
  /** Size (metres, the instance's `size`) the strength is quoted at. */
  sizeRef: number;
  /**
   * How much of the grip is mechanical — fingers behind an edge — rather
   * than friction. A positive hold does not care that the wall leans back; a
   * friction hold does, because the surface it relies on tips away with it.
   */
  positivity: number;
  /** How much size matters: an edge half the size is much worse; a jug half the size is still a jug. */
  sizeSensitivity: number;
  /**
   * How well the shape catches a body that is still moving, 0..1. A jug is a
   * handle you can slam into; a sloper has to be arrived at gently, which is
   * what a deadpoint is for.
   */
  catchTolerance: number;
  /** Lowest the load-direction factor goes, loaded completely the wrong way. */
  wrongWay: number;
};

export const GRIP: Record<HoldType, GripPhysics> = {
  jug: { strength: 3.4, sizeRef: 0.11, positivity: 1, sizeSensitivity: 0.25, catchTolerance: 1, wrongWay: 0.45 },
  pocket: { strength: 1.55, sizeRef: 0.1, positivity: 0.8, sizeSensitivity: 0.6, catchTolerance: 0.5, wrongWay: 0.3 },
  crimp: { strength: 1.3, sizeRef: 0.095, positivity: 0.7, sizeSensitivity: 0.9, catchTolerance: 0.45, wrongWay: 0.25 },
  pinch: { strength: 1.45, sizeRef: 0.1, positivity: 0.5, sizeSensitivity: 0.5, catchTolerance: 0.5, wrongWay: 0.2 },
  sidepull: { strength: 1.9, sizeRef: 0.1, positivity: 0.7, sizeSensitivity: 0.5, catchTolerance: 0.6, wrongWay: 0.18 },
  undercling: { strength: 2.1, sizeRef: 0.11, positivity: 0.8, sizeSensitivity: 0.4, catchTolerance: 0.55, wrongWay: 0.16 },
  gaston: { strength: 1.6, sizeRef: 0.1, positivity: 0.65, sizeSensitivity: 0.5, catchTolerance: 0.45, wrongWay: 0.16 },
  sloper: { strength: 1.25, sizeRef: 0.115, positivity: 0.12, sizeSensitivity: 0.35, catchTolerance: 0.25, wrongWay: 0.12 },
  volume: { strength: 1.1, sizeRef: 0.15, positivity: 0.08, sizeSensitivity: 0.3, catchTolerance: 0.3, wrongWay: 0.3 },
  foothold: { strength: 2.4, sizeRef: 0.085, positivity: 0.75, sizeSensitivity: 0.6, catchTolerance: 0.9, wrongWay: 0.35 },
  smear: { strength: 1.5, sizeRef: 0.08, positivity: 0, sizeSensitivity: 0, catchTolerance: 0.6, wrongWay: 0.4 },
};

/** Smallest and largest the size factor goes, so a typo in a route cannot make a hold of steel. */
const SIZE_MIN = 0.55;
const SIZE_MAX = 1.35;

export function gripPhysics(type: HoldType): GripPhysics {
  return GRIP[type];
}

/** How the instance's size scales its strength. */
export function sizeFactor(hold: Pick<Hold, 'type' | 'size'>): number {
  const g = GRIP[hold.type];
  if (g.sizeSensitivity <= 0) return 1;
  const f = Math.pow(Math.max(hold.size, 0.01) / g.sizeRef, g.sizeSensitivity);
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, f));
}

/**
 * How much the wall's lean costs a shape. Positive holds barely notice; a
 * sloper on a roof is a sloper upside down. Slab helps friction feet a lot and
 * hands not at all (you cannot pull outwards on a slab).
 */
export function wallFactor(type: HoldType, angle: number, hand: boolean): number {
  const g = GRIP[type];
  if (angle <= 0) {
    // Slab: the wall leans away and friction holds press into it.
    const slab = Math.min(1, -angle / 0.35);
    return hand ? 1 - 0.1 * slab * (1 - g.positivity) : 1 + 0.35 * slab * (1 - g.positivity);
  }
  const lean = Math.sin(Math.min(Math.PI / 2, angle));
  const loss = hand ? 0.8 : 1.05;
  return Math.max(0.12, 1 - loss * (1 - g.positivity) * lean);
}

/** 0..1: how well a hold's direction suits the force through it. */
export function alignment(hold: Pick<Hold, 'dir' | 'type'>, force: Vec2): number {
  const p = HOLD_PROFILES[hold.type];
  const want = { x: Math.cos(hold.dir), y: Math.sin(hold.dir) };
  const a = Math.max(0, Math.min(1, (want.x * force.x + want.y * force.y + 1) / 2));
  return Math.max(0, Math.min(1, 1 - p.directionality * (1 - a) * 2.1));
}

/** The conditions a contact is held in, beyond the hold itself. */
export type GripContext = {
  limb: LimbId;
  /** Unit force direction the limb puts through the hold. */
  force: Vec2;
  /** How far the wall leans at the hold, radians past vertical. */
  angle: number;
  /** 0..1: forearm freshness for a hand; ignored for feet. 1 = fresh. */
  grip?: number;
  /** 0..1: core tension left. Feet on steep ground need it. */
  core?: number;
  /** An opposing force (squeeze, stem) the climber can push this hold against. */
  opposition?: Vec2 | null;
  /** A foot hooked round the hold, heel or toe: it holds from any side. */
  hooked?: boolean;
  /** Two hands sharing the hold. */
  matched?: boolean;
};

/**
 * Body weights this limb can put through this hold before it lets go.
 */
export function holdCapacity(hold: Pick<Hold, 'type' | 'size' | 'dir' | 'hard'>, c: GripContext): number {
  const g = GRIP[hold.type];
  const hand = isHand(c.limb);
  const p = HOLD_PROFILES[hold.type];
  let align = alignment(hold, c.force);
  // A squeeze or a stem: the climber pushes the hold against something, and
  // the force through it is theirs to point.
  if (c.opposition) align = Math.max(align, 0.92 * alignment(hold, c.opposition));
  if (c.hooked) align = Math.max(align, 0.55 + 0.4 * g.positivity);
  const dirF = g.wrongWay + (1 - g.wrongWay) * align;
  // Wrong limb for the shape: feet on hand holds are fine but not as intended.
  const aff = p.affinity === 'both' ? 1 : p.affinity === 'foot' ? (hand ? 0 : 1) : hand ? 1 : p.crossUse;
  let cap = g.strength * sizeFactor(hold) * dirF * wallFactor(hold.type, c.angle, hand) * aff;
  // Hand-set routes can mark a hold spicy or soft.
  if (hold.hard) cap /= Math.max(0.7, Math.min(1.4, hold.hard));
  if (hand) {
    const fresh = c.grip ?? 1;
    // Pumped forearms close on less. Gentle until it is not.
    cap *= 1 - 0.5 * Math.pow(1 - Math.max(0, Math.min(1, fresh)), 1.6);
    if (c.matched) cap *= 0.8;
  } else if (c.angle > 0) {
    // Keeping a foot on a steep wall is the core's job.
    const core = c.core ?? 1;
    cap *= 1 - 0.35 * (1 - core) * Math.sin(Math.min(Math.PI / 2, c.angle));
  }
  return Math.max(0.02, cap);
}

/**
 * How expensive a hold is to keep holding, per unit of load, for the pump:
 * 1 for a jug, more for anything you have to close your hand harder on.
 * This is overgripping, priced: the same weight on a crimp costs the forearm
 * more than on a jug.
 */
export function gripCost(hold: Pick<Hold, 'type' | 'size' | 'dir' | 'hard'>, c: GripContext): number {
  const ideal = GRIP.jug.strength;
  const cap = holdCapacity(hold, { ...c, grip: 1 });
  return Math.min(3.2, Math.max(1, Math.pow(ideal / Math.max(cap, 0.05), 0.6)));
}

/**
 * Catching. Until a contact is established the hold only offers part of what
 * it can take — how much depends on the shape — ramping to all of it over
 * `ESTABLISH_TIME`. A body arriving fast on a sloper is a body leaving again.
 */
export const ESTABLISH_TIME = 0.22;

export function establishFactor(type: HoldType, heldT: number): number {
  const g = GRIP[type];
  const t = Math.max(0, Math.min(1, heldT / ESTABLISH_TIME));
  const s = t * t * (3 - 2 * t);
  return g.catchTolerance + (1 - g.catchTolerance) * s;
}

/**
 * The slip. Over capacity a contact does not vanish in a frame; it starts to
 * go, and keeps going faster the further over it is. Back under, it comes
 * back. 1 is gone.
 */
export const SLIP = {
  /** Load ratio above which it starts to go. */
  start: 0.97,
  /** Per second, per unit of ratio over `start`. */
  rate: 11,
  /** Minimum rate once it is going at all. */
  floor: 0.9,
  /** Recovery per second once it is back under `recover`. */
  heal: 1.8,
  recover: 0.88,
} as const;

/** Advances a contact's slip by `dt` at load ratio `ratio` (demand / capacity). */
export function stepSlip(slip: number, ratio: number, dt: number): number {
  if (ratio > SLIP.start) return slip + Math.max(SLIP.floor, (ratio - SLIP.start) * SLIP.rate) * dt;
  if (ratio < SLIP.recover) return Math.max(0, slip - SLIP.heal * dt);
  return slip;
}

/** One line for the inspect panel: what this shape asks of you, in numbers a climber would say. */
export function describeGrip(hold: Pick<Hold, 'type' | 'size' | 'dir' | 'hard'>): { hold: string; catch: string; steep: string } {
  const g = GRIP[hold.type];
  const cap = holdCapacity(hold, { limb: hold.type === 'foothold' || hold.type === 'smear' ? 'LF' : 'RH', force: { x: Math.cos(hold.dir), y: Math.sin(hold.dir) }, angle: 0 });
  const holdWord = cap >= 2.6 ? 'Takes a swinging body on one arm'
    : cap >= 1.6 ? 'Holds you one-handed if you are still'
    : cap >= 1.0 ? 'Fine with feet on; marginal on one hand'
    : cap >= 0.6 ? 'Needs good feet and the right body position'
    : 'Barely there: weight on your feet or nothing';
  const catchWord = g.catchTolerance >= 0.85 ? 'Catch it however you like'
    : g.catchTolerance >= 0.5 ? 'Arrive in control'
    : 'Deadpoint it: arrive slow or come off';
  const steepWord = g.positivity >= 0.75 ? 'Steepness barely matters'
    : g.positivity >= 0.45 ? 'Worse as the wall leans out'
    : 'Friction: hopeless on steep ground, best on slab';
  return { hold: holdWord, catch: catchWord, steep: steepWord };
}
