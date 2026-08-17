import { describe, expect, it } from 'vitest';
import type { Hold, LimbId } from './types';
import { initialState, projectLanding, resolveMove, angleQuality, reachQuality } from './move';
import { anchorFor, solvePose, maxReachOf } from './body';
import { norm, sub, dist } from './vec';

const jug = (id: number, x: number, y: number, extra: Partial<Hold> = {}): Hold => ({
  id, pos: { x, y }, type: 'jug', size: 0.11, dir: -Math.PI / 2, ...extra,
});
const foot = (id: number, x: number, y: number): Hold => ({
  id, pos: { x, y }, type: 'foothold', size: 0.075, dir: -Math.PI / 2,
});

/** A plain ladder of jugs with feet, used as the control case. */
function ladder(): Hold[] {
  return [
    jug(1, -0.28, 1.55), jug(2, 0.28, 1.55),
    foot(3, -0.3, 0.62), foot(4, 0.3, 0.62),
    jug(5, -0.24, 2.15), jug(6, 0.26, 2.2),
    foot(7, -0.28, 1.2), foot(8, 0.3, 1.24),
  ];
}
const START = { LH: 1, RH: 2, LF: 3, RF: 4 };

function aimAt(state: ReturnType<typeof initialState>, limb: LimbId, target: { x: number; y: number }) {
  const anchor = anchorFor(limb, state.pose.hip, state.pose.shoulder);
  const d = sub(target, anchor);
  return { limb, dir: norm(d), power: dist(anchor, target) / maxReachOf(limb) };
}

describe('body solver', () => {
  it('hangs from straight arms once the feet have nothing and the mat is gone', () => {
    // Hands on the high jugs (~2.15) and nothing else — too high to stand up.
    const s = initialState(ladder(), { LH: 5, RH: 6 });
    expect(s.pose.shoulder.y).toBeLessThan(2.15 - 0.6);
    expect(s.pose.hip.y).toBeLessThan(s.pose.shoulder.y);
  });

  it('lets the climber stand on the mat before they have pulled on', () => {
    const s = initialState(ladder(), { LH: 1, RH: 2 });
    // Feet are still on the floor, so the hips do not sink to a full hang.
    expect(s.pose.hip.y).toBeGreaterThan(0.6);
  });

  it('stands up on its feet rather than dangling off the hands', () => {
    const s = initialState(ladder(), START);
    expect(s.contacts).toHaveLength(4);
    // Feet at 0.62 — standing on them puts the hips well above the mat.
    expect(s.pose.hip.y).toBeGreaterThan(0.95);
    expect(s.pose.shoulder.y).toBeGreaterThan(s.pose.hip.y);
  });

  it('is deterministic — identical inputs give bit-identical poses', () => {
    const a = initialState(ladder(), START);
    const b = initialState(ladder(), START);
    expect(a.pose).toEqual(b.pose);
  });

  it('raises the shoulder when a foot steps up', () => {
    const holds = ladder();
    const low = initialState(holds, START);
    const high = initialState(holds, { LH: 1, RH: 2, LF: 7, RF: 8 });
    expect(high.pose.shoulder.y).toBeGreaterThan(low.pose.shoulder.y);
  });

  it('scores a four-point stance as stable and a one-arm hang as not', () => {
    const four = initialState(ladder(), START);
    const one = initialState(ladder(), { LH: 1 });
    expect(four.pose.stability).toBeGreaterThan(0.6);
    expect(one.pose.stability).toBeLessThan(four.pose.stability);
  });

  it('flags a barn door when both contacts are on the same side', () => {
    const holds = ladder();
    const square = initialState(holds, { LH: 1, RH: 2, LF: 3, RF: 4 });
    const sided = initialState(holds, { LH: 1, LF: 3 });
    expect(Math.abs(sided.pose.barnDoor)).toBeGreaterThan(Math.abs(square.pose.barnDoor));
  });
});

describe('move resolution', () => {
  it('is deterministic — the same throw from the same state repeats exactly', () => {
    const holds = ladder();
    const s = initialState(holds, START);
    const aim = aimAt(s, 'RH', holds[5].pos);
    const a = resolveMove({ state: s, aim, holds });
    const b = resolveMove({ state: s, aim, holds });
    expect(a.grade).toBe(b.grade);
    expect(a.next.pose).toEqual(b.next.pose);
    expect(a.landing).toEqual(b.landing);
  });

  it('sticks a well-aimed jug within comfortable reach', () => {
    const holds = ladder();
    const s = initialState(holds, START);
    const r = resolveMove({ state: s, aim: aimAt(s, 'RH', holds[5].pos), holds });
    expect(['PERFECT', 'GOOD']).toContain(r.grade);
    expect(r.holdId).toBe(6);
    expect(r.fell).toBe(false);
  });

  it('misses when aimed at empty wall', () => {
    const holds = ladder();
    const s = initialState(holds, START);
    const r = resolveMove({ state: s, aim: aimAt(s, 'RH', { x: 1.4, y: 1.9 }), holds });
    expect(['MISS', 'YEET']).toContain(r.grade);
    expect(r.holdId).toBeNull();
  });

  it('calls a dramatic overshoot a YEET', () => {
    const holds = ladder();
    const s = initialState(holds, START);
    const anchor = anchorFor('RH', s.pose.hip, s.pose.shoulder);
    const aim = { limb: 'RH' as LimbId, dir: norm(sub(holds[5].pos, anchor)), power: 1 };
    const r = resolveMove({ state: s, aim, holds });
    expect(r.grade).toBe('YEET');
  });

  it('lands the limb exactly where the preview said it would', () => {
    const holds = ladder();
    const s = initialState(holds, START);
    const aim = aimAt(s, 'RH', holds[5].pos);
    const preview = projectLanding(s, aim);
    const r = resolveMove({ state: s, aim, holds });
    expect(r.landing.x).toBeCloseTo(preview.landing.x, 10);
    expect(r.landing.y).toBeCloseTo(preview.landing.y, 10);
  });
});

describe('hold directionality', () => {
  const com = { x: 0, y: 1.0 };
  it('loves a jug pulled straight down and does not care much either way', () => {
    const h = jug(1, 0, 1.8);
    expect(angleQuality(h, 'RH', com)).toBeGreaterThan(0.95);
  });

  it('rejects an undercling while the hips are still below it', () => {
    const h: Hold = { id: 1, pos: { x: 0, y: 1.8 }, type: 'undercling', size: 0.1, dir: Math.PI / 2 };
    const below = angleQuality(h, 'RH', { x: 0, y: 1.0 });
    const above = angleQuality(h, 'RH', { x: 0, y: 2.2 });
    expect(below).toBeLessThan(0.25);
    expect(above).toBeGreaterThan(0.9);
  });

  it('wants a sidepull loaded across the body, not straight down', () => {
    // A right-hand sidepull that pulls down-and-left.
    const h: Hold = { id: 1, pos: { x: 0.5, y: 1.9 }, type: 'sidepull', size: 0.1, dir: Math.PI * 1.15 };
    const across = angleQuality(h, 'RH', { x: -0.35, y: 1.55 });
    const under = angleQuality(h, 'RH', { x: 0.5, y: 1.0 });
    expect(across).toBeGreaterThan(under);
  });
});

describe('reach', () => {
  it('is unpenalised close in and punishing at full stretch', () => {
    expect(reachQuality('RH', 0.4)).toBe(1);
    expect(reachQuality('RH', 0.74)).toBeLessThan(0.6);
    expect(reachQuality('RH', 0.82)).toBeLessThan(0.45);
  });
});

describe('pose sanity', () => {
  it('never inverts the climber', () => {
    const p = solvePose({
      contacts: [
        { limb: 'LH', holdId: 1, pos: { x: -0.3, y: 0.4 }, seat: 1, grip: 1, grade: 'GOOD' },
        { limb: 'RH', holdId: 2, pos: { x: 0.3, y: 0.4 }, seat: 1, grip: 1, grade: 'GOOD' },
      ],
      seedHip: { x: 0, y: 1 }, seedShoulder: { x: 0, y: 1.5 },
    });
    expect(p.shoulder.y).toBeGreaterThan(p.hip.y);
  });
});
