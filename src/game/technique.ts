import type { Hold, LimbId, Vec2 } from './types';
import { LIMBS, isHand, isLeft } from './types';

/**
 * Technique, read off the body.
 *
 * Nothing here is a special move with a button. A drop knee is what a foot
 * level with the hips and out to the side is on a steep wall; a flag is a
 * free leg pressed against the wall on the far side of the weight; a squeeze
 * is two hands on holds that face each other. The sim reads this every step
 * and the forces change because of it — a drop knee lets a foot carry weight
 * on steep ground, a squeeze lets a hand point its force into a hold that
 * gravity alone would peel it off, a flag stops the barn door. So each one
 * solves the physical problem it solves in real climbing, and only where the
 * wall and the holds allow it.
 */

export type TechniqueId =
  | 'flag' | 'smear' | 'dropKnee' | 'heelHook' | 'toeHook' | 'highStep'
  | 'mantle' | 'gaston' | 'undercling' | 'sidepull' | 'pinch'
  | 'compression' | 'match' | 'stem' | 'cutLoose';

export const TECHNIQUE_LABEL: Record<TechniqueId | 'deadpoint' | 'footSwap', string> = {
  flag: 'Flag',
  smear: 'Smear',
  dropKnee: 'Drop knee',
  heelHook: 'Heel hook',
  toeHook: 'Toe hook',
  highStep: 'High step',
  mantle: 'Mantle',
  gaston: 'Gaston',
  undercling: 'Undercling',
  sidepull: 'Sidepull',
  pinch: 'Pinch',
  compression: 'Compression',
  match: 'Match',
  stem: 'Stem',
  cutLoose: 'Cut loose',
  deadpoint: 'Deadpoint',
  footSwap: 'Foot swap',
};

/** What the detector needs to know about the body. */
export type TechLimb = {
  pos: Vec2;
  phase: 'held' | 'flying' | 'free';
  holdId: number | null;
  hooked?: boolean;
  flag?: boolean;
};

export type TechBody = {
  hip: Vec2;
  shoulder: Vec2;
  limbs: Record<LimbId, TechLimb>;
};

export type TechReading = {
  /** Every technique the body is doing right now. */
  active: TechniqueId[];
  /** A force the climber can push a hold against, per limb: a squeeze or a stem. */
  opposition: Partial<Record<LimbId, Vec2>>;
  /** Feet turned in on a steep wall, carrying weight they otherwise could not. */
  dropKnee: Partial<Record<LimbId, boolean>>;
  /** Hands pressing down on top of their hold. */
  mantle: Partial<Record<LimbId, boolean>>;
  /** A flagged leg, and how much it is countering the barn door, 0..1. */
  flag: { limb: LimbId; counter: number } | null;
};

/** Tunables for the detector. Geometry, in metres. */
export const TECH = {
  /** A foot this far above the hips' line, or higher, is a high step. */
  highStep: 0.32,
  /** Drop knee: the foot is within this of hip height... */
  dropKneeBand: 0.32,
  /** ...and at least this far out to the side... */
  dropKneeOut: 0.28,
  /** ...on a wall at least this steep, radians. */
  dropKneeAngle: (8 * Math.PI) / 180,
  /** Mantle: shoulders this far over the hand. */
  mantleOver: 0.08,
  /** Compression: hands at least this far apart. */
  squeezeWidth: 0.32,
  /** Stem: feet at least this far apart. */
  stemWidth: 0.72,
  /** Cut loose: no feet on a wall at least this steep. */
  cutAngle: (20 * Math.PI) / 180,
  /** Steeper than this a hooked foot is a toe hook rather than a heel. */
  toeAngle: (40 * Math.PI) / 180,
} as const;

function dirOf(h: Hold): Vec2 {
  return { x: Math.cos(h.dir), y: Math.sin(h.dir) };
}

/**
 * Reads the techniques off a body. `holdOf` resolves a hold id (including the
 * sim's smears); `angleAt` is the wall's lean at a height.
 */
export function readTechnique(
  body: TechBody, holdOf: (id: number) => Hold | undefined, angleAt: (y: number) => number,
): TechReading {
  const active = new Set<TechniqueId>();
  const opposition: TechReading['opposition'] = {};
  const dropKnee: TechReading['dropKnee'] = {};
  const mantle: TechReading['mantle'] = {};
  let flag: TechReading['flag'] = null;

  const held = (id: LimbId) => body.limbs[id].phase === 'held' && body.limbs[id].holdId !== null;
  const hold = (id: LimbId) => (held(id) ? holdOf(body.limbs[id].holdId!) : undefined);
  const angle = angleAt((body.hip.y + body.shoulder.y) / 2);
  const com = {
    x: body.hip.x * 0.56 + body.shoulder.x * 0.44,
    y: body.hip.y * 0.56 + body.shoulder.y * 0.44,
  };

  // --- feet ---
  let feetOn = 0;
  for (const id of ['LF', 'RF'] as LimbId[]) {
    const l = body.limbs[id];
    if (l.phase === 'free' && l.flag) {
      // A flag counters the barn door when it is on the far side of the
      // weight from whatever is holding the body.
      const supportX = supportCentre(body, held);
      const side = Math.sign(com.x - supportX) || (isLeft(id) ? -1 : 1);
      const out = (l.pos.x - com.x) * side;
      const counter = Math.max(0, Math.min(1, out / 0.45));
      if (counter > 0.1) {
        active.add('flag');
        if (!flag || counter > flag.counter) flag = { limb: id, counter };
      }
      continue;
    }
    const h = hold(id);
    if (!h) continue;
    feetOn++;
    if (h.type === 'smear') active.add('smear');
    if (l.hooked) {
      active.add(angleAt(l.pos.y) >= TECH.toeAngle ? 'toeHook' : 'heelHook');
      continue;
    }
    const up = l.pos.y - body.hip.y;
    const out = Math.abs(l.pos.x - body.hip.x);
    if (angle >= TECH.dropKneeAngle && Math.abs(up + 0.12) < TECH.dropKneeBand && out >= TECH.dropKneeOut) {
      dropKnee[id] = true;
      active.add('dropKnee');
    } else if (up > -TECH.highStep) {
      active.add('highStep');
    }
  }
  if (feetOn === 0 && !flag) {
    const handsOn = held('LH') || held('RH');
    if (handsOn && angle >= TECH.cutAngle) active.add('cutLoose');
  }

  // Stemming: feet wide, pushing out against each other.
  const lf = hold('LF');
  const rf = hold('RF');
  if (lf && rf && !body.limbs.LF.hooked && !body.limbs.RF.hooked) {
    const a = body.limbs.LF.pos;
    const b = body.limbs.RF.pos;
    const [left, right] = a.x <= b.x ? ['LF', 'RF'] as const : ['RF', 'LF'] as const;
    const lp = body.limbs[left].pos;
    const rp = body.limbs[right].pos;
    if (rp.x - lp.x >= TECH.stemWidth && lp.y < body.hip.y && rp.y < body.hip.y) {
      const lh = holdOf(body.limbs[left].holdId!)!;
      const rh = holdOf(body.limbs[right].holdId!)!;
      // Only holds that face outward give the push something to press on.
      if (dirOf(lh).x < -0.25 || dirOf(rh).x > 0.25) {
        opposition[left] = norm({ x: -1, y: -0.45 });
        opposition[right] = norm({ x: 1, y: -0.45 });
        active.add('stem');
      }
    }
  }

  // --- hands ---
  const lhId = body.limbs.LH.holdId;
  const rhId = body.limbs.RH.holdId;
  if (held('LH') && held('RH') && lhId === rhId) active.add('match');
  for (const id of ['LH', 'RH'] as LimbId[]) {
    const h = hold(id);
    if (!h) continue;
    const p = body.limbs[id].pos;
    const d = dirOf(h);
    if (body.shoulder.y > p.y + TECH.mantleOver && d.y < -0.3) {
      mantle[id] = true;
      active.add('mantle');
    }
    if (h.type === 'gaston') active.add('gaston');
    if (h.type === 'undercling' && body.shoulder.y > p.y - 0.05) active.add('undercling');
    if (h.type === 'sidepull') active.add('sidepull');
    if (h.type === 'pinch') active.add('pinch');
  }

  // Compression: two hands on holds that face each other, pulled in.
  const lh = hold('LH');
  const rh = hold('RH');
  if (lh && rh && lhId !== rhId) {
    const a = body.limbs.LH.pos;
    const b = body.limbs.RH.pos;
    const [left, right, lHold, rHold] = a.x <= b.x
      ? ['LH', 'RH', lh, rh] as const : ['RH', 'LH', rh, lh] as const;
    const width = Math.abs(b.x - a.x);
    // A hold faces in when pulling it pulls you toward the other one; volumes
    // and pinches have a face on every side.
    const facesIn = (h: Hold, toward: number) => h.type === 'volume' || h.type === 'pinch' || dirOf(h).x * toward > 0.3;
    if (width >= TECH.squeezeWidth && facesIn(lHold, 1) && facesIn(rHold, -1)) {
      opposition[left] = { x: 1, y: 0 };
      opposition[right] = { x: -1, y: 0 };
      active.add('compression');
    }
  }

  return { active: LIMBS.length ? [...active] : [], opposition, dropKnee, mantle, flag };
}

/** Where the body is held from, sideways: the holds the limbs are on. */
function supportCentre(body: TechBody, held: (id: LimbId) => boolean): number {
  let sx = 0;
  let n = 0;
  for (const id of LIMBS) {
    if (!held(id)) continue;
    const w = isHand(id) ? 1 : 1.4;
    sx += body.limbs[id].pos.x * w;
    n += w;
  }
  return n ? sx / n : body.hip.x;
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}
