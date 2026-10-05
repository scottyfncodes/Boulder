import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES, buildRoute, generateRoute, generatedRouteById, parseGeneratedId, shapeOf,
  type Difficulty,
} from './index';
import { checkShape, checkStructure, replays, tighten } from './validate';
import { TIERS } from './difficulty';
import { solveRoute } from '../../game/autoplay';
import { initialState } from '../../game/move';
import { WALL } from '../wall';
import { SETTERS } from '../setters';
import { routeById } from '../routes';
import { applySend, freshProfile } from '../../state/progress';
import { gradeIndex } from '../../game/types';
import type { BuildResult } from './build';

/**
 * The route setter.
 *
 * Two kinds of test. The slow kind sets real routes end to end — plan, holds,
 * validation, a headless send — and then checks the result independently, the
 * same way the hand-set routes are checked. The fast kind sets hundreds of
 * candidate routes per difficulty without climbing them, and checks that the
 * *population* behaves: harder tiers really are more sideways, more twisty,
 * more combined, and have their cruxes late.
 */

/** Candidates that pass the cheap checks, i.e. the ones the setter would go on to climb. */
function population(d: Difficulty, n = 160): BuildResult[] {
  const out: BuildResult[] = [];
  for (let seed = 1; out.length < n && seed < n * 10; seed++) {
    const b = buildRoute(d, seed * 7919);
    if (!checkStructure(b) && !checkShape(b, d)) out.push(b);
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const share = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length / Math.max(1, xs.length);

const POP = Object.fromEntries(DIFFICULTIES.map((d) => [d, population(d)])) as Record<Difficulty, BuildResult[]>;

describe('generated routes, end to end', () => {
  for (const d of DIFFICULTIES) {
    describe(d, () => {
      const results = [11, 4242].map((seed) => generateRoute(d, seed));

      for (const [i, g] of results.entries()) {
        const route = g.route;
        describe(`#${i + 1} ${route.grade} ${route.name}`, () => {
          it('is real route data', () => {
            const ids = route.holds.map((h) => h.id);
            expect(new Set(ids).size).toBe(ids.length);
            expect(SETTERS[route.setter]).toBeDefined();
            expect(TIERS[d].grades).toContain(route.grade);
            for (const h of route.holds) {
              expect(h.pos.x).toBeGreaterThanOrEqual(WALL.minX);
              expect(h.pos.x).toBeLessThanOrEqual(WALL.maxX);
              expect(h.pos.y).toBeGreaterThanOrEqual(WALL.minY);
              expect(h.pos.y).toBeLessThanOrEqual(WALL.maxY);
            }
          });

          it('starts standing and finishes at the top', () => {
            const s = initialState(route.holds, route.start, ((route.overhang ?? 0) * Math.PI) / 180);
            expect(s.contacts).toHaveLength(4);
            expect(s.pose.stability).toBeGreaterThan(0.4);
            for (const id of route.finish) {
              expect(route.holds.find((h) => h.id === id)!.pos.y).toBeGreaterThan(3.4);
            }
          });

          it('can actually be climbed, by an independent search', () => {
            const sol = solveRoute(route, { beam: 20, depth: 140 });
            expect(sol.sent).toBe(true);
            // ...and the send the setter tightened par from still replays.
            expect(replays(route, tighten(route, sol.moves))).toBe(true);
          });

          it('sets a par a clean climb could hit', () => {
            expect(route.par).toBeGreaterThan(8);
            expect(route.par).toBeLessThan(60);
          });

          it('did not need many tries', () => {
            // Shape rejects are cheap and expected. Climbs are not.
            expect(g.climbs).toBeLessThanOrEqual(6);
            expect(route.blueprint?.relax ?? 0).toBeLessThanOrEqual(1);
          });

          it('can be rebuilt from its id alone', () => {
            const parsed = parseGeneratedId(route.id)!;
            expect(parsed.difficulty).toBe(d);
            const rebuilt = buildRoute(parsed.difficulty, parsed.seed, { relax: parsed.relax }).route;
            expect(rebuilt.holds).toEqual(route.holds);
            expect(rebuilt.name).toBe(route.name);
            expect(generatedRouteById(route.id)?.par).toBe(route.par);
            expect(routeById(route.id)?.holds).toEqual(route.holds);
          });
        });
      }

      it('is deterministic for a seed', () => {
        const again = generateRoute(d, 11);
        expect(again.route.id).toBe(results[0].route.id);
        expect(again.route.holds).toEqual(results[0].route.holds);
      });
    });
  }
});

describe('difficulty changes the shape, not just the pitch', () => {
  it('every difficulty produces plenty of candidates worth climbing', () => {
    for (const d of DIFFICULTIES) expect(POP[d].length).toBe(160);
  });

  it('harder routes go further sideways, wider, with more changes of direction', () => {
    const lat = DIFFICULTIES.map((d) => mean(POP[d].map((b) => shapeOf(b.path).lateralTravel)));
    const ext = DIFFICULTIES.map((d) => mean(POP[d].map((b) => shapeOf(b.path).lateralExtent)));
    const turns = DIFFICULTIES.map((d) => mean(POP[d].map((b) => shapeOf(b.path).directionChanges)));
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      expect(lat[i]).toBeGreaterThan(lat[i - 1]);
      expect(turns[i]).toBeGreaterThan(turns[i - 1]);
    }
    for (let i = 1; i < DIFFICULTIES.length; i++) expect(ext[i]).toBeGreaterThan(ext[i - 1]);
    // The top tiers go most of the way across the cave.
    expect(ext[DIFFICULTIES.indexOf('mythic')]).toBeGreaterThan(4.5);
  });

  it('easy is readable: mostly up, never a perfectly straight ladder', () => {
    for (const b of POP.easy) {
      const m = shapeOf(b.path);
      expect(m.lateralTravel).toBeGreaterThanOrEqual(0.2);
      expect(m.lateralExtent).toBeLessThanOrEqual(0.95);
      expect(m.downSteps).toBe(0);
      expect(b.plan.sections.some((a) => a === 'traverse' || a === 'roof' || a === 'overhang')).toBe(false);
      expect(b.plan.cruxes).toHaveLength(0);
    }
  });

  it('traverses start at moderate and are a fixture from very hard up', () => {
    const has = (d: Difficulty) => share(POP[d], (b) => b.plan.sections.includes('traverse'));
    expect(has('easy')).toBe(0);
    expect(has('moderate')).toBeGreaterThan(0.15);
    expect(has('hard')).toBeGreaterThan(0.4);
    expect(has('veryHard')).toBe(1);
    expect(has('brutal')).toBe(1);
    expect(has('elite')).toBe(1);
    expect(has('mythic')).toBe(1);
  });

  it('roofs and steep sections only appear from hard up, and always from very hard', () => {
    const steep = (d: Difficulty) => share(POP[d], (b) => b.plan.sections.some((a) => a === 'roof' || a === 'overhang'));
    expect(steep('easy')).toBe(0);
    expect(steep('moderate')).toBe(0);
    expect(steep('hard')).toBeGreaterThan(0.2);
    expect(steep('veryHard')).toBe(1);
    expect(steep('brutal')).toBe(1);
    expect(steep('elite')).toBe(1);
    expect(steep('mythic')).toBe(1);
  });

  it('harder routes are longer', () => {
    const moves = DIFFICULTIES.map((d) => mean(POP[d].map((b) => b.spine.length)));
    for (let i = 1; i < DIFFICULTIES.length; i++) expect(moves[i]).toBeGreaterThan(moves[i - 1]);
  });

  it('harder tiers combine more ideas', () => {
    const kinds = (d: Difficulty) => mean(POP[d].map((b) => new Set(b.plan.sections).size));
    expect(kinds('easy')).toBeLessThan(2);
    expect(kinds('hard')).toBeGreaterThan(kinds('moderate'));
    expect(kinds('brutal')).toBeGreaterThan(kinds('veryHard'));
    expect(kinds('brutal')).toBeGreaterThanOrEqual(3.5);
    expect(kinds('mythic')).toBeGreaterThan(kinds('brutal'));
  });

  it('has cruxes where it should, and puts the last one late', () => {
    expect(share(POP.easy, (b) => b.plan.cruxes.length > 0)).toBe(0);
    expect(share(POP.hard, (b) => b.plan.cruxes.length >= 1)).toBe(1);
    expect(share(POP.brutal, (b) => b.plan.cruxes.length >= 2)).toBe(1);
    expect(share(POP.mythic, (b) => b.plan.cruxes.length >= 3)).toBe(1);
    for (const d of ['hard', 'veryHard', 'brutal', 'elite', 'mythic'] as const) {
      const at = POP[d].map((b) => shapeOf(b.path).cruxAt!).filter((x) => x !== null);
      expect(mean(at)).toBeGreaterThan(0.6);
    }
  });

  it('never runs sideways for longer than the tier allows', () => {
    for (const d of DIFFICULTIES) {
      for (const b of POP[d]) {
        expect(shapeOf(b.path).maxConsecutiveLateral).toBeLessThanOrEqual(TIERS[d].maxConsecutiveLateral + 1);
      }
    }
  });

  it('pitch is the smallest lever: a brutal route is not just a steeper easy one', () => {
    const pitch = (d: Difficulty) => mean(POP[d].map((b) => b.route.overhang ?? 0));
    // Hand-set V8-V10s sit at 30-34 degrees; generated brutal routes stay below that.
    expect(pitch('brutal')).toBeLessThan(30);
    const lat = (d: Difficulty) => mean(POP[d].map((b) => shapeOf(b.path).lateralTravel));
    expect(lat('brutal') / Math.max(0.01, lat('easy'))).toBeGreaterThan(5);
  });
});

describe('variety', () => {
  it('two routes in a row at the same difficulty are different routes', () => {
    for (const d of DIFFICULTIES) {
      for (let i = 1; i < 40; i++) {
        const a = POP[d][i - 1].route;
        const b = POP[d][i].route;
        expect(a.holds).not.toEqual(b.holds);
      }
    }
  });

  it('section order, start side and crux kinds all vary at the top end', () => {
    for (const d of ['hard', 'veryHard', 'brutal'] as const) {
      const orders = new Set(POP[d].map((b) => b.plan.sections.join('>')));
      const starts = new Set(POP[d].map((b) => Math.sign(b.route.holds[0].pos.x)));
      const cruxes = new Set(POP[d].flatMap((b) => b.plan.cruxes));
      expect(orders.size).toBeGreaterThan(15);
      expect(starts.size).toBe(2);
      expect(cruxes.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('every archetype gets used somewhere', () => {
    const used = new Set(DIFFICULTIES.flatMap((d) => POP[d].flatMap((b) => b.plan.sections)));
    for (const a of ['slab', 'zigzag', 'traverse', 'roof', 'overhang', 'dihedral', 'crack', 'arete', 'compression']) {
      expect(used.has(a as never)).toBe(true);
    }
  });
});

describe('generated routes and progression', () => {
  it('a generated send is scored but does not move your grade', () => {
    const route = generatedRouteById(generateRoute('brutal', 11).route.id)!;
    const card = {
      routeId: route.id, grade: route.grade, moves: 30, par: route.par, falls: 0, perfect: 10,
      good: 10, scrape: 10, whiffed: 0, timeMs: 60000, efficiency: 0.8, points: 500, onsight: true, sentAt: 1,
    };
    const { profile, breakthrough } = applySend(freshProfile(), route, card, []);
    expect(profile.topGrade).toBeNull();
    expect(breakthrough).toBeNull();
    expect(profile.records[route.id].sent).toBe(true);
    expect(profile.totalSends).toBe(1);
    expect(gradeIndex(route.grade)).toBeGreaterThanOrEqual(gradeIndex('V8'));
  });
});
