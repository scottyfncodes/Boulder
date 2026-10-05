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

export type ArmId = 'LH' | 'RH';
export const ARMS: readonly ArmId[] = ['LH', 'RH'] as const;

/** A foot on something, and how much of the body it can usefully take. */
export type FootSupport = {
  /**
   * 0..1 from where the foot is against the body: under the hips and in
   * reach is a foot you can stand on; up by the hips, at full stretch or
   * way out to the side is one that is only touching.
   */
  support: number;
  /** A heel or toe hook: pulls rather than stands, so it still works upside down. */
  hooked: boolean;
};

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
  /**
   * The detail the sim can give, all optional so a posture can be written by
   * hand. Which hands are on; left out, the first `hands` of LH, RH.
   */
  held?: Record<ArmId, boolean>;
  /** Hands off the wall and hanging by your side: shaking out. */
  shaking?: Record<ArmId, boolean>;
  /**
   * How much of the arms' load the left hand takes when both are on, 0..1,
   * from where the body hangs between them. Left out, half.
   */
  leftShare?: number;
  /** One entry per foot on. Left out, `feet` good feet. */
  footSupport?: FootSupport[];
};

/** One forearm. */
export type ArmPump = {
  /** 0 fresh .. 1 blown: this hand opens. */
  pump: number;
  /** The part of it that will not come back this climb. */
  floor: number;
};

export type Pump = {
  /** The bar: the more pumped forearm, 0 fresh .. 1 blown. */
  pump: number;
  /** The part of the bar that will not come back this climb. Never above `pump`. */
  floor: number;
  /** Bigger is fitter: every cost is divided by it. 1 is a new climber. */
  fitness: number;
  /** Each forearm on its own: the bar is whichever is worse. */
  arms: Record<ArmId, ArmPump>;
  /**
   * The effort each forearm is under, smoothed. Load comes on and off a
   * forearm over a moment, not in a frame, so grabbing or dropping a hold
   * bends the rate rather than snapping it. Null until the first tick.
   */
  load: Record<ArmId, number> | null;
  /** How fast the bar is moving, per second, smoothed: below zero is recovering. */
  rate: number;
};

export const PUMP = {
  /** Holding onto a wall at all: core, balance, fingers closed. */
  onWall: 0.06,
  /**
   * Feet. Good feet carry the weight off the arms: the total carried is
   * `feetMax × (1 − e^(−feetK × feet))`, where `feet` adds up each foot's
   * support times what the wall lets a foot do. One good foot carries about
   * 62%, two about 90%, and anything in between is in between.
   */
  feetMax: 1.13,
  feetK: 0.795,
  /**
   * How much a standing foot still manages on a roof, where it is pushing on
   * nothing that faces it. On a vertical wall it is all of it.
   */
  roofFeet: 0.3,
  /** Same for a hooked foot, which pulls: it loses much less upside down. */
  roofHook: 0.7,
  /** Arms never carry less than this: hands are still balancing the body. */
  armFloor: 0.1,
  /**
   * Core tension: keeping the body in to a wall that leans out over you,
   * whatever is holding it. Per unit of the sine of the angle.
   */
  core: 0.1,
  /**
   * How much the wall multiplies what a forearm carries: `1 + steepness ×
   * lean^steepCurve`, lean being the sine of the angle. Gentle off the
   * vertical, then hard: at a roof it is 1 + steepness.
   */
  steepness: 3.0,
  steepCurve: 1.6,
  /** A forearm carrying a share `s` of the body: `forearm × s²`, times the wall. */
  forearm: 2,
  /** Swinging on your arms, per (m/s)², at full arm load. */
  swing: 0.14,
  /** A limb in the air: the rest of the body is holding a position to throw from. */
  reach: 0.14,
  /**
   * Below this effort a forearm recovers; above it, it pumps. Most of a stable
   * vertical stance sits under it. Hanging off two arms does not.
   */
  restLine: 0.24,
  /** Effort above the rest line per unit of pump: how many effort-seconds fill a forearm. */
  capacity: 40,
  /** Fastest recovery, pump per second, for a forearm doing nothing on a still body. */
  recover: 0.026,
  /**
   * A hand off the wall, hanging and shaking: blood back into it. Its
   * recovery is this much faster than a hand resting on a hold — but only as
   * still as the body is, and the other arm is holding the lot meanwhile.
   */
  shake: 1.9,
  /**
   * Recovery needs the rest of you calm. While the other forearm is working
   * this far over the rest line, a forearm recovers at half speed: shaking
   * one arm out while the other is screaming on a roof barely helps.
   */
  strainHalf: 0.45,
  /** Body speed, m/s, at which recovery has halved: you cannot rest while swinging. */
  stillSpeed: 0.35,
  /** Seconds for a forearm's load to come on or off. */
  loadTau: 0.35,
  /** Seconds for the bar's rate to settle, for the readout. */
  rateTau: 0.5,
  /** Of every bit of pump gained, how much stays for the rest of the climb. */
  fatigue: 0.28,
  /** Throwing one limb at full pull, before the wall and the body are counted. */
  fling: 0.022,
  /** A full dyno, before the wall is counted. Everything leaves the wall. */
  dyno: 0.12,
  /** Catching yourself: per (m/s)² of body speed over the first bit, on two hands. */
  catchShock: 0.02,
} as const;

export function freshPump(fitness = 1): Pump {
  return {
    pump: 0, floor: 0, fitness,
    arms: { LH: { pump: 0, floor: 0 }, RH: { pump: 0, floor: 0 } },
    load: null,
    rate: 0,
  };
}

/** Which hands are on, from a posture that may only have counts. */
function heldOf(p: Posture): Record<ArmId, boolean> {
  return p.held ?? { LH: p.hands >= 1, RH: p.hands >= 2 };
}

function feetOf(p: Posture): FootSupport[] {
  return p.footSupport ?? Array.from({ length: Math.max(0, Math.min(2, p.feet)) }, () => ({ support: 1, hooked: false }));
}

/** The sine of the wall's lean, 0 vertical .. 1 roof. Smooth all the way. */
function leanOf(angle: number): number {
  return Math.sin(Math.max(0, Math.min(Math.PI / 2, angle)));
}

/** How much the wall multiplies the load on a forearm. 1 on a vertical wall. */
export function wallFactor(angle: number): number {
  return 1 + PUMP.steepness * leanOf(angle) ** PUMP.steepCurve;
}

/** What a foot can do on this wall, 0..1: all of it upright, less leaning out. */
function footWork(angle: number, hooked: boolean): number {
  const upright = Math.pow(Math.max(0, Math.cos(Math.max(0, angle))), 1.5);
  const roof = hooked ? PUMP.roofHook : PUMP.roofFeet;
  return roof + (1 - roof) * upright;
}

/**
 * How much of the body's weight the arms are carrying, 0..1. Feet are what
 * take it off them — each by how good a foot it is, and less the steeper the
 * wall — and there is no step in it: a foot that is barely on takes barely
 * anything.
 */
export function armShare(p: Pick<Posture, 'angle' | 'hands' | 'feet' | 'footSupport'>): number {
  if (p.hands <= 0) return 0;
  let feet = 0;
  for (const f of feetOf(p as Posture)) feet += Math.max(0, Math.min(1, f.support)) * footWork(p.angle, f.hooked);
  const carried = PUMP.feetMax * (1 - Math.exp(-PUMP.feetK * feet));
  return Math.max(PUMP.armFloor, 1 - carried);
}

/** How still the body is, 0..1: 1 standing still, a half at `stillSpeed`. */
export function stillness(speed: number): number {
  const k = speed / PUMP.stillSpeed;
  return 1 / (1 + k * k);
}

/**
 * Effort on each forearm, per second, from a posture.
 *
 * A hand on carries its share of what the arms carry, squared — two hands
 * sharing a load is half the cost of one hand holding it, per hand a quarter
 * — times the wall. Every hand on also pays for being on the wall at all,
 * keeping the body in to it, swinging, and holding still while another limb
 * is in the air. A hand off the wall pays almost nothing: that is the
 * shakeout. Hanging off your feet alone is core work, which the arms feel a
 * little of.
 */
export function armEfforts(p: Posture): Record<ArmId, number> {
  if (p.grounded) return { LH: 0, RH: 0 };
  const lean = leanOf(p.angle);
  const wall = wallFactor(p.angle);
  const held = heldOf(p);
  const on = (held.LH ? 1 : 0) + (held.RH ? 1 : 0);
  const arms = armShare({ ...p, hands: on });
  const left = on === 2 ? Math.max(0, Math.min(1, p.leftShare ?? 0.5)) : held.LH ? 1 : 0;
  const share: Record<ArmId, number> = { LH: left, RH: on === 2 ? 1 - left : held.RH ? 1 : 0 };
  const swing = PUMP.swing * Math.min(p.speed, 3) ** 2;
  const reach = p.reaching ? PUMP.reach * wall : 0;
  const hooksOnly = on === 0 && feetOf(p).length > 0 ? 0.35 * wall : 0;
  const out = { LH: 0, RH: 0 } as Record<ArmId, number>;
  for (const a of ARMS) {
    if (held[a]) {
      const load = share[a] * arms;
      out[a] = PUMP.onWall + PUMP.core * lean + PUMP.forearm * load * load * wall
        + swing * (0.5 + 0.5 * arms) + reach;
    } else {
      // Off the wall: hanging, or in the air. The body's tension still
      // reaches it a little.
      out[a] = 0.5 * PUMP.core * lean + 0.4 * swing + 0.3 * hooksOnly;
    }
  }
  return out;
}

/** Effort on the harder-worked forearm: the one that decides how this goes. */
export function effort(p: Posture): number {
  const e = armEfforts(p);
  return Math.max(e.LH, e.RH);
}

/**
 * How fast one forearm's pump moves under an effort, per second. Above the
 * rest line it fills; below it, it drains — faster the further below, only as
 * still as the body is, faster again for a hand that is off and shaking, and
 * slower the deeper the pump already is. The two meet at zero at the rest
 * line, so there is no step anywhere.
 */
export function armRate(
  e: number, pump: number, still: number, shaking: boolean, fitness = 1, other = 0,
): number {
  if (e >= PUMP.restLine) return (e - PUMP.restLine) / PUMP.capacity / fitness;
  const below = (PUMP.restLine - e) / PUMP.restLine;
  const depth = 0.3 + 0.7 * (1 - pump);
  const calm = 1 / (1 + Math.max(0, other - PUMP.restLine) / PUMP.strainHalf);
  return -PUMP.recover * below * depth * still * calm * (shaking ? 1 + (PUMP.shake - 1) * still : 1) * fitness;
}

/** The other forearm. */
function otherArm(a: ArmId): ArmId {
  return a === 'LH' ? 'RH' : 'LH';
}

/**
 * The bar's rate in a posture held for long enough that the loads have
 * settled, at a given pump: what a posture is worth, per second. Negative is
 * a rest.
 */
export function restRate(p: Posture, pump = 0.4, fitness = 1): number {
  const e = armEfforts(p);
  const still = stillness(p.speed);
  const shaking = p.shaking ?? { LH: false, RH: false };
  const r = ARMS.map((a) => armRate(e[a], pump, still, shaking[a], fitness, e[otherArm(a)]));
  // Both arms start level; the bar follows the one going the wrong way faster.
  return Math.max(r[0], r[1]);
}

/** Advances the pump by `dt` seconds of holding `posture`. */
export function tickPump(state: Pump, posture: Posture, dt: number): Pump {
  if (dt <= 0) return state;
  const target = armEfforts(posture);
  const k = 1 - Math.exp(-dt / PUMP.loadTau);
  const load = state.load
    ? { LH: state.load.LH + (target.LH - state.load.LH) * k, RH: state.load.RH + (target.RH - state.load.RH) * k }
    : target;
  const still = stillness(posture.speed);
  const shaking = posture.shaking ?? { LH: false, RH: false };
  const arms = { ...state.arms };
  for (const a of ARMS) {
    const arm = state.arms[a];
    const r = armRate(load[a], arm.pump, still, shaking[a], state.fitness, load[otherArm(a)]);
    if (r > 0) {
      const pump = Math.min(1, arm.pump + r * dt);
      arms[a] = { pump, floor: Math.min(pump, arm.floor + r * dt * PUMP.fatigue) };
    } else {
      // Never below zero, and never below what the climb has cost for good.
      arms[a] = { ...arm, pump: Math.max(arm.floor, Math.max(0, arm.pump + r * dt)) };
    }
  }
  const next = settleBar({ ...state, arms, load });
  const instant = (next.pump - state.pump) / dt;
  const rate = state.rate + (instant - state.rate) * (1 - Math.exp(-dt / PUMP.rateTau));
  return { ...next, rate };
}

/** The bar is the worse forearm. */
function settleBar(state: Pump): Pump {
  const worse = state.arms.RH.pump > state.arms.LH.pump ? state.arms.RH : state.arms.LH;
  return { ...state, pump: worse.pump, floor: Math.min(worse.pump, Math.max(state.arms.LH.floor, state.arms.RH.floor)) };
}

/** Adds pump to both forearms, or to one; some of it for good. */
export function gain(state: Pump, amount: number, arm?: ArmId): Pump {
  if (amount <= 0) return state;
  const a = amount / state.fitness;
  const arms = { ...state.arms };
  for (const id of arm ? [arm] : ARMS) {
    const pump = Math.min(1, arms[id].pump + a);
    arms[id] = { pump, floor: Math.min(pump, arms[id].floor + a * PUMP.fatigue) };
  }
  return settleBar({ ...state, arms });
}

/** Forearms that have nothing left: those hands open. */
export function blownArms(state: Pump): ArmId[] {
  return ARMS.filter((a) => state.arms[a].pump >= 1);
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
 * Catching yourself. `speed` is the body's, not the hand's: a hand arriving
 * on a still body costs nothing, a body arriving fast and stopping on it costs
 * by the square of the speed, and twice that when one hand is all there is to
 * stop it.
 */
export function catchCost(speed: number, isHand: boolean, handsOn: number, angle: number): number {
  if (!isHand) return 0;
  const over = Math.max(0, speed - 0.8);
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

/** From how fast the bar is actually moving, smoothed: what the player sees it do. */
export function pumpTrend(state: Pump): PumpTrend {
  if (state.rate < -0.002) return 'recovering';
  if (state.rate <= 0.002) return 'steady';
  if (state.rate < 0.02) return 'climbing';
  return 'burning';
}

/**
 * Why. The one or two things doing most of the damage right now — or, when
 * it is coming down, what is making it come down — in words a climber would
 * use, so the bar is never a mystery.
 */
export function pumpReason(p: Posture, trend?: PumpTrend): string {
  if (p.grounded) return 'on the ground';
  const deg = (p.angle * 180) / Math.PI;
  const shaking = p.shaking && (p.shaking.LH || p.shaking.RH);
  if (trend === 'recovering') {
    if (shaking) return 'shaking out';
    if (armShare(p) < 0.4) return 'weight on your feet';
    return 'resting';
  }
  const bits: string[] = [];
  if (shaking && p.hands === 1) bits.push('one arm holding it all');
  else if (p.hands === 1) bits.push('one hand');
  else if (p.hands === 0 && p.feet > 0) bits.push('hanging off your feet');
  if (p.hands > 0 && armShare(p) > 0.75) bits.push(p.feet === 0 ? 'feet cut' : 'feet doing nothing');
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
