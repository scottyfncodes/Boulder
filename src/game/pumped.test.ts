import { describe, expect, it } from 'vitest';
import type { Hold, Route } from './types';
import { beginAttempt, pullOn, tickEndurance } from './attempt';
import { fallOffResult, initialState } from './move';
import { capacityFor, drainEndurance, freshEndurance } from './endurance';
import { shoutText, SHOUT_MS } from '../render/overlay';

const jug = (id: number, x: number, y: number): Hold => ({
  id, pos: { x, y }, type: 'jug', size: 0.115, dir: -Math.PI / 2,
});
const foot = (id: number, x: number, y: number): Hold => ({
  id, pos: { x, y }, type: 'foothold', size: 0.085, dir: -Math.PI / 2,
});
const route: Route = {
  id: 'test', name: 'Test', grade: 'V2', setter: 'house', wall: 'main', par: 10,
  start: { LH: 1, RH: 2, LF: 3, RF: 4 },
  finish: [5],
  holds: [
    jug(1, -0.3, 1.55), jug(2, 0.3, 1.55),
    foot(3, -0.35, 0.5), foot(4, 0.35, 0.5),
    jug(5, 0, 3.6),
  ],
};

describe('running out of endurance', () => {
  it('empties the pool and reports it', () => {
    let e = freshEndurance(10);
    let pumped = false;
    for (let i = 0; i < 400 && !pumped; i++) {
      const r = drainEndurance({
        endurance: e, dtMs: 100, drain: 2, stability: 0.6,
        reaching: false, resting: false,
      });
      e = r.endurance;
      pumped = r.pumped;
    }
    expect(pumped).toBe(true);
    expect(e.base).toBe(0);
  });

  it('drains faster with a limb in the air than while hanging', () => {
    const one = drainEndurance({
      endurance: freshEndurance(100), dtMs: 1000, drain: 1, stability: 0.6,
      reaching: false, resting: false,
    });
    const two = drainEndurance({
      endurance: freshEndurance(100), dtMs: 1000, drain: 1, stability: 0.6,
      reaching: true, resting: false,
    });
    expect(two.endurance.base).toBeLessThan(one.endurance.base);
  });

  it('ends the attempt as a fall, not merely as a stop', () => {
    let attempt = pullOn(beginAttempt(route, 'onsight', 0, 4));
    let pumped = false;
    for (let i = 0; i < 500 && !pumped; i++) {
      const t = tickEndurance(attempt, 100, false, route);
      attempt = t.attempt;
      pumped = t.pumped;
    }
    expect(pumped).toBe(true);
    expect(attempt.phase).toBe('fallen');
    // A fall counts as a fall, so the route's record reflects it.
    expect(attempt.falls).toBe(1);
  });

  it('produces something the fall animation can actually play', () => {
    const state = initialState(route.holds, route.start);
    expect(state.contacts.length).toBeGreaterThan(0);

    const result = fallOffResult(state, 'Pumped.');
    // Without a result that reads as a fall, the climber snapped to the mat
    // with no tumble at all.
    expect(result.fell).toBe(true);
    expect(result.next.contacts).toHaveLength(0);
    expect(result.next.pose.stability).toBe(0);
    expect(result.popped).toHaveLength(state.contacts.length);
  });

  it('a rest hold gives endurance back', () => {
    const spent = { base: 0.4, capacity: 100 };
    const resting = drainEndurance({
      endurance: spent, dtMs: 1000, drain: 1, stability: 0.8,
      reaching: false, resting: true,
    });
    const not = drainEndurance({
      endurance: spent, dtMs: 1000, drain: 1, stability: 0.8,
      reaching: false, resting: false,
    });
    expect(resting.endurance.base).toBeGreaterThan(not.endurance.base);
  });

  it('grows capacity with grade and mileage', () => {
    expect(capacityFor('V5', 20)).toBeGreaterThan(capacityFor(null, 0));
    expect(capacityFor('V10', 40)).toBeGreaterThan(capacityFor('V5', 20));
  });
});

describe('the noise he makes', () => {
  it('stretches the vowel the whole way down', () => {
    const start = shoutText(0);
    const mid = shoutText(SHOUT_MS / 2);
    const end = shoutText(SHOUT_MS);
    expect(start).toBe('Bruh!');
    expect(start.length).toBeLessThan(mid.length);
    expect(mid.length).toBeLessThan(end.length);
    // A long fall earns a long vowel.
    expect(end.match(/u/g)!.length).toBeGreaterThanOrEqual(8);
  });

  it('is always recognisably the same word', () => {
    for (const age of [-500, 0, 200, 1000, 5000]) {
      const t = shoutText(age);
      expect(t.startsWith('Br')).toBe(true);
      expect(t.endsWith('h!')).toBe(true);
      expect(t).toMatch(/^Bru+h!$/);
    }
  });
});
