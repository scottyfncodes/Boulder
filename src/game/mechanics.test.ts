import { describe, expect, it } from 'vitest';
import type { Hold } from './types';
import {
  DYNO_RANGE, dynoLanding, initialState, limbOrigin, resolveDyno, resolveMove, zoneAt,
} from './move';
import { anchorFor, footShare, maxReachOf, pullOff } from './body';
import { worldZones } from './holds';
import { dist, norm, sub } from './vec';

const jug = (id: number, x: number, y: number): Hold => ({
  id, pos: { x, y }, type: 'jug', size: 0.115, dir: -Math.PI / 2,
});
const foot = (id: number, x: number, y: number): Hold => ({
  id, pos: { x, y }, type: 'foothold', size: 0.085, dir: -Math.PI / 2,
});
const wall = (): Hold[] => [
  jug(1, -0.3, 1.55), jug(2, 0.3, 1.55),
  foot(3, -0.35, 0.5), foot(4, 0.35, 0.5),
  jug(5, -0.28, 2.1), jug(6, 0.28, 2.1),
  jug(7, 0.0, 2.95),          // a long way up: dyno territory
];
const START = { LH: 1, RH: 2, LF: 3, RF: 4 };

describe('hold zones', () => {
  it('gives a jug a good incut and a worse lip', () => {
    const h = jug(1, 0, 2);
    const zones = worldZones(h);
    expect(zones).toHaveLength(2);
    const incut = zoneAt(h, zones[0].pos)!;
    const lip = zoneAt(h, zones[1].pos)!;
    expect(incut.quality).toBeGreaterThan(lip.quality);
    expect(incut.name).toBe('the incut');
    expect(lip.name).toBe('the lip');
  });

  it('returns nothing for a landing that touches no usable part', () => {
    const h = jug(1, 0, 2);
    expect(zoneAt(h, { x: 5, y: 5 })).toBeNull();
  });

  it('rotates zones with the hold, so a sidepull rail runs along the rail', () => {
    const up: Hold = { id: 1, pos: { x: 0, y: 2 }, type: 'sidepull', size: 0.105, dir: -Math.PI / 2 };
    const side: Hold = { ...up, dir: Math.PI };
    const upBest = worldZones(up)[0].pos;
    const sideBest = worldZones(side)[0].pos;
    // The best zone sits off-centre, so turning the hold moves it somewhere else.
    expect(dist(upBest, sideBest)).toBeGreaterThan(0.01);
  });

  it('tapers quality toward a zone edge, so precision still pays inside it', () => {
    const h = jug(1, 0, 2);
    const z = worldZones(h)[0];
    const centre = zoneAt(h, z.pos)!;
    const edge = zoneAt(h, { x: z.pos.x + z.r * 0.95, y: z.pos.y })!;
    expect(centre.quality).toBeGreaterThan(edge.quality);
  });
});

describe('slingshot momentum', () => {
  it('costs stability to throw harder at the same hold', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const from = limbOrigin(s, 'RH');
    const target = worldZones(holds[5])[0].pos;
    const d = dist(from, target);
    const dir = norm(sub(target, from));

    const measured = resolveMove({ state: s, aim: { limb: 'RH', dir, power: d / maxReachOf('RH') }, holds });
    const hurled = resolveMove({ state: s, aim: { limb: 'RH', dir, power: 1 }, holds });

    expect(measured.detail.momentum).toBeLessThan(hurled.detail.momentum);
  });

  it('arrests momentum when the hold is actually caught', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const from = limbOrigin(s, 'RH');
    const target = worldZones(holds[5])[0].pos;
    const dir = norm(sub(target, from));
    const power = dist(from, target) / maxReachOf('RH');
    const caught = resolveMove({ state: s, aim: { limb: 'RH', dir, power }, holds });
    const whiffed = resolveMove({ state: s, aim: { limb: 'RH', dir: { x: 1, y: 0.2 }, power }, holds });
    expect(caught.holdId).not.toBeNull();
    expect(caught.detail.momentum).toBeLessThan(whiffed.detail.momentum);
  });
});

describe('overhang', () => {
  it('hands weight from the feet to the arms as the wall tips back', () => {
    expect(footShare(0)).toBeCloseTo(1, 5);
    expect(pullOff(0)).toBeCloseTo(0, 5);
    const steep = (40 * Math.PI) / 180;
    expect(footShare(steep)).toBeLessThan(0.8);
    expect(pullOff(steep)).toBeGreaterThan(0.6);
  });

  it('makes the identical stance less stable on a steeper wall', () => {
    const holds = wall();
    const flat = initialState(holds, START, 0);
    const steep = initialState(holds, START, (35 * Math.PI) / 180);
    expect(steep.pose.stability).toBeLessThan(flat.pose.stability);
  });

  it('is deterministic at any angle', () => {
    const a = initialState(wall(), START, 0.5);
    const b = initialState(wall(), START, 0.5);
    expect(a.pose).toEqual(b.pose);
  });
});

/** The power whose hand-landing lands on `target`, found the way the UI would. */
function powerToReach(state: Parameters<typeof dynoLanding>[0], target: { x: number; y: number }): number {
  let best = 0;
  let bestD = Infinity;
  for (let p = 0.05; p <= 1; p += 0.005) {
    const d = dist(dynoLanding(state, { limb: 'RH', dir: { x: 0, y: 1 }, power: p }).hands, target);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

describe('dyno', () => {
  it('reaches holds a single limb cannot', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const anchor = anchorFor('RH', s.pose.hip, s.pose.shoulder);
    const target = holds[6].pos;
    expect(dist(anchor, target)).toBeGreaterThan(maxReachOf('RH'));

    // Aim it the way a player would: find the power that puts the hands there.
    const power = powerToReach(s, target);
    const r = resolveDyno(s, { limb: 'RH', dir: { x: 0, y: 1 }, power }, holds);
    expect(r.fell).toBe(false);
    expect(r.caught.length).toBeGreaterThan(0);
  });

  it('lands on the mat when aimed at nothing', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const r = resolveDyno(s, { limb: 'RH', dir: { x: 1, y: 0.3 }, power: 1 }, holds);
    expect(r.fell).toBe(true);
    expect(r.grade).toBe('YEET');
  });

  it('is deterministic', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const aim = { limb: 'RH' as const, dir: { x: 0, y: 1 }, power: powerToReach(s, holds[6].pos) };
    const a = resolveDyno(s, aim, holds);
    const b = resolveDyno(s, aim, holds);
    expect(a.next.pose).toEqual(b.next.pose);
    expect(a.caught).toEqual(b.caught);
  });

  it('never catches cleanly — a dyno placement is always worse than a static one', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const r = resolveDyno(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: powerToReach(s, holds[6].pos) }, holds);
    expect(r.next.contacts.length).toBeGreaterThan(0);
    for (const c of r.next.contacts) expect(c.seat).toBeLessThan(0.7);
  });

  it('cannot travel further than its range', () => {
    const holds = wall();
    const s = initialState(holds, START);
    const r = resolveDyno(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 1 }, holds);
    expect(r.next.pose.hip.y - s.pose.hip.y).toBeLessThanOrEqual(DYNO_RANGE + 0.3);
  });
});
