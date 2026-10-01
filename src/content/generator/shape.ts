import type { PathStep } from './build';

/**
 * Numbers that describe what a route's line does, so "harder routes are more
 * creative" can be checked rather than hoped for.
 */
export type ShapeMetrics = {
  /** Total sideways distance the line covers, metres. */
  lateralTravel: number;
  /** Widest the line spreads across the wall, metres. */
  lateralExtent: number;
  /** Times the line changes sideways direction, plus times it goes down. */
  directionChanges: number;
  /** Steps that are more sideways than up. */
  lateralSteps: number;
  /** Longest run of sideways steps. */
  maxConsecutiveLateral: number;
  /** Steps that lose height. */
  downSteps: number;
  /** Steps tagged as part of a crux. */
  cruxSteps: number;
  /** Fraction of the way along the route the last crux step sits, or null. */
  cruxAt: number | null;
};

/** A sideways move smaller than this is wander, not a decision. */
const LATERAL_EPS = 0.06;

export function shapeOf(path: PathStep[]): ShapeMetrics {
  let lateralTravel = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let changes = 0;
  let lastSign = 0;
  let lateralSteps = 0;
  let run = 0;
  let maxRun = 0;
  let down = 0;
  let cruxSteps = 0;
  let lastCrux = -1;
  path.forEach((p, i) => {
    const dx = p.to.x - p.from.x;
    const dy = p.to.y - p.from.y;
    lateralTravel += Math.abs(dx);
    minX = Math.min(minX, p.from.x, p.to.x);
    maxX = Math.max(maxX, p.from.x, p.to.x);
    if (Math.abs(dx) >= LATERAL_EPS) {
      const sgn = Math.sign(dx);
      if (lastSign !== 0 && sgn !== lastSign) changes++;
      lastSign = sgn;
    }
    if (dy < -0.05) {
      down++;
      changes++;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      lateralSteps++;
      run++;
      maxRun = Math.max(maxRun, run);
    } else {
      run = 0;
    }
    if (p.crux) {
      cruxSteps++;
      lastCrux = i;
    }
  });
  return {
    lateralTravel,
    lateralExtent: path.length ? maxX - minX : 0,
    directionChanges: changes,
    lateralSteps,
    maxConsecutiveLateral: maxRun,
    downSteps: down,
    cruxSteps,
    cruxAt: lastCrux >= 0 ? (lastCrux + 1) / path.length : null,
  };
}
