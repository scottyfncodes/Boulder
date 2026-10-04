import { describe, expect, it } from 'vitest';
import {
  type Posture, PUMP, catchCost, dynoCost, effort, flingCost, freshPump, gain, pumpReason, pumpStage,
  pumpTrend, tickPump,
} from './pump';

const deg = (d: number) => (d * Math.PI) / 180;
const VERTICAL = 0;
const STEEP = deg(35);
const ROOF = deg(85);

function pose(angle: number, hands: number, feet: number, over: Partial<Posture> = {}): Posture {
  return { angle, hands, feet, speed: 0, reaching: false, ...over };
}

/** Holds a posture for `seconds` from `start`, at 60 frames a second. */
function hold(p: Posture, seconds: number, start = freshPump()) {
  let s = start;
  for (let i = 0; i < seconds * 60; i++) s = tickPump(s, p, 1 / 60);
  return s;
}

/** Seconds a posture takes to blow the pump from fresh, capped. */
function timeToFail(p: Posture, cap = 600): number {
  let s = freshPump();
  for (let i = 0; i < cap * 60; i++) {
    s = tickPump(s, p, 1 / 60);
    if (s.pump >= 1) return i / 60;
  }
  return Infinity;
}

describe('what pump comes from', () => {
  it('a steeper wall costs more, at every number of limbs', () => {
    for (const [h, f] of [[2, 2], [2, 1], [2, 0], [1, 1], [1, 0]]) {
      const costs = [0, 15, 30, 45, 60, 75, 90].map((a) => effort(pose(deg(a), h, f)));
      for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    }
  });

  it('fewer limbs holding on costs more, on any wall', () => {
    for (const a of [VERTICAL, STEEP, ROOF]) {
      const four = effort(pose(a, 2, 2));
      const three = effort(pose(a, 2, 1));
      const two = effort(pose(a, 2, 0));
      const one = effort(pose(a, 1, 0));
      expect(three).toBeGreaterThan(four);
      expect(two).toBeGreaterThan(three);
      expect(one).toBeGreaterThan(two);
    }
  });

  it('one hand holding the lot costs much more than two sharing it', () => {
    for (const a of [VERTICAL, STEEP, ROOF]) {
      expect(effort(pose(a, 1, 0))).toBeGreaterThan(effort(pose(a, 2, 0)) * 1.5);
    }
  });

  it('moving costs: swinging, and having a limb in the air', () => {
    const still = effort(pose(STEEP, 2, 1));
    expect(effort(pose(STEEP, 2, 1, { speed: 1.5 }))).toBeGreaterThan(still);
    expect(effort(pose(STEEP, 2, 1, { speed: 3 }))).toBeGreaterThan(effort(pose(STEEP, 2, 1, { speed: 1.5 })));
    expect(effort(pose(STEEP, 2, 1, { reaching: true }))).toBeGreaterThan(still);
  });

  it('nothing costs anything while you are still standing at the bottom', () => {
    expect(effort(pose(STEEP, 2, 2, { grounded: true }))).toBe(0);
  });
});

describe('the shape of it', () => {
  it('vertical with four on is a rest; vertical on one hand is not', () => {
    expect(effort(pose(VERTICAL, 2, 2))).toBeLessThan(PUMP.restLine);
    expect(effort(pose(VERTICAL, 1, 2))).toBeLessThan(PUMP.restLine);
    expect(effort(pose(VERTICAL, 1, 0))).toBeGreaterThan(PUMP.restLine * 3);
  });

  it('an overhang with four on is real work, and a roof with four on is hard', () => {
    expect(effort(pose(STEEP, 2, 2))).toBeGreaterThan(PUMP.restLine);
    expect(effort(pose(ROOF, 2, 2))).toBeGreaterThan(effort(pose(VERTICAL, 2, 0)));
  });

  it('a roof on two is very hard and a roof on one hand is the worst thing on the wall', () => {
    expect(effort(pose(ROOF, 2, 0))).toBeGreaterThan(effort(pose(VERTICAL, 1, 0)));
    expect(effort(pose(ROOF, 1, 0))).toBeGreaterThan(effort(pose(ROOF, 2, 0)) * 1.5);
    expect(effort(pose(ROOF, 1, 0))).toBeGreaterThan(effort(pose(VERTICAL, 2, 2)) * 20);
  });

  it('how long you can hang there: vertical and efficient lasts, a roof on one arm does not', () => {
    expect(timeToFail(pose(VERTICAL, 2, 2))).toBe(Infinity);
    expect(timeToFail(pose(VERTICAL, 2, 0))).toBeGreaterThan(50);
    expect(timeToFail(pose(ROOF, 2, 2))).toBeLessThan(timeToFail(pose(VERTICAL, 2, 0)));
    expect(timeToFail(pose(ROOF, 1, 0))).toBeLessThan(20);
  });

  it('the same hold costs whatever your body makes it cost: no hold enters into it', () => {
    // A jug on a roof, one hand: expensive. Anything on a vertical wall, feet on: cheap.
    expect(effort(pose(ROOF, 1, 1))).toBeGreaterThan(effort(pose(VERTICAL, 1, 2)) * 10);
  });
});

describe('recovery', () => {
  it('a stable stance brings the pump down', () => {
    const tired = { pump: 0.6, floor: 0.1, fitness: 1 };
    expect(hold(pose(VERTICAL, 2, 2), 10, tired).pump).toBeLessThan(0.6);
  });

  it('an unstable one cannot: one hand, feet cut, steep, swinging', () => {
    const tired = { pump: 0.6, floor: 0.1, fitness: 1 };
    for (const p of [pose(VERTICAL, 1, 0), pose(STEEP, 2, 0), pose(ROOF, 2, 2), pose(VERTICAL, 2, 2, { speed: 2 })]) {
      expect(hold(p, 5, tired).pump).toBeGreaterThan(0.6);
    }
  });

  it('comes back slower than it goes', () => {
    const start = { pump: 0.5, floor: 0, fitness: 1 };
    const down = 0.5 - hold(pose(VERTICAL, 2, 2), 5, start).pump;
    const up = hold(pose(VERTICAL, 1, 0), 5, start).pump - 0.5;
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(down * 1.5);
  });

  it('comes back slower the deeper you are', () => {
    const shallow = 0.35 - hold(pose(VERTICAL, 2, 2), 3, { pump: 0.35, floor: 0, fitness: 1 }).pump;
    const deep = 0.85 - hold(pose(VERTICAL, 2, 2), 3, { pump: 0.85, floor: 0, fitness: 1 }).pump;
    expect(shallow).toBeGreaterThan(deep);
  });

  it('cannot be farmed: some of every effort stays, so a rest never makes the climb free', () => {
    // Climb hard, rest as long as you like, again and again.
    let s = freshPump();
    const floors: number[] = [];
    for (let lap = 0; lap < 6; lap++) {
      s = hold(pose(STEEP, 2, 0), 12, s);
      s = hold(pose(VERTICAL, 2, 2), 600, s);
      floors.push(s.pump);
    }
    for (let i = 1; i < floors.length; i++) expect(floors[i]).toBeGreaterThan(floors[i - 1]);
    // A long rest takes you down to the floor and no further.
    expect(s.pump).toBeCloseTo(s.floor, 6);
    // Enough laps and the floor itself blows you off: there is no infinite climb.
    for (let lap = 0; lap < 60 && s.pump < 1; lap++) {
      s = hold(pose(STEEP, 2, 0), 12, s);
      s = hold(pose(VERTICAL, 2, 2), 600, s);
    }
    expect(s.pump).toBe(1);
  });
});

describe('moves', () => {
  it('a harder throw costs more, and so does throwing from a steeper wall', () => {
    expect(flingCost(1, VERTICAL, 3)).toBeGreaterThan(flingCost(0.5, VERTICAL, 3));
    expect(flingCost(1, ROOF, 3)).toBeGreaterThan(flingCost(1, VERTICAL, 3));
  });

  it('throwing with only one limb left on costs more than with three', () => {
    expect(flingCost(1, STEEP, 1)).toBeGreaterThan(flingCost(1, STEEP, 3));
  });

  it('a real dyno costs more than any throw, and a big one more than a small one', () => {
    expect(dynoCost(0.5, VERTICAL)).toBeGreaterThan(flingCost(1, VERTICAL, 1));
    expect(dynoCost(1, VERTICAL)).toBeGreaterThan(dynoCost(0.4, VERTICAL) * 1.5);
    expect(dynoCost(1, ROOF)).toBeGreaterThan(dynoCost(1, VERTICAL));
  });

  it('a dynamic catch costs, more on one hand; a gentle one is free', () => {
    expect(catchCost(0.6, true, 2, VERTICAL)).toBe(0);
    expect(catchCost(3, true, 1, VERTICAL)).toBeGreaterThan(catchCost(3, true, 2, VERTICAL));
    expect(catchCost(4, true, 2, VERTICAL)).toBeGreaterThan(catchCost(2.5, true, 2, VERTICAL));
  });

  it('a big dyno is affordable from fresh: it is a strategy, not a suicide', () => {
    const after = gain(freshPump(), dynoCost(1, VERTICAL) + catchCost(3, true, 1, VERTICAL));
    expect(after.pump).toBeLessThan(0.35);
  });

  it('fitness stretches it', () => {
    expect(gain(freshPump(1.4), 0.2).pump).toBeLessThan(gain(freshPump(1), 0.2).pump);
  });
});

describe('reading it', () => {
  it('goes fresh, pumped, struggling, critical, failure', () => {
    expect([0, 0.4, 0.6, 0.9, 1].map(pumpStage)).toEqual(['fresh', 'pumped', 'struggling', 'critical', 'failure']);
  });

  it('says which way it is going', () => {
    expect(pumpTrend(pose(VERTICAL, 2, 2))).toBe('recovering');
    expect(pumpTrend(pose(ROOF, 1, 0))).toBe('burning');
  });

  it('says why, in climbing words', () => {
    expect(pumpReason(pose(ROOF, 1, 0))).toMatch(/one hand/);
    expect(pumpReason(pose(ROOF, 1, 0))).toMatch(/feet cut|roof/);
    expect(pumpReason(pose(VERTICAL, 2, 2))).toMatch(/four on/);
  });
});
