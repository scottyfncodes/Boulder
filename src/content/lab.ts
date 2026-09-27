import type { Route } from '../game/types';
import {
  crimp, foot, jug, sidepull, sloper, undercling, volume,
  DOWN_RIGHT, UP,
} from './holdKit';

/**
 * The slingshot lab.
 *
 * Not a route so much as a wall with one of everything on it, set so the
 * question "is flinging individual limbs actually fun?" can be answered in a
 * minute. Short throws at the bottom, a long one in the middle, a diagonal, a
 * swing with nothing for the feet, a sloper that punishes the wrong angle, an
 * undercling that only works from above, and a finish you have to match.
 *
 * It lives outside the route book on purpose: it is not graded, it does not
 * count toward anything, and it is not checked by the old route validator,
 * because the old solver does not know how to swing.
 */
export const SLING_LAB: Route = {
  id: 'sling-lab',
  name: 'Sling Lab',
  grade: 'V0',
  setter: 'house',
  wall: 'main',
  tagline: 'Four limbs. One wall. See what happens.',
  par: 16,
  start: { LH: 1, RH: 2, LF: 3, RF: 4 },
  finish: [30],
  holds: [
    // Start: a pair of jugs and a pair of chips.
    jug(1, -0.3, 1.5), jug(2, 0.3, 1.5),
    foot(3, -0.36, 0.55), foot(4, 0.36, 0.58),
    // Short throws.
    foot(5, -0.34, 1.02), foot(6, 0.4, 1.06),
    jug(7, -0.3, 1.96), jug(8, 0.3, 2.0),
    foot(9, 0.05, 1.5), foot(10, -0.5, 1.98), foot(11, 0.56, 2.04),
    // Diagonals: a jug out right, a sidepull out left that wants to be pulled in.
    jug(12, 0.9, 2.4),
    sidepull(13, -0.92, 2.36, { dir: DOWN_RIGHT }),
    foot(14, 0.0, 2.46), foot(15, -0.32, 2.52), foot(16, 0.4, 2.56),
    // The long one. About a metre off the last pair, no feet to help.
    jug(17, 0.0, 2.98),
    // A swing: one jug off to the side with nothing under it.
    jug(18, -0.8, 2.96),
    volume(19, 0.85, 3.0),
    foot(20, -0.2, 3.02), foot(21, 0.42, 3.06),
    // The awkward ones.
    sloper(22, 0.66, 3.36),
    undercling(23, -0.46, 3.22, { dir: UP }),
    crimp(24, 0.34, 3.58),
    jug(25, -0.28, 3.6),
    foot(26, -0.4, 3.3), foot(27, 0.1, 3.4),
    // Finish. Match both hands.
    jug(30, 0.0, 3.98, { finish: true }),
  ],
};

export const LAB_ROUTES: Route[] = [SLING_LAB];

export function isLabRoute(id: string): boolean {
  return LAB_ROUTES.some((r) => r.id === id);
}
