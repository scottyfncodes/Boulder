import { describe, expect, it } from 'vitest';
import {
  type ArmId, type Posture, type Pump, ARMS, PUMP, armEfforts, armShare, blownArms, catchCost, dynoCost, effort,
  flingCost, freshPump, gain, pumpReason, pumpStage, pumpTrend, restRate, tickPump, wallFactor,
} from './pump';

const deg = (d: number) => (d * Math.PI) / 180;
const VERTICAL = 0;
const STEEP = deg(35);
const ROOF = deg(85);

function pose(angle: number, hands: number, feet: number, over: Partial<Posture> = {}): Posture {
  return { angle, hands, feet, speed: 0, reaching: false, ...over };
}

/** Both forearms at the same level, some of it for good. */
function tired(pump: number, floor = 0, fitness = 1): Pump {
  const s = freshPump(fitness);
  const arm = { pump, floor };
  return { ...s, pump, floor, arms: { LH: { ...arm }, RH: { ...arm } } };
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

/** One hand on, the other hanging off and shaking. */
function shaking(angle: number, feet: number, arm: ArmId, over: Partial<Posture> = {}): Posture {
  const off = arm;
  const on = off === 'LH' ? 'RH' : 'LH';
  return pose(angle, 1, feet, {
    held: { [on]: true, [off]: false } as Record<ArmId, boolean>,
    shaking: { [on]: false, [off]: true } as Record<ArmId, boolean>,
    ...over,
  });
}

/** Rate of the bar in a posture, per second, at a middling pump. */
const rate = (p: Posture) => restRate(p, 0.4);

describe('the load: wall × limbs × feet × movement', () => {
  it('a steeper wall costs more, at every number of limbs', () => {
    for (const [h, f] of [[2, 2], [2, 1], [2, 0], [1, 1], [1, 0]]) {
      const costs = [0, 15, 30, 45, 60, 75, 90].map((a) => effort(pose(deg(a), h, f)));
      for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    }
  });

  it('the wall matters a lot: a roof multiplies what a forearm carries several times over', () => {
    expect(wallFactor(VERTICAL)).toBe(1);
    expect(wallFactor(deg(30))).toBeLessThan(2.2);
    expect(wallFactor(deg(60))).toBeGreaterThan(wallFactor(deg(30)) + 0.8);
    expect(wallFactor(ROOF)).toBeGreaterThan(3.5);
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

  it('a foot only helps as much as it is really standing on something', () => {
    const feet = (support: number) => effort(pose(STEEP, 2, 1, { footSupport: [{ support, hooked: false }] }));
    expect(feet(1)).toBeLessThan(feet(0.5));
    expect(feet(0.5)).toBeLessThan(feet(0.1));
    expect(feet(0)).toBeCloseTo(effort(pose(STEEP, 2, 0)), 6);
  });

  it('feet do less the steeper the wall, and hooks hold on where standing feet cannot', () => {
    const stand = [{ support: 1, hooked: false }];
    const hook = [{ support: 1, hooked: true }];
    expect(armShare(pose(ROOF, 2, 1, { footSupport: stand }))).toBeGreaterThan(armShare(pose(VERTICAL, 2, 1, { footSupport: stand })));
    expect(armShare(pose(ROOF, 2, 1, { footSupport: hook }))).toBeLessThan(armShare(pose(ROOF, 2, 1, { footSupport: stand })));
  });

  it('where the body hangs between the hands decides which forearm works', () => {
    const under = armEfforts(pose(STEEP, 2, 1, { leftShare: 0.8 }));
    expect(under.LH).toBeGreaterThan(under.RH);
    const even = armEfforts(pose(STEEP, 2, 1));
    expect(even.LH).toBeCloseTo(even.RH, 9);
  });

  it('moving costs: swinging, and having a limb in the air', () => {
    const still = effort(pose(STEEP, 2, 1));
    expect(effort(pose(STEEP, 2, 1, { speed: 1.5 }))).toBeGreaterThan(still);
    expect(effort(pose(STEEP, 2, 1, { speed: 3 }))).toBeGreaterThan(effort(pose(STEEP, 2, 1, { speed: 1.5 })));
    expect(effort(pose(STEEP, 2, 1, { reaching: true }))).toBeGreaterThan(still);
  });

  it('nothing costs anything while you are still standing at the bottom', () => {
    expect(effort(pose(STEEP, 2, 2, { grounded: true }))).toBe(0);
    expect(hold(pose(ROOF, 1, 0, { grounded: true }), 5, tired(0.5)).pump).toBeLessThanOrEqual(0.5);
  });
});

describe('the curve: where pump comes back and where it goes', () => {
  it('flat and easy terrain is a proper rest', () => {
    // A slab leans back, not out: it reads as vertical at worst.
    expect(rate(pose(deg(-15), 2, 2))).toBeLessThan(-0.012);
    expect(rate(pose(deg(-15), 2, 2))).toBeCloseTo(rate(pose(VERTICAL, 2, 2)), 9);
  });

  it('vertical: four on is a strong rest, three a good one, two about even, one pumps', () => {
    const four = rate(pose(VERTICAL, 2, 2));
    const three = rate(pose(VERTICAL, 2, 1));
    const twoFoot = rate(pose(VERTICAL, 1, 1));
    const one = rate(pose(VERTICAL, 1, 0));
    expect(four).toBeLessThan(-0.012);
    expect(three).toBeLessThan(-0.004);
    expect(three).toBeGreaterThan(four);
    expect(Math.abs(twoFoot)).toBeLessThan(0.006);
    expect(one).toBeGreaterThan(0.03);
  });

  it('a moderate overhang: four on rests a little, three is about even, two pumps', () => {
    const a = deg(30);
    expect(rate(pose(a, 2, 2))).toBeLessThan(-0.004);
    expect(Math.abs(rate(pose(a, 2, 1)))).toBeLessThan(0.006);
    expect(rate(pose(a, 2, 0))).toBeGreaterThan(0.01);
    expect(rate(pose(a, 1, 1))).toBeGreaterThan(0.01);
  });

  it('a roof: four on is barely a rest at all, two pumps hard, one is a countdown', () => {
    expect(Math.abs(rate(pose(ROOF, 2, 2, { footSupport: [{ support: 1, hooked: true }, { support: 1, hooked: true }] })))).toBeLessThan(0.006);
    expect(rate(pose(ROOF, 2, 2))).toBeGreaterThan(rate(pose(VERTICAL, 2, 2)) + 0.012);
    expect(rate(pose(ROOF, 2, 0))).toBeGreaterThan(0.03);
    expect(rate(pose(ROOF, 1, 0))).toBeGreaterThan(rate(pose(ROOF, 2, 0)) * 2.5);
  });

  it('how long you can hang there: vertical and efficient lasts, a roof on one arm does not', () => {
    expect(timeToFail(pose(VERTICAL, 2, 2))).toBe(Infinity);
    expect(timeToFail(pose(VERTICAL, 2, 0))).toBeGreaterThan(50);
    expect(timeToFail(pose(ROOF, 2, 2))).toBeLessThan(timeToFail(pose(VERTICAL, 2, 0)) * 3);
    expect(timeToFail(pose(ROOF, 1, 0))).toBeLessThan(12);
  });

  it('the same hold costs whatever your body makes it cost: no hold enters into it', () => {
    expect(effort(pose(ROOF, 1, 1))).toBeGreaterThan(effort(pose(VERTICAL, 1, 2)) * 8);
  });
});

describe('recovery', () => {
  it('a stable stance brings the pump down while you stay put', () => {
    expect(hold(pose(VERTICAL, 2, 2), 10, tired(0.6, 0.1)).pump).toBeLessThan(0.5);
    expect(hold(pose(deg(30), 2, 2), 10, tired(0.6, 0.1)).pump).toBeLessThan(0.6);
  });

  it('an unstable one cannot: one hand, feet cut, steep, swinging', () => {
    for (const p of [pose(VERTICAL, 1, 0), pose(STEEP, 2, 0), pose(ROOF, 2, 1), pose(VERTICAL, 2, 2, { speed: 2 })]) {
      expect(hold(p, 5, tired(0.6, 0.1)).pump).toBeGreaterThan(0.6);
    }
  });

  it('a still body recovers; the same stance swinging does not', () => {
    const still = 0.6 - hold(pose(VERTICAL, 2, 2), 5, tired(0.6)).pump;
    const swaying = 0.6 - hold(pose(VERTICAL, 2, 2, { speed: 0.5 }), 5, tired(0.6)).pump;
    expect(still).toBeGreaterThan(swaying * 1.5);
  });

  it('comes back slower than it goes', () => {
    const down = 0.5 - hold(pose(VERTICAL, 2, 2), 5, tired(0.5)).pump;
    const up = hold(pose(VERTICAL, 1, 0), 5, tired(0.5)).pump - 0.5;
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(down * 1.5);
  });

  it('comes back slower the deeper you are', () => {
    const shallow = 0.35 - hold(pose(VERTICAL, 2, 2), 3, tired(0.35)).pump;
    const deep = 0.85 - hold(pose(VERTICAL, 2, 2), 3, tired(0.85)).pump;
    expect(shallow).toBeGreaterThan(deep);
  });

  it('never goes below zero, and never below what the climb has cost for good', () => {
    let s = hold(pose(VERTICAL, 2, 2), 600, tired(0.05));
    expect(s.pump).toBe(0);
    for (const a of ARMS) expect(s.arms[a].pump).toBe(0);
    s = hold(pose(VERTICAL, 2, 2), 600, tired(0.6, 0.2));
    expect(s.pump).toBeCloseTo(0.2, 9);
    // Even a shakeout on a perfect stance stops at zero.
    s = hold(shaking(VERTICAL, 2, 'LH'), 120, tired(0.02));
    expect(s.arms.LH.pump).toBe(0);
    expect(Math.min(s.pump, s.arms.LH.pump, s.arms.RH.pump)).toBeGreaterThanOrEqual(0);
  });

  it('cannot be farmed: some of every effort stays, so a rest never makes the climb free', () => {
    let s = freshPump();
    const floors: number[] = [];
    for (let lap = 0; lap < 6; lap++) {
      s = hold(pose(STEEP, 2, 0), 12, s);
      s = hold(pose(VERTICAL, 2, 2), 600, s);
      floors.push(s.pump);
    }
    for (let i = 1; i < floors.length; i++) expect(floors[i]).toBeGreaterThan(floors[i - 1]);
    expect(s.pump).toBeCloseTo(s.floor, 6);
    for (let lap = 0; lap < 80 && s.pump < 1; lap++) {
      s = hold(pose(STEEP, 2, 0), 12, s);
      s = hold(pose(VERTICAL, 2, 2), 600, s);
    }
    expect(s.pump).toBe(1);
  });
});

describe('shaking out, one arm at a time', () => {
  it('the hand off the wall recovers while the hand on carries the load', () => {
    const s = hold(shaking(deg(20), 2, 'LH'), 4, tired(0.6));
    expect(s.arms.LH.pump).toBeLessThan(0.55);
    expect(s.arms.LH.pump).toBeLessThan(s.arms.RH.pump);
    expect(armEfforts(shaking(deg(20), 2, 'LH')).RH).toBeGreaterThan(armEfforts(pose(deg(20), 2, 2)).RH);
  });

  /** Alternates: `each` seconds off on one arm, then the other, for `seconds`. */
  function alternate(angle: number, feet: number, seconds: number, start: Pump, each = 4): Pump {
    let s = start;
    let arm: ArmId = 'LH';
    for (let t = 0; t < seconds; t += each) {
      s = hold(shaking(angle, feet, arm), each, s);
      arm = arm === 'LH' ? 'RH' : 'LH';
    }
    return s;
  }

  it('load, stabilise, shake one, switch, shake the other: beats just hanging there on good feet', () => {
    for (const a of [VERTICAL, deg(20), deg(35)]) {
      const shook = alternate(a, 2, 32, tired(0.6, 0.1));
      const hung = hold(pose(a, 2, 2), 32, tired(0.6, 0.1));
      expect(shook.pump).toBeLessThan(hung.pump - 0.02);
    }
  });

  it('a bad position makes it pointless or worse: no feet, poor feet, or a roof', () => {
    // No feet: the arm left on is holding everything.
    expect(alternate(VERTICAL, 0, 24, tired(0.6)).pump).toBeGreaterThan(0.6);
    // One foot on a steep wall: the arm on pumps faster than the other recovers.
    expect(alternate(deg(45), 1, 24, tired(0.6)).pump).toBeGreaterThan(0.6);
    // A roof, both feet on: nearly nothing for it.
    const roof = 0.6 - alternate(ROOF, 2, 24, tired(0.6)).pump;
    const wall = 0.6 - alternate(VERTICAL, 2, 24, tired(0.6)).pump;
    expect(roof).toBeLessThan(wall * 0.35);
  });

  it('shaking while swinging gets you much less', () => {
    const still = 0.6 - hold(shaking(VERTICAL, 2, 'LH'), 4, tired(0.6)).arms.LH.pump;
    const moving = 0.6 - hold(shaking(VERTICAL, 2, 'LH', { speed: 0.6 }), 4, tired(0.6)).arms.LH.pump;
    expect(still).toBeGreaterThan(moving * 2);
  });

  it('the bar follows the worse arm: the one about to let go', () => {
    let s = tired(0.5);
    s = gain(s, 0.2, 'RH');
    expect(s.pump).toBeCloseTo(s.arms.RH.pump, 9);
    expect(s.arms.LH.pump).toBeCloseTo(0.5, 9);
  });

  it('a blown forearm opens its own hand, not both', () => {
    let s = tired(0.95);
    s = gain(s, 0.2, 'LH');
    expect(blownArms(s)).toEqual(['LH']);
  });
});

describe('no jumps: small changes make small differences', () => {
  it('sweeping the wall from slab to past a roof never jumps', () => {
    for (const [h, f] of [[2, 2], [2, 1], [1, 2], [2, 0], [1, 0]]) {
      let prev = rate(pose(deg(-30), h, f));
      for (let a = -29.9; a <= 120; a += 0.1) {
        const r = rate(pose(deg(a), h, f));
        expect(Math.abs(r - prev)).toBeLessThan(0.0015);
        expect(Number.isFinite(r)).toBe(true);
        prev = r;
      }
    }
  });

  it('a foot coming on gradually brings the rate down gradually', () => {
    let prev = rate(pose(STEEP, 2, 1, { footSupport: [{ support: 0, hooked: false }] }));
    for (let k = 0.01; k <= 1; k += 0.01) {
      const r = rate(pose(STEEP, 2, 1, { footSupport: [{ support: k, hooked: false }] }));
      expect(Math.abs(r - prev)).toBeLessThan(0.002);
      prev = r;
    }
  });

  it('weight shifting between the hands changes things smoothly', () => {
    let prev = rate(pose(STEEP, 2, 1, { leftShare: 0.2 }));
    for (let k = 0.21; k <= 0.8; k += 0.01) {
      const r = rate(pose(STEEP, 2, 1, { leftShare: k }));
      expect(Math.abs(r - prev)).toBeLessThan(0.002);
      prev = r;
    }
  });

  it('grabbing or dropping a limb bends the rate over a moment rather than snapping it', () => {
    // Settled on four, then a foot comes off, then a hand: frame to frame the
    // bar's speed never lurches, though where it ends up is very different.
    let s = hold(pose(STEEP, 2, 2), 3, tired(0.5));
    const seq = [pose(STEEP, 2, 1), pose(STEEP, 1, 1)];
    let lastRate = s.rate;
    for (const p of seq) {
      for (let i = 0; i < 120; i++) {
        const before = s.pump;
        s = tickPump(s, p, 1 / 60);
        const inst = (s.pump - before) * 60;
        expect(Math.abs(inst - lastRate)).toBeLessThan(0.006);
        lastRate = inst;
      }
    }
    expect(s.pump).toBeGreaterThan(0.5);
  });

  it('copes with extreme angles: upside down and beyond is a roof, not a crash', () => {
    for (const a of [deg(90), deg(135), deg(180), deg(-90), Math.PI * 4]) {
      for (const [h, f] of [[2, 2], [1, 0], [0, 2]]) {
        const e = armEfforts(pose(a, h, f));
        for (const arm of ARMS) expect(Number.isFinite(e[arm])).toBe(true);
        const s = hold(pose(a, h, f), 2, tired(0.5));
        expect(s.pump).toBeGreaterThanOrEqual(0);
        expect(s.pump).toBeLessThanOrEqual(1);
      }
    }
    expect(effort(pose(deg(150), 1, 0))).toBeCloseTo(effort(pose(deg(90), 1, 0)), 9);
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

  it('a dyno past a bad sequence can be cheaper than climbing it', () => {
    // Four moves on a roof, hands cut half the time, against one big dyno.
    let climbed = tired(0.3);
    for (let i = 0; i < 4; i++) {
      climbed = gain(climbed, flingCost(0.7, ROOF, 2));
      climbed = hold(pose(ROOF, 1, 1, { reaching: true }), 1.5, climbed);
      climbed = hold(pose(ROOF, 2, 1), 2, climbed);
    }
    const dynoed = gain(tired(0.3), dynoCost(1, ROOF) + catchCost(3, true, 2, ROOF));
    expect(dynoed.pump).toBeLessThan(climbed.pump);
  });

  it('fitness stretches it', () => {
    expect(gain(freshPump(1.4), 0.2).pump).toBeLessThan(gain(freshPump(1), 0.2).pump);
    expect(timeToFail(pose(STEEP, 2, 0))).toBeLessThan(
      (() => { let s = freshPump(1.4); let t = 0; while (s.pump < 1 && t < 600) { s = tickPump(s, pose(STEEP, 2, 0), 1 / 60); t += 1 / 60; } return t; })(),
    );
  });
});

describe('reading it', () => {
  it('goes fresh, pumped, struggling, critical, failure', () => {
    expect([0, 0.4, 0.6, 0.9, 1].map(pumpStage)).toEqual(['fresh', 'pumped', 'struggling', 'critical', 'failure']);
  });

  it('says which way the bar is actually going', () => {
    expect(pumpTrend(hold(pose(VERTICAL, 2, 2), 2, tired(0.5)))).toBe('recovering');
    expect(pumpTrend(hold(pose(ROOF, 1, 0), 2, tired(0.2)))).toBe('burning');
    expect(pumpTrend(hold(pose(VERTICAL, 2, 2), 2, tired(0)))).toBe('steady');
  });

  it('says why, in climbing words', () => {
    expect(pumpReason(pose(ROOF, 1, 0))).toMatch(/one hand/);
    expect(pumpReason(pose(ROOF, 1, 0))).toMatch(/feet cut|roof/);
    expect(pumpReason(pose(VERTICAL, 2, 2))).toMatch(/four on/);
    expect(pumpReason(shaking(VERTICAL, 2, 'LH'), 'recovering')).toMatch(/shaking out/);
    expect(pumpReason(pose(VERTICAL, 2, 2), 'recovering')).toMatch(/feet|resting/);
    expect(pumpReason(pose(STEEP, 2, 0))).toMatch(/feet cut/);
  });

  it('the restLine still splits rest from work on a single forearm', () => {
    expect(effort(pose(VERTICAL, 2, 2))).toBeLessThan(PUMP.restLine);
    expect(effort(pose(VERTICAL, 1, 0))).toBeGreaterThan(PUMP.restLine * 3);
  });
});
