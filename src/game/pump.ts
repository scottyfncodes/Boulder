import type { Grade } from './types';
import { gradeIndex } from './types';
import { clamp01 } from './vec';

/**
 * The pump.
 *
 * This is the game's currency. Every hold sticks the same — a hold is
 * something to hang on, not a test — so what a climb costs is how you climbed
 * it: how steep the wall is where your body is, how many limbs are sharing
 * the weight, and how much you are throwing yourself about. The same jug is a
 * rest on a vertical wall with your feet on and a countdown on a roof with
 * one hand on it.
 *
 * Two numbers. `pump` is how full the forearms are right now, 0 fresh to 1
 * blown, and it comes back down when the body is somewhere it can recover —
 * slowly, and slower the deeper you are. `floor` is how tired you are under
 * that, and it never comes back during a climb: a fraction of every bit of
 * effort lands there for good, so a rest buys time but cannot buy a free
 * climb. Hit 1 and the hands open.
 *
 * Nothing here knows about holds. Pure numbers, no clock of its own.
 */

/** What the body is doing this instant: everything the pump reads. */
export type Posture = {
  /** How far the wall leans where the body is, radians past vertical. */
  angle: number;
  /** Hands on something. */
  hands: number;
  /** Feet on something: holds, hooks, or the mat once you have left it. */
  feet: number;
  /** How fast the body is moving, m/s. Swinging, sagging, flying. */
  speed: number;
  /** A limb in the air looking for a hold. */
  reaching: boolean;
  /** Still standing at the bottom: nothing costs anything yet. */
  grounded?: boolean;
};

export type Pump = {
  /** 0 fresh .. 1 blown. */
  pump: number;
  /** The part of it that will not come back this climb. Never above `pump`. */
  floor: number;
  /** Bigger is fitter: every cost is divided by it. 1 is a new climber. */
  fitness: number;
};

export const PUMP = {
  /** Holding onto a wall at all: core, balance, fingers closed. */
  onWall: 0.06,
  /**
   * How much of the weight good feet take off the arms, by how many feet are
   * on: none, one, both.
   */
  feetCarry: [0, 0.62, 0.9] as const,
  /**
   * How much of that feet still manage on a roof, where they are hooking and
   * pulling in rather than standing. On a vertical wall it is all of it.
   */
  roofFeet: 0.32,
  /** Arms never carry less than this: hands are still balancing the body. */
  armFloor: 0.1,
  /**
   * Core tension: keeping the body in to a wall that leans out over you,
   * whatever is holding it. Per unit of the sine of the angle.
   */
  core: 0.3,
  /** How much the wall angle multiplies what the arms are carrying. At a roof it is 1 + this. */
  steepness: 1.7,
  /** Swinging on your arms, per (m/s)², at full arm load. */
  swing: 0.55,
  /** A limb in the air: the rest of the body is holding a position to throw from. */
  reach: 0.14,
  /**
   * Below this effort the body recovers; above it, it pumps. Most of a stable
   * vertical stance sits under it. Hanging off two arms does not.
   */
  restLine: 0.24,
  /** Effort above the rest line per unit of pump: how many effort-seconds fill the forearms. */
  capacity: 26,
  /** Fastest recovery, pump per second, from a perfectly stable stance with fresh arms. */
  recover: 0.016,
  /** Of every bit of pump gained, how much stays for the rest of the climb. */
  fatigue: 0.28,
  /** Throwing one limb at full pull, before the wall and the body are counted. */
  fling: 0.022,
  /** A full dyno, before the wall is counted. Everything leaves the wall. */
  dyno: 0.085,
  /** Catching yourself, per (m/s)² over the first metre a second, by one hand. */
  catchShock: 0.009,
} as const;

export function freshPump(fitness = 1): Pump {
  return { pump: 0, floor: 0, fitness };
}

/**
 * How much of the body's weight the arms are carrying, 0..1, before the wall
 * angle adds its bit. Feet are what take it off them, and the steeper the
 * wall the less a foot can do.
 */
export function armShare(p: Pick<Posture, 'angle' | 'hands' | 'feet'>): number {
  if (p.hands <= 0) return 0;
  const feet = PUMP.feetCarry[Math.max(0, Math.min(2, p.feet))];
  const upright = Math.pow(Math.max(0, Math.cos(p.angle)), 1.5);
  const footWork = PUMP.roofFeet + (1 - PUMP.roofFeet) * upright;
  return Math.max(PUMP.armFloor, 1 - feet * footWork);
}

/**
 * Effort, per second, from a posture. Arms: weight per hand squared, summed —
 * so two hands sharing a load cost half of one hand holding it — times the
 * wall. Then swinging, and reaching. Hanging off feet alone is core work, not
 * forearm work, but it is not free either.
 */
export function effort(p: Posture): number {
  if (p.grounded) return 0;
  const lean = Math.sin(Math.max(0, Math.min(Math.PI / 2, p.angle)));
  const steep = 1 + PUMP.steepness * lean;
  const arms = armShare(p);
  const hands = Math.max(1, p.hands);
  const forearms = p.hands > 0 ? (arms * arms) / hands : 0;
  const hooks = p.hands === 0 && p.feet > 0 ? 0.35 * steep : 0;
  const swing = PUMP.swing * Math.min(p.speed, 3.5) ** 2 * (p.hands > 0 ? arms : 0.4);
  const reach = p.reaching ? PUMP.reach * steep : 0;
  return PUMP.onWall + PUMP.core * lean + forearms * steep + hooks + swing + reach;
}

/** Advances the pump by `dt` seconds of holding `posture`. */
export function tickPump(state: Pump, posture: Posture, dt: number): Pump {
  const e = effort(posture);
  if (e > PUMP.restLine) return gain(state, ((e - PUMP.restLine) * dt) / PUMP.capacity);
  // Recovery: only from somewhere stable, faster the more stable, and slower
  // the deeper the pump already is. Never below what the climb has cost for good.
  const stable = (PUMP.restLine - e) / PUMP.restLine;
  const depth = 0.3 + 0.7 * (1 - state.pump);
  const pump = Math.max(state.floor, state.pump - PUMP.recover * stable * depth * state.fitness * dt);
  return { ...state, pump };
}

/** Adds pump, some of it for good. */
export function gain(state: Pump, amount: number): Pump {
  if (amount <= 0) return state;
  const a = amount / state.fitness;
  const pump = Math.min(1, state.pump + a);
  const floor = Math.min(pump, state.floor + a * PUMP.fatigue);
  return { ...state, pump, floor };
}

/** The steeper the wall, the more anything violent costs. */
function steepFactor(angle: number): number {
  return 1 + 1.2 * Math.sin(Math.max(0, Math.min(Math.PI / 2, angle)));
}

/**
 * Throwing a limb. Harder pulls cost more, and so does whatever is left
 * holding on while it flies: one limb left on is a lot to ask of it.
 */
export function flingCost(power: number, angle: number, leftOn: number): number {
  const lonely = leftOn <= 1 ? 1.8 : leftOn === 2 ? 1.2 : 1;
  return PUMP.fling * clamp01(power) ** 2 * steepFactor(angle) * lonely;
}

/** A dyno: the whole body, all at once. */
export function dynoCost(power: number, angle: number): number {
  return PUMP.dyno * (0.35 + 0.65 * clamp01(power) ** 2) * steepFactor(angle);
}

/**
 * Catching yourself. A hand arriving slowly costs nothing; a body arriving
 * fast and stopping on it costs by the square of the speed, and twice that
 * when one hand is all there is to stop it.
 */
export function catchCost(speed: number, isHand: boolean, handsOn: number, angle: number): number {
  if (!isHand) return 0;
  const over = Math.max(0, speed - 1);
  const lonely = handsOn <= 1 ? 2 : 1;
  return PUMP.catchShock * over * over * lonely * steepFactor(angle);
}

/** Fitness from the climber's record: a little more pump to spend with every grade and every send. */
export function fitnessFor(topGrade: Grade | null, sends: number): number {
  const fromGrade = topGrade ? gradeIndex(topGrade) * 0.035 : 0;
  const fromMileage = Math.min(sends, 40) * 0.006;
  return 1 + fromGrade + fromMileage;
}

/** Fresh → Pumped → Struggling → Critical → Failure. */
export type PumpStage = 'fresh' | 'pumped' | 'struggling' | 'critical' | 'failure';

export function pumpStage(pump: number): PumpStage {
  if (pump >= 1) return 'failure';
  if (pump >= 0.78) return 'critical';
  if (pump >= 0.55) return 'struggling';
  if (pump >= 0.3) return 'pumped';
  return 'fresh';
}

/** Which way it is going, and roughly how fast. */
export type PumpTrend = 'recovering' | 'steady' | 'climbing' | 'burning';

export function pumpTrend(p: Posture): PumpTrend {
  const e = effort(p);
  if (e < PUMP.restLine * 0.75) return 'recovering';
  if (e <= PUMP.restLine * 1.15) return 'steady';
  if (e < 1.0) return 'climbing';
  return 'burning';
}

/**
 * Why. The one or two things doing most of the damage right now, in words a
 * climber would use, so the bar is never a mystery.
 */
export function pumpReason(p: Posture): string {
  if (p.grounded) return 'on the ground';
  const bits: string[] = [];
  const deg = (p.angle * 180) / Math.PI;
  if (p.hands === 1) bits.push('one hand');
  else if (p.hands === 0 && p.feet > 0) bits.push('hanging off your feet');
  if (p.hands > 0 && p.feet === 0) bits.push('feet cut');
  if (deg >= 60) bits.push('roof');
  else if (deg >= 25) bits.push('steep');
  if (p.speed > 1.1) bits.push('swinging');
  if (p.reaching) bits.push('reaching');
  if (bits.length === 0) {
    if (p.hands + p.feet >= 4 && deg < 25) return 'four on, upright';
    if (p.hands + p.feet >= 3) return 'three on';
    return 'two on';
  }
  return bits.slice(0, 2).join(', ');
}
