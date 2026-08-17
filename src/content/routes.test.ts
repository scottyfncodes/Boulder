import { describe, expect, it } from 'vitest';
import { ROUTES } from './routes';
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
});
