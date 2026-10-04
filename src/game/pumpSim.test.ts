import { describe, expect, it } from 'vitest';
import { SLING_LAB } from '../content/lab';
import { SLING, initialSling, launch, postureOf, pumpOut, stepSling, type SlingEvent } from './sling';
import { PUMP, effort, tickPump } from './pump';
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

  it('a minute on a vertical wall with four on costs nothing; a minute on a roof does', () => {
    const run = (wall: number) => {
      const s = settled(wall);
      let pump = { pump: 0.3, floor: 0.05, fitness: 1 };
      for (let i = 0; i < 60 / SLING.dt; i++) {
        stepSling(s, holds, SLING.dt);
        pump = tickPump(pump, postureOf(s), SLING.dt);
      }
      return pump.pump;
    };
    expect(run(0)).toBeLessThan(0.3);
    expect(run(deg(75))).toBeGreaterThan(0.6);
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
