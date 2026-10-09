import { describe, expect, it } from 'vitest';
import { highballs, judgeLanding, isHighball } from './highball';
import { routeById } from './routes';
import { TOWER, WALL } from './wall';
import { checkClimb, checkStructure } from './generator/validate';
import { buildRoute } from './generator/build';
import { HIGHBALL_TIERS } from './highball';
import { gradeRoute } from '../game/grading';
import { gradeIndex } from '../game/types';
import { solveRoute } from '../game/autoplay';
import { applySend, freshProfile } from '../state/progress';
import type { ScoreCard } from '../game/scoring';

const all = highballs();

describe('the highballs', () => {
  it('are tall: twice a boulder problem, and on the tower', () => {
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const h of all) {
      expect(h.wall).toBe(TOWER.id);
      expect(h.highball.height).toBeGreaterThan(WALL.topY * 2 - 0.5);
      for (const hold of h.holds) expect(hold.pos.y).toBeLessThanOrEqual(TOWER.maxY);
    }
  });

  it('each has its own character, and the set spans the grades', () => {
    expect(new Set(all.map((h) => h.highball.character)).size).toBe(all.length);
    const grades = all.map((h) => gradeIndex(h.grade));
    expect(Math.max(...grades) - Math.min(...grades)).toBeGreaterThanOrEqual(4);
  });

  it('can be found by id, the way an attempt looks a route up', () => {
    for (const h of all) {
      const r = routeById(h.id);
      expect(r && isHighball(r)).toBe(true);
    }
  });

  for (const h of all) {
    it(`${h.name} goes, the way it was set, and is graded what its moves add up to`, () => {
      // The same checks the route setter holds its routes to, on the tower.
      const tier = HIGHBALL_TIERS[h.highball.tier];
      expect(tier).toBeDefined();
      const b = buildRoute(tier.difficulty, h.seed!, { tier });
      expect(checkStructure(b, TOWER)).toBeNull();
      const v = checkClimb(b);
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      const g = gradeRoute(h, [v.solution.moves.map((m) => ({ limb: m.limb, holdId: m.holdId }))]);
      expect(Math.abs(gradeIndex(g.grade) - gradeIndex(h.grade))).toBeLessThanOrEqual(1);
      // More than one hard part, and very few places to stop: a highball, not a long boulder.
      expect(g.styles).toContain('endurance');
    }, 60000);
  }

  it('an independent search agrees the hardest one goes', () => {
    const hardest = [...all].sort((a, b) => gradeIndex(b.grade) - gradeIndex(a.grade))[0];
    expect(solveRoute(hardest, { beam: 20, depth: 160 }).sent).toBe(true);
  }, 120000);
});

describe('landing', () => {
  const pads = { pads: 2, halfWidth: 0.8, centre: 0, spotter: false };
  it('a short fall onto the pads is a landing', () => {
    expect(judgeLanding(pads, 3, 0.2).kind).toBe('clean');
  });
  it('the same pads from the top are not enough: a heavy landing', () => {
    expect(judgeLanding(pads, 8.5, 0.2).kind).toBe('heavy');
  });
  it('more pads are good for more height, never for everything', () => {
    expect(judgeLanding({ ...pads, pads: 3 }, 5.8, 0).kind).toBe('clean');
    expect(judgeLanding({ ...pads, pads: 3 }, 9, 0).kind).toBe('heavy');
  });
  it('off the side of the pads is off the pads, and a spotter buys a little room', () => {
    expect(judgeLanding(pads, 2, 1.0).kind).toBe('off-pads');
    expect(judgeLanding({ ...pads, spotter: true }, 2, 1.0).kind).toBe('clean');
  });
});

describe('progress', () => {
  it('a highball send is kept, but does not open boulder grades', () => {
    const h = all.find((x) => gradeIndex(x.grade) >= 6)!;
    const card = { efficiency: 0.8, points: 100, moves: 40, onsight: false, sentAt: 1 } as unknown as ScoreCard;
    const { profile } = applySend(freshProfile(), h, card, []);
    expect(profile.records[h.id].sent).toBe(true);
    expect(profile.topGrade).toBeNull();
  });
});
