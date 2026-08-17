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
  /** Climbable extents in metres. */
  minX: -1.7,
  maxX: 1.7,
  minY: 0.2,
  maxY: 4.25,
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
];
