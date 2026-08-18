import { describe, expect, it } from 'vitest';
import { ROUTES } from './routes';
import { SETTERS } from './setters';
import { solveRoute } from '../game/autoplay';
import { initialState } from '../game/move';
import {
  capacityFor, drainEndurance, freshEndurance, routeDrain,
} from '../game/endurance';
import { GRADES, gradeIndex } from '../game/types';
import type { Route } from '../game/types';
import { WALL } from './wall';

/**
 * Seconds a route affords the climber it is aimed at, burned at an ordinary
 * stance with a limb in the air two ticks in five, crediting a short pause at
 * each rest hold. It is a yardstick, not a simulation — what it is good for is
 * catching a route that has quietly grown too long to finish.
 */
function secondsOnTheWall(route: Route): number {
  const gi = gradeIndex(route.grade);
  const cap = capacityFor(gi > 0 ? GRADES[gi - 1] : null, Math.min(gi * 3, 40));
  const drain = routeDrain(route);
  let restLeft = route.holds.filter((h) => h.rest === true).length * 3;

  let e = freshEndurance(cap);
  let t = 0;
  for (let i = 0; i < 100000; i++) {
    const resting = restLeft > 0 && i % 40 < 10;
    if (resting) restLeft -= 0.1;
    const r = drainEndurance({
      endurance: e, dtMs: 100, drain, stability: 0.6,
      reaching: !resting && i % 5 < 2, resting,
    });
    e = r.endurance;
    t += 0.1;
    if (r.pumped) break;
  }
  return t;
}

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

      it('leaves enough endurance to actually finish it', () => {
        // A route can be geometrically solvable and still unsendable, because
        // the solver does not model the pump. Every move on the reference line
        // needs time to read, aim and throw, so if the line grows or the wall
        // steepens without a rest to pay for it, this is what notices.
        const moves = solveRoute(route, { beam: 40, depth: 48 }).moves.length;
        const perMove = secondsOnTheWall(route) / moves;
        expect(perMove).toBeGreaterThanOrEqual(2.2);
      });
    });
  }
});
