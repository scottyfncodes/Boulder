import { describe, expect, it } from 'vitest';
import { BOARD_SOURCES, ROUTES } from './routes';
import { buildRoute, parseGeneratedId } from './generator';
import { checkClimb, checkShape, checkStructure } from './generator/validate';
import { TIERS } from './generator/difficulty';
import { GRADES } from '../game/types';
import { SETTERS } from './setters';
import { solveRoute } from '../game/autoplay';
import { initialState } from '../game/move';
import { WALL } from './wall';

describe('route data', () => {
  it('has unique ids', () => {
    const ids = ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const route of ROUTES) {
    describe(`${route.grade} ${route.name}`, () => {
      it('has unique hold ids and a real setter', () => {
        const ids = route.holds.map((h) => h.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(SETTERS[route.setter]).toBeDefined();
      });

      it('starts every limb on a hold that exists', () => {
        for (const id of Object.values(route.start)) {
          expect(route.holds.some((h) => h.id === id)).toBe(true);
        }
        const s = initialState(route.holds, route.start);
        expect(s.contacts).toHaveLength(Object.keys(route.start).length);
        expect(s.pose.stability).toBeGreaterThan(0.4);
      });

      it('finishes on holds that exist and are near the top', () => {
        for (const id of route.finish) {
          const h = route.holds.find((x) => x.id === id);
          expect(h).toBeDefined();
          expect(h!.pos.y).toBeGreaterThan(3.4);
        }
      });

      it('keeps every hold inside the wall', () => {
        for (const h of route.holds) {
          expect(h.pos.x).toBeGreaterThanOrEqual(WALL.minX);
          expect(h.pos.x).toBeLessThanOrEqual(WALL.maxX);
          expect(h.pos.y).toBeGreaterThanOrEqual(WALL.minY);
          expect(h.pos.y).toBeLessThanOrEqual(WALL.maxY);
        }
      });

      // The long routes at the top of the board are checked against the
      // setter that made them, below.
      if (BOARD_SOURCES.has(route.id)) return;

      it('can actually be climbed', () => {
        const sol = solveRoute(route);
        expect(sol.sent).toBe(true);
      });

      it('sets a par a clean climb could actually hit', () => {
        // Par is measured against a perfect-aim solver, then given a little
        // room, so a good human climb lands near it rather than miles over.
        const sol = solveRoute(route, { beam: 40, depth: 48 });
        expect(sol.moves.length).toBeGreaterThan(5);
        expect(route.par).toBeGreaterThanOrEqual(sol.moves.length);
        expect(route.par).toBeLessThanOrEqual(sol.moves.length + 5);
      });

    });
  }

  it('has routes at every grade from V0 to V17', () => {
    for (const g of GRADES) expect(ROUTES.some((r) => r.grade === g)).toBe(true);
  });
});

describe('the top of the board', () => {
  for (const [id, from] of BOARD_SOURCES) {
    const route = ROUTES.find((r) => r.id === id)!;
    it(`${route.grade} ${route.name} is still the route the setter climbed`, () => {
      const p = parseGeneratedId(from)!;
      const b = buildRoute(p.difficulty, p.seed, { relax: p.relax });
      expect(b.route.holds).toEqual(route.holds);
      expect(TIERS[p.difficulty].grades).toContain(route.grade);
      expect(route.par).toBe(p.par);
      expect(route.blueprint).toBeUndefined();
      expect(checkStructure(b)).toBeNull();
      expect(checkShape(b, p.difficulty)).toBeNull();
      expect(checkClimb(b).ok).toBe(true);
    }, 60000);
  }

  it('gets longer and taller as it gets harder', () => {
    const top = ROUTES.filter((r) => BOARD_SOURCES.has(r.id));
    const height = (r: typeof top[number]) => Math.max(...r.holds.map((h) => h.pos.y));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const v10 = ROUTES.filter((r) => r.grade === 'V10');
    const v11to13 = top.filter((r) => ['V11', 'V12', 'V13'].includes(r.grade));
    const v14up = top.filter((r) => !['V11', 'V12', 'V13'].includes(r.grade));
    expect(mean(v11to13.map(height))).toBeGreaterThan(mean(v10.map(height)) + 1);
    expect(mean(v14up.map(height))).toBeGreaterThan(mean(v11to13.map(height)) + 0.5);
    expect(mean(v14up.map((r) => r.par))).toBeGreaterThan(mean(v10.map((r) => r.par)));
  });
});
