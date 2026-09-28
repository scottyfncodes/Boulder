import { describe, expect, it } from 'vitest';
import {
  DYNO_COST, FLING_COST, capacityFor, drainEndurance, effortRate, freshEndurance, pumpWord, spend,
} from './endurance';
import { SLING_LAB } from '../content/lab';
import { SLING, handLoad, initialSling, launch, pumpOut, restingOn, stepSling } from './sling';
import type { SlingEvent } from './sling';

const tick = (base: number, over: Partial<Parameters<typeof drainEndurance>[0]>) =>
  drainEndurance({
    endurance: { base, capacity: 100 }, dtMs: 1000, drain: 1,
    handLoad: 1, handsOn: 2, reaching: false, resting: false, ...over,
  }).endurance.base;

describe('the pump', () => {
  it('burns by what the hands are carrying', () => {
    const standing = tick(1, { handLoad: 0.05, handsOn: 2 });
    const hanging = tick(1, { handLoad: 1.0, handsOn: 2 });
    expect(hanging).toBeLessThan(standing);
    expect(standing).toBeLessThan(1);
  });

  it('one arm holding it all is worse than two sharing it', () => {
    expect(effortRate(1, 1, false)).toBeGreaterThan(effortRate(1, 2, false));
  });

  it('a limb in the air costs more than a limb on the wall', () => {
    expect(tick(1, { reaching: true })).toBeLessThan(tick(1, { reaching: false }));
  });

  it('a rest gives it back, slower than hanging took it', () => {
    const rested = tick(0.4, { handLoad: 0, resting: true });
    expect(rested).toBeGreaterThan(0.4);
    const spent = 1 - tick(1, { handLoad: 1 });
    expect(rested - 0.4).toBeLessThan(spent);
  });

  it('empties and says so', () => {
    let e = freshEndurance(10);
    let pumped = false;
    for (let i = 0; i < 400 && !pumped; i++) {
      const r = drainEndurance({ endurance: e, dtMs: 100, drain: 2, handLoad: 1, handsOn: 2, reaching: false, resting: false });
      e = r.endurance;
      pumped = r.pumped;
    }
    expect(pumped).toBe(true);
    expect(e.base).toBe(0);
  });

  it('a fling and a dyno each take a bite', () => {
    expect(spend(freshEndurance(100), FLING_COST).endurance.base).toBeCloseTo(1 - FLING_COST, 6);
    expect(spend(freshEndurance(100), DYNO_COST).endurance.base).toBeCloseTo(1 - DYNO_COST, 6);
    expect(DYNO_COST).toBeGreaterThan(FLING_COST * 2);
  });

  it('grows capacity with grade and mileage', () => {
    expect(capacityFor('V5', 20)).toBeGreaterThan(capacityFor(null, 0));
    expect(capacityFor('V10', 40)).toBeGreaterThan(capacityFor('V5', 20));
  });

  it('has words for it', () => {
    expect(pumpWord(1)).toBe('fresh');
    expect(pumpWord(0.05)).toBe('about to come off');
  });
});

describe('reading the body', () => {
  const holds = SLING_LAB.holds;

  it('standing on the start reads almost no hand load', () => {
    const s = initialSling(holds, SLING_LAB.start);
    for (let i = 0; i < 240; i++) stepSling(s, holds, SLING.dt);
    const { load, hands } = handLoad(s);
    expect(hands).toBe(2);
    expect(load).toBeLessThan(0.15);
  });

  it('hanging on one arm reads about a body weight on one hand', () => {
    const s = initialSling(holds, { LH: 18 });
    for (let i = 0; i < 300; i++) stepSling(s, holds, SLING.dt);
    const { load, hands } = handLoad(s);
    expect(hands).toBe(1);
    expect(load).toBeGreaterThan(0.5);
  });

  it('a limb in flight is not a rest', () => {
    const s = initialSling(holds, SLING_LAB.start);
    for (let i = 0; i < 120; i++) stepSling(s, holds, SLING.dt);
    const rest = new Set([1, 2]);
    expect(restingOn(s, rest)).toBe(true);
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.7 });
    expect(restingOn(s, rest)).toBe(false);
  });

  it('pumping out opens the hands, and the wall does the rest', () => {
    const s = initialSling(holds, SLING_LAB.start);
    for (let i = 0; i < 120; i++) stepSling(s, holds, SLING.dt);
    const events: SlingEvent[] = [];
    expect(pumpOut(s, events)).toBe(true);
    expect(events[0].kind).toBe('pumped');
    expect(s.limbs.LH.phase).toBe('free');
    expect(s.limbs.RH.phase).toBe('free');
    expect(s.limbs.LF.phase).toBe('held');
    for (let i = 0; i < 600; i++) stepSling(s, holds, SLING.dt, 0, events);
    expect(events.map((e) => e.kind)).toContain('fell');
    expect(s.fallen).toBe(true);
    // Nothing left to open.
    expect(pumpOut(s)).toBe(false);
  });
});
