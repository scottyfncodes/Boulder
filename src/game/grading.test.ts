import { describe, expect, it } from 'vitest';
import type { Hold, HoldType, Route } from './types';
import { GRADES, gradeIndex } from './types';
import { ROUTES } from '../content/routes';
import { communityBetasFor } from '../content/communityBeta';
import { featuresOf, gradeRoute, readStance } from './grading';
import { solveRoute } from './autoplay';
import { initialState } from './move';
import { foot, jug } from '../content/holdKit';
import { HOLD_PROFILES } from './holds';

/** Spearman rank correlation. */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    idx.forEach(([, i], k) => { r[i] = k; });
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const handSet = ROUTES.filter((r) => communityBetasFor(r.id).length > 0);

describe('grades come out of the moves', () => {
  const reports = handSet.map((r) => ({ r, g: gradeRoute(r, communityBetasFor(r.id).map((b) => b.beta)) }));

  it('agrees with the setters on the order of the hand-set routes', () => {
    const rho = spearman(reports.map((x) => gradeIndex(x.r.grade)), reports.map((x) => x.g.score));
    expect(rho).toBeGreaterThan(0.88);
  });

  it('lands within two grades of the setter for most of them, and never wildly off', () => {
    const off = reports.map((x) => Math.abs(gradeIndex(x.g.grade) - gradeIndex(x.r.grade)));
    expect(off.filter((d) => d <= 2).length / off.length).toBeGreaterThan(0.75);
    expect(Math.max(...off)).toBeLessThanOrEqual(4);
  });

  it('follows the whole beta the setters’ climber found', () => {
    for (const { g } of reports) expect(g.coverage).toBe(1);
  });

  it('finds the crux, a sustained figure, rests and techniques for every route', () => {
    for (const { g } of reports) {
      expect(g.crux.difficulty).toBeGreaterThan(0);
      expect(g.sustained).toBeGreaterThan(0);
      expect(g.moves.length).toBeGreaterThan(5);
    }
    const easy = reports.find((x) => x.r.id === 'warmup')!.g;
    const roof = reports.find((x) => x.r.id === 'read-it-again')!.g;
    expect(easy.rests).toBeGreaterThan(roof.rests);
  });
});

/** A ladder: two holds a rung, half a metre apart, feet under them. */
function ladder(type: HoldType, angle: number, opts: { size?: number; rungs?: number; extraFeet?: boolean } = {}): Route {
  const holds: Hold[] = [jug(1, -0.28, 1.5), jug(2, 0.28, 1.5), foot(3, -0.3, 0.5), foot(4, 0.3, 0.5)];
  let id = 5;
  const rungs = opts.rungs ?? 5;
  for (let i = 1; i <= rungs; i++) {
    const y = 1.5 + i * (2.2 / rungs);
    const dir = HOLD_PROFILES[type].push ? 0 : -Math.PI / 2;
    for (const x of [-0.3, 0.3]) {
      holds.push({ id: id++, pos: { x: x + (i % 2 ? 0.05 : -0.05), y }, type, size: opts.size ?? 0.11, dir });
    }
    holds.push({ ...foot(id++, -0.3, y - 0.95) }, { ...foot(id++, 0.3, y - 0.95) });
    if (opts.extraFeet) holds.push({ ...foot(id++, 0, y - 0.7) });
  }
  holds.push(jug(id, 0, 4.05, { finish: true }));
  return {
    id: `test-${type}-${angle}`, name: 'ladder', grade: 'V0', setter: 'house', wall: 'main',
    holds, start: { LH: 1, RH: 2, LF: 3, RF: 4 }, finish: [id], par: 20, overhang: angle,
  };
}

function assess(route: Route) {
  const sol = solveRoute(route, { beam: 14, depth: 70 });
  expect(sol.sent).toBe(true);
  return gradeRoute(route, [sol.moves.map((m) => ({ limb: m.limb, holdId: m.holdId }))]);
}

describe('grades respond to more than one thing', () => {
  it('the same ladder gets harder as the wall tips back', () => {
    expect(assess(ladder('jug', 30)).score).toBeGreaterThan(assess(ladder('jug', 0)).score + 0.5);
  });

  it('and harder on worse holds, at the same angle and spacing', () => {
    expect(assess(ladder('crimp', 20)).score).toBeGreaterThan(assess(ladder('jug', 20)).score + 0.3);
  });

  it('a big hold can make a hard move: large slopers on steep ground out-grade small edges on a vertical wall', () => {
    const slopers = assess(ladder('sloper', 35, { size: 0.15 }));
    const edges = assess(ladder('crimp', 0, { size: 0.08 }));
    expect(slopers.score).toBeGreaterThan(edges.score);
  });

  it('more ways up makes a route easier, other things equal', () => {
    const r = ladder('crimp', 15);
    const a = solveRoute(r, { beam: 14, depth: 70 });
    const b = solveRoute(r, { beam: 14, depth: 70, style: 1337 });
    const c = solveRoute(r, { beam: 14, depth: 70, style: 24601 });
    const one = featuresOf(r, [a.moves.map((m) => ({ limb: m.limb, holdId: m.holdId }))]);
    const many = featuresOf(r, [a, b, c].map((s) => s.moves.map((m) => ({ limb: m.limb, holdId: m.holdId }))));
    expect(many.solutions).toBeGreaterThanOrEqual(one.solutions);
    expect(gradeRoute(r, [a, b, c].map((s) => s.moves.map((m) => ({ limb: m.limb, holdId: m.holdId })))).score)
      .toBeLessThanOrEqual(gradeRoute(r, [a.moves.map((m) => ({ limb: m.limb, holdId: m.holdId }))]).score);
  });

  it('calls slab, vertical and overhang what they are', () => {
    expect(assess(ladder('jug', -12)).styles).toContain('slab');
    expect(assess(ladder('jug', 0)).styles).toContain('vertical');
    expect(assess(ladder('jug', 25)).styles).toContain('overhang');
  });

  it('a grade is always a real grade', () => {
    for (const t of ['jug', 'crimp', 'sloper'] as HoldType[]) expect(GRADES).toContain(assess(ladder(t, 10)).grade);
  });
});

describe('a stance, read statically', () => {
  it('a hand on a crimp with the feet cut on a steep wall is near its limit; with feet on it is not', () => {
    const r = ladder('crimp', 30);
    const s = initialState(r.holds, r.start, (30 * Math.PI) / 180);
    const withFeet = readStance(r, s.contacts, s.pose.hip, s.pose.shoulder);
    const cut = readStance(r, s.contacts.filter((c) => c.limb === 'LH' || c.limb === 'RH'), s.pose.hip, s.pose.shoulder);
    expect(cut.ratio).toBeGreaterThan(withFeet.ratio * 1.5);
  });
});
