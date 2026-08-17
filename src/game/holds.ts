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
    zones: [
      { name: 'the incut', at: { x: 0, y: 0.12 }, r: 0.52, quality: 1 },
      { name: 'the lip', at: { x: 0, y: -0.55 }, r: 0.42, quality: 0.6 },
    ],
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
    zones: [
      { name: 'the edge', at: { x: 0, y: 0.18 }, r: 0.4, quality: 1 },
      { name: 'the corner', at: { x: -0.62, y: 0.1 }, r: 0.3, quality: 0.62 },
      { name: 'the corner', at: { x: 0.62, y: 0.1 }, r: 0.3, quality: 0.62 },
    ],
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
    zones: [
      { name: 'the high point', at: { x: 0, y: 0.34 }, r: 0.38, quality: 1 },
      { name: 'the slope', at: { x: 0, y: -0.2 }, r: 0.72, quality: 0.42 },
    ],
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
    zones: [
      { name: 'the squeeze', at: { x: 0, y: 0 }, r: 0.44, quality: 1 },
      { name: 'the flat side', at: { x: 0, y: -0.5 }, r: 0.4, quality: 0.5 },
    ],
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
    zones: [
      { name: 'two pads in', at: { x: 0, y: 0 }, r: 0.46, quality: 1 },
      { name: 'the rim', at: { x: 0, y: -0.5 }, r: 0.34, quality: 0.45 },
    ],
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
    zones: [
      { name: 'the rail', at: { x: 0, y: 0.15 }, r: 0.42, quality: 1 },
      { name: 'the low end', at: { x: 0, y: -0.6 }, r: 0.36, quality: 0.55 },
    ],
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
    zones: [
      { name: 'under the lip', at: { x: 0, y: 0.16 }, r: 0.46, quality: 1 },
      { name: 'the outside', at: { x: 0, y: -0.52 }, r: 0.38, quality: 0.5 },
    ],
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
    zones: [
      { name: 'the rail', at: { x: 0, y: 0.14 }, r: 0.42, quality: 1 },
      { name: 'the far end', at: { x: 0, y: -0.58 }, r: 0.34, quality: 0.48 },
    ],
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
    zones: [
      { name: 'the flat', at: { x: 0, y: 0.1 }, r: 0.5, quality: 1 },
      { name: 'the outside edge', at: { x: 0.58, y: -0.2 }, r: 0.34, quality: 0.55 },
      { name: 'the inside edge', at: { x: -0.58, y: -0.2 }, r: 0.34, quality: 0.55 },
    ],
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
    zones: [
      { name: 'the apex', at: { x: 0, y: 0.3 }, r: 0.34, quality: 1 },
      { name: 'the face', at: { x: -0.42, y: -0.2 }, r: 0.5, quality: 0.52 },
      { name: 'the face', at: { x: 0.42, y: -0.2 }, r: 0.5, quality: 0.52 },
      { name: 'the blank part', at: { x: 0, y: -0.66 }, r: 0.44, quality: 0.24 },
    ],
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

/** A hold's landing zones placed in world space, oriented the way it is set. */
export function worldZones(hold: {
  pos: Vec2; size: number; type: HoldType; dir: number;
}): { name: string; pos: Vec2; r: number; quality: number }[] {
  const p = HOLD_PROFILES[hold.type];
  const radius = contactRadius(hold.size, hold.type);
  // Zone offsets are authored against the hold's own "up", which is the
  // direction it is pulled. Rotating them means a sidepull's rail runs along
  // the rail, not wherever the authoring happened to put it.
  const a = hold.dir - Math.PI / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return p.zones.map((z) => ({
    name: z.name,
    r: z.r * radius,
    quality: z.quality,
    pos: {
      x: hold.pos.x + (z.at.x * cos - z.at.y * sin) * radius,
      y: hold.pos.y + (z.at.x * sin + z.at.y * cos) * radius,
    },
  }));
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
