import { describe, expect, it } from 'vitest';
import { SLING_LAB } from '../content/lab';
import { SLING, initialSling, launch, letGo, placeLimb, postureOf, pumpOut, stepSling, type SlingEvent, type SlingState } from './sling';
import { PUMP, type Pump, effort, freshPump, restRate, tickPump } from './pump';
import { flatProfile } from './profile';
import { climb } from './climbBot';
import { ROUTES } from '../content/routes';
import { generateRoute } from '../content/generator';

const holds = SLING_LAB.holds;
const deg = (d: number) => (d * Math.PI) / 180;

function settled(wall: number, start = SLING_LAB.start) {
  const s = initialSling(holds, start, flatProfile(wall));
  s.left = true;
  for (let i = 0; i < 240; i++) stepSling(s, holds, SLING.dt);
  return s;
}

describe('the pump, read off the body', () => {
  it('four on a vertical wall is a rest; the same stance under a roof is not', () => {
    const vertical = postureOf(settled(0));
    const roof = postureOf(settled(deg(75)));
    expect(vertical.hands + vertical.feet).toBe(4);
    expect(effort(vertical)).toBeLessThan(PUMP.restLine);
    expect(effort(roof)).toBeGreaterThan(effort(vertical) * 4);
  });

  it('standing at the bottom costs nothing until you leave the ground', () => {
    const s = initialSling(holds, SLING_LAB.start);
    expect(postureOf(s).grounded).toBe(true);
    expect(effort(postureOf(s))).toBe(0);
  });

  it('throwing a limb is reaching, and one fewer thing holding on', () => {
    const s = settled(deg(30));
    const before = effort(postureOf(s));
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.6 });
    stepSling(s, holds, SLING.dt);
    const p = postureOf(s);
    expect(p.reaching).toBe(true);
    expect(p.hands).toBe(1);
    expect(effort(p)).toBeGreaterThan(before);
  });

  it('a minute on a vertical wall with four on is a rest; under a roof it is not, and feet cut it is a countdown', () => {
    const run = (wall: number, feetOff = false) => {
      const s = settled(wall);
      if (feetOff) cutFeet(s);
      let pump = tiredAt(0.3, 0.05);
      for (let i = 0; i < 60 / SLING.dt; i++) {
        stepSling(s, holds, SLING.dt);
        pump = tickPump(pump, postureOf(s), SLING.dt);
      }
      return pump.pump;
    };
    expect(run(0)).toBeLessThan(0.15);
    expect(run(deg(75))).toBeGreaterThanOrEqual(0.3);
    expect(run(deg(75), true)).toBeGreaterThan(0.6);
  });
});

function tiredAt(level: number, floor = 0): Pump {
  const s = freshPump();
  return { ...s, pump: level, floor, arms: { LH: { pump: level, floor }, RH: { pump: level, floor } } };
}

/** Both feet off whatever they are on, hanging. */
function cutFeet(s: SlingState): void {
  for (const f of ['LF', 'RF'] as const) {
    const l = s.limbs[f];
    l.phase = 'free';
    l.holdId = null;
    l.onFloor = false;
  }
}

describe('the load, read off the real body', () => {
  it('feet under the hips count for everything; a foot hauled up by the hip counts for much less', () => {
    const s = settled(0);
    const under = postureOf(s).footSupport!;
    expect(under).toHaveLength(2);
    for (const f of under) expect(f.support).toBeGreaterThan(0.8);
    // Put the right foot up on the left hand's jug: a high step, not a stance.
    s.limbs.RF.pos = { x: 0.3, y: s.hip.y + 0.1 };
    const high = postureOf(s).footSupport!;
    expect(Math.min(...high.map((f) => f.support))).toBeLessThan(0.6);
  });

  it('the hand nearer under the weight takes more of it', () => {
    const s = settled(deg(30));
    s.hip.x -= 0.2;
    s.shoulder.x -= 0.2;
    expect(postureOf(s).leftShare!).toBeGreaterThan(0.6);
    s.hip.x += 0.4;
    s.shoulder.x += 0.4;
    expect(postureOf(s).leftShare!).toBeLessThan(0.4);
  });

  it('every wall angle settles to a rate, and the steeper the wall the worse it is', () => {
    const rates = [0, 20, 40, 60, 80].map((a) => restRate(postureOf(settled(deg(a)))));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    expect(rates[0]).toBeLessThan(-0.01);
  });
});

describe('shaking out on the real body', () => {
  it('a hand taken off hangs and shakes while the climber stays on the wall', () => {
    const s = settled(0);
    expect(letGo(s, 'LH')).toBe(true);
    let pump = tiredAt(0.6);
    for (let i = 0; i < 4 / SLING.dt; i++) {
      stepSling(s, holds, SLING.dt);
      pump = tickPump(pump, postureOf(s), SLING.dt);
    }
    expect(s.fallen).toBe(false);
    expect(s.limbs.LH.phase).toBe('free');
    expect(postureOf(s).shaking!.LH).toBe(true);
    expect(pump.arms.LH.pump).toBeLessThan(0.55);
    expect(pump.arms.LH.pump).toBeLessThan(pump.arms.RH.pump);
    // And it goes back on the hold it came off.
    expect(placeLimb(s, 'LH', 1, holds, [])).toBe(true);
  });

  it('only hands can be let go, and only when on something', () => {
    const s = settled(0);
    expect(letGo(s, 'LF')).toBe(false);
    expect(letGo(s, 'LH')).toBe(true);
    expect(letGo(s, 'LH')).toBe(false);
  });

  it('a blown forearm opens its own hand, and the other stays on', () => {
    const s = settled(0);
    const events: SlingEvent[] = [];
    expect(pumpOut(s, events, ['RH'])).toBe(true);
    expect(s.limbs.RH.phase).toBe('free');
    expect(s.limbs.LH.phase).toBe('held');
    expect(events).toEqual([expect.objectContaining({ kind: 'pumped', hands: 1 })]);
  });
});

describe('any limb can hold you', () => {
  it('on a roof, hooked feet keep you on when the hands let go', () => {
    const s = settled(deg(70), { LH: 17, RH: 18, LF: 7, RF: 8 });
    const events: SlingEvent[] = [];
    pumpOut(s, events);
    for (let i = 0; i < 1.5 / SLING.dt; i++) stepSling(s, holds, SLING.dt, 0, events);
    expect(s.fallen).toBe(false);
    expect(s.limbs.LF.phase === 'held' || s.limbs.RF.phase === 'held').toBe(true);
  });

  it('on a vertical wall, feet on footholds do not: you peel off', () => {
    const s = settled(0);
    const events: SlingEvent[] = [];
    pumpOut(s, events);
    for (let i = 0; i < 5 / SLING.dt; i++) stepSling(s, holds, SLING.dt, 0, events);
    expect(s.fallen).toBe(true);
  });
});

describe('climbing it for real', () => {
  const warmup = ROUTES.find((r) => r.id === 'warmup')!;
  const roofy = ROUTES.find((r) => r.id === 'grip-it')!;

  it('an efficient climb up a vertical route stays fresh', () => {
    const r = climb(warmup, 'efficient');
    expect(r.outcome).toBe('sent');
    expect(r.maxPump).toBeLessThan(0.25);
  });

  it('a roof route costs far more than a vertical one, however you climb it', () => {
    const flat = climb(warmup, 'reckless');
    const roof = climb(roofy, 'reckless');
    expect(roof.maxPump).toBeGreaterThan(flat.maxPump * 2.5);
  });

  it('generated routes bend under their roofs, and still go', () => {
    let folded = 0;
    for (const seed of [11, 42, 777]) {
      const res = generateRoute('brutal', seed);
      const route = 'route' in res ? res.route : res;
      if (route.profile?.length) folded++;
      const sent = climb(route, 'efficient').outcome === 'sent' || climb(route, 'reckless').outcome === 'sent';
      expect(sent).toBe(true);
    }
    expect(folded).toBeGreaterThan(0);
  }, 120000);
});
