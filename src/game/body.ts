import type { Contact, LimbId, Pose, Vec2 } from './types';
import { isHand, isLeft } from './types';
import { add, clamp, clamp01, dist, len, lerp, norm, scale, sub, v } from './vec';

/**
 * The body model.
 *
 * Two particles — hip and shoulder — joined by a rigid torso, each pulled down
 * by gravity and held up by whichever limbs are on holds. Relaxation runs a
 * fixed number of iterations with no randomness anywhere, so the same set of
 * contacts always resolves to the same pose. That is the whole contract the
 * rest of the game depends on: if you repeat a move from a state, you get the
 * same answer.
 *
 * The interesting consequence is that limbs are coupled. Standing a foot up
 * raises the hip, which raises the shoulder, which is what puts the next hand
 * hold in range. Sequencing puzzles fall out of the solver rather than being
 * authored.
 */

export const BODY = {
  torso: 0.52,
  arm: 0.74,
  leg: 0.86,
  head: 0.24,
  /** Half-width of the shoulders and hips; makes crossing over cost reach. */
  shoulderHalf: 0.17,
  hipHalf: 0.11,
  /** Downward drift applied per relaxation step. */
  gravity: 0.011,
  iterations: 64,
} as const;

/** Extra stretch a limb can find beyond its comfortable length, at a cost. */
export const OVERREACH = 1.12;

/** How straight a leg goes when the climber stands on it. */
const STAND_FRACTION = 0.9;
/** How hard the leg pushes back. Comfortably beats gravity, so feet win. */
const STAND_STIFFNESS = 0.55;
/**
 * How hard the climber pulls toward a commanded hip position. Beats gravity —
 * you can haul your hips up and across if your arms and feet allow it — but
 * stays below the limb constraints, which are not negotiable.
 */
const SHIFT_STIFFNESS = 0.16;
/**
 * Gravity's righting moment. A body hanging or standing off to one side of its
 * support gets pulled back over it — a slack arm has no tension to hold you out
 * there, and weight out past your feet either comes back or takes you off the
 * wall. Without this the model treats every displaced position as a free
 * equilibrium, so letting go of a shift would leave the climber hanging out in
 * space with nothing holding them there.
 */
const RESTORE_STIFFNESS = 0.055;
/** Sideways offset a foot can carry weight from without the hips moving over. */
const STANCE_WIDTH = 0.42;
/** Furthest the torso tips from vertical, radians. */
const MAX_LEAN = 0.7;
/** Constraint-only passes run after the main relaxation to guarantee feasibility. */
const SETTLE_ITERATIONS = 10;

const FLOOR_Y = 0;

/** Where a limb swings from: shoulders for hands, hips for feet. */
export function anchorFor(limb: LimbId, hip: Vec2, shoulder: Vec2): Vec2 {
  const axis = norm(sub(shoulder, hip));
  // Perpendicular to the torso, pointing right when the climber is upright.
  const side = v(axis.y, -axis.x);
  const sign = isLeft(limb) ? -1 : 1;
  return isHand(limb)
    ? add(shoulder, scale(side, sign * BODY.shoulderHalf))
    : add(hip, scale(side, sign * BODY.hipHalf));
}

export function limbLength(limb: LimbId): number {
  return isHand(limb) ? BODY.arm : BODY.leg;
}

/** Comfortable reach, before the stretchy overreach allowance. */
export function reachOf(limb: LimbId): number {
  return limbLength(limb);
}

/** Absolute furthest a limb can be thrown, past which it simply cannot arrive. */
export function maxReachOf(limb: LimbId): number {
  return limbLength(limb) * OVERREACH;
}

/** Pulls `p` toward `anchor` until it is within `max` of it. */
function constrainMax(p: Vec2, anchor: Vec2, max: number, stiffness: number): void {
  const d = sub(p, anchor);
  const l = len(d);
  if (l <= max || l < 1e-9) return;
  const pull = (l - max) * stiffness;
  p.x -= (d.x / l) * pull;
  p.y -= (d.y / l) * pull;
}

/** Holds two points at exactly `target` apart, moving both halfway. */
function enforceRigid(a: Vec2, b: Vec2, target: number): void {
  const d = sub(b, a);
  const l = len(d);
  if (l < 1e-9) {
    b.y = a.y + target;
    return;
  }
  const corr = (l - target) / 2;
  const ux = (d.x / l) * corr;
  const uy = (d.y / l) * corr;
  a.x += ux; a.y += uy;
  b.x -= ux; b.y -= uy;
}

export type BodyInput = {
  contacts: Contact[];
  /** Previous pose, used as the relaxation seed so poses move continuously. */
  seedHip: Vec2;
  seedShoulder: Vec2;
  /** True while the climber may still stand on the mat. */
  onMat?: boolean;
  /**
   * Where the player has asked the hips to be. The climber pulls toward it and
   * the limb constraints then have the final say, so a commanded position you
   * cannot physically hold simply resolves to the closest one you can.
   * Null means hang wherever gravity and the contacts put you.
   */
  shift?: Vec2 | null;
};

/**
 * Resolves hip and shoulder against the current contacts. Deterministic:
 * fixed iteration count, no randomness, no time input.
 */
export function solvePose(input: BodyInput): Pose {
  const hip: Vec2 = { x: input.seedHip.x, y: input.seedHip.y };
  const sh: Vec2 = { x: input.seedShoulder.x, y: input.seedShoulder.y };

  const hands = input.contacts.filter((c) => isHand(c.limb));
  const feet = input.contacts.filter((c) => !isHand(c.limb));

  const shift = input.shift ?? null;

  for (let i = 0; i < BODY.iterations; i++) {
    hip.y -= BODY.gravity;
    sh.y -= BODY.gravity;

    // Gravity rights the body over whatever is holding it up.
    if (input.contacts.length > 0) {
      let sx = 0;
      let sw = 0;
      for (const c of input.contacts) {
        const w = isHand(c.limb) ? 1 : 1.4; // feet define the base you stand on
        sx += c.pos.x * w;
        sw += w;
      }
      const restore = (sx / sw - hip.x) * RESTORE_STIFFNESS;
      hip.x += restore;
      sh.x += restore * 0.7;
    }

    // Pull toward the commanded position before the constraints run, so the
    // limbs get the last word on how much of it is actually achievable.
    if (shift) {
      hip.x += (shift.x - hip.x) * SHIFT_STIFFNESS;
      hip.y += (shift.y - hip.y) * SHIFT_STIFFNESS;
      sh.x += (shift.x - sh.x) * SHIFT_STIFFNESS * 0.5;
    }

    // Feet on the mat stop the hip sinking through the floor.
    if (input.onMat && feet.length === 0) {
      const minHip = FLOOR_Y + BODY.leg * 0.82;
      if (hip.y < minHip) hip.y = minHip;
    }

    // Every limb is solved against the *same* body position and the results are
    // averaged, rather than each one moving the body before the next one looks.
    // Solving them in sequence makes the answer depend on the order the limbs
    // happen to be stored in, which tilts a perfectly symmetric stance by
    // twenty degrees and looks like a bug because it is one.
    let hipDX = 0, hipDY = 0, hipN = 0;
    for (const c of feet) {
      const a = anchorFor(c.limb, hip, sh);
      const off = sub(a, hip);
      const target: Vec2 = { x: a.x, y: a.y };
      // A leg is a strut, not a string. It stops the hip dropping away from the
      // hold, and it pushes the hip up until the leg is nearly straight — which
      // is what standing on a foothold is.
      constrainMax(target, c.pos, BODY.leg, 1);

      // How much of the climber's weight this foot can actually take. Anything
      // inside a normal stance width is free; past that the hips have to travel
      // across to the foot before it holds anything, which is the whole reason
      // a flag or a rockover is a move you have to plan rather than a freebie.
      const spread = Math.abs(target.x - c.pos.x);
      const over = clamp01(1 - Math.max(0, spread - STANCE_WIDTH) / 0.5);
      const support = clamp(c.grip, 0, 1) * over;
      const stand = BODY.leg * STAND_FRACTION * support;

      const d = sub(target, c.pos);
      const l = len(d);
      if (l < stand) {
        // Above the foot, extend along the leg. At or below it, the climber is
        // rocking onto a high step, so the push goes straight up.
        const dir = l > 1e-6 && d.y > 0.02 ? { x: d.x / l, y: d.y / l } : { x: 0, y: 1 };
        const push = (stand - l) * STAND_STIFFNESS;
        target.x += dir.x * push;
        target.y += dir.y * push;
      }
      hipDX += target.x - off.x - hip.x;
      hipDY += target.y - off.y - hip.y;
      hipN++;
    }
    if (hipN > 0) {
      hip.x += (hipDX / hipN) * 0.9;
      hip.y += (hipDY / hipN) * 0.9;
    }

    let shDX = 0, shDY = 0, shN = 0;
    for (const c of hands) {
      const a = anchorFor(c.limb, hip, sh);
      const off = sub(a, sh);
      const target: Vec2 = { x: a.x, y: a.y };
      constrainMax(target, c.pos, BODY.arm, 1);
      shDX += target.x - off.x - sh.x;
      shDY += target.y - off.y - sh.y;
      shN++;
    }
    if (shN > 0) {
      sh.x += (shDX / shN) * 0.9;
      sh.y += (shDY / shN) * 0.9;
    }

    enforceRigid(hip, sh, BODY.torso);

    // The climber does not invert, and does not lie down either. Torque can
    // twist the body a long way — that is the barn door, and it should look
    // alarming — but past about forty degrees it stops reading as a climber
    // fighting a swing and starts reading as a dropped puppet.
    const tx = sh.x - hip.x;
    const ty = sh.y - hip.y;
    if (Math.abs(Math.atan2(tx, ty)) > MAX_LEAN) {
      const mid = { x: (hip.x + sh.x) / 2, y: (hip.y + sh.y) / 2 };
      const capped = Math.sign(tx) * MAX_LEAN;
      const dx = Math.sin(capped) * BODY.torso;
      const dy = Math.cos(capped) * BODY.torso;
      hip.x = mid.x - dx / 2; hip.y = mid.y - dy / 2;
      sh.x = mid.x + dx / 2; sh.y = mid.y + dy / 2;
    }
  }

  // The rigid torso and the lean clamp both run after the limb constraints and
  // can nudge the body back out of range, so the pose is settled against the
  // constraints alone at the end. Without this a hard enough shift command can
  // out-pull an arm and leave a hand further from its hold than an arm is long.
  for (let i = 0; i < SETTLE_ITERATIONS; i++) {
    for (const c of feet) {
      const a = anchorFor(c.limb, hip, sh);
      const off = sub(a, hip);
      const target: Vec2 = { x: a.x, y: a.y };
      constrainMax(target, c.pos, BODY.leg, 1);
      hip.x += target.x - off.x - hip.x;
      hip.y += target.y - off.y - hip.y;
    }
    for (const c of hands) {
      const a = anchorFor(c.limb, hip, sh);
      const off = sub(a, sh);
      const target: Vec2 = { x: a.x, y: a.y };
      constrainMax(target, c.pos, BODY.arm, 1);
      sh.x += target.x - off.x - sh.x;
      sh.y += target.y - off.y - sh.y;
    }
    enforceRigid(hip, sh, BODY.torso);
  }

  const axis = norm(sub(sh, hip));
  const lean = Math.atan2(axis.x, axis.y);
  const head = add(sh, scale(axis, BODY.head));
  // Centre of mass sits low in the torso — legs are heavy and usually hanging.
  const com = lerp(hip, sh, 0.34);

  const { tension, stability, barnDoor } = analyseStance(input.contacts, com);

  return { hip, shoulder: sh, head, com, lean, tension, stability, barnDoor };
}

/** Below this the climber comes off the wall. */
export const FALL_THRESHOLD = 0.3;

export type Stance = { tension: number; stability: number; barnDoor: number };

/**
 * Scores how composed a stance is and how close it is to spitting the climber
 * off. Two things dominate: whether any foot is actually taking weight, and
 * whether the centre of mass has drifted off the line the contacts make. The
 * second one is the barn door — hold the wall with a left hand and a left foot
 * and your right side swings out into the room.
 */
export function analyseStance(contacts: Contact[], com: Vec2): Stance {
  if (contacts.length === 0) return { tension: 0, stability: 0, barnDoor: 0 };

  const feet = contacts.filter((c) => !isHand(c.limb));

  // Weighted contact security. Hands carry more of the load than feet do.
  let secNum = 0;
  let secDen = 0;
  for (const c of contacts) {
    const w = isHand(c.limb) ? 1 : 0.75;
    secNum += c.grip * w;
    secDen += w;
  }
  const security = secDen > 0 ? secNum / secDen : 0;

  // Feet only carry weight when the centre of mass is somewhere over them.
  let footQ = 0;
  if (feet.length > 0) {
    const fx = feet.reduce((s, c) => s + c.pos.x, 0) / feet.length;
    const fy = feet.reduce((s, c) => s + c.pos.y, 0) / feet.length;
    const over = clamp01(1 - Math.abs(com.x - fx) / 0.75);
    // Feet above the hips are not standing on anything.
    const below = clamp01(1 - clamp01((fy - com.y) / 0.5));
    const grip = feet.reduce((s, c) => s + c.grip, 0) / feet.length;
    footQ = over * below * grip * (feet.length > 1 ? 1 : 0.82);
  }

  // Barn door: how far the centre of mass sits off the contacts' own axis,
  // amplified when the contacts are nearly in a line to begin with.
  const cx = contacts.reduce((s, c) => s + c.pos.x, 0) / contacts.length;
  const cy = contacts.reduce((s, c) => s + c.pos.y, 0) / contacts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const c of contacts) {
    const dx = c.pos.x - cx;
    const dy = c.pos.y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const n = contacts.length;
  sxx /= n; syy /= n; sxy /= n;
  // Principal axis of the contact cloud.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const axis = v(Math.cos(theta), Math.sin(theta));
  const perp = v(-axis.y, axis.x);
  const spreadPerp = Math.sqrt(
    Math.max(sxx * perp.x * perp.x + 2 * sxy * perp.x * perp.y + syy * perp.y * perp.y, 0),
  );
  const off = (com.x - cx) * perp.x + (com.y - cy) * perp.y;
  // A wide cloud resists rotation; a colinear one does not.
  const colinearity = clamp01(1 - spreadPerp / 0.42);
  const barnDoor = off * colinearity;

  const BARN_LIMIT = 0.62;
  const barnPenalty = clamp01(Math.abs(barnDoor) / BARN_LIMIT);

  const countFactor = n >= 4 ? 1 : n === 3 ? 0.94 : n === 2 ? 0.76 : 0.34;

  const stability = clamp01(
    security * (0.52 + 0.48 * footQ) * (1 - 0.85 * barnPenalty) * countFactor,
  );

  const tension = clamp01(0.45 * stability + 0.4 * footQ + 0.15 * security);

  return { tension, stability, barnDoor };
}

/** Starting guess for the relaxation when a climber first pulls on. */
export function seedPoseFor(contacts: Contact[]): { hip: Vec2; shoulder: Vec2 } {
  if (contacts.length === 0) return { hip: v(0, 1), shoulder: v(0, 1 + BODY.torso) };
  const cx = contacts.reduce((s, c) => s + c.pos.x, 0) / contacts.length;
  const hands = contacts.filter((c) => isHand(c.limb));
  const feet = contacts.filter((c) => !isHand(c.limb));

  // Start standing on the highest foot if there is one, otherwise hanging.
  let hipY: number;
  if (feet.length > 0) {
    hipY = Math.max(...feet.map((c) => c.pos.y)) + BODY.leg * STAND_FRACTION;
  } else {
    hipY = Math.min(...hands.map((c) => c.pos.y)) - BODY.arm - BODY.torso * 0.6;
  }
  if (hands.length > 0) {
    // Arms cannot be longer than they are: keep the shoulder in range.
    const handY = hands.reduce((s, c) => s + c.pos.y, 0) / hands.length;
    hipY = Math.min(hipY, handY + BODY.arm - BODY.torso);
  }
  return { hip: v(cx, hipY), shoulder: v(cx, hipY + BODY.torso) };
}

/** True once a limb is far enough from its anchor that it cannot arrive. */
export function outOfReach(limb: LimbId, anchor: Vec2, target: Vec2): boolean {
  return dist(anchor, target) > maxReachOf(limb) + 1e-6;
}
