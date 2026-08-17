import type {
  Contact, Hold, LimbId, MoveGrade, Pose, Vec2,
} from './types';
import { isHand } from './types';
import {
  affinityFactor, canShare, contactRadius, profileOf, worldZones,
} from './holds';
import {
  anchorFor, analyseStance, BODY, FALL_THRESHOLD, maxReachOf, reachOf,
  seedPoseFor, solvePose,
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
  /** Wall angle past vertical, radians. Carried on the state so every solve
   * and every preview agrees on how steep the ground under them is. */
  overhang: number;
  /**
   * Where the player is holding their hips, if they have taken over. Persists
   * until they move it or let go, because a body position you have to re-set
   * after every move is a chore rather than a decision.
   */
  shift: Vec2 | null;
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

/** The zone a landing point falls in, and how good that part of the shape is. */
export function zoneAt(hold: Hold, landing: Vec2): { name: string; quality: number; dist: number } | null {
  let best: { name: string; quality: number; dist: number } | null = null;
  for (const z of worldZones(hold)) {
    const d = dist(landing, z.pos);
    if (d > z.r) continue;
    // Within a zone, quality tapers toward its edge, so precision still pays
    // inside the good part rather than the zone being a flat plateau.
    const q = z.quality * (1 - 0.35 * (d / Math.max(z.r, 1e-6)));
    if (!best || q > best.quality) best = { name: z.name, quality: q, dist: d };
  }
  return best;
}

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
  /** The part of the shape that was found, if any. */
  zoneName: string | null;
  /** Quality of that part of the shape before body factors, 0..1. */
  zoneQuality: number;
  /** Momentum the throw put through the body. */
  momentum: number;
  stabilityBefore: number;
  stabilityAfter: number;
};

/** Where a limb lands for a given aim. The aiming preview calls this too. */
/**
 * Where the limb currently is. A throw starts from the hand or foot, not from
 * the shoulder or hip — that is where the player sees it and where they expect
 * the line to come from.
 */
export function limbOrigin(state: ClimbState, limb: LimbId): Vec2 {
  const c = state.contacts.find((x) => x.limb === limb);
  if (c) return c.pos;
  // A limb already in the air hangs from its anchor.
  const anchor = anchorFor(limb, state.pose.hip, state.pose.shoulder);
  const len = (isHand(limb) ? 0.74 : 0.86) * 0.72;
  return { x: anchor.x, y: anchor.y - len };
}

export function projectLanding(state: ClimbState, aim: Aim): { landing: Vec2; travel: number; capped: boolean } {
  // Reach is still measured from the shoulder or hip, because that is what
  // limits it, but the throw is drawn and flown from the limb itself.
  const anchor = anchorFor(aim.limb, state.pose.hip, state.pose.shoulder);
  const from = limbOrigin(state, aim.limb);
  const max = maxReachOf(aim.limb);
  const dirUnit = norm(aim.dir);
  const want = clamp01(aim.power) * max;

  // Clip the throw so the limb cannot end up further from its anchor than the
  // limb is long, however far the drag asked it to go.
  let travel = want;
  const rel = sub(from, anchor);
  // |rel + t*dir| <= max  ->  solve the quadratic for t.
  const b = 2 * dot(rel, dirUnit);
  const c2 = dot(rel, rel) - max * max;
  const disc = b * b - 4 * c2;
  if (disc >= 0) {
    const tMax = (-b + Math.sqrt(disc)) / 2;
    travel = Math.min(travel, Math.max(tMax, 0));
  } else {
    travel = 0;
  }
  return { landing: add(from, scale(dirUnit, travel)), travel, capped: want > travel + 1e-6 };
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
export function gripOf(contact: Contact, hold: Hold, com: Vec2, overhang = 0): number {
  const p = profileOf(hold.type);
  const angleQ = angleQuality(hold, contact.limb, com);
  const aff = affinityFactor(hold.type, contact.limb);
  const hard = hold.hard ?? 1;
  // The steeper it is, the more of your weight each hand is actually holding —
  // enough to feel, not enough to peel you off on its own. The real cost of
  // steepness is that it burns endurance, not that it breaks grip outright.
  const load = 1 - Math.sin(overhang) * (isHand(contact.limb) ? 0.12 : 0.22);
  return clamp01((0.3 + 0.7 * contact.seat) * p.gripBase * angleQ * aff * load / hard);
}

/** Re-seats every contact against a new pose. Called after any body movement. */
export function recomputeGrips(
  contacts: Contact[], holds: Map<number, Hold>, com: Vec2, overhang = 0,
): Contact[] {
  return contacts.map((c) => {
    const hold = holds.get(c.holdId);
    if (!hold) return c;
    return { ...c, grip: gripOf(c, hold, com, overhang) };
  });
}

function holdMap(holds: Hold[]): Map<number, Hold> {
  return new Map(holds.map((h) => [h.id, h]));
}

/**
 * Settles a pose and its grips against each other.
 *
 * The two depend on each other: how well a foot is placed decides how much
 * weight the leg can hold up, and where the body ends up decides how well that
 * foot is loaded. Solving once leaves the answer depending on whichever grip
 * values happened to arrive, which is how history leaks into a pose that is
 * meant to be a function of the contacts. A few passes reach the fixed point,
 * and every caller goes through here so they all agree on what settled means.
 */
function settle(
  contacts: Contact[],
  seed: { hip: Vec2; shoulder: Vec2 },
  map: Map<number, Hold>,
  onMat: boolean,
  shift: Vec2 | null,
  overhang: number,
): { pose: Pose; contacts: Contact[] } {
  let pose = solvePose({
    contacts, seedHip: seed.hip, seedShoulder: seed.shoulder, onMat, shift, overhang,
  });
  let live = recomputeGrips(contacts, map, pose.com, overhang);
  for (let pass = 0; pass < 3; pass++) {
    pose = solvePose({
      contacts: live, seedHip: seed.hip, seedShoulder: seed.shoulder, onMat, shift, overhang,
    });
    const next = recomputeGrips(live, map, pose.com, overhang);
    // Usually converged after one pass. Stopping early matters because the
    // route validator runs this tens of thousands of times per test run.
    let moved = 0;
    for (let i = 0; i < next.length; i++) moved = Math.max(moved, Math.abs(next[i].grip - live[i].grip));
    live = next;
    if (moved < 1e-4) break;
  }
  return { pose, contacts: live };
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
  let reason = '';
  let newContact: Contact | null = null;
  let angleQ = 1;
  let affinityQ = 1;
  let offset = 0;
  let zone = 0;
  let zoneName: string | null = null;
  let zoneQuality = 0;
  let windowScale = preScale;

  if (caught) {
    angleQ = angleQuality(caught, limb, state.pose.com);
    affinityQ = affinityFactor(caught.type, limb);
    const hard = caught.hard ?? 1;
    windowScale = clamp(reachQ * tensionQ * (0.55 + 0.45 * angleQ) * affinityQ / hard, 0.22, 1.2);

    zone = contactRadius(caught.size, caught.type);
    offset = dist(landing, caught.pos);

    // Which part of the shape the hand actually found. Missing every zone means
    // touching the hold somewhere useless, which is not a placement.
    const hit = zoneAt(caught, landing);
    zoneName = hit?.name ?? null;
    zoneQuality = hit?.quality ?? 0;

    // The stance and the throw decide how much of that zone's quality survives.
    const seat = clamp01(zoneQuality * windowScale / preScale * (0.45 + 0.55 * windowScale));

    if (!hit) {
      grade = 'MISS';
      reason = 'Caught the hold somewhere that is not a hold.';
    } else if (seat >= 0.8) grade = 'PERFECT';
    else if (seat >= 0.55) grade = 'GOOD';
    else if (seat >= 0.24) grade = 'SCRAPE';
    else {
      grade = 'MISS';
      reason = describeMiss(angleQ, reachQ, tensionQ, affinityQ);
    }

    if (grade !== 'MISS') {
      newContact = {
        limb,
        holdId: caught.id,
        // The limb settles into the zone it found rather than staying where it
        // hit, so a hand on the lip stays on the lip.
        pos: settleOnZone(landing, caught, hit!.name, seat),
        seat,
        grip: 0,
        grade,
        zone: hit!.name,
      };
      reason =
        grade === 'PERFECT' ? `Right on ${hit!.name}.`
        : grade === 'GOOD' ? `Got ${hit!.name}.`
        : `${hit!.name.charAt(0).toUpperCase()}${hit!.name.slice(1)}, barely. That will not last.`;
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

  // Slingshot. A thrown limb carries momentum in proportion to how hard it was
  // thrown, and the body goes with it — a leg more than an arm, because a leg
  // weighs more. Catching the hold arrests most of it; whiffing arrests none.
  // This is what makes power a decision rather than a slider you max out: you
  // want enough to arrive and not a drop more.
  const limbMass = isHand(limb) ? 0.55 : 1;
  const caughtIt = newContact !== null;
  const arrest = caughtIt ? 0.28 + 0.5 * (newContact!.seat) : 1;
  const momentum = clamp01(aim.power) ** 1.6 * limbMass * (1 - arrest * 0.72)
    * (grade === 'YEET' ? 2.1 : 1);
  const kick = momentum * 0.62;
  const seedHip = add(state.pose.hip, scale(dirUnit, kick * 0.7));
  const seedShoulder = add(state.pose.shoulder, scale(dirUnit, kick));

  let settled = settle(
    nextContacts, { hip: seedHip, shoulder: seedShoulder }, map, state.onMat, state.shift,
    state.overhang,
  );
  let pose = settled.pose;
  let live = settled.contacts;

  // Drop anything that has come off and settle again. A pop can cascade, which
  // is exactly how it goes in real life.
  const popped: LimbId[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const survivors = live.filter((c) => c.grip >= POP_THRESHOLD);
    if (survivors.length === live.length) break;
    for (const c of live) if (c.grip < POP_THRESHOLD) popped.push(c.limb);
    live = survivors;
    settled = settle(live, { hip: pose.hip, shoulder: pose.shoulder }, map, state.onMat, state.shift, state.overhang);
    pose = settled.pose;
    live = settled.contacts;
  }

  const stance = analyseStance(live, pose.com, state.overhang);
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
    next: { contacts: live, pose, onMat: state.onMat && pose.hip.y < 1.4, shift: state.shift, overhang: state.overhang },
    detail: {
      angleQ, reachQ, tensionQ, affinityQ, windowScale,
      offset, zone, zoneName, zoneQuality, momentum,
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
function settleOnZone(landing: Vec2, hold: Hold, zoneName: string, seat: number): Vec2 {
  const z = worldZones(hold).find((w) => w.name === zoneName);
  const target = z ? z.pos : hold.pos;
  const pull = 0.35 + 0.6 * seat;
  return {
    x: landing.x + (target.x - landing.x) * pull,
    y: landing.y + (target.y - landing.y) * pull,
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
 * Resolves a body position without committing it, for the drag preview. Skips
 * the pop cascade — mid-drag is the wrong moment to start tearing limbs off the
 * wall — but reports the stability so the interface can warn before the player
 * lets go rather than surprising them after.
 */
export function previewShift(
  state: ClimbState, target: Vec2 | null, holds: Hold[],
): { pose: Pose; risky: boolean } {
  const map = holdMap(holds);
  const { pose, contacts: live } = settle(state.contacts, shiftSeed(state, target), map, state.onMat, target, state.overhang);
  const stance = analyseStance(live, pose.com, state.overhang);
  const weakest = live.reduce((m, c) => Math.min(m, c.grip), 1);
  return {
    pose: { ...pose, ...stance },
    risky: stance.stability < FALL_THRESHOLD * 1.35 || weakest < POP_THRESHOLD * 1.35,
  };
}

/**
 * Letting go relaxes from the canonical seed rather than from wherever the body
 * currently is, so the neutral hang depends only on the contacts. Release has
 * to mean the same thing twice or the player cannot use it to undo anything.
 */
function shiftSeed(state: ClimbState, target: Vec2 | null): { hip: Vec2; shoulder: Vec2 } {
  return target
    ? { hip: state.pose.hip, shoulder: state.pose.shoulder }
    : seedPoseFor(state.contacts);
}

export type ShiftResult = {
  next: ClimbState;
  /** Contacts that came off because the new position unloaded them. */
  popped: LimbId[];
  fell: boolean;
  reason: string;
};

/**
 * Moves the body without moving a limb.
 *
 * The commanded position is a request, not a teleport: the climber pulls toward
 * it and the limb constraints decide how much is actually reachable, so asking
 * for something your arms cannot support resolves to the nearest position they
 * can. What it costs is honest — dragging your weight off your feet is exactly
 * how a barn door starts — and what it buys is reach and better angles on the
 * holds you are already on, which is what body positioning is for.
 *
 * Pass null to stop holding a position and hang naturally again.
 */
export function shiftBody(state: ClimbState, target: Vec2 | null, holds: Hold[]): ShiftResult {
  const map = holdMap(holds);
  let settled = settle(state.contacts, shiftSeed(state, target), map, state.onMat, target, state.overhang);
  let pose = settled.pose;
  let live = settled.contacts;

  const popped: LimbId[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const survivors = live.filter((c) => c.grip >= POP_THRESHOLD);
    if (survivors.length === live.length) break;
    for (const c of live) if (c.grip < POP_THRESHOLD) popped.push(c.limb);
    live = survivors;
    settled = settle(live, { hip: pose.hip, shoulder: pose.shoulder }, map, state.onMat, target, state.overhang);
    pose = settled.pose;
    live = settled.contacts;
  }

  const stance = analyseStance(live, pose.com, state.overhang);
  pose = { ...pose, ...stance };
  const handsOn = live.some((c) => isHand(c.limb));
  const fell = live.length === 0 || !handsOn || pose.stability < FALL_THRESHOLD;

  return {
    next: { contacts: live, pose, onMat: state.onMat, shift: target, overhang: state.overhang },
    popped,
    fell,
    reason: popped.length
      ? `Shifted the weight off ${labelOf(popped[0]).toLowerCase()}.`
      : fell
        ? 'Moved out over nothing and the wall let go.'
        : '',
  };
}

/** Furthest a dyno can carry the body, metres of hip travel. */
export const DYNO_RANGE = 1.15;

/**
 * Hands converge when you throw for something, rather than staying shoulder
 * width apart. Without this a jug set on the centre line gets straddled by both
 * hands and caught by neither, which is not a thing that happens to climbers.
 */
const DYNO_HAND_SPREAD = 0.12;

/**
 * Where the hands arrive for a given dyno. The aiming overlay draws this, and
 * it is the same function the resolver uses, so the preview cannot lie.
 */
export function dynoLanding(state: ClimbState, aim: Aim): { hands: Vec2; hip: Vec2; apex: Vec2 } {
  const dirUnit = norm(aim.dir);
  const travel = clamp01(aim.power) * DYNO_RANGE;
  const hip = add(state.pose.hip, scale(dirUnit, travel));
  const shoulder = add(hip, { x: 0, y: BODY.torso });
  return {
    hip,
    hands: add(shoulder, scale(dirUnit, BODY.arm * 0.72)),
    apex: add(state.pose.hip, add(scale(dirUnit, travel * 0.5), { x: 0, y: travel * 0.28 })),
  };
}

export type DynoResult = {
  /** Where the hands ended up. */
  landing: Vec2;
  caught: { limb: LimbId; holdId: number }[];
  grade: MoveGrade;
  reason: string;
  next: ClimbState;
  fell: boolean;
  /** Peak of the arc, for the animation to follow. */
  apex: Vec2;
};

/**
 * A dyno.
 *
 * Everything comes off the wall and the whole body goes. There is no partial
 * credit on the way — either a hand finds something at the far end or the
 * climber lands on the mat — which is exactly the deal a dyno offers in real
 * life. Power sets how far the hips travel; the hands arrive an arm's length
 * ahead of them and catch whatever is there.
 *
 * Feet are not re-placed. You arrive on your hands and sort your feet out
 * afterwards, assuming you are still on.
 */
export function resolveDyno(state: ClimbState, aim: Aim, holds: Hold[]): DynoResult {
  const map = holdMap(holds);
  const power = clamp01(aim.power);

  const { hip: hipTo, hands: reachPoint, apex } = dynoLanding(state, aim);
  const shoulderTo = add(hipTo, { x: 0, y: BODY.torso });

  // Both hands reach ahead of the body along the launch line.
  const caught: Contact[] = [];
  const blocked = new Set<number>();

  for (const limb of ['LH', 'RH'] as LimbId[]) {
    const side = limb === 'LH' ? -1 : 1;
    const hand: Vec2 = {
      x: reachPoint.x + side * BODY.shoulderHalf * DYNO_HAND_SPREAD,
      y: reachPoint.y,
    };
    let best: { hold: Hold; hit: { name: string; quality: number } } | null = null;
    let bestD = Infinity;
    for (const h of holds) {
      if (blocked.has(h.id)) continue;
      const hit = zoneAt(h, hand);
      if (!hit) continue;
      const d = dist(hand, h.pos);
      if (d < bestD) { best = { hold: h, hit }; bestD = d; }
    }
    if (!best) continue;
    // A dyno catch is never clean — you are arresting a moving body with your
    // fingers, so the placement is worth markedly less than the same one made
    // slowly. Bigger throws cost more.
    const seat = clamp01(best.hit.quality * (0.8 - power * 0.2));
    if (seat < 0.18) continue;
    if (!canShare(best.hold.size, best.hold.type)) blocked.add(best.hold.id);
    caught.push({
      limb,
      holdId: best.hold.id,
      pos: { ...hand },
      seat,
      grip: 0,
      grade: seat >= 0.55 ? 'GOOD' : 'SCRAPE',
      zone: best.hit.name,
    });
  }

  const settled = settle(
    caught, { hip: hipTo, shoulder: shoulderTo }, map, false, null, state.overhang,
  );
  let pose = settled.pose;
  const live = settled.contacts.filter((c) => c.grip >= POP_THRESHOLD);
  const stance = analyseStance(live, pose.com, state.overhang);
  pose = { ...pose, ...stance };

  const fell = live.length === 0 || pose.stability < FALL_THRESHOLD;
  const grade: MoveGrade =
    fell ? 'YEET'
    : live.length === 2 ? (live.every((c) => c.grade === 'GOOD') ? 'PERFECT' : 'GOOD')
    : 'SCRAPE';

  return {
    landing: reachPoint,
    apex,
    caught: live.map((c) => ({ limb: c.limb, holdId: c.holdId })),
    grade,
    reason:
      fell ? (caught.length ? 'Touched it. Did not keep it.' : 'Caught nothing but air.')
      : live.length === 2 ? 'Both hands. Stuck it.'
      : 'One hand on it, swinging.',
    fell,
    next: {
      contacts: live,
      pose,
      onMat: false,
      shift: null,
      overhang: state.overhang,
    },
  };
}

/**
 * Builds the state a route starts in: limbs on their start holds, body settled,
 * grips resolved.
 */
export function initialState(
  holds: Hold[], start: Partial<Record<LimbId, number>>, overhang = 0,
): ClimbState {
  const map = holdMap(holds);
  const seeded: Contact[] = [];
  for (const limb of ['LH', 'RH', 'LF', 'RF'] as LimbId[]) {
    const id = start[limb];
    if (id === undefined) continue;
    const hold = map.get(id);
    if (!hold) continue;
    const best = worldZones(hold)[0];
    seeded.push({
      limb, holdId: id, pos: { ...best.pos }, seat: 0.9, grip: 0.9, grade: 'GOOD',
      zone: best.name,
    });
  }
  const { pose: pose0, contacts: live } = settle(
    seeded, seedPoseFor(seeded), map, true, null, overhang,
  );
  const stance = analyseStance(live, pose0.com, overhang);
  return { contacts: live, pose: { ...pose0, ...stance }, onMat: true, shift: null, overhang };
}
