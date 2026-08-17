import type { HoldProfile, HoldType, LimbId, Vec2 } from './types';
import { isHand } from './types';

/**
 * The shape table. Nothing here is exposed to the player as numbers — the
 * inspect panel shows the label and the note, and the rest is learned by
 * getting spat off a sloper you approached from the wrong angle.
 */
export const HOLD_PROFILES: Record<HoldType, HoldProfile> = {
  jug: {
    type: 'jug',
    label: 'Jug',
    affinity: 'both',
    zoneScale: 1.0,
    perfectFrac: 0.5,
    directionality: 0.05,
    gripBase: 1.0,
    push: false,
    crossUse: 0.9,
    note: 'A handle. Hard to get wrong.',
  },
  crimp: {
    type: 'crimp',
    label: 'Crimp',
    affinity: 'hand',
    zoneScale: 0.62,
    perfectFrac: 0.34,
    directionality: 0.4,
    gripBase: 0.74,
    push: false,
    crossUse: 0.45,
    note: 'An edge. Wants a straight downward pull.',
  },
  sloper: {
    type: 'sloper',
    label: 'Sloper',
    affinity: 'both',
    zoneScale: 1.35,
    perfectFrac: 0.3,
    directionality: 0.9,
    gripBase: 0.62,
    push: false,
    crossUse: 0.8,
    note: 'Big and round. Only holds if your weight hangs under it.',
  },
  pinch: {
    type: 'pinch',
    label: 'Pinch',
    affinity: 'hand',
    zoneScale: 0.8,
    perfectFrac: 0.38,
    directionality: 0.72,
    gripBase: 0.7,
    push: false,
    crossUse: 0.4,
    note: 'Squeeze it. Needs the approach it was set for.',
  },
  pocket: {
    type: 'pocket',
    label: 'Pocket',
    affinity: 'hand',
    zoneScale: 0.5,
    perfectFrac: 0.42,
    directionality: 0.34,
    gripBase: 0.8,
    push: false,
    crossUse: 0.3,
    note: 'Small opening. You either find it or you do not.',
  },
  sidepull: {
    type: 'sidepull',
    label: 'Sidepull',
    affinity: 'hand',
    zoneScale: 0.85,
    perfectFrac: 0.38,
    directionality: 0.95,
    gripBase: 0.78,
    push: false,
    crossUse: 0.5,
    note: 'Pull it sideways, into your body. Needs tension to work.',
  },
  undercling: {
    type: 'undercling',
    label: 'Undercling',
    affinity: 'hand',
    zoneScale: 0.95,
    perfectFrac: 0.4,
    directionality: 0.95,
    gripBase: 0.8,
    push: false,
    crossUse: 0.45,
    note: 'Faces down. Only useful once your hips are above it.',
  },
  gaston: {
    type: 'gaston',
    label: 'Gaston',
    affinity: 'hand',
    zoneScale: 0.85,
    perfectFrac: 0.36,
    directionality: 0.95,
    gripBase: 0.68,
    push: true,
    crossUse: 0.4,
    note: 'Thumb down, elbow out, push away. Feels wrong. Is correct.',
  },
  foothold: {
    type: 'foothold',
    label: 'Foothold',
    affinity: 'foot',
    zoneScale: 0.62,
    perfectFrac: 0.4,
    directionality: 0.3,
    gripBase: 0.85,
    push: false,
    crossUse: 0.35,
    note: 'For feet. Trust it more than you want to.',
  },
  volume: {
    type: 'volume',
    label: 'Volume',
    affinity: 'both',
    zoneScale: 1.7,
    perfectFrac: 0.26,
    directionality: 0.5,
    gripBase: 0.66,
    push: false,
    crossUse: 1.0,
    note: 'A large shape. Generous with position, stingy with security.',
  },
};

export function profileOf(type: HoldType): HoldProfile {
  return HOLD_PROFILES[type];
}

/** Radius of the usable contact zone for a hold instance, in metres. */
export function contactRadius(size: number, type: HoldType): number {
  return size * HOLD_PROFILES[type].zoneScale;
}

/** Radius of the sweet spot inside that zone. */
export function perfectRadius(size: number, type: HoldType): number {
  const p = HOLD_PROFILES[type];
  return size * p.zoneScale * p.perfectFrac;
}

/**
 * How badly this limb is misusing this shape. 1 = as intended.
 * Feet on hand holds and hands on footholds both work — just not well.
 */
export function affinityFactor(type: HoldType, limb: LimbId): number {
  const p = HOLD_PROFILES[type];
  if (p.affinity === 'both') return 1;
  const wantsHand = p.affinity === 'hand';
  return wantsHand === isHand(limb) ? 1 : p.crossUse;
}

/**
 * Whether a shape has room for two limbs at once. Matching both hands on the
 * finish jug is how a boulder problem ends, and matching mid-route is a real
 * move, but nobody is fitting two hands on a crimp.
 */
export function canShare(size: number, type: HoldType): boolean {
  return contactRadius(size, type) >= 0.09;
}

/** Unit vector of the force direction a hold instance accepts best. */
export function holdAxis(dir: number): Vec2 {
  return { x: Math.cos(dir), y: Math.sin(dir) };
}
