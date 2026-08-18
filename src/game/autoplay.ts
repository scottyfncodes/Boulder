import type { Hold, LimbId, Route, Vec2 } from './types';
import { LIMBS, isHand } from './types';
import { anchorFor, maxReachOf } from './body';
import {
  type Aim, type ClimbState, blockedFor, initialState, limbOrigin, resolveMove,
} from './move';
import { canUse, worldZones } from './holds';
import { dist, norm, sub } from './vec';
import { rng } from './rng';

/**
 * A headless climber.
 *
 * It exists for three reasons: to prove at test time that every shipped route
 * can actually be climbed, to generate the community betas players compare
 * themselves against, and to check that a generated route is worth setting
 * before anyone sees it. It plays with perfect aim and no nerves, which makes
 * it a good validator and a boring rival.
 */

export type PlannedMove = { limb: LimbId; holdId: number; aim: Aim };

export type Solution = {
  sent: boolean;
  moves: PlannedMove[];
  /** Grades the solver earned, for difficulty reporting. */
  grades: string[];
  /** Lowest stability the body passed through. */
  minStability: number;
  /** How many candidate states were expanded. Cheap complexity proxy. */
  explored: number;
};

/**
 * Perfect aim at the best part of a hold. The throw starts where the limb
 * actually is, not at the shoulder, because that is where the player throws
 * from and the solver has to play the same game they do.
 */
export function aimAtHold(state: ClimbState, limb: LimbId, hold: Hold): Aim {
  const from = limbOrigin(state, limb);
  const target = worldZones(hold)[0].pos;
  const d = sub(target, from);
  return { limb, dir: norm(d), power: Math.min(dist(target, from) / maxReachOf(limb), 1) };
}

/** Holds a limb could physically arrive at from the current pose. */
export function reachableHolds(state: ClimbState, limb: LimbId, holds: Hold[]): Hold[] {
  const anchor = anchorFor(limb, state.pose.hip, state.pose.shoulder);
  const from = limbOrigin(state, limb);
  const max = maxReachOf(limb);
  const taken = blockedFor(state.contacts.filter((c) => c.limb !== limb), holds);
  // Two limits, and both bite: the limb has to end up within its own length of
  // the shoulder or hip, and the throw itself cannot travel further than that.
  return holds.filter((h) => {
    if (taken.has(h.id)) return false;
    if (!canUse(h.type, limb)) return false;
    const target = worldZones(h)[0].pos;
    return dist(anchor, target) <= max && dist(from, target) <= max;
  });
}

function key(state: ClimbState): string {
  return LIMBS.map((l) => state.contacts.find((c) => c.limb === l)?.holdId ?? '-').join(',');
}

function sent(state: ClimbState, finish: number[]): boolean {
  const hands = state.contacts.filter((c) => isHand(c.limb));
  return hands.length === 2 && hands.every((c) => finish.includes(c.holdId));
}

/** Mean height of the hands — the thing a climber is actually trying to raise. */
function height(state: ClimbState): number {
  const hands = state.contacts.filter((c) => isHand(c.limb));
  if (hands.length === 0) return 0;
  return hands.reduce((s, c) => s + c.pos.y, 0) / hands.length;
}

function goalPull(state: ClimbState, goal: Vec2): number {
  const hands = state.contacts.filter((c) => isHand(c.limb));
  if (!hands.length) return 99;
  return hands.reduce((s, c) => s + dist(c.pos, goal), 0) / hands.length;
}

type Node = {
  state: ClimbState;
  moves: PlannedMove[];
  grades: string[];
  minStability: number;
  score: number;
};

/**
 * Beam search over limb placements. Deep enough to find the real sequence on a
 * V7, narrow enough to stay fast in a test run.
 */
export function solveRoute(
  route: Route,
  opts: { beam?: number; depth?: number; style?: number } = {},
): Solution {
  const beam = opts.beam ?? 14;
  const maxDepth = opts.depth ?? 40;
  // A style seed nudges which holds this climber gravitates toward, so the same
  // route can be solved several genuinely different ways. This is how the
  // community betas get generated — different climbers, different habits, not
  // the same solution with the moves shuffled.
  const style = opts.style ?? 0;
  const taste = new Map<number, number>();
  if (style !== 0) {
    const r = rng(style);
    for (const h of route.holds) taste.set(h.id, (r() - 0.5) * 0.5);
  }
  const holds = route.holds;
  const finishHolds = holds.filter((h) => route.finish.includes(h.id));
  const goal: Vec2 = finishHolds.length
    ? {
        x: finishHolds.reduce((s, h) => s + h.pos.x, 0) / finishHolds.length,
        y: finishHolds.reduce((s, h) => s + h.pos.y, 0) / finishHolds.length,
      }
    : { x: 0, y: 4 };

  const start = initialState(holds, route.start, ((route.overhang ?? 0) * Math.PI) / 180);
  let frontier: Node[] = [
    { state: start, moves: [], grades: [], minStability: start.pose.stability, score: 0 },
  ];
  const seen = new Set<string>([key(start)]);
  let explored = 0;

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const limb of LIMBS) {
        // Never strip the body down to a single point of contact on purpose.
        const others = node.state.contacts.filter((c) => c.limb !== limb);
        if (others.length < 2) continue;
        for (const hold of reachableHolds(node.state, limb, holds)) {
          explored++;
          const aim = aimAtHold(node.state, limb, hold);
          const r = resolveMove({ state: node.state, aim, holds });
          if (r.fell || r.grade === 'MISS' || r.grade === 'YEET') continue;
          if (r.holdId !== hold.id) continue;

          const child: Node = {
            state: r.next,
            moves: [...node.moves, { limb, holdId: hold.id, aim }],
            grades: [...node.grades, r.grade],
            minStability: Math.min(node.minStability, r.next.pose.stability),
            score: 0,
          };
          if (sent(child.state, route.finish)) {
            return {
              sent: true,
              moves: child.moves,
              grades: child.grades,
              minStability: child.minStability,
              explored,
            };
          }
          const k = key(child.state);
          if (seen.has(k)) continue;
          seen.add(k);
          child.score =
            height(child.state) * 2
            - goalPull(child.state, goal) * 1.1
            + child.state.pose.stability * 0.5
            - child.moves.length * 0.03
            + (taste.get(hold.id) ?? 0);
          next.push(child);
        }
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.score - a.score);
    frontier = next.slice(0, beam);
  }

  const best = frontier[0];
  return {
    sent: false,
    moves: best?.moves ?? [],
    grades: best?.grades ?? [],
    minStability: best?.minStability ?? 0,
    explored,
  };
}
