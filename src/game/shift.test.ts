import { describe, expect, it } from 'vitest';
import type { Hold } from './types';
import { initialState, shiftBody, resolveMove } from './move';
import { anchorFor, maxReachOf } from './body';
import { dist, norm, sub } from './vec';

const jug = (id: number, x: number, y: number): Hold => ({
  id, pos: { x, y }, type: 'jug', size: 0.115, dir: -Math.PI / 2,
});
const foot = (id: number, x: number, y: number): Hold => ({
  id, pos: { x, y }, type: 'foothold', size: 0.085, dir: -Math.PI / 2,
});

/** Two hands low, two feet, and one jug far out to the right. */
function wall(): Hold[] {
  return [
    jug(1, -0.3, 1.55), jug(2, 0.3, 1.55),
    foot(3, -0.35, 0.5), foot(4, 0.35, 0.5),
    jug(5, 0.95, 2.05),   // deliberately out right
    foot(6, 0.6, 0.95),
  ];
}
const START = { LH: 1, RH: 2, LF: 3, RF: 4 };

describe('weight shift', () => {
  it('is deterministic', () => {
    const s = initialState(wall(), START);
    const a = shiftBody(s, { x: 0.3, y: 1.2 }, wall());
    const b = shiftBody(s, { x: 0.3, y: 1.2 }, wall());
    expect(a.next.pose).toEqual(b.next.pose);
  });

  it('actually moves the hips toward where it is told', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const right = shiftBody(s, { x: 0.45, y: s.pose.hip.y }, holds);
    expect(right.next.pose.hip.x).toBeGreaterThan(s.pose.hip.x + 0.1);
    const left = shiftBody(s, { x: -0.45, y: s.pose.hip.y }, holds);
    expect(left.next.pose.hip.x).toBeLessThan(s.pose.hip.x - 0.1);
  });

  it('cannot drag the body past what the limbs allow', () => {
    const holds = wall();
    const s = initialState(holds, START);
    // Ask for a hip position miles off the wall.
    const r = shiftBody(s, { x: 8, y: 4 }, holds);
    for (const c of r.next.contacts) {
      const anchor = anchorFor(c.limb, r.next.pose.hip, r.next.pose.shoulder);
      expect(dist(anchor, c.pos)).toBeLessThanOrEqual(maxReachOf(c.limb) + 0.02);
    }
  });

  it('buys reach: a hold out of range becomes reachable after shifting', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const target = holds[4].pos; // the jug out right

    const before = dist(anchorFor('RH', s.pose.hip, s.pose.shoulder), target);
    const shifted = shiftBody(s, { x: 0.5, y: 1.35 }, holds).next;
    const after = dist(anchorFor('RH', shifted.pose.hip, shifted.pose.shoulder), target);

    expect(before).toBeGreaterThan(maxReachOf('RH'));  // genuinely out of reach
    expect(after).toBeLessThan(before);                // shifting closes the gap
  });

  it('lets go and hangs naturally again when passed null', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const shifted = shiftBody(s, { x: 0.5, y: 1.3 }, holds).next;
    const released = shiftBody(shifted, null, holds).next;
    expect(Math.abs(released.pose.hip.x)).toBeLessThan(Math.abs(shifted.pose.hip.x));
    expect(released.shift).toBeNull();
  });

  it('costs stability when the weight goes out past the feet', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const overFeet = shiftBody(s, { x: 0, y: s.pose.hip.y }, holds).next;
    const wayOut = shiftBody(s, { x: 1.2, y: s.pose.hip.y }, holds).next;
    expect(wayOut.pose.stability).toBeLessThan(overFeet.pose.stability);
  });

  it('persists through a limb move', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const shifted = shiftBody(s, { x: 0.3, y: 1.3 }, holds).next;
    const anchor = anchorFor('LF', shifted.pose.hip, shifted.pose.shoulder);
    const aim = {
      limb: 'LF' as const,
      dir: norm(sub(holds[5].pos, anchor)),
      power: dist(anchor, holds[5].pos) / maxReachOf('LF'),
    };
    const r = resolveMove({ state: shifted, aim, holds });
    expect(r.next.shift).toEqual({ x: 0.3, y: 1.3 });
  });
});

describe('shift is path independent', () => {
  it('returns to the same neutral hang however you got there', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const viaRight = shiftBody(shiftBody(s, { x: 0.5, y: 1.3 }, holds).next, null, holds).next;
    const viaLeft = shiftBody(shiftBody(s, { x: -0.5, y: 0.9 }, holds).next, null, holds).next;
    // Within a millimetre. Contact zones are 50-250mm, so anything at this
    // scale is far below what a move could possibly notice.
    expect(viaRight.pose.hip.x).toBeCloseTo(viaLeft.pose.hip.x, 3);
    expect(viaRight.pose.hip.y).toBeCloseTo(viaLeft.pose.hip.y, 3);
    // And it is the pose you started in, not merely a consistent other one.
    expect(viaRight.pose.hip.x).toBeCloseTo(s.pose.hip.x, 2);
    expect(viaRight.pose.hip.y).toBeCloseTo(s.pose.hip.y, 2);
  });

  it('reaches the same commanded position from either side', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const target = { x: 0.32, y: 1.25 };
    const fromLeft = shiftBody(shiftBody(s, { x: -0.4, y: 1.1 }, holds).next, target, holds).next;
    const fromRight = shiftBody(shiftBody(s, { x: 0.6, y: 1.4 }, holds).next, target, holds).next;
    expect(fromLeft.pose.hip.x).toBeCloseTo(fromRight.pose.hip.x, 2);
    expect(fromLeft.pose.hip.y).toBeCloseTo(fromRight.pose.hip.y, 2);
  });
});
