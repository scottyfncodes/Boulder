import type { Contact, LimbId, MoveGrade, Pose, Vec2 } from '../game/types';
import { LIMBS, isHand, isLeft } from '../game/types';
import { anchorFor, BODY } from '../game/body';
import type { MoveResult } from '../game/move';
import type { Mood } from './climber';

/**
 * Turns a resolved move into motion.
 *
 * The sim only ever produces two things: the state before and the state after.
 * Everything between them is this file's problem — throwing the limb, letting
 * the body catch up, and, when it has gone wrong, the flailing.
 *
 * The rule the comedy has to obey: exaggerate the reaction, never the cause.
 * A limb that missed always visibly travels to where the player actually aimed
 * it, so a player watching a spectacular failure can still see the mistake that
 * produced it.
 */

export type Frame = {
  pose: Pose;
  limbs: Record<LimbId, Vec2>;
  mood: Mood;
  /** True once nothing is moving and input can be handed back. */
  done: boolean;
};

export type LimbMap = Record<LimbId, Vec2>;

const THROW_MS = 260;
const SETTLE_MS = 300;
const FLAIL_MS = 420;
const FALL_MS = 2100;

/**
 * Where a limb hangs when it is not holding anything.
 *
 * Dead weight. A limb off the wall is not held anywhere, it is not tucked in
 * and it is not braced — it hangs from the shoulder or hip at almost full
 * length, points at the floor, and swings on its own slow pendulum. The player
 * is dragging this body up the wall; it is not helping.
 */
export function danglePos(limb: LimbId, pose: Pose, t = 0): Vec2 {
  const anchor = anchorFor(limb, pose.hip, pose.shoulder);
  // Nearly straight, because nothing is holding it bent.
  const length = (isHand(limb) ? BODY.arm : BODY.leg) * 0.96;
  const side = isLeft(limb) ? -1 : 1;
  // Two swings of different periods, so it never looks like it is on a timer.
  const sway = Math.sin(t * 0.0026 + (isLeft(limb) ? 0 : 1.7)) * 0.13
    + Math.sin(t * 0.0071 + (isHand(limb) ? 0 : 2.3)) * 0.05;
  const outward = side * (isHand(limb) ? 0.1 : 0.14) + sway;
  const angle = -Math.PI / 2 + outward;
  return {
    x: anchor.x + Math.cos(angle) * length,
    y: anchor.y + Math.sin(angle) * length,
  };
}

/** Current position of every limb for a settled state. */
export function limbsFor(contacts: Contact[], pose: Pose, t = 0): LimbMap {
  const map = {} as LimbMap;
  for (const limb of LIMBS) {
    const c = contacts.find((x) => x.limb === limb);
    map[limb] = c ? { ...c.pos } : danglePos(limb, pose, t);
  }
  return map;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Interpolates a pose by moving hip and shoulder and rederiving the rest. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const hip = lerpV(a.hip, b.hip, t);
  const shoulder = lerpV(a.shoulder, b.shoulder, t);
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  const l = Math.max(Math.hypot(dx, dy), 1e-5);
  return {
    hip,
    shoulder,
    head: { x: shoulder.x + (dx / l) * BODY.head, y: shoulder.y + (dy / l) * BODY.head },
    com: { x: lerp(hip.x, shoulder.x, 0.34), y: lerp(hip.y, shoulder.y, 0.34) },
    lean: Math.atan2(dx, dy),
    tension: lerp(a.tension, b.tension, t),
    stability: lerp(a.stability, b.stability, t),
    barnDoor: lerp(a.barnDoor, b.barnDoor, t),
  };
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** Slight overshoot — the body arrives, then agrees to have arrived. */
const easeBack = (t: number): number => {
  const c = 1.34;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

function moodFor(grade: MoveGrade, fell: boolean, stability: number): Mood {
  if (fell) return 'shocked';
  if (grade === 'YEET') return 'shocked';
  if (grade === 'MISS') return 'astonished';
  if (grade === 'SCRAPE') return 'surprised';
  return stability < 0.4 ? 'surprised' : stability < 0.62 ? 'impressed' : 'keen';
}

/**
 * The resting face, from how hard the climber is actually working: how solid
 * the stance is and how much is left in the tank. This is the only strain
 * readout the game gives — no coloured lines, no bars over the limbs.
 */
export function idleMood(stability: number, endurance: number): Mood {
  // The harder it is, the more amazed he is that it is happening.
  const effort = Math.max(1 - stability, 1 - endurance);
  if (effort > 0.78) return 'astonished';
  if (effort > 0.6) return 'surprised';
  if (effort > 0.4) return 'impressed';
  if (effort > 0.22) return 'keen';
  return 'calm';
}

/**
 * A move in progress. Built once when the move resolves, then sampled by the
 * render loop until it reports done.
 */
export class MoveAnimation {
  private readonly fromPose: Pose;
  private readonly fromLimbs: LimbMap;
  private readonly result: MoveResult;
  private readonly limb: LimbId;
  private readonly total: number;
  private readonly flails: boolean;

  constructor(fromPose: Pose, fromLimbs: LimbMap, limb: LimbId, result: MoveResult) {
    this.fromPose = fromPose;
    this.fromLimbs = { ...fromLimbs };
    this.limb = limb;
    this.result = result;
    this.flails = result.grade === 'MISS' || result.grade === 'YEET' || result.popped.length > 0;
    this.total =
      THROW_MS + SETTLE_MS
      + (this.flails ? FLAIL_MS : 0)
      + (result.fell ? FALL_MS : 0);
  }

  get durationMs(): number {
    return this.total;
  }

  sample(elapsed: number): Frame {
    const r = this.result;
    const toPose = r.next.pose;
    const settled = limbsFor(r.next.contacts, toPose, elapsed);

    // --- 1. the throw ----------------------------------------------------
    if (elapsed < THROW_MS) {
      const t = easeOut(elapsed / THROW_MS);
      const limbs = { ...this.fromLimbs };
      limbs[this.limb] = arc(this.fromLimbs[this.limb], r.landing, t, 0.16);
      // The body barely moves yet — it is about to find out what happened.
      const pose = lerpPose(this.fromPose, toPose, t * 0.18);
      for (const l of LIMBS) {
        if (l === this.limb) continue;
        if (!r.next.contacts.some((c) => c.limb === l)) limbs[l] = danglePos(l, pose, elapsed);
      }
      return { pose, limbs, mood: 'keen', done: false };
    }

    // --- 2. the body catches up -----------------------------------------
    const afterThrow = elapsed - THROW_MS;
    if (afterThrow < SETTLE_MS) {
      const t = easeBack(Math.min(afterThrow / SETTLE_MS, 1));
      const pose = lerpPose(this.fromPose, toPose, Math.min(t, 1.12));
      const limbs = {} as LimbMap;
      for (const l of LIMBS) {
        const target = l === this.limb && !r.holdId ? r.landing : settled[l];
        limbs[l] = lerpV(this.fromLimbs[l], target, easeInOut(Math.min(afterThrow / SETTLE_MS, 1)));
      }
      if (r.holdId !== null) limbs[this.limb] = settled[this.limb];
      return {
        pose, limbs,
        mood: moodFor(r.grade, false, toPose.stability),
        done: false,
      };
    }

    // --- 3. the flail ----------------------------------------------------
    const afterSettle = afterThrow - SETTLE_MS;
    if (this.flails && afterSettle < FLAIL_MS) {
      const t = afterSettle / FLAIL_MS;
      const pose = toPose;
      const limbs = { ...settled };
      // Anything not holding on swings through and hunts for the wall.
      for (const l of LIMBS) {
        if (r.next.contacts.some((c) => c.limb === l)) continue;
        const rest = danglePos(l, pose, elapsed);
        const swing = Math.sin(t * Math.PI * 2.4) * (1 - t) * (r.grade === 'YEET' ? 0.34 : 0.18);
        limbs[l] = { x: rest.x + swing, y: rest.y + Math.abs(swing) * 0.42 };
      }
      return {
        pose, limbs,
        mood: r.fell ? 'shocked' : moodFor(r.grade, false, toPose.stability),
        done: false,
      };
    }

    // --- 4. and off ------------------------------------------------------
    const afterFlail = afterSettle - (this.flails ? FLAIL_MS : 0);
    if (r.fell && afterFlail < FALL_MS) {
      const t = Math.min(afterFlail / FALL_MS, 1);
      // Gravity wins, eventually. The fall is deliberately slower than real
      // gravity and takes a long lazy tumble on the way, because the joke is
      // the hang time — a fast fall is over before it is funny.
      const drop = 4.9 * (t * 0.62) ** 2 * 0.5;
      // Tumbling, not toppling. Nothing is trying to land this.
      const tip = Math.sin(t * 3.1) * 1.25 * Math.sign(toPose.barnDoor || 1);
      const floor = 0.42;
      const hipY = Math.max(toPose.hip.y - drop, floor);
      const pose: Pose = {
        ...toPose,
        hip: { x: toPose.hip.x + tip * 0.3, y: hipY },
        shoulder: {
          x: toPose.hip.x + tip * 0.3 + Math.sin(tip) * BODY.torso,
          y: hipY + Math.cos(tip) * BODY.torso,
        },
        head: {
          x: toPose.hip.x + tip * 0.3 + Math.sin(tip) * (BODY.torso + BODY.head),
          y: hipY + Math.cos(tip) * (BODY.torso + BODY.head),
        },
        lean: tip,
        stability: 0,
      };
      const limbs = {} as LimbMap;
      for (const l of LIMBS) {
        const rest = danglePos(l, pose, elapsed);
        // Full windmill. All four, out of phase, for the entire descent.
        // All four trail behind the body rather than windmilling under their
        // own power — the difference between a climber falling and a mannequin
        // being dropped.
        const trail = Math.sin(t * Math.PI * 4.2 + (isLeft(l) ? 0 : 2.1) + (isHand(l) ? 0 : 1.1))
          * 0.5 * (1 - t * 0.25);
        limbs[l] = { x: rest.x + trail, y: rest.y + Math.abs(trail) * 0.3 + t * 0.22 };
      }
      return { pose, limbs, mood: t > 0.86 ? 'dazed' : 'whooping', done: false };
    }

    // --- rest -------------------------------------------------------------
    return {
      pose: r.fell ? this.restingPose(toPose) : toPose,
      limbs: r.fell ? this.restingLimbs(toPose) : settled,
      mood: r.fell ? 'dazed' : r.grade === 'PERFECT' ? 'delighted' : 'calm',
      done: true,
    };
  }

  private restingPose(from: Pose): Pose {
    const hipY = 0.42;
    const tip = Math.sign(from.barnDoor || 1) * 1.15;
    return {
      ...from,
      hip: { x: from.hip.x, y: hipY },
      shoulder: { x: from.hip.x + Math.sin(tip) * BODY.torso, y: hipY + Math.cos(tip) * BODY.torso },
      head: {
        x: from.hip.x + Math.sin(tip) * (BODY.torso + BODY.head),
        y: hipY + Math.cos(tip) * (BODY.torso + BODY.head),
      },
      lean: tip,
      stability: 0,
    };
  }

  private restingLimbs(from: Pose): LimbMap {
    const pose = this.restingPose(from);
    const map = {} as LimbMap;
    for (const l of LIMBS) map[l] = danglePos(l, pose, 0);
    return map;
  }
}

/** Travels between two points along a shallow arc, the way a thrown limb does. */
function arc(from: Vec2, to: Vec2, t: number, height: number): Vec2 {
  const x = lerp(from.x, to.x, t);
  const y = lerp(from.y, to.y, t);
  return { x, y: y + Math.sin(t * Math.PI) * height };
}
