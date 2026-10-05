import type { Hold } from '../game/types';

/**
 * The gym. One wall in the MVP — flat panels, visible seams, and a scattering
 * of holds that belong to other problems.
 *
 * Those scattered holds are not usable. They are there because reading a route
 * off a blank wall is not reading a route, and because a wall with only the
 * eight holds you need on it looks like a diagram.
 */

export const WALL = {
  id: 'main',
  name: 'The Cave',
  /**
   * Climbable extents in metres. Most routes use the middle three and a bit;
   * the top grades go a long way across.
   */
  minX: -4.0,
  maxX: 4.0,
  minY: 0.2,
  /** The cave goes up a long way. Most routes stop around four metres; the long ones do not. */
  maxY: 6.2,
  /** Height the finish jug tends to sit at. */
  topY: 3.9,
} as const;

/** Decorative off-route holds. Rendered dim grey, never grabbable. */
export const DECOR: { x: number; y: number; type: Hold['type']; size: number; roll: number }[] = [
  { x: -1.52, y: 0.72, type: 'foothold', size: 0.07, roll: 0.4 },
  { x: 1.48, y: 1.05, type: 'crimp', size: 0.08, roll: -0.2 },
  { x: -1.38, y: 1.95, type: 'jug', size: 0.1, roll: 1.1 },
  { x: 1.55, y: 2.4, type: 'pinch', size: 0.09, roll: 0.6 },
  { x: -1.6, y: 3.05, type: 'sloper', size: 0.12, roll: 0 },
  { x: 1.34, y: 3.5, type: 'crimp', size: 0.075, roll: 0.9 },
  { x: -0.95, y: 3.85, type: 'foothold', size: 0.07, roll: -0.5 },
  { x: 0.62, y: 0.42, type: 'jug', size: 0.1, roll: 0.3 },
  { x: -0.42, y: 4.08, type: 'pocket', size: 0.08, roll: 0 },
  { x: 1.18, y: 0.35, type: 'foothold', size: 0.065, roll: 1.4 },
  { x: -1.15, y: 2.62, type: 'crimp', size: 0.07, roll: -0.9 },
  { x: 0.98, y: 1.72, type: 'pocket', size: 0.075, roll: 0.2 },
  // Out wide, where the long routes go.
  { x: -2.35, y: 1.25, type: 'jug', size: 0.1, roll: 0.7 },
  { x: 2.2, y: 0.6, type: 'foothold', size: 0.07, roll: -0.3 },
  { x: 2.62, y: 2.18, type: 'sloper', size: 0.12, roll: 0.2 },
  { x: -2.8, y: 2.9, type: 'pinch', size: 0.09, roll: -0.6 },
  { x: -2.05, y: 4.45, type: 'crimp', size: 0.075, roll: 1.2 },
  { x: 2.95, y: 3.95, type: 'pocket', size: 0.08, roll: 0.1 },
  { x: -3.45, y: 0.95, type: 'foothold', size: 0.065, roll: 0.9 },
  { x: 3.5, y: 1.6, type: 'crimp', size: 0.08, roll: -1.0 },
  { x: -3.6, y: 3.7, type: 'jug', size: 0.1, roll: 0.4 },
  { x: 3.7, y: 4.8, type: 'sloper', size: 0.11, roll: -0.4 },
  { x: 0.3, y: 5.3, type: 'pinch', size: 0.09, roll: 0.8 },
  { x: -1.3, y: 5.0, type: 'foothold', size: 0.07, roll: 0 },
];
