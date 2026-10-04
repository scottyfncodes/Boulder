import type { Route } from '../../game/types';
import { isHand } from '../../game/types';
import { aimAtHold, solveRoute, type PlannedMove, type Solution } from '../../game/autoplay';
import { initialState, resolveMove } from '../../game/move';
import { overhangOf } from '../../game/attempt';
import { WALL } from '../wall';
import type { BuildResult } from './build';
import { TIERS, type Difficulty } from './difficulty';
import { shapeOf } from './shape';

/**
 * The anti-nonsense rules.
 *
 * Every generated route has to clear the same bar the hand-set ones do — real
 * data, a start you can stand on, a finish at the top, and a headless climber
 * that actually gets up it — plus a check that it is the route the plan
 * describes: a shape that suits its tier, and a send that goes the way the
 * line goes rather than finding a shortcut around it.
 */

export type Verdict =
  | { ok: true; solution: Solution }
  | { ok: false; reason: string };

/** Cheap checks first; the climb is the expensive one and only runs if these pass. */
export function checkStructure(b: BuildResult): string | null {
  const { route } = b;
  const ids = new Set<number>();
  for (const h of route.holds) {
    if (ids.has(h.id)) return `duplicate hold ${h.id}`;
    ids.add(h.id);
    if (h.pos.x < WALL.minX || h.pos.x > WALL.maxX || h.pos.y < WALL.minY || h.pos.y > WALL.maxY) {
      return `hold ${h.id} off the wall`;
    }
    if (!Number.isFinite(h.pos.x) || !Number.isFinite(h.pos.y) || !Number.isFinite(h.dir)) {
      return `hold ${h.id} is not a number`;
    }
  }
  for (let i = 0; i < route.holds.length; i++) {
    for (let j = i + 1; j < route.holds.length; j++) {
      const a = route.holds[i].pos;
      const c = route.holds[j].pos;
      if (Math.hypot(a.x - c.x, a.y - c.y) < 0.12) return `holds ${route.holds[i].id} and ${route.holds[j].id} overlap`;
    }
  }
  for (const id of Object.values(route.start)) {
    if (!ids.has(id!)) return 'start hold missing';
  }
  const start = initialState(route.holds, route.start, overhangOf(route));
  if (start.pose.stability <= 0.4) return 'start is not a stance';
  for (const id of route.finish) {
    const h = route.holds.find((x) => x.id === id);
    if (!h) return 'finish hold missing';
    if (h.pos.y <= 3.4) return 'finish is not at the top';
  }
  // No gap along the line that is longer than a limb can throw.
  const spine = b.spine.map((id) => route.holds.find((h) => h.id === id)!).filter(Boolean);
  for (let i = 2; i < spine.length; i++) {
    const gap = Math.min(
      Math.hypot(spine[i].pos.x - spine[i - 1].pos.x, spine[i].pos.y - spine[i - 1].pos.y),
      Math.hypot(spine[i].pos.x - spine[i - 2].pos.x, spine[i].pos.y - spine[i - 2].pos.y),
    );
    if (gap > 0.83) return `gap of ${gap.toFixed(2)}m at hold ${spine[i].id}`;
  }
  return null;
}

export function checkShape(b: BuildResult, difficulty: Difficulty): string | null {
  const t = TIERS[difficulty].shape;
  const m = shapeOf(b.path);
  if (m.lateralTravel < t.minLateralTravel) return `too straight (${m.lateralTravel.toFixed(2)}m sideways)`;
  if (m.lateralExtent > t.maxLateralExtent) return `too wide (${m.lateralExtent.toFixed(2)}m)`;
  if (m.directionChanges < t.minDirectionChanges) return `too few direction changes (${m.directionChanges})`;
  if (m.directionChanges > t.maxDirectionChanges) return `too much noise (${m.directionChanges} changes)`;
  if (m.maxConsecutiveLateral > Math.max(1, TIERS[difficulty].maxConsecutiveLateral + 1)) {
    return `sideways for ${m.maxConsecutiveLateral} moves`;
  }
  return null;
}

/**
 * Climbs it. Perfect aim, no nerves — the same climber that proves the hand
 * set routes go. A route that only goes by skipping half its holds is a
 * different, more boring route, so the send has to use most of the line.
 */
export function checkClimb(b: BuildResult, beam = CLIMB_BEAM): Verdict {
  const { route } = b;
  const depth = Math.max(40, Math.round(b.spine.length * 3.2));
  const solution = solveRoute(route, { beam, depth });
  if (!solution.sent) return { ok: false, reason: 'the climber could not send it' };
  const hands = new Set<number>();
  const any = new Set<number>();
  for (const id of Object.values(route.start)) any.add(id!);
  for (const m of solution.moves) {
    any.add(m.holdId);
    if (isHand(m.limb)) hands.add(m.holdId);
  }
  // The send has to follow the route it was given. Nearly every part of the
  // line has to be touched — sections by a hand, cruxes by any limb, since a
  // perfect-aim climber will sometimes reach straight past a two-hold crux —
  // and the hands have to cover most of the width the line covers, so a
  // traverse is traversed rather than climbed past.
  const tags = [...new Set(b.spineTags)].filter((t) => t !== 'start' && t !== 'topout');
  let touched = 0;
  for (const tag of tags) {
    const ids = b.spine.filter((_, i) => b.spineTags[i] === tag);
    const used = tag.startsWith('crux:') ? any : hands;
    if (ids.some((id) => used.has(id))) touched++;
  }
  // One part in three may go untouched: on a short wall a perfect-aim climber
  // can reach past a two-move section, and the width check below still holds
  // the send to the route's shape.
  if (tags.length - touched > Math.floor(tags.length / 3)) {
    return { ok: false, reason: `the send skipped ${tags.length - touched} of ${tags.length} parts` };
  }
  const xs = (ids: Iterable<number>) => [...ids].map((id) => route.holds.find((h) => h.id === id)!.pos.x);
  const lineXs = xs(b.spine);
  const sendXs = xs([...hands, route.start.LH!, route.start.RH!]);
  const width = (v: number[]) => Math.max(...v) - Math.min(...v);
  if (width(sendXs) < 0.7 * width(lineXs)) return { ok: false, reason: 'the send cut the corner' };
  return { ok: true, solution };
}

/**
 * Wide enough to find a clean send rather than any send. Narrower searches
 * are not faster here: they wander, shuffling feet, and take longer to top out.
 */
export const CLIMB_BEAM = 20;

export function validate(b: BuildResult, difficulty: Difficulty): Verdict {
  const s = checkStructure(b);
  if (s) return { ok: false, reason: s };
  const sh = checkShape(b, difficulty);
  if (sh) return { ok: false, reason: sh };
  return checkClimb(b);
}

/**
 * Par from the validator's send, with the same room the hand-set routes get.
 * A narrow search finds a send, not a good one — it shuffles its feet a lot —
 * so the send is tightened first: every move it can do without is dropped.
 */
export function parFor(route: Route, solution: Solution): number {
  return tighten(route, solution.moves).length + 2;
}

/** Replays a sequence, re-aiming each move from wherever the body actually is. */
export function replays(route: Route, moves: PlannedMove[]): boolean {
  const holds = route.holds;
  let state = initialState(holds, route.start, overhangOf(route));
  for (const m of moves) {
    const hold = holds.find((h) => h.id === m.holdId);
    if (!hold) return false;
    if (state.contacts.filter((c) => c.limb !== m.limb).length < 2) return false;
    const r = resolveMove({ state, aim: aimAtHold(state, m.limb, hold), holds });
    if (r.fell || r.holdId !== hold.id || r.grade === 'MISS' || r.grade === 'YEET') return false;
    state = r.next;
  }
  const hands = state.contacts.filter((c) => isHand(c.limb));
  return hands.length === 2 && hands.every((c) => route.finish.includes(c.holdId));
}

/** Drops moves one at a time, latest first, keeping each drop that still sends. */
export function tighten(route: Route, moves: PlannedMove[]): PlannedMove[] {
  let cur = moves;
  for (let i = cur.length - 2; i >= 0; i--) {
    const without = [...cur.slice(0, i), ...cur.slice(i + 1)];
    if (replays(route, without)) cur = without;
  }
  return cur;
}

export type { Route };
