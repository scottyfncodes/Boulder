import type {
  Contact, Hold, LimbId, MoveGrade, Pose, Vec2,
} from './types';
import { isHand } from './types';
import {
  affinityFactor, canShare, contactRadius, perfectRadius, profileOf,
} from './holds';
import {
  anchorFor, analyseStance, FALL_THRESHOLD, maxReachOf, reachOf, seedPoseFor, solvePose,
} from './body';
import { add, clamp, clamp01, dist, dot, norm, scale, sub, v } from './vec';

/**
 * Move resolution.
 *
 * Everything here is a pure function of the state you are in and the two
 * numbers the player supplies — direction and power. No randomness. Throw the
 * same limb the same way from the same stance and you get the same answer,
 * every time, which is the only way a puzzle game about execution can be
 * fair enough to learn from.
 */

/** Below this a contact pops off on its own. */
export const POP_THRESHOLD = 0.2;

export type ClimbState = {
  contacts: Contact[];
  pose: Pose;
  onMat: boolean;
};

export type Aim = {
  limb: LimbId;
  /** Unit vector the limb travels along. */
  dir: Vec2;
  /** 0..1. At 1 the limb is thrown its full stretch. */
  power: number;
};

export type MoveResult = {
  grade: MoveGrade;
  /** Where the limb actually ended up. */
  landing: Vec2;
  /** The hold it caught, if any. */
  holdId: number | null;
  /** Distance the limb travelled. */
  travel: number;
  /** Short readable cause, shown after the move so failure is never a mystery. */
  reason: string;
  /** State after the body has reacted. */
  next: ClimbState;
  /** Contacts that popped as a consequence of this move. */
  popped: LimbId[];
  fell: boolean;
  /** Debug/telemetry breakdown, also used to explain near-misses. */
  detail: MoveDetail;
};

export type MoveDetail = {
  angleQ: number;
  reachQ: number;
  tensionQ: number;
  affinityQ: number;
  /** Combined multiplier applied to the hold's contact zone. */
  windowScale: number;
  /** How far off the hold's centre the limb landed, metres. */
  offset: number;
  /** Radius the landing had to beat to count at all. */
  zone: number;
  stabilityBefore: number;
  stabilityAfter: number;
};

/** Where a limb lands for a given aim. The aiming preview calls this too. */
export function projectLanding(state: ClimbState, aim: Aim): { landing: Vec2; travel: number; capped: boolean } {
  const anchor = anchorFor(aim.limb, state.pose.hip, state.pose.shoulder);
  const max = maxReachOf(aim.limb);
  const want = clamp01(aim.power) * max;
  const capped = want > max;
  const travel = Math.min(want, max);
  return { landing: add(anchor, scale(norm(aim.dir), travel)), travel, capped };
}

/**
 * Direction of the force the climber puts through a hold, given where their
 * weight is. This is what makes body position matter: the same undercling is
 * useless with your hips below it and solid with your hips above it.
 */
export function loadDirection(hold: Hold, limb: LimbId, com: Vec2): Vec2 {
  const away = sub(com, hold.pos);
  let base = norm(away);
  if (profileOf(hold.type).push) base = scale(base, -1);
  if (!isHand(limb)) {
    // Feet press down into the hold no matter where the hips are.
    base = norm(add(scale(base, 0.3), scale(v(0, -1), 0.7)));
  }
  return base;
}

/** 0..1 alignment between how the hold wants to be loaded and how it is. */
export function angleQuality(hold: Hold, limb: LimbId, com: Vec2): number {
  const p = profileOf(hold.type);
  const want = v(Math.cos(hold.dir), Math.sin(hold.dir));
  const got = loadDirection(hold, limb, com);
  const alignment = clamp01((dot(want, got) + 1) / 2); // 0 opposed, 1 aligned
  // Omnidirectional shapes barely care; slopers and sidepulls care completely.
  return clamp01(1 - p.directionality * (1 - alignment) * 2.1);
}

/** 0..1 penalty for throwing a limb near or past its comfortable length. */
export function reachQuality(limb: LimbId, travel: number): number {
  const comfy = reachOf(limb);
  const r = travel / comfy;
  if (r <= 0.78) return 1;
  if (r <= 1) return 1 - ((r - 0.78) / 0.22) * 0.5;      // 1.0 -> 0.5
  return clamp(0.5 - ((r - 1) / 0.12) * 0.32, 0.16, 0.5); // stretched thin
}

/** Positional quality of a landing before it is graded into a tier. */
export function seatQuality(offset: number, zone: number, windowScale: number): number {
  const usable = zone * windowScale;
  if (usable <= 1e-6) return 0;
  return clamp01(1 - offset / usable);
}

/** Live security of a contact given where the body currently is. */
export function gripOf(contact: Contact, hold: Hold, com: Vec2): number {
  const p = profileOf(hold.type);
  const angleQ = angleQuality(hold, contact.limb, com);
  const aff = affinityFactor(hold.type, contact.limb);
  const hard = hold.hard ?? 1;
  return clamp01((0.3 + 0.7 * contact.seat) * p.gripBase * angleQ * aff / hard);
}

/** Re-seats every contact against a new pose. Called after any body movement. */
export function recomputeGrips(contacts: Contact[], holds: Map<number, Hold>, com: Vec2): Contact[] {
  return contacts.map((c) => {
    const hold = holds.get(c.holdId);
    if (!hold) return c;
    return { ...c, grip: gripOf(c, hold, com) };
  });
}

function holdMap(holds: Hold[]): Map<number, Hold> {
  return new Map(holds.map((h) => [h.id, h]));
}

/** Holds this limb cannot arrive on, because something else is already there. */
export function blockedFor(remaining: Contact[], holds: Hold[]): Set<number> {
  const byId = new Map(holds.map((h) => [h.id, h]));
  const count = new Map<number, number>();
  for (const c of remaining) count.set(c.holdId, (count.get(c.holdId) ?? 0) + 1);
  const blocked = new Set<number>();
  for (const [id, n] of count) {
    const h = byId.get(id);
    if (!h) continue;
    if (n >= 2 || !canShare(h.size, h.type)) blocked.add(id);
  }
  return blocked;
}

/** The hold a landing point catches, if any: nearest centre whose zone covers it. */
function findCaught(
  landing: Vec2, holds: Hold[], exclude: Set<number>, windowScale: number,
): Hold | null {
  let best: Hold | null = null;
  let bestD = Infinity;
  for (const h of holds) {
    if (exclude.has(h.id)) continue;
    const zone = contactRadius(h.size, h.type) * windowScale;
    const d = dist(landing, h.pos);
    if (d <= zone && d < bestD) { best = h; bestD = d; }
  }
  return best;
}

/** The hold the throw was plausibly aimed at, used to spot a dramatic overshoot. */
function aimedAt(anchor: Vec2, dirUnit: Vec2, travel: number, holds: Hold[], exclude: Set<number>): Hold | null {
  let best: Hold | null = null;
  let bestT = Infinity;
  for (const h of holds) {
    if (exclude.has(h.id)) continue;
    const rel = sub(h.pos, anchor);
    const t = dot(rel, dirUnit);
    if (t <= 0.05 || t >= travel) continue;
    const perp = Math.abs(rel.x * -dirUnit.y + rel.y * dirUnit.x);
    if (perp > contactRadius(h.size, h.type) * 1.5) continue;
    if (t < bestT) { best = h; bestT = t; }
  }
  return best;
}

export type ResolveInput = {
  state: ClimbState;
  aim: Aim;
  holds: Hold[];
};

/**
 * Runs one move end to end: throw the limb, see what it catches, let the body
 * settle onto the new set of contacts, then find out whether the stance
 * survives it.
 */
export function resolveMove({ state, aim, holds }: ResolveInput): MoveResult {
  const map = holdMap(holds);
  const { limb } = aim;
  const dirUnit = norm(aim.dir);
  const anchor = anchorFor(limb, state.pose.hip, state.pose.shoulder);
  const { landing, travel } = projectLanding(state, aim);

  const remaining = state.contacts.filter((c) => c.limb !== limb);
  const held = blockedFor(remaining, holds);
  const stabilityBefore = state.pose.stability;

  // Quality multipliers that widen or shrink the hold's usable window.
  const reachQ = reachQuality(limb, travel);
  const tensionQ = 0.62 + 0.38 * state.pose.tension;

  // The window is evaluated against the stance you are leaving from — you
  // cannot place a foot precisely while barn-dooring off the wall.
  const preScale = clamp(reachQ * tensionQ, 0.28, 1.15);

  const caught = findCaught(landing, holds, held, preScale);
  const target = aimedAt(anchor, dirUnit, travel, holds, held);

  let grade: MoveGrade;
  let reason: string;
  let newContact: Contact | null = null;
  let angleQ = 1;
  let affinityQ = 1;
  let offset = 0;
  let zone = 0;
  let windowScale = preScale;

  if (caught) {
    angleQ = angleQuality(caught, limb, state.pose.com);
    affinityQ = affinityFactor(caught.type, limb);
    const hard = caught.hard ?? 1;
    windowScale = clamp(reachQ * tensionQ * (0.55 + 0.45 * angleQ) * affinityQ / hard, 0.22, 1.2);

    zone = contactRadius(caught.size, caught.type);
    offset = dist(landing, caught.pos);
    const usable = zone * windowScale;
    const perfect = perfectRadius(caught.size, caught.type) * windowScale;

    if (offset <= perfect) grade = 'PERFECT';
    else if (offset <= usable * 0.72) grade = 'GOOD';
    else if (offset <= usable) grade = 'SCRAPE';
    else grade = 'MISS';

    if (grade === 'MISS') {
      reason = describeMiss(angleQ, reachQ, tensionQ, affinityQ);
    } else {
      const seat = seatQuality(offset, zone, windowScale);
      newContact = {
        limb,
        holdId: caught.id,
        // The limb settles onto the hold rather than staying where it hit.
        pos: settleOnHold(landing, caught, seat),
        seat,
        grip: 0,
        grade,
      };
      reason =
        grade === 'PERFECT' ? 'Dead centre.'
        : grade === 'GOOD' ? 'On it, not on the good part of it.'
        : 'Fingertips. Barely.';
    }
  } else {
    grade = 'MISS';
    reason = target ? 'Sailed past it.' : 'Grabbed a fistful of wall.';
  }

  // A throw that flies well past something it clearly aimed at is not a miss,
  // it is a yeet, and the body pays for it.
  if (grade === 'MISS' && target) {
    const tDist = dot(sub(target.pos, anchor), dirUnit);
    if (travel > tDist * 1.5 || travel >= maxReachOf(limb) * 0.97) {
      grade = 'YEET';
      reason = 'Committed to that far harder than necessary.';
    }
  }
  if (grade === 'MISS' && !target && aim.power > 0.93) {
    grade = 'YEET';
    reason = 'Full send. At nothing in particular.';
  }

  // --- body reacts -------------------------------------------------------
  const nextContacts: Contact[] = [...remaining];
  if (newContact) nextContacts.push(newContact);

  // A whiffed limb drags the body after it. A yeet drags it a lot.
  const kick =
    grade === 'YEET' ? 0.4 :
    grade === 'MISS' ? 0.17 :
    grade === 'SCRAPE' ? 0.06 : 0;
  const seedHip = add(state.pose.hip, scale(dirUnit, kick * 0.65));
  const seedShoulder = add(state.pose.shoulder, scale(dirUnit, kick));

  let pose = solvePose({
    contacts: nextContacts,
    seedHip,
    seedShoulder,
    onMat: state.onMat,
  });

  // Settle: re-grip against the new pose, drop anything that has come off,
  // and re-solve. A pop can cascade, which is exactly how it goes in real life.
  let live = recomputeGrips(nextContacts, map, pose.com);
  const popped: LimbId[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const survivors = live.filter((c) => c.grip >= POP_THRESHOLD);
    if (survivors.length === live.length) break;
    for (const c of live) if (c.grip < POP_THRESHOLD) popped.push(c.limb);
    live = survivors;
    pose = solvePose({
      contacts: live,
      seedHip: pose.hip,
      seedShoulder: pose.shoulder,
      onMat: state.onMat,
    });
    live = recomputeGrips(live, map, pose.com);
  }

  const stance = analyseStance(live, pose.com);
  pose = { ...pose, ...stance };

  const handsOn = live.some((c) => isHand(c.limb));
  const fell = live.length === 0 || !handsOn || pose.stability < FALL_THRESHOLD;

  if (fell && grade !== 'YEET') {
    reason = popped.length
      ? `${labelOf(popped[0])} popped. Everything else followed.`
      : Math.abs(pose.barnDoor) > 0.35
        ? 'Barn door. The wall let go of you.'
        : reason;
  }

  return {
    grade,
    landing,
    holdId: newContact?.holdId ?? null,
    travel,
    reason,
    popped,
    fell,
    next: { contacts: live, pose, onMat: state.onMat && pose.hip.y < 1.4 },
    detail: {
      angleQ, reachQ, tensionQ, affinityQ, windowScale,
      offset, zone,
      stabilityBefore,
      stabilityAfter: pose.stability,
    },
  };
}

/**
 * A limb that catches a hold slides toward its centre rather than staying
 * exactly where it hit — a good placement ends up centred, a scrape stays out
 * on the edge where it landed.
 */
function settleOnHold(landing: Vec2, hold: Hold, seat: number): Vec2 {
  const pull = 0.35 + 0.6 * seat;
  return {
    x: landing.x + (hold.pos.x - landing.x) * pull,
    y: landing.y + (hold.pos.y - landing.y) * pull,
  };
}

/** Names the weakest link so a failed move is never unexplained. */
function describeMiss(angleQ: number, reachQ: number, tensionQ: number, affinityQ: number): string {
  const worst = Math.min(angleQ, reachQ, tensionQ, affinityQ);
  if (worst === affinityQ && affinityQ < 0.7) return 'That is not what that hold is for.';
  if (worst === reachQ && reachQ < 0.7) return 'Too stretched out to hold anything.';
  if (worst === angleQ && angleQ < 0.7) return 'Wrong angle on it entirely.';
  if (worst === tensionQ && tensionQ < 0.8) return 'No tension. Nothing to place off.';
  return 'Caught the edge and lost it.';
}

function labelOf(limb: LimbId): string {
  return { LH: 'Left hand', RH: 'Right hand', LF: 'Left foot', RF: 'Right foot' }[limb];
}

/**
 * Builds the state a route starts in: limbs on their start holds, body settled,
 * grips resolved.
 */
export function initialState(holds: Hold[], start: Partial<Record<LimbId, number>>): ClimbState {
  const map = holdMap(holds);
  const seeded: Contact[] = [];
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as LimbId[]) {
    const id = start[limb];
    if (id === undefined) continue;
    const hold = map.get(id);
    if (!hold) continue;
    seeded.push({
      limb, holdId: id, pos: { ...hold.pos }, seat: 0.9, grip: 0.9, grade: 'GOOD',
    });
  }
  const seed = seedPoseFor(seeded);
  const pose0 = solvePose({
    contacts: seeded,
    seedHip: seed.hip,
    seedShoulder: seed.shoulder,
    onMat: true,
  });
  const live = recomputeGrips(seeded, map, pose0.com);
  const stance = analyseStance(live, pose0.com);
  return { contacts: live, pose: { ...pose0, ...stance }, onMat: true };
}
