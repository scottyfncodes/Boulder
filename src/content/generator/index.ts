import type { Route } from '../../game/types';
import { hashString } from '../../game/rng';
import { buildRoute, type BuildResult } from './build';
import { isDifficulty, type Difficulty } from './difficulty';
import { checkClimb, checkShape, checkStructure, parFor } from './validate';

/**
 * The route setter.
 *
 * `generateRoute` plans a route for a difficulty, sets it, and has the
 * headless climber try it. A route that fails any check is thrown away and
 * the next seed is tried; after a few failures the setter starts backing the
 * route off a notch at a time rather than rolling the dice forever. The id it
 * returns records the seed and the notch, so the exact same route can be
 * rebuilt later from the id alone without climbing it again.
 */

export { DIFFICULTIES, DIFFICULTY_LABEL, TIERS } from './difficulty';
export type { Difficulty, Archetype, CruxKind } from './difficulty';
export { buildRoute } from './build';
export { shapeOf } from './shape';

/**
 * Budgets. Setting a candidate and checking its geometry costs a fraction of
 * a millisecond, so the setter can afford to throw a lot of them away.
 * Climbing one costs a second or so, so only candidates that already look
 * right get climbed, and every few failed climbs the setter backs the route
 * off a notch.
 */
const MAX_CANDIDATES = 400;
const CLIMBS_PER_RELAX = 4;
const MAX_RELAX = 3;

export type GenerateResult = {
  route: Route;
  build: BuildResult;
  /** How many candidates were set and thrown away before this one. */
  rejected: number;
  /** How many of those got as far as being climbed. */
  climbs: number;
  reasons: string[];
};

export function generateRoute(difficulty: Difficulty, seed: number): GenerateResult {
  const reasons: string[] = [];
  let relax = 0;
  let climbs = 0;
  let failedClimbs = 0;
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const s = deriveSeed(seed, i);
    const b = buildRoute(difficulty, s, { relax });
    const cheap = checkStructure(b) ?? checkShape(b, difficulty);
    if (cheap) {
      reasons.push(cheap);
      continue;
    }
    climbs++;
    const v = checkClimb(b);
    if (v.ok) {
      b.route.par = parFor(b.route, v.solution);
      b.route.id = `${b.route.id}-${b.route.par}`;
      rememberRoute(b.route);
      return { route: b.route, build: b, rejected: reasons.length, climbs, reasons };
    }
    reasons.push(v.reason);
    failedClimbs++;
    if (failedClimbs % CLIMBS_PER_RELAX === 0) {
      if (relax === MAX_RELAX) break;
      relax++;
    }
  }
  // Unreachable in practice — the test suite sets hundreds of routes and
  // checks none get here — but a broken route must never be shown, so the
  // caller gets an error rather than an unvalidated route.
  throw new Error(`could not set a ${difficulty} route from seed ${seed}: ${reasons.slice(-3).join('; ')}`);
}

/** Every seed in a family is distinct and stable. */
export function deriveSeed(seed: number, attempt: number): number {
  return hashString(`${seed >>> 0}:${attempt}`);
}

/** A fresh seed for "set me another one". */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

const ID_RE = /^gen-([a-zA-Z]+)-([0-9a-z]+)-(\d)-(\d+)$/;

export function isGeneratedId(id: string): boolean {
  return ID_RE.test(id);
}

/** What a generated id records: enough to rebuild the route without climbing it. */
export function parseGeneratedId(id: string): { difficulty: Difficulty; seed: number; relax: number; par: number } | null {
  const m = ID_RE.exec(id);
  if (!m || !isDifficulty(m[1])) return null;
  return { difficulty: m[1], seed: parseInt(m[2], 36), relax: Number(m[3]), par: Number(m[4]) };
}

const cache = new Map<string, Route>();

/** Keeps a route the setter just validated, so the board and the climb share one object. */
export function rememberRoute(route: Route): void {
  cache.set(route.id, route);
}

/**
 * Rebuilds a generated route from its id. The id names the exact seed and
 * notch that passed validation, so this is pure geometry — no climbing — and
 * cheap enough to call while rendering a list.
 */
export function generatedRouteById(id: string): Route | undefined {
  const hit = cache.get(id);
  if (hit) return hit;
  const parsed = parseGeneratedId(id);
  if (!parsed) return undefined;
  const route = buildRoute(parsed.difficulty, parsed.seed, { relax: parsed.relax }).route;
  route.par = parsed.par;
  route.id = id;
  cache.set(id, route);
  return route;
}

export function difficultyOf(route: Route): Difficulty | null {
  const d = route.blueprint?.difficulty;
  return d && isDifficulty(d) ? d : null;
}

