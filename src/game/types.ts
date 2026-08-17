/**
 * Shared vocabulary for the climbing sim.
 *
 * World space is the wall plane: +X is right along the wall, +Y is up from the
 * mat, and everything is in metres. Holds live at Z = 0 and stick out toward
 * the camera; the sim itself is planar, which is what keeps it deterministic
 * and what keeps aiming honest.
 */

export type Vec2 = { x: number; y: number };

export type LimbId = 'LH' | 'RH' | 'LF' | 'RF';

export const LIMBS: readonly LimbId[] = ['LH', 'RH', 'LF', 'RF'] as const;

export const LIMB_LABEL: Record<LimbId, string> = {
  LH: 'Left hand',
  RH: 'Right hand',
  LF: 'Left foot',
  RF: 'Right foot',
};

export const LIMB_SHORT: Record<LimbId, string> = {
  LH: 'LH',
  RH: 'RH',
  LF: 'LF',
  RF: 'RF',
};

export function isHand(limb: LimbId): boolean {
  return limb === 'LH' || limb === 'RH';
}

export function isLeft(limb: LimbId): boolean {
  return limb === 'LH' || limb === 'LF';
}

/** The ten hold shapes the MVP wall is set with. */
export type HoldType =
  | 'jug'
  | 'crimp'
  | 'sloper'
  | 'pinch'
  | 'pocket'
  | 'sidepull'
  | 'undercling'
  | 'gaston'
  | 'foothold'
  | 'volume';

export type LimbAffinity = 'hand' | 'foot' | 'both';

/**
 * Static description of a hold type. Instances layer position, size and
 * orientation on top; everything here is what the *shape* is like to hold.
 */
export type HoldProfile = {
  type: HoldType;
  label: string;
  /** Who can usefully use it. Feet can smear anything, but badly. */
  affinity: LimbAffinity;
  /** Multiplier on the instance's contact radius. Big shapes forgive more. */
  zoneScale: number;
  /** Fraction of the contact zone that counts as a PERFECT landing. */
  perfectFrac: number;
  /**
   * How much the hold cares about the direction it is loaded from.
   * 0 = omnidirectional (jug), 1 = only works pulled exactly its own way.
   */
  directionality: number;
  /** Baseline grip the shape offers once you are on it, before quality. */
  gripBase: number;
  /** True for shapes you push away from you rather than hang off. */
  push: boolean;
  /** Penalty multiplier when the wrong kind of limb uses it. */
  crossUse: number;
  /** Flavour, shown in the inspect panel. Players learn the rest by falling. */
  note: string;
};

/** A hold as placed on a wall by a setter. */
export type Hold = {
  id: number;
  pos: Vec2;
  type: HoldType;
  /** Radius of the usable contact zone, in metres, before profile scaling. */
  size: number;
  /**
   * The direction the climber pulls it, in radians — the way a setter would
   * describe the hold out loud. 0 = +X (right), PI/2 = +Y (up).
   * A jug pulls down (-PI/2), an undercling pulls up (+PI/2), a sidepull on
   * your right pulls down-and-left, a gaston is pushed rather than pulled and
   * is flagged as such by its profile.
   */
  dir: number;
  /** Cosmetic rotation of the mesh, radians. Defaults to derived from dir. */
  roll?: number;
  /** Optional per-instance difficulty nudge, 0.7 (soft) .. 1.4 (spicy). */
  hard?: number;
  /** Marks the hold as part of the route's finish. */
  finish?: boolean;
};

/** Outcome tiers for a single limb move. */
export type MoveGrade = 'PERFECT' | 'GOOD' | 'SCRAPE' | 'MISS' | 'YEET';

export const MOVE_GRADE_ORDER: readonly MoveGrade[] = [
  'PERFECT',
  'GOOD',
  'SCRAPE',
  'MISS',
  'YEET',
] as const;

/** A limb that is currently touching something. */
export type Contact = {
  limb: LimbId;
  holdId: number;
  /** Where on the hold the limb actually sits (world space). */
  pos: Vec2;
  /**
   * Positional quality baked in when the limb landed, 0..1. Fixed for the life
   * of the contact — how well you placed it is history.
   */
  seat: number;
  /**
   * Live security, 0..1. Recomputed from the current pose every time the body
   * moves, because a sidepull that worked from one hip position stops working
   * from another.
   */
  grip: number;
  /** The landing tier that produced this contact. */
  grade: Exclude<MoveGrade, 'MISS' | 'YEET'>;
};

/** Full body pose produced by the solver. */
export type Pose = {
  hip: Vec2;
  shoulder: Vec2;
  head: Vec2;
  /** Centre of mass, the thing stability is judged on. */
  com: Vec2;
  /** Torso lean, radians from vertical. Positive leans right. */
  lean: number;
  /** 0..1, how composed the stance is. Feeds move quality. */
  tension: number;
  /** 0..1, how close to peeling off. Below FALL_THRESHOLD the climber is off. */
  stability: number;
  /** Signed barn-door torque; sign is the direction the body swings. */
  barnDoor: number;
};

export type Grade =
  | 'V0' | 'V1' | 'V2' | 'V3' | 'V4'
  | 'V5' | 'V6' | 'V7' | 'V8' | 'V9';

export const GRADES: readonly Grade[] = [
  'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9',
] as const;

export function gradeIndex(g: Grade): number {
  return GRADES.indexOf(g);
}

/** Where a limb starts before the climber has pulled on. */
export type StartAssignment = Partial<Record<LimbId, number>>;

export type Route = {
  id: string;
  name: string;
  grade: Grade;
  setter: string;
  /** Wall the route is set on. One wall in the MVP, but routes name it. */
  wall: string;
  holds: Hold[];
  /** Which hold each limb starts on. Feet may be omitted (start off the mat). */
  start: StartAssignment;
  /** Hold ids that finish the route. Matching both hands on one sends it. */
  finish: number[];
  /** Setter's expected move count. Efficiency is scored against this. */
  par: number;
  /** Dry one-liner shown on the route card. */
  tagline?: string;
  /** Set for generated routes so they can be rebuilt rather than stored. */
  seed?: number;
};
