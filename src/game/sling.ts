import type { Contact, Hold, LimbId, MoveGrade, Pose, Vec2 } from './types';
import { LIMBS, isHand } from './types';
import { BODY, anchorFor, analyseStance, footShare, seedPoseFor } from './body';
import {
  canShare, canUse, contactRadius, profileOf, worldZones,
} from './holds';
import { clamp, clamp01, dist, len, norm, sub } from './vec';
import { type WallProfile, ROOF_ANGLE, angleAt, flatProfile } from './profile';
import type { ArmId, FootSupport, Posture } from './pump';
import { type Envelope, type ReachLimits, envelopeExtent, envelopeOf, envelopeOutline, holdsInEnvelope, inEnvelope, poseFor } from './reach';
import { ESTABLISH_TIME, establishFactor, gripCost, holdCapacity, stepSlip } from './grip';
import { type TechReading, type TechniqueId, readTechnique } from './technique';
import { armShare } from './pump';

/**
 * Slingshot limbs.
 *
 * The body is a handful of particles on a wall: a hip, a shoulder, and the
 * tips of four limbs. Each limb is a tether from its anchor on the torso to
 * wherever the tip is — a rope for an arm, a strut for a leg — and a limb that
 * is holding something is simply pinned to that hold. Everything the player
 * does is one thing: pick a limb, pull it back, let go, and it flies.
 *
 * Nothing here teleports. A launched limb travels under gravity until the
 * tether goes taut and yanks the body after it, or until it passes through a
 * hold and grabs on, or until it runs out of flight and dangles. The body
 * swings, rotates and sags around whatever is still holding on, so the puzzle
 * is never "which hold" but "what is my body going to do when I throw this".
 *
 * It is deterministic: a fixed time step, a fixed constraint order, and no
 * randomness. Play the same launch from the same state and you get the same
 * answer, which is what makes a miss something you can learn from.
 */

export const SLING = {
  /** Fixed physics step, seconds. */
  dt: 1 / 120,
  gravity: 9.81,
  massHip: 1.0,
  massShoulder: 0.8,
  massHand: 0.14,
  massFoot: 0.22,
  /**
   * A limb in flight is the whole arm or leg moving, and the climber lunging
   * after it. Heavier in the air than at rest so the tether going taut is a
   * proper yank rather than a twitch.
   */
  flyMassHand: 0.5,
  flyMassFoot: 0.62,
  /**
   * How far a thrown limb can get from its shoulder or hip before the tether
   * goes taut, as a multiple of the limb's length. A thrown arm is the whole
   * climber reaching — shoulder out, side long, on tiptoe — so it goes past
   * the arm's own length. The route checker plays with the shorter, static
   * reach in body.ts, so every route stays climbable with room to spare —
   * and the wide routes up the grades are a long way across.
   */
  armReach: 1.4,
  legReach: 1.34,
  /** Launch speed at full pull, metres per second. Enough to get to the end of the reach. */
  maxSpeedHand: 5.2,
  maxSpeedFoot: 4.7,
  /**
   * Gravity on a limb in flight, as a fraction of the real thing. An arm
   * being thrown is muscle as well as mass: it flies flatter and longer than a
   * dropped object, which also makes the arc something you can watch.
   */
  flyGravity: 0.45,
  /** How far back a limb winds up for a full pull, metres. The stretch. */
  windup: 0.34,
  /** Below this much pull the launch is treated as a cancelled drag. */
  minPower: 0.05,
  /**
   * How far back the body winds up for a full dyno, metres. Whatever is on
   * the wall is the band, so it only goes as far as the limbs let it.
   */
  dynoWindup: 0.3,
  /**
   * A dyno at full pull: the whole body, metres per second. Enough for the
   * hands to go nearly three metres up the wall — the move that skips a
   * section, not one that saves a reach.
   */
  maxDynoSpeed: 6.8,
  /** How much faster than the body the hands go on a dyno: the reach. */
  dynoReach: 0.5,
  /** How long the hands can still catch something on a dyno, seconds. */
  dynoFlight: 1.8,
  /**
   * The deadpoint. On a dyno the hands sail past anything they meet while
   * they are still going up faster than this, metres per second, and only
   * close near the top of the jump. Holds on the way are not the target; the
   * power you pull is how you pick the hold.
   */
  dynoPass: 3.0,
  /** Fraction of the launch speed the anchor gets: the body goes with it. */
  recoil: 0.12,
  /**
   * The core. A climber holds their torso upright against the wall as long as
   * they have a hand on something; without this the body is an inverted
   * pendulum and falls over the moment it is standing. Restoring pull toward
   * upright, in g at full horizontal.
   */
  core: 1.1,
  coreDamp: 4.0,
  /**
   * Gravity's righting moment, in g per metre. A body standing or hanging off
   * to one side of what is holding it gets pulled back over it: the wall's
   * friction, and a climber keeping their weight where their feet are. Without
   * it one foot on a hold shoves the hips sideways until it skates off.
   */
  restore: 1.4,
  /** Velocity damping per second: body, dangling limbs, limbs in flight. */
  dampBody: 1.5,
  dampFree: 3.0,
  dampFlying: 0.22,
  /** Constraint passes per step. */
  iterations: 10,
  /** How long a launched limb can still catch something, seconds. */
  flightMax: 0.85,
  /** A reach for a hold can take longer: it is going somewhere, not falling. */
  reachFlightMax: 1.3,
  /** Slowest a limb moves on a reach for a hold, m/s, however gently it was pulled. */
  reachSpeed: 3.2,
  /**
   * A thrown limb that reaches full stretch stops there, the way an arm does
   * at the end of a reach, rather than whipping round its shoulder like a
   * stone on a string. How fast its sideways speed dies once taut, per second.
   */
  tautArrest: 25,
  /** A taut limb moving slower than this, m/s, has stalled: the throw is over. */
  tautStall: 0.45,
  /**
   * While a limb reaches, the rest of the climber carries the body: arms
   * pull, legs push, and the body goes where the reach takes it instead of
   * sagging off it. This much of the body's weight is carried per limb still
   * on the wall, up to all of it — one limb on is a desperate reach, two or
   * more is a climber moving their weight.
   */
  reachCarry: 0.5,
  /** How much of the body's speed survives a reach landing on its hold. */
  reachSettle: 0.25,
  /** Seconds a climber takes to pull back in after a reach that caught nothing. */
  reachRecover: 0.6,
  /** How hard they pull back: a spring to where they reached from, per second squared, and its damping. */
  reachReturn: 55,
  reachReturnDamp: 13,
  /** Seconds after a catch before the hold is asked whether it can take the load. */
  lockOnGrace: 0.16,
  /** Smoothing time for the load reading, seconds. */
  tensionTau: 0.11,
  /**
   * How much any hold can take, in body weights, loaded the way it wants to
   * be: enough for one limb to hold the whole body, swinging. Holds do not
   * decide whether you stay on; the pump does.
   */
  gripStrength: 3.4,
  /** Arm pull: the climber locking off toward a hold, as a fraction of body weight, each. */
  armPull: 0.34,
  /** Leg push: standing up on a foot, as a fraction of body weight, each. */
  legPush: 0.95,
  /** Damping on that push, body weights per metre per second. Stops the pogo. */
  legDamp: 1.0,
  /** Sideways shove on the shoulders with no hand on: peeling off the wall. */
  peel: 0.55,
  /** Hip height below which a climber who has left the mat is on it again. */
  matHip: 0.5,
  /** Hip height above which the climber is considered to have left the mat. */
  leftHip: 0.92,
} as const;

/** Where a leg stands: the length it pushes out to when there is a foot below the hip. */
const LEG_STAND = BODY.leg * 0.9;
const LEG_MIN = BODY.leg * 0.2;
const LEG_MAX = BODY.leg * SLING.legReach;
const ARM_MIN = BODY.arm * 0.08;
const ARM_MAX = BODY.arm * SLING.armReach;
/** Arm length the lock-off pulls toward. */
const ARM_LOCK = BODY.arm * 0.62;

const FLOOR = 0;
const MAT_HIP_MIN = 0.34;
const MAT_SHOULDER_MIN = 0.3;
const FOOT_FLOOR = 0.03;
/**
 * How far off the floor a limb that is not on anything stays while anything
 * else is still holding on. Limbs meet the ground in a fall and only then:
 * a dangling foot folds at the knee rather than dragging on the mat, and a
 * throw at the floor stops short of it.
 */
const LIMB_CLEARANCE = 0.14;
/** Furthest the torso tips from vertical while a hand is on, radians. */
const MAX_LEAN = 0.7;
/** Sideways offset a foot can carry weight from without the hips moving over it. */
const STANCE_WIDTH = 0.26;
/** Holds this close to where a limb was thrown from cannot catch it on the way out. */
const LAUNCH_CLEAR = 0.16;
/** The body limits the reach envelope is solved with: the same ones the step enforces. */
/** Highest the shoulders go over the hands holding them while reaching: a press, not a mantle. */
const REACH_PRESS = 0.3;
/** How far a standing foot lets the hips go on a reach, as a fraction of the leg. */
const REACH_FOOT = 0.93;
/** Highest a reaching foot goes over its hip: a high step. */
const HIGH_STEP = 0.45;
const REACH_LIMITS: ReachLimits = {
  arm: ARM_MAX, leg: LEG_MAX, maxLean: MAX_LEAN, hipMin: MAT_HIP_MIN + 0.1, stance: STANCE_WIDTH,
  press: REACH_PRESS, highStep: HIGH_STEP, footHold: REACH_FOOT,
};

export type LimbPhase = 'held' | 'flying' | 'free';

export type SlingLimb = {
  id: LimbId;
  pos: Vec2;
  vel: Vec2;
  phase: LimbPhase;
  /** Hold the limb is on. Null while free, in flight, or planted on the mat. */
  holdId: number | null;
  /** True for a foot standing on the mat before the climber has left it. */
  onFloor: boolean;
  /** Positional quality of the catch, 0..1. */
  seat: number;
  zone: string | null;
  grade: Exclude<MoveGrade, 'MISS' | 'YEET'> | null;
  /** Seconds in flight. */
  flightT: number;
  /** Seconds since the catch. */
  heldT: number;
  /** Smoothed load through the limb, body weights. */
  tension: number;
  /** Load the hold can take before it lets go, body weights. */
  capacity: number;
  /** The hold this limb launched from — cannot be re-caught until it is clear. */
  leftHoldId: number | null;
  /** Position last step, for the catch sweep. */
  prev: Vec2;
  /** The hold a flying limb is currently passing through, and its nearest approach so far. */
  touch: { holdId: number; d: number; at: Vec2 } | null;
  /** A hand passed through a foot chip on this flight. For the excuse. */
  brushedChip: boolean;
  /** A thrown limb out at full stretch this step. */
  taut?: boolean;
  /** A foot on a hold that the body is hanging from: a heel or toe hook. */
  hooked?: boolean;
  /** Where a thrown limb left its hold from, while it is still leaving. */
  launchAt?: Vec2 | null;
  /** Which way a thrown limb was thrown: the body follows it only that way. */
  launchDir?: Vec2 | null;
  /** The hold a reach is going for. It goes there, past anything on the way. */
  target?: number | null;
  /** 0..1: how far this contact has slipped. 1 is gone. */
  slip?: number;
  /** Extra load from arriving on the hold moving, body weights, dying away. */
  impact?: number;
  /** What the limb is asking of its hold this step, body weights. */
  demand?: number;
  /** A free foot pressed flat on the wall to balance: a flag. */
  flag?: boolean;
  /** Where the flag sits, relative to the hips. */
  flagAt?: Vec2 | null;
  /** Seconds since this limb last came off something. */
  releasedT?: number;
};

/**
 * What the body has left. The screen writes it from the fatigue model every
 * frame; the sim only reads it, so a preview run on a copy sees the same
 * tired body the real throw will. 1 is fresh.
 */
export type Condition = {
  /** Each forearm's grip, 1 fresh .. 0 blown. */
  grip: Record<'LH' | 'RH', number>;
  /** Short-term power: how hard you can still throw. */
  power: number;
  /** Core tension: keeping feet on and the body in on steep ground. */
  core: number;
};

export const FRESH: Condition = { grip: { LH: 1, RH: 1 }, power: 1, core: 1 };

export type SlingState = {
  hip: Vec2;
  hipV: Vec2;
  shoulder: Vec2;
  shV: Vec2;
  limbs: Record<LimbId, SlingLimb>;
  /** The wall: how far it leans at every height. */
  profile: WallProfile;
  /** Sim time, seconds. */
  t: number;
  /** Once true the mat is a place to fall to rather than a place to stand. */
  left: boolean;
  fallen: boolean;
  /** Which way the body last leaned, so a peel has a side to go. */
  peelSign: number;
  /** How many limbs were holding on at the end of the last step. */
  heldLast: number;
  /** True from a dyno's launch until a hand catches or both hands give up. */
  dyno: boolean;
  /** Whether that was true at the end of the last step. */
  dynoLast: boolean;
  /**
   * Where the body was when a limb was thrown, and how long is left of
   * getting back there after a reach that caught nothing. A climber who
   * stretches out for a hold and misses pulls their weight back in.
   */
  reachHome?: { hip: Vec2; shoulder: Vec2; t: number } | null;
  /** Where the body is going to get a limb onto the hold it is reaching for. */
  reachPose?: { hip: Vec2; shoulder: Vec2 } | null;
  /** What the body has left. Fresh when left out. */
  cond?: Condition;
  /**
   * Where the ground is, metres up the wall's coordinates. Zero in a gym; on
   * the tread wall it rises at the belt's speed, which is the same thing as
   * the wall going down.
   */
  ground?: number;
  /** Smears: blank wall a foot is standing on. Ids are negative. */
  smears?: Hold[];
  /** The techniques the body read as doing, last step. */
  tech?: TechReading;
  /** The holds the last step ran against, so readers without them (the pump) can price a grip. */
  holdsRef?: Hold[];
};

export type SlingEvent =
  | { kind: 'launch'; limb: LimbId; from: Vec2; power: number }
  /** Everything left the wall at once, on purpose. */
  | { kind: 'dyno'; from: Vec2; power: number }
  /** A dangling limb was put straight back on a hold. */
  | { kind: 'place'; limb: LimbId; holdId: number; at: Vec2 }
  | { kind: 'catch'; limb: LimbId; holdId: number; at: Vec2; grade: Exclude<MoveGrade, 'MISS' | 'YEET'>; seat: number; zone: string; speed: number; dyno: boolean }
  | { kind: 'miss'; limb: LimbId; at: Vec2; reason: string }
  /** A dyno hand got fingertips on a hold and could not stop the body with them. */
  | { kind: 'slip'; limb: LimbId; holdId: number | null; reason: string }
  /** The last thing holding on let go. The climber is airborne. */
  | { kind: 'off'; at: Vec2 }
  /** The climber met the mat. */
  | { kind: 'fell'; at: Vec2; from: number }
  /** A forearm ran out: its hand opened on its own. `hands` is how many opened. */
  | { kind: 'pumped'; at: Vec2; hands: number }
  /** The body did something with a name: a smear, a flag, a deadpoint, a foot swap. */
  | { kind: 'tech'; limb: LimbId | null; tech: TechniqueId | 'deadpoint' | 'footSwap'; at: Vec2 };

export type LaunchAim = {
  limb: LimbId;
  /** Unit direction of travel. */
  dir: Vec2;
  /** 0..1 pull, full pull is full speed. */
  power: number;
  /**
   * Where the limb is when it lets go: the wound-up position, drawn back
   * against the pull. Left out, it fires from wherever it is.
   */
  from?: Vec2;
  /**
   * The hold this is a reach for, picked from the reach envelope by where the
   * pull points and how hard it is. The limb goes to it rather than flying
   * blind and grabbing whatever it passes. Left out, it is a plain throw.
   */
  target?: { id: number; at: Vec2 } | null;
};

function bodyMass(): number {
  return SLING.massHip + SLING.massShoulder + 2 * SLING.massHand + 2 * SLING.massFoot;
}

function limbMass(limb: SlingLimb): number {
  const hand = isHand(limb.id);
  if (limb.phase === 'flying') return hand ? SLING.flyMassHand : SLING.flyMassFoot;
  return hand ? SLING.massHand : SLING.massFoot;
}

export function maxSpeedOf(limb: LimbId): number {
  return isHand(limb) ? SLING.maxSpeedHand : SLING.maxSpeedFoot;
}

const holdMaps = new WeakMap<Hold[], Map<number, Hold>>();

/** Holds by id. Built once per hold list: the step asks for it every time. */
function holdMap(holds: Hold[]): Map<number, Hold> {
  let m = holdMaps.get(holds);
  if (!m || m.size !== holds.length) {
    m = new Map(holds.map((h) => [h.id, h]));
    holdMaps.set(holds, m);
  }
  return m;
}

/** A hold by id: the route's, or a smear the body made. */
export function holdIn(state: SlingState, holds: Hold[], id: number | null): Hold | undefined {
  if (id === null) return undefined;
  if (id < 0) return state.smears?.find((h) => h.id === id);
  return holdMap(holds).get(id);
}

/** Smear ids: one per foot, so a foot moving its smear replaces it. */
const SMEAR_ID: Record<'LF' | 'RF', number> = { LF: -1, RF: -2 };

function condOf(state: SlingState): Condition {
  return state.cond ?? FRESH;
}

function groundOf(state: SlingState): number {
  return state.ground ?? 0;
}

// --- construction --------------------------------------------------------

function freshLimb(id: LimbId, pos: Vec2): SlingLimb {
  return {
    id, pos: { ...pos }, vel: { x: 0, y: 0 }, prev: { ...pos },
    phase: 'free', holdId: null, onFloor: false,
    seat: 0, zone: null, grade: null,
    flightT: 0, heldT: 0, tension: 0, capacity: 0, leftHoldId: null, touch: null,
    brushedChip: false, slip: 0, impact: 0, demand: 0, flag: false, flagAt: null, releasedT: 10,
  };
}

/**
 * The state a route starts in: limbs on their start holds, feet without a
 * hold standing on the mat, and the body settled onto all of it so the first
 * thing the player sees is a climber at rest rather than one dropping into
 * position.
 */
export function initialSling(
  holds: Hold[], start: Partial<Record<LimbId, number>>, wall: number | WallProfile = 0, settleSteps = 240,
): SlingState {
  const profile = typeof wall === 'number' ? flatProfile(wall) : wall;
  const map = holdMap(holds);
  const contacts: Contact[] = [];
  for (const limb of LIMBS) {
    const id = start[limb];
    if (id === undefined) continue;
    const hold = map.get(id);
    if (!hold) continue;
    const z = worldZones(hold)[0];
    contacts.push({
      limb, holdId: id, pos: { ...z.pos }, seat: 1, grip: 1, grade: STUCK, zone: z.name,
    });
  }
  const seed = slingSeed(contacts);

  const limbs = {} as Record<LimbId, SlingLimb>;
  for (const limb of LIMBS) {
    const c = contacts.find((x) => x.limb === limb);
    if (c) {
      const l = freshLimb(limb, c.pos);
      l.phase = 'held';
      l.holdId = c.holdId;
      l.seat = 1;
      l.zone = c.zone;
      l.grade = STUCK;
      l.heldT = 10;
      limbs[limb] = l;
      continue;
    }
    const anchor = anchorFor(limb, seed.hip, seed.shoulder);
    if (isHand(limb)) {
      limbs[limb] = freshLimb(limb, { x: anchor.x, y: anchor.y - BODY.arm * 0.9 });
    } else {
      // No foothold: it hangs, clear of the floor. Nobody starts on the mat.
      limbs[limb] = freshLimb(limb, {
        x: anchor.x,
        y: Math.max(LIMB_CLEARANCE, anchor.y - BODY.leg * 0.9),
      });
    }
  }

  const state: SlingState = {
    hip: { ...seed.hip }, hipV: { x: 0, y: 0 },
    shoulder: { ...seed.shoulder }, shV: { x: 0, y: 0 },
    limbs, profile, t: 0, left: false, fallen: false, peelSign: 1, heldLast: 0, dyno: false, dynoLast: false, reachHome: null, reachPose: null,
    cond: FRESH, ground: 0, smears: [],
  };
  state.heldLast = heldCount(state);
  // Let it settle. Heavy damping for the warm-up only, so the opening frame is
  // still, then the real damping takes over.
  for (let i = 0; i < settleSteps; i++) stepSling(state, holds, SLING.dt, 6);
  for (const limb of LIMBS) {
    const l = state.limbs[limb];
    l.tension = 0;
    l.heldT = 10;
    l.slip = 0;
    l.impact = 0;
  }
  state.t = 0;
  state.left = false;
  state.fallen = false;
  return state;
}

/**
 * A starting guess the warm-up can settle from without drama: standing on
 * whatever the feet have (footholds, or the mat), unless the hands cannot
 * reach from there, in which case hanging from the hands.
 */
function slingSeed(contacts: Contact[]): { hip: Vec2; shoulder: Vec2 } {
  if (contacts.length === 0) return seedPoseFor(contacts);
  const hands = contacts.filter((c) => isHand(c.limb));
  const feet = contacts.filter((c) => !isHand(c.limb));
  const cx = contacts.reduce((s, c) => s + c.pos.x, 0) / contacts.length;
  const footY = feet.length ? Math.max(...feet.map((c) => c.pos.y)) : FOOT_FLOOR;
  let hipY = footY + LEG_STAND * 0.95;
  if (hands.length) {
    const handY = Math.min(...hands.map((c) => c.pos.y));
    // Arms are only so long, in both directions.
    hipY = clamp(hipY, handY - ARM_MAX * 0.92 - BODY.torso, handY + ARM_MAX * 0.9 - BODY.torso);
  }
  return { hip: { x: cx, y: hipY }, shoulder: { x: cx, y: hipY + BODY.torso } };
}

export function cloneSling(s: SlingState): SlingState {
  const limbs = {} as Record<LimbId, SlingLimb>;
  for (const limb of LIMBS) {
    const l = s.limbs[limb];
    limbs[limb] = {
      ...l, pos: { ...l.pos }, vel: { ...l.vel }, prev: { ...l.prev },
      touch: l.touch ? { ...l.touch, at: { ...l.touch.at } } : null,
      flagAt: l.flagAt ? { ...l.flagAt } : null,
    };
  }
  return {
    ...s,
    hip: { ...s.hip }, hipV: { ...s.hipV },
    shoulder: { ...s.shoulder }, shV: { ...s.shV },
    limbs,
    reachHome: s.reachHome ? { hip: { ...s.reachHome.hip }, shoulder: { ...s.reachHome.shoulder }, t: s.reachHome.t } : null,
    reachPose: s.reachPose ? { hip: { ...s.reachPose.hip }, shoulder: { ...s.reachPose.shoulder } } : null,
    smears: s.smears ? s.smears.map((h) => ({ ...h, pos: { ...h.pos } })) : [],
  };
}

// --- launching -----------------------------------------------------------

/** Whether this limb can be picked up and thrown right now. */
export function canLaunch(state: SlingState, limb: LimbId): boolean {
  return !state.fallen && state.limbs[limb].phase !== 'flying';
}

/**
 * Turns a pull into a launch. The pull is the input: how far back you dragged
 * is how hard it goes, and it goes the opposite way to the drag, which is what
 * a slingshot does.
 */
export function aimFromPull(limb: LimbId, pull: Vec2, maxPull: number): LaunchAim {
  const l = len(pull);
  if (l < 1e-6) return { limb, dir: { x: 0, y: 1 }, power: 0 };
  return {
    limb,
    dir: { x: -pull.x / l, y: -pull.y / l },
    power: clamp01(l / maxPull),
  };
}

/**
 * Where a limb is drawn back to while it is being pulled: along the pull, as
 * far as the pull is long, and never further from its anchor than the limb is
 * long. This is where it launches from, so the band visibly snaps through.
 */
export function windupPos(state: SlingState, limb: LimbId, pull: Vec2, power: number): Vec2 {
  const l = state.limbs[limb];
  const dir = norm(pull);
  const target = {
    x: l.pos.x + dir.x * SLING.windup * clamp01(power),
    y: l.pos.y + dir.y * SLING.windup * clamp01(power),
  };
  const anchor = anchorFor(limb, state.hip, state.shoulder);
  const max = (isHand(limb) ? ARM_MAX : LEG_MAX) * 0.97;
  const d = sub(target, anchor);
  const L = len(d);
  if (L > max) {
    target.x = anchor.x + (d.x / L) * max;
    target.y = anchor.y + (d.y / L) * max;
  }
  if (target.y < groundOf(state) + LIMB_CLEARANCE) target.y = groundOf(state) + LIMB_CLEARANCE;
  return target;
}

/** How much of a full throw a tired body still has. */
export function powerScale(state: SlingState): number {
  return 0.78 + 0.22 * condOf(state).power;
}

/** A foot leaving its smear takes the smear with it. */
function dropSmear(state: SlingState, l: SlingLimb): void {
  if (l.holdId !== null && l.holdId < 0 && state.smears) {
    state.smears = state.smears.filter((h) => h.id !== l.holdId);
  }
}

/** Launch speed for a pull, metres per second. */
export function launchSpeed(limb: LimbId, power: number): number {
  return clamp01(power) * maxSpeedOf(limb);
}

/**
 * Lets go of whatever the limb was on and throws it. Mutates the state. Returns
 * false when the limb is already in the air or the pull was too small to mean
 * anything.
 */
export function launch(state: SlingState, aim: LaunchAim, events: SlingEvent[] = []): boolean {
  if (!canLaunch(state, aim.limb)) return false;
  if (aim.power < SLING.minPower) return false;
  // A reach for a hold: where the body has to be to get the limb onto it.
  let pose: { hip: Vec2; shoulder: Vec2 } | null = null;
  if (aim.target) {
    const p = poseFor(reachEnvelope(state, aim.limb), aim.target.at, { hip: state.hip, shoulder: state.shoulder });
    pose = { hip: { ...p.hip }, shoulder: { ...p.shoulder } };
  }
  const l = state.limbs[aim.limb];
  const d = norm(aim.dir);
  // Tired arms throw shorter: the same pull is less of a throw.
  const speed = launchSpeed(aim.limb, aim.power) * powerScale(state);

  // Where it left from: whatever is touching that spot cannot grab it back
  // before it has gone anywhere.
  l.launchAt = l.holdId !== null ? { ...l.pos } : null;
  l.leftHoldId = l.holdId;
  dropSmear(state, l);
  l.holdId = null;
  l.onFloor = false;
  l.touch = null;
  l.brushedChip = false;
  l.slip = 0;
  l.impact = 0;
  l.flag = false;
  l.flagAt = null;
  if (aim.from) l.pos = { ...aim.from };
  l.phase = 'flying';
  l.flightT = 0;
  l.heldT = 0;
  l.tension = 0;
  l.capacity = 0;
  l.seat = 0;
  l.zone = null;
  l.grade = null;

  l.launchDir = { ...d };
  l.target = aim.target?.id ?? null;
  state.reachPose = pose;
  state.reachHome = { hip: { ...state.hip }, shoulder: { ...state.shoulder }, t: 0 };
  const bodyV = isHand(aim.limb) ? state.shV : state.hipV;
  l.vel = { x: bodyV.x + d.x * speed, y: bodyV.y + d.y * speed };
  l.prev = { ...l.pos };

  // The lunge. Nobody throws a hand at a hold without the shoulder going too.
  const kick = speed * SLING.recoil;
  bodyV.x += d.x * kick;
  bodyV.y += d.y * kick;

  events.push({ kind: 'launch', limb: aim.limb, from: { ...l.pos }, power: aim.power });
  return true;
}

/**
 * Pumping out. The hands open — that is all — and the physics does the rest:
 * feet on holds peel, feet on nothing fall, and either way the mat is next.
 * Each forearm has its own pump, so `hands` says which ones have gone: one
 * blown arm opens one hand, and the other is left holding the lot.
 */
export function pumpOut(state: SlingState, events: SlingEvent[] = [], hands: readonly LimbId[] = ['LH', 'RH']): boolean {
  if (state.fallen) return false;
  let opened = 0;
  for (const id of hands) {
    const l = state.limbs[id];
    if (l.phase !== 'held') continue;
    release(state, l, [], 'Pumped stupid. Arms opened on their own.');
    opened++;
  }
  if (opened === 0) return false;
  events.push({ kind: 'pumped', at: { ...state.shoulder }, hands: opened });
  return true;
}

/**
 * Taking a hand off on purpose: it comes off the hold and hangs, to be shaken
 * out and put back on. Nothing else changes — whatever was on that hand is
 * now on everything else, and if that is not enough, the physics says so.
 */
export function letGo(state: SlingState, limb: LimbId): boolean {
  const l = state.limbs[limb];
  if (state.fallen || !isHand(limb) || l.phase !== 'held' || l.holdId === null) return false;
  release(state, l, [], '');
  return true;
}

/** Load through the hands that are holding something, body weights. */
export function handLoad(state: SlingState): { load: number; hands: number } {
  let load = 0;
  let hands = 0;
  for (const id of ['LH', 'RH'] as LimbId[]) {
    const l = state.limbs[id];
    if (l.phase !== 'held' || l.holdId === null) continue;
    load += l.tension;
    hands++;
  }
  return { load, hands };
}

/** How far the wall leans at a height on it, radians. */
export function wallAngle(state: SlingState, y: number): number {
  return angleAt(state.profile, y);
}

/** How far the wall leans where the body is: the middle of the torso. */
export function bodyAngle(state: SlingState): number {
  return angleAt(state.profile, (state.hip.y + state.shoulder.y) / 2);
}

/**
 * What the pump reads off the body this instant: the wall where it is, what
 * is holding on, and how much it is moving. Feet on the mat only count once
 * the climber has left it; before that, nothing costs anything.
 */
export function postureOf(state: SlingState): Posture {
  let hands = 0;
  let feet = 0;
  let reaching = false;
  const held = { LH: false, RH: false } as Record<ArmId, boolean>;
  const shaking = { LH: false, RH: false } as Record<ArmId, boolean>;
  const footSupport: FootSupport[] = [];
  const grip = { LH: 1, RH: 1 } as Record<ArmId, number>;
  const com = centreOfMass(state);
  for (const id of LIMBS) {
    const l = state.limbs[id];
    if (l.phase === 'flying') reaching = true;
    if (isHand(id) && l.phase === 'free' && !state.dyno) shaking[id as ArmId] = true;
    if (l.phase !== 'held') continue;
    if (isHand(id)) {
      hands++;
      held[id as ArmId] = true;
      const list = state.holdsRef;
      const hold = list ? holdIn(state, list, l.holdId) : undefined;
      if (hold) {
        const anchor = anchorFor(id, state.hip, state.shoulder);
        grip[id as ArmId] = gripCost(hold, {
          limb: id, force: pullDirection(hold, l, anchor), angle: angleAt(state.profile, hold.pos.y),
          opposition: state.tech?.opposition[id] ?? null,
        });
        // Hanging off something you are about to lose is the most expensive
        // thing a forearm does: the closer to letting go, the harder you squeeze.
        const ratio = (l.demand ?? 0) / Math.max(l.capacity, 1e-3);
        grip[id as ArmId] *= 1 + 0.9 * smoothstep(0.55, 1.0, ratio);
      }
    } else {
      feet++;
      footSupport.push(footSupportOf(state, l, com));
    }
  }
  const flag = state.tech?.flag;
  if (flag && state.limbs[flag.limb].phase === 'free') footSupport.push({ support: 0.18 * flag.counter, hooked: false });
  return {
    angle: bodyAngle(state),
    hands,
    feet,
    speed: bodySpeed(state),
    reaching: reaching || state.dyno,
    grounded: !state.left,
    held,
    shaking,
    leftShare: hands === 2 ? leftShareOf(state, com) : undefined,
    footSupport,
    grip,
    core: (state.tech?.active ?? []).reduce((n, t) => n + (CORE_TECH[t] ?? 0), 0),
  };
}

/** How much each technique asks of the core while it is held, per second of effort. */
const CORE_TECH: Partial<Record<TechniqueId, number>> = {
  toeHook: 0.5, heelHook: 0.25, compression: 0.35, flag: 0.15, cutLoose: 0.6, dropKnee: 0.1, stem: 0.1,
};

/** Where the weight is: hips and shoulders, by their masses. */
function centreOfMass(state: SlingState): Vec2 {
  const m = SLING.massHip + SLING.massShoulder;
  return {
    x: (state.hip.x * SLING.massHip + state.shoulder.x * SLING.massShoulder) / m,
    y: (state.hip.y * SLING.massHip + state.shoulder.y * SLING.massShoulder) / m,
  };
}

/** 0 at `a`, 1 at `b`, smooth in between. */
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * How good a foot is to stand on, 0..1, from where it is against the body.
 * Under the hips is a foot you can stand on; up by the hips is a rockover at
 * best; at full stretch, or way out to the side of where the weight is, it is
 * only touching. A hook is a different thing: it pulls, and holds well.
 */
function footSupportOf(state: SlingState, l: SlingLimb, com: Vec2, holds?: Hold[]): FootSupport {
  const below = state.hip.y - l.pos.y;
  const under = 0.25 + 0.75 * smoothstep(-0.15, 0.5, below);
  const reach = dist(anchorFor(l.id, state.hip, state.shoulder), l.pos) / LEG_MAX;
  const stretch = 1 - 0.6 * smoothstep(0.85, 1.0, reach);
  const out = 1 - 0.45 * smoothstep(0.35, 0.95, Math.abs(l.pos.x - com.x));
  let support = under * stretch * out;
  const hooked = !!l.hooked && l.holdId !== null;
  // A drop knee: the foot is level with the hips and out wide, the knee
  // turned in. On steep ground that foot carries weight a flat foot could not.
  const twist = !hooked && !!state.tech?.dropKnee[l.id];
  if (twist) support = Math.max(support, 0.72);
  // A bad foot takes less off the hands, however well it is placed.
  const list = holds ?? state.holdsRef;
  const hold = list ? holdIn(state, list, l.holdId) : undefined;
  if (hold) {
    const cap = capacityOf(hold, l, anchorFor(l.id, state.hip, state.shoulder), state);
    support *= 0.45 + 0.55 * smoothstep(0.25, 1.3, cap);
  }
  return { support: hooked ? Math.max(support, 0.85) : support, hooked, twist };
}

/**
 * How much of the arms' load is on the left hand when both are on: the body
 * hangs between them, and the hand nearer under the weight takes more. Hang
 * the hips under one hand and the other goes light.
 */
function leftShareOf(state: SlingState, com: Vec2): number {
  const lx = state.limbs.LH.pos.x;
  const rx = state.limbs.RH.pos.x;
  const span = rx - lx;
  if (Math.abs(span) < 0.08) return 0.5;
  const raw = (rx - com.x) / span;
  // Never all of it: the light hand is still balancing.
  return 0.2 + 0.6 * smoothstep(0, 1, raw);
}

export type DynoAim = {
  dir: Vec2;
  power: number;
  /**
   * How far the body has been drawn back against its limbs when it lets go,
   * from where it is. Left out, it fires from where it is.
   */
  wind?: Vec2;
};

/** A limb that is on something: a hold or the mat. On a dyno, these are the bands. */
export function isBand(l: SlingLimb): boolean {
  return l.phase === 'held' || l.onFloor;
}

/**
 * How far the body is drawn back for a dyno: along the pull, as far as the
 * pull is long, and no further than every limb that is on something can
 * stretch. Those limbs stay put; they are the band.
 */
export function dynoWindup(state: SlingState, pull: Vec2, power: number): Vec2 {
  const dir = norm(pull);
  const full = SLING.dynoWindup * clamp01(power);
  const fits = (k: number) => {
    const off = { x: dir.x * full * k, y: dir.y * full * k };
    const hip = { x: state.hip.x + off.x, y: state.hip.y + off.y };
    const shoulder = { x: state.shoulder.x + off.x, y: state.shoulder.y + off.y };
    return LIMBS.every((id) => {
      const l = state.limbs[id];
      if (!isBand(l)) return true;
      const max = (isHand(id) ? ARM_MAX : LEG_MAX) * 0.97;
      const d = dist(anchorFor(id, hip, shoulder), l.pos);
      // Already past it: fine as long as the pull does not make it worse.
      return d <= Math.max(max, dist(anchorFor(id, state.hip, state.shoulder), l.pos));
    });
  };
  let k = 1;
  if (!fits(1)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    k = lo;
  }
  const off = { x: dir.x * full * k, y: dir.y * full * k };
  // The hips do not go through the mat.
  const floorHip = groundOf(state) + FOOT_FLOOR + LEG_STAND * 0.45;
  if (state.hip.y + off.y < floorHip) off.y = Math.min(0, floorHip - state.hip.y);
  return off;
}

/** Whether the climber has anything to jump off. */
export function canDyno(state: SlingState): boolean {
  return !state.fallen && !state.dyno && heldCount(state) > 0;
}

export function dynoSpeed(power: number): number {
  return clamp01(power) * SLING.maxDynoSpeed;
}

/**
 * The dyno. Everything lets go at once and the whole body is the thing that
 * flies. The hands lead, reaching for whatever is up there, and either one
 * of them finds a hold on the way past or the mat finds the climber. There
 * is no partial credit: it is the most committing move on the wall and it
 * should feel like it. Whether the climber has earned
 * a dyno at all is the meter's business (`juice.ts`), not the body's.
 */
export function dyno(state: SlingState, aim: DynoAim, events: SlingEvent[] = []): boolean {
  if (!canDyno(state)) return false;
  if (aim.power < SLING.minPower) return false;
  const d = norm(aim.dir);
  const speed = dynoSpeed(aim.power) * (0.8 + 0.2 * condOf(state).power);
  if (aim.wind) {
    // The body lets go from where it was drawn back to. Whatever was not
    // holding on comes with it; the limbs that were are where they are.
    const w = aim.wind;
    const shift = (p: Vec2) => { p.x += w.x; p.y += w.y; };
    shift(state.hip);
    shift(state.shoulder);
    for (const id of LIMBS) {
      const l = state.limbs[id];
      if (!isBand(l)) shift(l.pos);
    }
  }
  const from = { ...state.hip };

  for (const id of LIMBS) {
    const l = state.limbs[id];
    l.leftHoldId = l.phase === 'held' ? l.holdId : l.leftHoldId;
    dropSmear(state, l);
    l.holdId = null;
    l.slip = 0;
    l.impact = 0;
    l.flag = false;
    l.flagAt = null;
    l.onFloor = false;
    l.tension = 0;
    l.capacity = 0;
    l.seat = 0;
    l.zone = null;
    l.grade = null;
    l.heldT = 0;
    l.touch = null;
    l.brushedChip = false;
    l.target = null;
    l.prev = { ...l.pos };
    if (isHand(id)) {
      l.phase = 'flying';
      l.flightT = 0;
      l.vel = {
        x: state.shV.x + d.x * speed * (1 + SLING.dynoReach),
        y: state.shV.y + d.y * speed * (1 + SLING.dynoReach),
      };
    } else {
      l.phase = 'free';
      l.flightT = 0;
      l.vel = { x: state.hipV.x + d.x * speed, y: state.hipV.y + d.y * speed };
    }
  }
  state.hipV.x += d.x * speed;
  state.hipV.y += d.y * speed;
  state.shV.x += d.x * speed;
  state.shV.y += d.y * speed;
  state.dyno = true;
  state.left = true;
  state.reachHome = null;
  state.reachPose = null;
  events.push({ kind: 'dyno', from, power: aim.power });
  return true;
}

/**
 * Holds a dangling limb can simply be put back on: in reach of where its
 * shoulder or hip is right now, usable by it, and not already full. Putting a
 * limb on does not move the body; getting somewhere further is a throw.
 */
export function placeableHolds(state: SlingState, holds: Hold[], limb: LimbId): Hold[] {
  const l = state.limbs[limb];
  if (l.phase !== 'free' || state.fallen) return [];
  // Nobody puts a foot back on while the body is still swinging past it.
  if (bodySpeed(state) > PLACE_SWING) return [];
  const anchor = anchorFor(limb, state.hip, state.shoulder);
  const max = isHand(limb) ? ARM_MAX : LEG_MAX;
  const blocked = blockedHolds(state, holds, limb);
  return holds.filter((h) => {
    if (!canUse(h.type, limb) || blocked.has(h.id)) return false;
    const z = worldZones(h)[0];
    return dist(anchor, z.pos) <= max;
  });
}

/**
 * Puts a dangling limb straight back on a hold. No flight, no throw: this is
 * the climber reaching for something that is right there. It is only for
 * limbs that are hanging — a limb that is holding on has to be flung.
 */
export function placeLimb(
  state: SlingState, limb: LimbId, holdId: number, holds: Hold[], events: SlingEvent[] = [],
): boolean {
  const hold = placeableHolds(state, holds, limb).find((h) => h.id === holdId);
  if (!hold) return false;
  const l = state.limbs[limb];
  const z = worldZones(hold)[0];
  l.phase = 'held';
  l.holdId = hold.id;
  l.onFloor = false;
  l.pos = { ...z.pos };
  l.prev = { ...z.pos };
  l.vel = { x: 0, y: 0 };
  l.seat = 1;
  l.zone = z.name;
  l.grade = STUCK;
  l.heldT = 0;
  l.tension = 0;
  l.touch = null;
  l.leftHoldId = null;
  l.slip = 0;
  l.impact = 0;
  l.flag = false;
  l.flagAt = null;
  swapOff(state, l, events);
  l.capacity = capacityOf(hold, l, anchorFor(limb, state.hip, state.shoulder), state);
  events.push({ kind: 'place', limb, holdId: hold.id, at: { ...l.pos } });
  return true;
}

/** Fastest the body can be moving for a dangling limb to be put straight back on, m/s. */
export const PLACE_SWING = 0.9;

/** A foot arriving on the other foot's hold: the other one comes off. */
function swapOff(state: SlingState, l: SlingLimb, events: SlingEvent[]): void {
  if (isHand(l.id) || l.holdId === null) return;
  for (const o of ['LF', 'RF'] as LimbId[]) {
    if (o === l.id) continue;
    const other = state.limbs[o];
    if (other.phase === 'held' && other.holdId === l.holdId) {
      release(state, other, [], '');
      events.push({ kind: 'tech', limb: l.id, tech: 'footSwap', at: { ...l.pos } });
    }
  }
}

// --- reach -----------------------------------------------------------------

const envCache = new WeakMap<SlingState, { key: string; env: Record<string, Envelope> }>();

/**
 * Everywhere a limb can get to from here, with the body free to move after
 * it as far as everything still on the wall allows (`reach.ts`). This, not a
 * circle round the shoulder, is the reach.
 */
export function reachEnvelope(state: SlingState, limb: LimbId): Envelope {
  const key = [state.hip.x, state.hip.y, state.shoulder.x, state.shoulder.y,
    ...LIMBS.flatMap((id) => [state.limbs[id].pos.x, state.limbs[id].pos.y, state.limbs[id].phase, state.limbs[id].hooked ? 1 : 0])].join(',');
  let c = envCache.get(state);
  if (!c || c.key !== key) {
    c = { key, env: {} };
    envCache.set(state, c);
  }
  if (!c.env[limb]) {
    const limbs = {} as Record<LimbId, { pos: Vec2; held: boolean; hooked?: boolean }>;
    for (const id of LIMBS) {
      const l = state.limbs[id];
      limbs[id] = { pos: l.pos, held: l.phase === 'held', hooked: l.hooked };
    }
    c.env[limb] = envelopeOf({ hip: state.hip, shoulder: state.shoulder, limbs }, limb, REACH_LIMITS);
  }
  return c.env[limb];
}

/** Whether a limb can get to a point from here, the body coming with it. */
export function canReach(state: SlingState, _holds: Hold[], limb: LimbId, p: Vec2): boolean {
  return inEnvelope(reachEnvelope(state, limb), p);
}

/** How far either side of the pull a hold can be and still be the one reached for, radians. */
const TARGET_CONE = 0.5;
/** And for the hold the aim is already on, so it does not flicker off it. */
const TARGET_STICKY = 0.7;
/** And for a hold another limb is already on: only straight at it. */
const TARGET_MATCH = 0.12;

/**
 * Which hold a pull is reaching for. The direction says where; how hard says
 * how far, as a share of everything the envelope allows that way — a light
 * pull takes the near hold, a full one the far one. Any hold in the envelope
 * can be picked this way, whatever is in front of it. Null when nothing in
 * reach is anywhere near the way the pull points.
 */
export function pickTarget(
  state: SlingState, holds: Hold[], aim: LaunchAim, prefer: number | null = null,
): Hold | null {
  if (state.fallen || aim.power < SLING.minPower) return null;
  const l = state.limbs[aim.limb];
  const from = aim.from ?? l.pos;
  const env = reachEnvelope(state, aim.limb);
  const dir = norm(aim.dir);
  const far = Math.max(envelopeExtent(env, from, dir), 0.3);
  const want = clamp01(aim.power) * far;
  const chosen = Math.atan2(dir.y, dir.x);
  // Matching is something to mean: a hold another limb is on is only reached
  // for when the pull points right at it.
  const taken = new Set(LIMBS.filter((id) => id !== aim.limb).map((id) => state.limbs[id].holdId));
  let best: Hold | null = null;
  let bestScore = Infinity;
  for (const h of reachableHolds(state, holds, aim.limb)) {
    if (h.id === l.holdId) continue;
    const to = sub(h.pos, from);
    const d = len(to);
    if (d < 0.05) continue;
    const gap = angleGap(Math.atan2(to.y, to.x), chosen);
    const cone = taken.has(h.id) ? TARGET_MATCH : h.id === prefer ? TARGET_STICKY : TARGET_CONE;
    if (gap > cone) continue;
    const score = Math.abs(d - want) / far + 0.5 * (gap / TARGET_CONE) - (h.id === prefer ? 0.15 : 0);
    if (score < bestScore) { bestScore = score; best = h; }
  }
  return best;
}

/** The reach envelope's edge, as a ring of points round the limb's anchor, for drawing. */
export function reachOutline(state: SlingState, limb: LimbId, n = 96): Vec2[] {
  return envelopeOutline(reachEnvelope(state, limb), anchorFor(limb, state.hip, state.shoulder), n);
}

// --- holds ---------------------------------------------------------------

/** Holds a limb cannot land on because something is already there. */
export function blockedHolds(state: SlingState, holds: Hold[], except: LimbId): Set<number> {
  const byId = holdMap(holds);
  const count = new Map<number, number>();
  for (const limb of LIMBS) {
    if (limb === except) continue;
    const l = state.limbs[limb];
    if (l.phase === 'held' && l.holdId !== null) {
      count.set(l.holdId, (count.get(l.holdId) ?? 0) + 1);
    }
  }
  const blocked = new Set<number>();
  for (const [id, n] of count) {
    const h = byId.get(id);
    if (!h) continue;
    // A foot can take a hold the other foot is on: the other one hops off.
    // That is a foot swap, and it is how you change feet on a small edge.
    const swap = !isHand(except) && n === 1 && LIMBS.some((o) => o !== except && !isHand(o) && state.limbs[o].holdId === id);
    if (swap) continue;
    if (n >= 2 || !canShare(h.size, h.type)) blocked.add(id);
  }
  return blocked;
}

/** Closest point on segment ab to p, and its distance. */
function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { at: Vec2; d: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = 0;
  if (l2 > 1e-12) t = clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2);
  const at = { x: a.x + abx * t, y: a.y + aby * t };
  return { at, d: dist(p, at) };
}

/**
 * How well a landing point sits on a hold, 0..1. Inside a zone it is that
 * zone's quality tapering to its edge; outside every zone it is a scrape on
 * the blank part of the shape.
 */
export function seatOn(hold: Hold, at: Vec2): { seat: number; zone: string } {
  let best = { seat: 0, zone: 'the blank part' };
  for (const z of worldZones(hold)) {
    const d = dist(at, z.pos);
    const r = Math.max(z.r, 1e-6);
    const q = d <= r
      ? z.quality * (1 - 0.35 * (d / r))
      : z.quality * Math.max(0, 0.65 - ((d - r) / r) * 0.5);
    if (q > best.seat) best = { seat: q, zone: z.name };
  }
  best.seat = Math.max(best.seat, 0.12);
  return best;
}

export function gradeOfSeat(seat: number): Exclude<MoveGrade, 'MISS' | 'YEET'> {
  return seat >= 0.8 ? 'PERFECT' : seat >= 0.55 ? 'GOOD' : 'SCRAPE';
}

/**
 * There is one way to stick. A limb that gets to a hold has it, all of it,
 * wherever on the hold it landed; a limb that does not get there has nothing.
 * The grade vocabulary is older than that rule, so a stick is recorded as
 * the top grade.
 */
export const STUCK = 'PERFECT' as const;

/**
 * Direction the climber is actually loading a hold, from where the anchor of
 * the limb has ended up. This is what makes an undercling useless with your
 * hips below it: the pull is down, the hold wants up. A hand with the
 * shoulders over it on a hold that faces up is pressing down on it: a mantle.
 */
function pullDirection(hold: Hold, limb: SlingLimb, anchor: Vec2): Vec2 {
  let base = norm(sub(anchor, hold.pos));
  if (profileOf(hold.type).push) base = { x: -base.x, y: -base.y };
  // A hooked foot pulls the way a hand does.
  if (!isHand(limb.id) && limb.hooked) return base;
  if (!isHand(limb.id)) {
    // Feet press down into the hold whatever the hips are doing.
    return norm({ x: -base.x * 0.3, y: -0.7 - Math.abs(base.y) * 0.3 });
  }
  // Pressing on top of a hold: the force goes down into it.
  if (anchor.y > hold.pos.y + 0.08 && Math.sin(hold.dir) < -0.3 && !profileOf(hold.type).push) {
    return norm({ x: -base.x * 0.4, y: -1 });
  }
  return base;
}

/** 0..1, how happy the hold is with the direction it is being loaded. */
export function loadAlignment(hold: Hold, pull: Vec2): number {
  const p = profileOf(hold.type);
  const want = { x: Math.cos(hold.dir), y: Math.sin(hold.dir) };
  const alignment = clamp01((want.x * pull.x + want.y * pull.y + 1) / 2);
  return clamp01(1 - p.directionality * (1 - alignment) * 2.1);
}

/**
 * The load a hold will take through this limb before it starts to go, in
 * body weights: the shape, its size, the way it is being loaded, how far the
 * wall leans, and what the body has left (`grip.ts`). A jug takes a swinging
 * body on one arm; a crimp a still one; a sloper on a roof almost nothing.
 */
export function capacityOf(hold: Hold, limb: SlingLimb, anchor: Vec2, state?: SlingState): number {
  const cond = state ? condOf(state) : FRESH;
  const tech = state?.tech;
  const angle = state ? angleAt(state.profile, hold.pos.y) : 0;
  const hand = isHand(limb.id);
  const matched = hand && !!state && limb.holdId !== null
    && LIMBS.some((id) => id !== limb.id && isHand(id) && state.limbs[id].phase === 'held' && state.limbs[id].holdId === limb.holdId);
  return holdCapacity(hold, {
    limb: limb.id,
    force: pullDirection(hold, limb, anchor),
    angle,
    grip: hand ? cond.grip[limb.id as 'LH' | 'RH'] : undefined,
    core: cond.core,
    opposition: tech?.opposition[limb.id] ?? null,
    hooked: !hand && !!limb.hooked,
    matched,
  });
}

// --- the step ------------------------------------------------------------

function damp(v: Vec2, rate: number, dt: number): void {
  const k = Math.exp(-rate * dt);
  v.x *= k;
  v.y *= k;
}

/**
 * Advances the world by one fixed step. Mutates the state and appends whatever
 * happened to `events`. `extraDamp` is only for the warm-up settle.
 */
export function stepSling(
  state: SlingState, holds: Hold[], dt: number = SLING.dt, extraDamp = 0, events: SlingEvent[] = [],
): SlingEvent[] {
  if (state.fallen) return events;
  const map = holdMap(holds);
  const holdAt = (id: number | null) => holdIn(state, holds, id);
  state.holdsRef = holds;
  const g = SLING.gravity;
  const cond = condOf(state);
  const g0 = groundOf(state);
  const W = bodyMass() * g;
  const lean = bodyAngle(state);
  const hang = Math.sin(lean);
  const footAuthority = footShare(lean);

  // Hooks. A foot on a hold that is above the hips, or on a roof, can hold
  // the body the way a hand does once the leg goes tight: a heel or toe hook.
  let hooks = 0;
  for (const id of ['LF', 'RF'] as LimbId[]) {
    const l = state.limbs[id];
    l.hooked = false;
    if (l.phase !== 'held' || l.holdId === null) continue;
    const canHook = l.pos.y > state.hip.y - 0.05 || angleAt(state.profile, l.pos.y) > ROOF_ANGLE;
    if (!canHook) continue;
    l.hooked = true;
    if (dist(anchorFor(id, state.hip, state.shoulder), l.pos) > LEG_MAX * 0.95) hooks++;
  }
  /** Hands on, or the body hanging off a hooked foot: either keeps it on the wall. */
  const hanging = (n: number) => n > 0 || hooks > 0;
  state.tech = readTechnique(state, (id) => holdAt(id), (y) => angleAt(state.profile, y));

  // A flagged leg stays pressed on the wall where it was put, moving with the
  // hips, until it is thrown again or there is nothing left to flag against.
  for (const id of ['LF', 'RF'] as LimbId[]) {
    const l = state.limbs[id];
    l.releasedT = (l.releasedT ?? 10) + dt;
    if (!l.flag || l.phase !== 'free' || !l.flagAt) continue;
    const anyHand = state.limbs.LH.phase === 'held' || state.limbs.RH.phase === 'held';
    if (!anyHand || state.dyno) { l.flag = false; l.flagAt = null; continue; }
    l.pos = { x: state.hip.x + l.flagAt.x, y: Math.max(g0 + LIMB_CLEARANCE, state.hip.y + l.flagAt.y) };
    l.vel = { ...state.hipV };
  }
  for (const id of ['LH', 'RH'] as LimbId[]) state.limbs[id].releasedT = (state.limbs[id].releasedT ?? 10) + dt;

  // A limb in the air on purpose: the body is going after it, and the feet
  // stay on while it does — a climber reaching does not step off their feet.
  const home = state.reachHome && state.reachHome.t > 0 && !state.dyno ? state.reachHome : null;
  const reaching = !state.dyno && (LIMBS.some((id) => state.limbs[id].phase === 'flying') || !!home);

  // Counted at the end of the previous step, not the start of this one, so a
  // launch between steps still reads as letting go.
  const heldBefore = state.heldLast;

  // --- 1. forces -----------------------------------------------------------
  // Gravity, with an overhang costing the arms more than the feet can give back
  // — less whatever the limbs still on are carrying while one reaches.
  const carried = reaching ? Math.min(1, SLING.reachCarry * heldCount(state)) : 0;
  state.hipV.y -= g * (1 + 0.25 * hang) * (1 - carried) * dt;
  state.shV.y -= g * (1 + 0.25 * hang) * (1 - carried) * dt;
  if (state.reachPose && reaching && !home && heldCount(state) > 0) {
    // Reaching for a hold: the climber moves their body to where the limb
    // gets there — hips over, torso leaning, as little as it takes.
    const to = state.reachPose;
    for (const [p, v, q] of [[state.hip, state.hipV, to.hip], [state.shoulder, state.shV, to.shoulder]] as const) {
      v.x += ((q.x - p.x) * SLING.reachReturn - v.x * SLING.reachReturnDamp) * dt;
      v.y += ((q.y - p.y) * SLING.reachReturn - v.y * SLING.reachReturnDamp) * dt;
    }
  }
  if (home) {
    // Missed: back in to where the reach started, as long as something is on to pull from.
    if (heldCount(state) > 0) {
      for (const [p, v, to] of [[state.hip, state.hipV, home.hip], [state.shoulder, state.shV, home.shoulder]] as const) {
        v.x += ((to.x - p.x) * SLING.reachReturn - v.x * SLING.reachReturnDamp) * dt;
        v.y += ((to.y - p.y) * SLING.reachReturn - v.y * SLING.reachReturnDamp) * dt;
      }
    }
    home.t -= dt;
    if (home.t <= 0) state.reachHome = null;
  }

  let handsOn = 0;
  // Muscle: the spring part of each limb's load, on top of what the rope carries.
  const legLoad = { LH: 0, RH: 0, LF: 0, RF: 0 } as Record<LimbId, number>;
  for (const id of LIMBS) {
    const l = state.limbs[id];
    if (l.phase !== 'held') {
      // A thrown limb flies flat; on a dyno the hands fall with the body,
      // because the body is the thing that was thrown.
      const flat = l.phase === 'flying' && !state.dyno;
      const goal = flat && l.target != null ? map.get(l.target) : undefined;
      if (goal) {
        // A reach for a hold: the climber puts the limb on it. Straight
        // there, at least briskly, the body coming along behind.
        const to = sub(goal.pos, l.pos);
        const d = len(to);
        if (d > 1e-6) {
          const speed = Math.max(len(l.vel), SLING.reachSpeed);
          l.vel = { x: (to.x / d) * speed, y: (to.y / d) * speed };
        }
        continue;
      }
      l.vel.y -= g * (flat ? SLING.flyGravity : 1) * dt;
      continue;
    }
    const anchor = anchorFor(id, state.hip, state.shoulder);
    const d = sub(anchor, l.pos);
    const L = len(d);
    if (L < 1e-6) continue;
    const n = { x: d.x / L, y: d.y / L };
    if (isHand(id)) {
      handsOn++;
      // Lock-off: the arm pulls the shoulder in toward the hold, up to a bent
      // arm. Not enough to do a pull-up on one arm; enough to sit up on two.
      const above = clamp01((-n.y - 0.2) / 0.5);
      if (L > ARM_LOCK && above > 0) {
        const f = SLING.armPull * (0.55 + 0.45 * cond.power) * W * clamp01((L - ARM_LOCK) / (BODY.arm * 0.2)) * above;
        state.shV.x -= (n.x * f / SLING.massShoulder) * dt;
        state.shV.y -= (n.y * f / SLING.massShoulder) * dt;
        legLoad[id] = f;
      }
    } else {
      // Standing up: a leg is a strut that pushes the hip away from the foot,
      // and it only does that when the foot is somewhere below the hip. A foot
      // above the hip is a heel hook, and heel hooks hold, they do not lift.
      // A foot below the hip pushes along the leg; a foot at or above the hip
      // is a high step, and the climber rocks onto it — the push goes straight
      // up, and it is weaker, because that is a rockover and not a stand.
      const high = n.y <= 0.1;
      const up = high ? 0.55 : clamp01(0.55 + (n.y - 0.1) / 0.6);
      // A foot only carries weight the hips are somewhere over. Past a normal
      // stance width the strut would just shove the hips sideways, which is
      // not what a leg does — the foot skates instead.
      const over = clamp01(1 - Math.max(0, Math.abs(d.x) - STANCE_WIDTH) / 0.35);
      if (L < LEG_STAND && over > 0) {
        // Soft over part of a knee's bend, so two feet at slightly different
        // heights share the weight instead of the higher one shoving the hips
        // sideways. The push is mostly up: knees bend, struts do not. And it
        // moves the whole body rather than just the hip, so a sideways push
        // does not spin the torso — the core, not the pelvis, decides that.
        // Standing up is a push, not a spring: damped along the leg so a
        // freshly placed foot stands the climber up rather than bouncing them
        // off it.
        const vn = state.hipV.x * n.x + state.hipV.y * n.y;
        const spring = SLING.legPush * W * clamp01((LEG_STAND - L) / (BODY.leg * 0.14));
        const f = Math.max(0, spring - SLING.legDamp * W * Math.max(0, vn)) * up * over * footAuthority;
        const px = high ? 0 : n.x * 0.45;
        const py = high ? 1 : n.y * 0.45 + 0.55;
        const pl = Math.hypot(px, py);
        const ax = (px / pl) * f / (SLING.massHip + SLING.massShoulder);
        const ay = (py / pl) * f / (SLING.massHip + SLING.massShoulder);
        state.hipV.x += ax * dt;
        state.hipV.y += ay * dt;
        state.shV.x += ax * dt;
        state.shV.y += ay * dt;
        legLoad[id] = f;
      }
    }
  }

  // No hand on: the wall stops holding you against it. Something has to make
  // a climber standing on two footholds with nothing in their hands fall off,
  // because a wall does — and in a flat sim, this is that something.
  // Righting: pull the hips back over the support. Feet define the base.
  {
    let sx = 0;
    let sw = 0;
    for (const id of LIMBS) {
      const l = state.limbs[id];
      if (l.phase !== 'held') continue;
      const w = isHand(id) ? 1 : 1.4;
      sx += l.pos.x * w;
      sw += w;
    }
    // Nothing rights a body with no hand on it: that is the whole reason it
    // is about to leave.
    if (sw > 0 && (hanging(handsOn) || state.dyno)) {
      // Reaching, the climber leans out on purpose; the pull back comes after.
      // A flag on the far side of the weight is a counterweight: it holds
      // the body over its support the way a third limb would.
      const flagK = state.tech?.flag ? 1 + 0.9 * state.tech.flag.counter : 1;
      const a = (sx / sw - state.hip.x) * SLING.restore * flagK * g * (1 - carried);
      state.hipV.x += a * dt;
      state.shV.x += a * dt;
    }
  }

  const feetOnHolds = LIMBS.some((id) => !isHand(id) && state.limbs[id].phase === 'held' && state.limbs[id].holdId !== null);
  const dxT = state.shoulder.x - state.hip.x;
  if (hanging(handsOn) || state.dyno) {
    // Core: a torque that turns the torso back upright. Applied across the
    // torso rather than sideways, so it still has leverage when the body has
    // been swung a long way over. Beaten by a real swing, not by standing.
    const dyT = state.shoulder.y - state.hip.y;
    const tl = Math.max(Math.hypot(dxT, dyT), 1e-6);
    const theta = Math.atan2(dxT, dyT);
    // Unit vector along which the shoulder moves to lean further right.
    const tx = dyT / tl;
    const ty = -dxT / tl;
    const relV = (state.shV.x - state.hipV.x) * tx + (state.shV.y - state.hipV.y) * ty;
    const a = -(SLING.core * (0.55 + 0.45 * cond.core) * g * theta) - SLING.coreDamp * relV;
    // Internal: equal and opposite on the hip, so it turns the body without
    // dragging it across the wall.
    state.shV.x += a * tx * dt;
    state.shV.y += a * ty * dt;
    const r = SLING.massShoulder / SLING.massHip;
    state.hipV.x -= a * tx * r * dt;
    state.hipV.y -= a * ty * r * dt;
  } else if (feetOnHolds && state.left) {
    if (Math.abs(dxT) > 0.015) state.peelSign = Math.sign(dxT);
    state.shV.x += state.peelSign * SLING.peel * g * dt;
    state.hipV.x += state.peelSign * SLING.peel * 0.6 * g * dt;
  }

  damp(state.hipV, SLING.dampBody + extraDamp, dt);
  damp(state.shV, SLING.dampBody + extraDamp, dt);
  for (const id of LIMBS) {
    const l = state.limbs[id];
    if (l.phase === 'held') { l.vel.x = 0; l.vel.y = 0; continue; }
    damp(l.vel, (l.phase === 'flying' ? SLING.dampFlying : SLING.dampFree) + extraDamp, dt);
  }

  // Velocities the constraints are about to correct; the difference is the load.
  const hipVPred = { ...state.hipV };
  const shVPred = { ...state.shV };

  // --- 2. predict ----------------------------------------------------------
  const hip0 = { ...state.hip };
  const sh0 = { ...state.shoulder };
  state.hip.x += state.hipV.x * dt;
  state.hip.y += state.hipV.y * dt;
  state.shoulder.x += state.shV.x * dt;
  state.shoulder.y += state.shV.y * dt;
  const tip0 = {} as Record<LimbId, Vec2>;
  for (const id of LIMBS) {
    const l = state.limbs[id];
    tip0[id] = { ...l.pos };
    l.prev = { ...l.pos };
    if (l.phase === 'held') continue;
    l.pos.x += l.vel.x * dt;
    l.pos.y += l.vel.y * dt;
  }

  // --- 3. constraints --------------------------------------------------------
  let pressTop: number | null = null;
  for (const id of ['LH', 'RH'] as LimbId[]) {
    const l = state.limbs[id];
    if (l.phase === 'held') pressTop = Math.max(pressTop ?? -Infinity, l.pos.y + REACH_PRESS);
  }
  const corr = { LH: 0, RH: 0, LF: 0, RF: 0 } as Record<LimbId, number>;
  const footPopped = new Set<LimbId>();
  const wHip = 1 / SLING.massHip;
  const wSh = 1 / SLING.massShoulder;

  for (let it = 0; it < SLING.iterations; it++) {
    // Rigid torso.
    {
      const d = sub(state.shoulder, state.hip);
      const L = len(d);
      if (L > 1e-9) {
        const C = L - BODY.torso;
        const nx = d.x / L;
        const ny = d.y / L;
        const wsum = wHip + wSh;
        state.hip.x += nx * C * (wHip / wsum);
        state.hip.y += ny * C * (wHip / wsum);
        state.shoulder.x -= nx * C * (wSh / wsum);
        state.shoulder.y -= ny * C * (wSh / wsum);
      }
    }

    for (const id of LIMBS) {
      const l = state.limbs[id];
      const hand = isHand(id);
      const body = hand ? state.shoulder : state.hip;
      const wb = hand ? wSh : wHip;
      const anchor = anchorFor(id, state.hip, state.shoulder);
      const d = sub(l.pos, anchor);
      const L = len(d);
      if (L < 1e-9) continue;
      const nx = d.x / L;
      const ny = d.y / L;

      const minL = hand ? ARM_MIN : LEG_MIN;
      const maxL = hand ? ARM_MAX : LEG_MAX;

      if (l.phase === 'held') {
        // Pinned tip: all the correction lands on the body.
        if (!hand && L > maxL && !l.hooked && !reaching) {
          // A foot standing on something cannot hang from it. Fall away from
          // it and it is gone. A hooked one can. While a limb is reaching the
          // feet are where the body pushes from, so they bound it instead.
          footPopped.add(id);
          continue;
        }
        // A standing foot bounds a reach a little short of full stretch, so
        // the body it lets go to is one the foot can still stand under.
        const holdL = !hand && reaching && !l.hooked ? maxL * REACH_FOOT : maxL;
        if (L > holdL) {
          const C = L - holdL;
          body.x += nx * C;
          body.y += ny * C;
          corr[id] += C;
        } else if (L < minL) {
          const C = minL - L;
          body.x -= nx * C;
          body.y -= ny * C;
        }
        continue;
      }

      const wt = 1 / limbMass(l);
      const wsum = wt + wb;
      if (L > maxL) {
        const C = L - maxL;
        // Free reach: a limb at full stretch does not swing round a fixed
        // shoulder — the body goes after it, hips shifting and torso leaning.
        // Everything still on the wall pulls the body back to where it can
        // be, and the limb stops there (below): that is the edge of the reach.
        // A foot going up past a high step is a hook, and the hips do not
        // climb after it: that is the old tether, the limb stopping.
        const follows = l.phase === 'flying' && reaching && (hand || l.pos.y <= state.hip.y + HIGH_STEP);
        const toLimb = follows ? 0 : wt / wsum;
        l.pos.x -= nx * C * toLimb;
        l.pos.y -= ny * C * toLimb;
        body.x += nx * C * (1 - toLimb);
        body.y += ny * C * (1 - toLimb);
      } else if (L < minL && !(l.phase === 'flying' && reaching)) {
        // (A limb reaching past its own shoulder or hip goes by in front of
        // it — a knee bends, an arm crosses — rather than bouncing off it.)
        const C = minL - L;
        l.pos.x += nx * C * (wt / wsum);
        l.pos.y += ny * C * (wt / wsum);
        body.x -= nx * C * (wb / wsum);
        body.y -= ny * C * (wb / wsum);
      }
    }

    // With a hand on, the climber does not invert: past about forty degrees
    // of lean it stops reading as a climber fighting a swing and starts
    // reading as a dropped puppet. Without a hand on, tumble away.
    if (hanging(handsOn) || state.dyno) {
      const tx = state.shoulder.x - state.hip.x;
      const ty = state.shoulder.y - state.hip.y;
      const theta = Math.atan2(tx, ty);
      if (Math.abs(theta) > MAX_LEAN) {
        const capped = Math.sign(theta) * MAX_LEAN;
        state.shoulder.x = state.hip.x + Math.sin(capped) * BODY.torso;
        state.shoulder.y = state.hip.y + Math.cos(capped) * BODY.torso;
      }
    }

    // Reaching, the shoulders go no higher than a press over the hands that
    // are holding them: a climber pulls up to a hold, they do not float over it.
    if (reaching && pressTop !== null && state.shoulder.y > pressTop) state.shoulder.y = pressTop;

    // The mat. Bodies stop at it; so do limbs — and while anything is still
    // holding on, a loose limb does not get that far: only a fall puts a
    // hand or a foot on the ground.
    if (state.hip.y < g0 + MAT_HIP_MIN) state.hip.y = g0 + MAT_HIP_MIN;
    if (state.shoulder.y < g0 + MAT_SHOULDER_MIN) state.shoulder.y = g0 + MAT_SHOULDER_MIN;
    const floorY = groundFloor(state);
    for (const id of LIMBS) {
      const l = state.limbs[id];
      if (l.phase !== 'held' && l.pos.y < floorY) {
        l.pos.y = floorY;
        if (l.vel.y < 0) l.vel.y = 0;
      }
    }
  }

  // A reaching limb goes as far as the body could follow it, and no further.
  if (reaching) {
    for (const id of LIMBS) {
      const l = state.limbs[id];
      if (l.phase !== 'flying') continue;
      const anchor = anchorFor(id, state.hip, state.shoulder);
      const max = isHand(id) ? ARM_MAX : LEG_MAX;
      const d = sub(l.pos, anchor);
      const L = len(d);
      if (L > max) {
        l.pos.x = anchor.x + (d.x / L) * max;
        l.pos.y = anchor.y + (d.y / L) * max;
      }
    }
  }

  // --- 4. velocities from what actually happened ----------------------------
  state.hipV = { x: (state.hip.x - hip0.x) / dt, y: (state.hip.y - hip0.y) / dt };
  state.shV = { x: (state.shoulder.x - sh0.x) / dt, y: (state.shoulder.y - sh0.y) / dt };
  for (const id of LIMBS) {
    const l = state.limbs[id];
    if (l.phase === 'held') continue;
    l.vel = { x: (l.pos.x - tip0[id].x) / dt, y: (l.pos.y - tip0[id].y) / dt };
    l.taut = false;
    if (l.phase !== 'flying' || state.dyno) continue;
    // Full stretch: the throw stops going sideways relative to the body.
    const hand = isHand(id);
    const anchor = anchorFor(id, state.hip, state.shoulder);
    const d = sub(l.pos, anchor);
    const L = len(d);
    if (L < (hand ? ARM_MAX : LEG_MAX) * 0.995) continue;
    l.taut = true;
    const bv = hand ? state.shV : state.hipV;
    const n = { x: d.x / L, y: d.y / L };
    const rel = { x: l.vel.x - bv.x, y: l.vel.y - bv.y };
    const along = rel.x * n.x + rel.y * n.y;
    const keep = Math.exp(-SLING.tautArrest * dt);
    const lost = { x: (rel.x - n.x * along) * (1 - keep), y: (rel.y - n.y * along) * (1 - keep) };
    l.vel.x -= lost.x;
    l.vel.y -= lost.y;
    // Where that went: into the body, which is what swings it round.
    const share = limbMass(l) / (hand ? SLING.massShoulder : SLING.massHip);
    bv.x += lost.x * share;
    bv.y += lost.y * share;
  }

  // --- 5. what the holds think of all this ------------------------------------
  // Total impulse the constraints put through the body this step. Summing each
  // rope's own corrections over the iterations counts the same load ten times,
  // because the torso keeps handing it back; the net change in momentum does
  // not. Hands share it out by how much pulling each one had to do.
  const netImpulse =
    SLING.massHip * Math.hypot(state.hipV.x - hipVPred.x, state.hipV.y - hipVPred.y)
    + SLING.massShoulder * Math.hypot(state.shV.x - shVPred.x, state.shV.y - shVPred.y);
  let corrSum = 0;
  for (const id of LIMBS) corrSum += corr[id];

  // What the arms are carrying with the body where it is: the feet take what
  // they can and the hands the rest, split by where the weight hangs. The
  // rope's own load says what a swing adds on top.
  const statics = staticHandLoads(state, holds);
  for (const id of LIMBS) {
    const l = state.limbs[id];
    if (l.phase !== 'held') continue;
    l.heldT += dt;
    if (footPopped.has(id)) {
      // Stepping off the mat is not a slip, it is leaving.
      release(state, l, l.onFloor ? [] : events, 'Foot came off. Body went the other way.');
      continue;
    }
    if (l.holdId === null) continue; // standing on the mat: it holds
    const hold = holdAt(l.holdId);
    if (!hold) continue;
    // The tread wall: a hold that has gone under the bottom of the panel is gone.
    if (g0 > 0 && hold.pos.y < g0 + 0.12) {
      release(state, l, events, isHand(id) ? 'The hold went under the floor. So did you.' : 'That foot went under the floor.');
      continue;
    }

    const share = corrSum > 1e-9 ? corr[id] / corrSum : 0;
    const inst = Math.min(((netImpulse * share) / dt + legLoad[id]) / W, 12);
    l.tension += (inst - l.tension) * Math.min(1, dt / SLING.tensionTau);
    l.impact = (l.impact ?? 0) * Math.exp(-dt / IMPACT_TAU);

    const anchor = anchorFor(id, state.hip, state.shoulder);
    const full = capacityOf(hold, l, anchor, state);
    l.capacity = full * establishFactor(hold.type, l.heldT);
    const base = isHand(id) ? Math.max(l.tension, statics[id as 'LH' | 'RH']) : l.tension;
    l.demand = base + (l.impact ?? 0);
    if (extraDamp === 0) {
      l.slip = stepSlip(l.slip ?? 0, l.demand / Math.max(l.capacity, 1e-3), dt);
      if ((l.slip ?? 0) >= 1) release(state, l, events, slipReason(hold, l, anchor, state));
    }
  }

  // --- 6. flights ------------------------------------------------------------
  for (const id of LIMBS) {
    const l = state.limbs[id];
    if (l.phase !== 'flying') continue;
    l.flightT += dt;

    const blocked = blockedHolds(state, holds, id);
    // The hold the tip is passing through this step, if any.
    let near: { hold: Hold; at: Vec2; d: number } | null = null;
    const passing = state.dyno && l.vel.y > SLING.dynoPass;
    if (passing) l.touch = null;
    const aimedAt = !state.dyno && l.target != null ? map.get(l.target) : undefined;
    for (const h of passing ? [] : aimedAt ? [aimedAt] : holds) {
      if (blocked.has(h.id)) continue;
      if (!canUse(h.type, id)) {
        if (closestOnSegment(h.pos, l.prev, l.pos).d <= contactRadius(h.size, h.type)) l.brushedChip = true;
        continue;
      }
      // The hold you let go of does not grab you back. Fall past it and the
      // hand is dangling next to it, and that is a fling to fix, not a freebie.
      if (h.id === l.leftHoldId) continue;
      // Nor does the jug right next to it, while the limb is still leaving:
      // a foot thrown off a chip is not caught by the hand hold beside it.
      if (!aimedAt && l.launchAt && dist(h.pos, l.launchAt) < LAUNCH_CLEAR && dist(l.pos, l.launchAt) < LAUNCH_CLEAR + 0.08) continue;
      const r = contactRadius(h.size, h.type);
      const { at, d } = closestOnSegment(h.pos, l.prev, l.pos);
      if (d <= r && (!near || d < near.d)) near = { hold: h, at, d };
    }

    // A hand closes on the hold where it passes closest to it, not where it
    // first brushes the edge — so a throw through the middle of a jug gets the
    // middle of the jug, and one that clips the rim gets the rim.
    let caught: { hold: Hold; at: Vec2 } | null = null;
    if (near && (!l.touch || l.touch.holdId !== near.hold.id)) {
      l.touch = { holdId: near.hold.id, d: near.d, at: near.at };
    } else if (near && l.touch && near.d < l.touch.d) {
      l.touch = { holdId: near.hold.id, d: near.d, at: near.at };
    } else if (l.touch) {
      // Moving away from the closest point, or out the far side: grab it there.
      const hold = map.get(l.touch.holdId);
      if (hold) caught = { hold, at: l.touch.at };
      l.touch = null;
    }

    if (caught) {
      // Got there: it sticks. All of it, wherever on the hold it landed.
      const speed = len(l.vel);
      const { zone } = seatOn(caught.hold, caught.at);
      const seat = 1;
      const grade = STUCK;
      l.phase = 'held';
      l.holdId = caught.hold.id;
      l.onFloor = false;
      l.seat = seat;
      l.zone = zone;
      l.grade = grade;
      l.heldT = 0;
      l.tension = 0;
      l.flightT = 0;
      // Settle into the part of the shape it found.
      const z = worldZones(caught.hold).find((w) => w.name === zone);
      const target = z ? z.pos : caught.hold.pos;
      const pull = 0.9;
      l.pos = {
        x: caught.at.x + (target.x - caught.at.x) * pull,
        y: caught.at.y + (target.y - caught.at.y) * pull,
      };
      l.vel = { x: 0, y: 0 };
      l.slip = 0;
      // Arriving moving is a load the hold has to stop, on top of the body's
      // weight, and it lands while the hand is still closing.
      const bodyV = isHand(id) ? state.shV : state.hipV;
      const arrive = len(bodyV);
      l.impact = arrive * (state.dyno ? 0.18 : IMPACT_PER_MS);
      l.capacity = capacityOf(caught.hold, l, anchorFor(id, state.hip, state.shoulder), state) * establishFactor(caught.hold.type, 0);
      swapOff(state, l, events);
      events.push({
        kind: 'catch', limb: id, holdId: caught.hold.id, at: { ...l.pos }, grade, seat, zone, speed,
        dyno: state.dyno,
      });
      // A dynamic move caught at the top of its arc, when the body is barely
      // moving: the deadpoint. It is why a hard catch can stick.
      if (state.dyno && Math.abs(state.hipV.y) < 1.0 && isHand(id)) {
        events.push({ kind: 'tech', limb: id, tech: 'deadpoint', at: { ...l.pos } });
      }
      // A reach that lands is a climber arriving, not a body still flying:
      // they stop their weight where the move put it. (A dyno's catch is
      // the opposite — that is the whole point of it.)
      state.reachHome = null;
      state.reachPose = null;
      if (!state.dyno) {
        const keep = SLING.reachSettle;
        state.hipV.x *= keep; state.hipV.y *= keep;
        state.shV.x *= keep; state.shV.y *= keep;
      }
      // A hand on something: the dyno is over, whatever the other hand does.
      state.dyno = false;
      continue;
    }

    // A limb hanging under its anchor is dangling, not flying, however recently
    // it was thrown. Until then it can still catch something on the way down.
    const anchor = anchorFor(id, state.hip, state.shoulder);
    const limbLen = isHand(id) ? BODY.arm : BODY.leg;
    const hanging = l.flightT > 0.25 && l.pos.y < anchor.y - limbLen * 0.55 && len(l.vel) < 1.0;
    // Out at full stretch and no longer going the way it was thrown: that is
    // as far as this reach goes. A limb dragging the body along with it is
    // still going, however still it is against the body; one sagging back
    // under gravity is not, and the body does not go down with it.
    const dir = aimedAt ? norm(sub(aimedAt.pos, l.pos)) : l.launchDir ?? norm(l.vel);
    const onward = l.vel.x * dir.x + l.vel.y * dir.y;
    // A reach for a hold is not over until the body has had time to get there.
    const stalled = !aimedAt && l.taut && l.flightT > 0.12 && !state.dyno && onward < SLING.tautStall;
    const floored = l.pos.y <= groundFloor(state) + 0.005;
    const maxFlight = state.dyno ? SLING.dynoFlight : aimedAt ? SLING.reachFlightMax : SLING.flightMax;
    // A foot thrown at blank wall is put there: at the top of its arc it
    // presses on, as a smear or a flag, if the wall and the body allow it.
    const apex = !isHand(id) && !aimedAt && !state.dyno && l.flightT > 0.1 && l.vel.y - state.hipV.y < 0 && (l.launchDir?.y ?? 0) > -0.5;
    if (apex && pressFoot(state, l, events)) {
      state.reachPose = null;
      state.reachHome = null;
      continue;
    }
    if (l.flightT >= maxFlight || (hanging && !state.dyno) || stalled || floored) {
      // A foot that finds no hold is not necessarily wasted: pressed onto
      // blank wall below the hips it is a smear, out to the side it is a flag.
      if (!isHand(id) && !state.dyno && !floored && pressFoot(state, l, events)) {
        state.reachPose = null;
        state.reachHome = null;
        continue;
      }
      l.phase = 'free';
      l.touch = null;
      l.flightT = 0;
      if (!state.dyno && state.reachHome) state.reachHome.t = SLING.reachRecover;
      state.reachPose = null;
      events.push({
        kind: 'miss', limb: id, at: { ...l.pos },
        reason: state.dyno ? 'Caught nothing but air.' : missReason(state, l, holds),
      });
    }
  }
  // Both hands gave up: the dyno has failed, and now it is just a fall.
  if (state.dyno && !LIMBS.some((id) => isHand(id) && state.limbs[id].phase === 'flying')) {
    state.dyno = false;
  }

  // --- 7. the mat -----------------------------------------------------------
  // Feet never stand on the mat: the climber starts on the start holds, and
  // the ground is for falling onto. Off the ground is off it.
  if (!state.left) {
    const anyFloor = LIMBS.some((id) => state.limbs[id].onFloor);
    if (!anyFloor && state.hip.y > g0 + SLING.leftHip && handsOn > 0) state.left = true;
  }

  const heldNow = LIMBS.filter((id) => state.limbs[id].phase === 'held').length;
  // Letting go of everything is a fall, unless it is a dyno, which is a jump
  // until it isn't.
  if (state.left && heldNow === 0 && !state.dyno && (heldBefore > 0 || state.dynoLast)) {
    events.push({ kind: 'off', at: { ...state.hip } });
  }
  state.dynoLast = state.dyno;
  if (state.left && heldNow === 0 && state.hip.y <= g0 + SLING.matHip) {
    state.fallen = true;
    state.dyno = false;
    events.push({ kind: 'fell', at: { ...state.hip }, from: peakOf(state) });
  }
  state.heldLast = heldNow;

  state.t += dt;
  return events;
}

/**
 * How low a limb that is not on anything may go: the clearance while any
 * limb is still on something (or a dyno is in the air), the floor itself
 * once nothing is — that is a fall, and a fall ends on the ground.
 */
function groundFloor(state: SlingState): number {
  const holding = state.dyno || LIMBS.some((id) => state.limbs[id].phase === 'held');
  return groundOf(state) + (holding && !state.fallen ? LIMB_CLEARANCE : FLOOR + 0.02);
}

/** Highest the hip could sensibly have fallen from: for the thud, not the sim. */
function peakOf(state: SlingState): number {
  return Math.max(state.hip.y, state.shoulder.y);
}

function release(state: SlingState, l: SlingLimb, events: SlingEvent[], reason: string): void {
  const holdId = l.holdId;
  dropSmear(state, l);
  l.slip = 0;
  l.impact = 0;
  l.demand = 0;
  l.releasedT = 0;
  l.phase = 'free';
  l.holdId = null;
  l.onFloor = false;
  l.leftHoldId = holdId;
  l.tension = 0;
  l.heldT = 0;
  l.seat = 0;
  l.zone = null;
  l.grade = null;
  const bodyV = isHand(l.id) ? state.shV : state.hipV;
  l.vel = { x: bodyV.x, y: bodyV.y };
  if (reason) events.push({ kind: 'slip', limb: l.id, holdId, reason });
}

function slipReason(hold: Hold, l: SlingLimb, anchor: Vec2, state: SlingState): string {
  const label = profileOf(hold.type).label.toLowerCase();
  const angle = loadAlignment(hold, pullDirection(hold, l, anchor));
  if (!isHand(l.id)) {
    if (hold.type === 'smear') return 'The smear skated. Hips were not over it.';
    if (wallAngleAtHold(state, hold) > 0.35) return `Foot popped off the ${label}. Steep ground needs core to keep feet on.`;
    return `Foot skated off the ${label}.`;
  }
  if (l.heldT < ESTABLISH_TIME) return `Arrived too fast for a ${label}. Slow down into it, or deadpoint.`;
  if (angle < 0.5) return `Wrong angle on the ${label}. Get your body under the way it pulls.`;
  const cond = condOf(state);
  if (cond.grip[l.id as 'LH' | 'RH'] < 0.45) return `Too pumped to hold the ${label}.`;
  if ((l.impact ?? 0) > 0.2 || bodySpeed(state) > 1.2) return `Too much swing for a ${label}.`;
  return `Not enough on your feet for a ${label}. It peeled.`;
}

function wallAngleAtHold(state: SlingState, hold: Hold): number {
  return angleAt(state.profile, hold.pos.y);
}

/** Body weights of extra load per m/s the body is moving when a reach lands. */
const IMPACT_PER_MS = 0.32;
/** How fast arriving load dies away, seconds. */
const IMPACT_TAU = 0.14;

/**
 * Smearing and flagging: a foot put on blank wall. Below the hips, on wall
 * that is not too steep for rubber, it stands — a smear, as good as the
 * friction and the angle allow. Out to the side it is a flag: it carries
 * nothing, and holds the body against the barn door. Returns false when it
 * is neither, and the foot just dangles.
 */
function pressFoot(state: SlingState, l: SlingLimb, events: SlingEvent[]): boolean {
  const g0 = groundOf(state);
  if (l.pos.y < g0 + LIMB_CLEARANCE + 0.1) return false;
  const handOn = state.limbs.LH.phase === 'held' || state.limbs.RH.phase === 'held';
  if (!handOn) return false;
  const hipDist = dist(anchorFor(l.id, state.hip, state.shoulder), l.pos);
  if (hipDist > LEG_MAX * 1.02 || hipDist < BODY.leg * 0.35) return false;
  const angle = angleAt(state.profile, l.pos.y);
  const below = state.hip.y - l.pos.y;
  if (below > 0.2 && angle < SMEAR_MAX_ANGLE && Math.abs(l.pos.x - state.hip.x) < 0.55) {
    const id = SMEAR_ID[l.id as 'LF' | 'RF'];
    const smear: Hold = { id, pos: { ...l.pos }, type: 'smear', size: 0.08, dir: -Math.PI / 2 };
    state.smears = [...(state.smears ?? []).filter((h) => h.id !== id), smear];
    l.phase = 'held';
    l.holdId = id;
    l.onFloor = false;
    l.vel = { x: 0, y: 0 };
    l.seat = 0.6;
    l.zone = 'rubber on the wall';
    l.grade = 'GOOD';
    l.heldT = 0;
    l.tension = 0;
    l.flightT = 0;
    l.slip = 0;
    l.impact = 0;
    l.touch = null;
    events.push({ kind: 'tech', limb: l.id, tech: 'smear', at: { ...l.pos } });
    return true;
  }
  if (Math.abs(l.pos.x - state.hip.x) > 0.22 && l.pos.y < state.hip.y + 0.25 && angle < ROOF_ANGLE) {
    l.phase = 'free';
    l.flag = true;
    l.flagAt = { x: l.pos.x - state.hip.x, y: l.pos.y - state.hip.y };
    l.vel = { ...state.hipV };
    l.touch = null;
    l.flightT = 0;
    events.push({ kind: 'tech', limb: l.id, tech: 'flag', at: { ...l.pos } });
    return true;
  }
  return false;
}

/** Steeper than this, radians, rubber on blank wall does not stand. */
const SMEAR_MAX_ANGLE = (28 * Math.PI) / 180;

/**
 * What each hand is carrying with the body held where it is, in body
 * weights: the share the feet leave the arms, split between the hands by
 * where the weight hangs. Steep ground puts more on them because the feet
 * do less there, not because gravity changes.
 */
export function staticHandLoads(state: SlingState, holds: Hold[]): Record<'LH' | 'RH', number> {
  const out = { LH: 0, RH: 0 };
  if (!state.left || state.dyno) return out;
  const com = centreOfMass(state);
  const held = { LH: state.limbs.LH.phase === 'held', RH: state.limbs.RH.phase === 'held' };
  const hands = (held.LH ? 1 : 0) + (held.RH ? 1 : 0);
  if (hands === 0) return out;
  const feet: FootSupport[] = [];
  for (const id of ['LF', 'RF'] as LimbId[]) {
    const l = state.limbs[id];
    if (l.phase === 'held') feet.push(footSupportOf(state, l, com, holds));
    else if (l.flag && state.tech?.flag?.limb === id) feet.push({ support: 0.18 * state.tech.flag.counter, hooked: false });
  }
  const arms = armShare({ angle: bodyAngle(state), hands, feet: feet.length, footSupport: feet });
  if (hands === 2) {
    const left = leftShareOf(state, com);
    out.LH = arms * left;
    out.RH = arms * (1 - left);
  } else if (held.LH) out.LH = arms;
  else out.RH = arms;
  return out;
}

function missReason(state: SlingState, l: SlingLimb, holds: Hold[]): string {
  // Went through a foot chip with a hand?
  if (l.brushedChip) return 'That is a foot chip. Nothing there for a hand.';
  let near = Infinity;
  for (const h of holds) near = Math.min(near, dist(h.pos, l.pos) - contactRadius(h.size, h.type));
  if (near < 0.12) return 'Brushed it. Did not grab it.';
  const anchor = anchorFor(l.id, state.hip, state.shoulder);
  const taut = dist(anchor, l.pos) > (isHand(l.id) ? ARM_MAX : LEG_MAX) * 0.97;
  if (taut && l.pos.y > anchor.y) return 'Out of reach. The body did not come.';
  if (l.pos.y < anchor.y) return 'Nothing there. It is dangling.';
  return 'A fistful of wall.';
}

// --- reading the state -----------------------------------------------------

/** Contacts in the old sim's vocabulary, so the stance analysis can be reused. */
export function contactsOf(state: SlingState): Contact[] {
  const out: Contact[] = [];
  for (const id of LIMBS) {
    const l = state.limbs[id];
    if (l.phase !== 'held' || l.holdId === null) continue;
    const grip = l.capacity > 0 ? clamp01(1 - l.tension / l.capacity) : 1;
    out.push({
      limb: id, holdId: l.holdId, pos: { ...l.pos }, seat: l.seat, grip,
      grade: l.grade ?? 'GOOD', zone: l.zone ?? '',
    });
  }
  return out;
}

/** The pose the renderer wants, read off the particles. */
export function poseOf(state: SlingState): Pose {
  const dx = state.shoulder.x - state.hip.x;
  const dy = state.shoulder.y - state.hip.y;
  const L = Math.max(Math.hypot(dx, dy), 1e-6);
  const ax = dx / L;
  const ay = dy / L;
  const com = {
    x: state.hip.x + dx * 0.34,
    y: state.hip.y + dy * 0.34,
  };
  const stance = analyseStance(contactsOf(state), com, bodyAngle(state));
  return {
    hip: { ...state.hip },
    shoulder: { ...state.shoulder },
    head: { x: state.shoulder.x + ax * BODY.head, y: state.shoulder.y + ay * BODY.head },
    com,
    lean: Math.atan2(dx, dy),
    ...stance,
  };
}

export function limbPositions(state: SlingState): Record<LimbId, Vec2> {
  const out = {} as Record<LimbId, Vec2>;
  for (const id of LIMBS) out[id] = { ...state.limbs[id].pos };
  return out;
}

export function heldCount(state: SlingState): number {
  return LIMBS.filter((id) => state.limbs[id].phase === 'held').length;
}

/** How fast the body is moving, for knowing when it has settled. */
export function bodySpeed(state: SlingState): number {
  return Math.max(len(state.hipV), len(state.shV));
}

/** Both hands on the finish and the body not still swinging: sent. */
export function isSlingSent(state: SlingState, finish: number[]): boolean {
  const lh = state.limbs.LH;
  const rh = state.limbs.RH;
  return lh.phase === 'held' && rh.phase === 'held'
    && lh.holdId !== null && rh.holdId !== null
    && finish.includes(lh.holdId) && finish.includes(rh.holdId)
    && bodySpeed(state) < 0.6;
}

export type Prediction = {
  /** Tip positions over the flight, one per step. */
  path: Vec2[];
  /** Where it ends up if it catches nothing. */
  end: Vec2;
  /** What it catches, if the body does what it is about to do. */
  caught: { holdId: number; at: Vec2; grade: Exclude<MoveGrade, 'MISS' | 'YEET'>; step: number } | null;
  /** Everything that lets go as a consequence, before the flight is over. */
  slips: LimbId[];
};

/**
 * Plays the launch forward on a copy, so the trajectory on screen is the
 * trajectory that will happen — tether going taut, body coming with it, and
 * all. Honest aiming was the old game's rule and it stays.
 */
export function predictLaunch(
  state: SlingState, holds: Hold[], aim: LaunchAim, seconds = 1.0,
): Prediction {
  const ghost = cloneSling(state);
  const events: SlingEvent[] = [];
  const path: Vec2[] = [];
  const slips: LimbId[] = [];
  if (!launch(ghost, aim, events)) {
    return { path, end: { ...state.limbs[aim.limb].pos }, caught: null, slips };
  }
  const steps = Math.round(seconds / SLING.dt);
  let caught: Prediction['caught'] = null;
  for (let i = 0; i < steps; i++) {
    events.length = 0;
    stepSling(ghost, holds, SLING.dt, 0, events);
    path.push({ ...ghost.limbs[aim.limb].pos });
    for (const e of events) {
      if (e.kind === 'catch' && e.limb === aim.limb && !caught) {
        caught = { holdId: e.holdId, at: e.at, grade: e.grade, step: i };
      }
      if (e.kind === 'slip') slips.push(e.limb);
    }
    if (caught) break;
    if (ghost.limbs[aim.limb].phase === 'free') break;
  }
  return { path, end: { ...ghost.limbs[aim.limb].pos }, caught, slips };
}

export type DynoPrediction = {
  /** Hip positions over the jump, one per step. */
  path: Vec2[];
  /** Hands that find something, in the order they do. */
  caught: { limb: LimbId; holdId: number; at: Vec2; grade: Exclude<MoveGrade, 'MISS' | 'YEET'> }[];
  /** Where the hands end up if nothing is caught. */
  hands: Vec2;
};

/** The dyno, run forward on a copy. What you see is what you get. */
export function predictDyno(
  state: SlingState, holds: Hold[], aim: DynoAim, seconds = 1.5,
): DynoPrediction {
  const ghost = cloneSling(state);
  const events: SlingEvent[] = [];
  const path: Vec2[] = [];
  const caught: DynoPrediction['caught'] = [];
  const hands = () => ({
    x: (ghost.limbs.LH.pos.x + ghost.limbs.RH.pos.x) / 2,
    y: (ghost.limbs.LH.pos.y + ghost.limbs.RH.pos.y) / 2,
  });
  if (!dyno(ghost, aim, events)) return { path, caught, hands: hands() };
  const steps = Math.round(seconds / SLING.dt);
  for (let i = 0; i < steps; i++) {
    events.length = 0;
    stepSling(ghost, holds, SLING.dt, 0, events);
    path.push({ ...ghost.hip });
    for (const e of events) {
      if (e.kind === 'catch') caught.push({ limb: e.limb, holdId: e.holdId, at: e.at, grade: e.grade });
    }
    const flying = LIMBS.some((id) => isHand(id) && ghost.limbs[id].phase === 'flying');
    if (!flying || ghost.fallen) break;
  }
  return { path, caught, hands: hands() };
}

/** Holds a limb could plausibly be thrown at from here: in its reach envelope, usable, not taken. */
export function reachableHolds(state: SlingState, holds: Hold[], limb: LimbId): Hold[] {
  return holdsInEnvelope(reachEnvelope(state, limb), holds, blockedHolds(state, holds, limb), -0.03);
}

/** How far off a hold a throw can be and still be steered onto it, radians. */
const ASSIST_CONE = 0.28;
/** How much the assist may add to or take off the pull, tried in this order. */
const ASSIST_POWER = [0, 0.06, 0.12, -0.06];
/** How much wider the cone is for the hold the aim is already locked onto. */
const STICKY_CONE = 1.5;
/** Most throws the assist will play forward looking for a catch, per aim. */
const ASSIST_TRIES = 28;
/**
 * Either side of the plain arc to feel for the real one, radians. Close in
 * first: the tether and the body bend the real arc a little, and the window
 * a throw catches through can be a degree wide.
 */
const ASSIST_NUDGES = [0, 0.02, -0.02, 0.045, -0.045, 0.07, -0.07, 0.1, -0.1];

/**
 * Launch angle that puts a thrown limb through a point, ignoring the tether
 * and the air: the plain arc. Of the two answers (flat and lobbed), the one
 * nearer the angle the player chose. Null when the throw is too weak to get
 * there at all.
 */
export function arcAngle(from: Vec2, to: Vec2, speed: number, near: number): number | null {
  const g = SLING.gravity * SLING.flyGravity;
  const x = to.x - from.x;
  const y = to.y - from.y;
  const v2 = speed * speed;
  if (Math.abs(x) < 1e-4) return y > 0 && v2 >= 2 * g * y ? Math.PI / 2 : null;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0) return null;
  const r = Math.sqrt(disc);
  const flip = x < 0 ? Math.PI : 0;
  const a = Math.atan((v2 - r) / (g * x)) + flip;
  const b = Math.atan((v2 + r) / (g * x)) + flip;
  return angleGap(a, near) <= angleGap(b, near) ? a : b;
}

function angleGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return d;
}

function closestOnPath(path: Vec2[], p: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const q of path) {
    const d = dist(q, p);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

export type AssistedLaunch = {
  aim: LaunchAim;
  prediction: Prediction;
  /** The hold the throw was steered onto, when it needed steering. */
  assisted: number | null;
};

/**
 * Aim assist. A throw that is roughly at a hold in reach — pulled within a
 * few degrees of the arc that would get there, and about hard enough — is
 * steered onto it. The power moves as little as it can, and where on the hold
 * it lands stays the player's, as near as the hold allows. A throw that already catches something, or is nowhere near
 * anything, is left alone. What comes back is checked against the real
 * physics, so the arc on screen is still the arc that happens.
 */
export function assistLaunch(
  state: SlingState, holds: Hold[], aim: LaunchAim, seconds = 1.0, prefer: number | null = null,
): AssistedLaunch {
  // A reach for whatever hold in reach the pull points at, first.
  const hold = pickTarget(state, holds, aim, prefer);
  if (hold) {
    const reach = { ...aim, target: { id: hold.id, at: { ...hold.pos } } };
    const prediction = predictLaunch(state, holds, reach, Math.max(seconds, 1.5));
    if (prediction.caught?.holdId === hold.id) return { aim: reach, prediction, assisted: hold.id };
  }
  const raw = predictLaunch(state, holds, aim, seconds);
  if (raw.caught || aim.power < SLING.minPower) return { aim, prediction: raw, assisted: null };
  const l = state.limbs[aim.limb];
  const from = aim.from ?? l.pos;
  const chosen = Math.atan2(aim.dir.y, aim.dir.x);
  // Only empty holds: matching is something to mean, not something to be steered into.
  const taken = new Set(LIMBS.map((id) => state.limbs[id].holdId).filter((id) => id !== null));
  const inReach = reachableHolds(state, holds, aim.limb).filter((h) => !taken.has(h.id));
  let budget = ASSIST_TRIES;
  // A hold the aim is already locked onto stays locked a little further off
  // it than it took to lock on, so the arc does not flicker on and off a hold
  // while the finger settles.
  const sticky = prefer !== null ? inReach.find((h) => h.id === prefer) : undefined;

  // The player's power first; then a touch more, then a touch less. Judging
  // the pull is half of what makes an arc hard to read.
  for (const extra of ASSIST_POWER) {
    const power = clamp(aim.power + extra, SLING.minPower, 1);
    if (extra !== 0 && power === aim.power) continue;
    const speed = launchSpeed(aim.limb, power);
    const candidates: { hold: Hold; gap: number }[] = [];
    for (const h of inReach) {
      const a = arcAngle(from, h.pos, speed, chosen);
      if (a === null) continue;
      const gap = angleGap(a, chosen);
      const cone = h === sticky ? ASSIST_CONE * STICKY_CONE : ASSIST_CONE;
      if (gap <= cone) candidates.push({ hold: h, gap: h === sticky ? -1 : gap });
    }
    candidates.sort((p, q) => p.gap - q.gap);

    for (const { hold } of candidates.slice(0, 2)) {
      const cone = hold === sticky ? ASSIST_CONE * STICKY_CONE : ASSIST_CONE;
      // Keep the player's miss, shrunk to fit on the hold: a throw that was
      // low stays lowish, it just stops being a miss.
      const r = contactRadius(hold.size, hold.type);
      const near = closestOnPath(raw.path, hold.pos);
      let target = hold.pos;
      if (near) {
        const off = sub(near, hold.pos);
        const L = len(off);
        const keep = Math.min(L, r * 0.5);
        if (L > 1e-6) target = { x: hold.pos.x + (off.x / L) * keep, y: hold.pos.y + (off.y / L) * keep };
      }
      for (const t of [target, hold.pos]) {
        const a = arcAngle(from, t, speed, chosen);
        if (a === null) continue;
        // The tether and the body pull the real arc off the plain one a
        // little; feel either side of it.
        for (const nudge of ASSIST_NUDGES) {
          if (angleGap(a + nudge, chosen) > cone) continue;
          if (budget-- <= 0) return { aim, prediction: raw, assisted: null };
          const steered = { ...aim, power, dir: { x: Math.cos(a + nudge), y: Math.sin(a + nudge) } };
          const prediction = predictLaunch(state, holds, steered, seconds);
          if (prediction.caught?.holdId === hold.id) return { aim: steered, prediction, assisted: hold.id };
        }
      }
    }
  }
  return { aim, prediction: raw, assisted: null };
}

export const SLING_LIMITS = { ARM_MAX, LEG_MAX, ARM_LOCK, LEG_STAND } as const;

/** What a contact is doing, for the eye and for the tests. */
export type ContactState = 'free' | 'searching' | 'establishing' | 'engaged' | 'loaded' | 'slipping' | 'released' | 'flagging';

export function contactState(state: SlingState, limb: LimbId): ContactState {
  const l = state.limbs[limb];
  if (l.phase === 'flying') return 'searching';
  if (l.phase === 'free') {
    if (l.flag) return 'flagging';
    return (l.releasedT ?? 10) < 0.4 ? 'released' : 'free';
  }
  if (l.holdId === null) return 'engaged';
  if ((l.slip ?? 0) > 0.04) return 'slipping';
  if (l.heldT < ESTABLISH_TIME) return 'establishing';
  const ratio = (l.demand ?? 0) / Math.max(l.capacity, 1e-3);
  return ratio > 0.25 ? 'loaded' : 'engaged';
}

/** How close each contact is to going, 0 comfortable .. 1 gone: the larger of its load ratio and its slip. */
export function contactRisk(state: SlingState, limb: LimbId): number {
  const l = state.limbs[limb];
  if (l.phase !== 'held' || l.holdId === null) return 0;
  const ratio = (l.demand ?? 0) / Math.max(l.capacity, 1e-3);
  return clamp01(Math.max(l.slip ?? 0, (ratio - 0.5) / 0.5));
}
