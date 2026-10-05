import { describe, expect, it } from 'vitest';
import { SLING_LAB } from '../content/lab';
import { type SlingEvent, SLING, initialSling, launch, stepSling } from './sling';
import { AIM_STEP, AimSearch, POWER_STEP } from './aimSearch';

const holds = SLING_LAB.holds;
const up = Math.PI / 2;
const deg = (d: number) => (d * Math.PI) / 180;

function start() {
  const s = initialSling(holds, SLING_LAB.start);
  s.left = true;
  return s;
}

describe('aiming against a held-still body', () => {
  it('snaps the pull to a grid: nearby finger positions are the same throw', () => {
    const a = AimSearch.snap({ x: 3.1, y: -120.2 }, 200);
    const b = AimSearch.snap({ x: 3.3, y: -120.4 }, 200);
    expect(a).toEqual(b);
    expect(Math.abs(a.angle / AIM_STEP - Math.round(a.angle / AIM_STEP))).toBeLessThan(1e-9);
    expect(Math.abs(a.power / POWER_STEP - Math.round(a.power / POWER_STEP))).toBeLessThan(1e-9);
  });

  it('a pull resting on the line between two notches stays on the one it was on', () => {
    // Exactly between two angle notches, either side by a hair.
    const between = (k: number, e: number) => {
      const a = (k + 0.5 + e) * AIM_STEP;
      return { x: -Math.cos(a) * 150, y: -Math.sin(a) * 150 };
    };
    const k = Math.round(up / AIM_STEP);
    const on = AimSearch.snap(between(k, -0.01), 200);
    for (const e of [0.01, -0.02, 0.03, 0.1, -0.1]) {
      expect(AimSearch.snap(between(k, e), 200, on).angle).toBe(on.angle);
    }
    // Clearly into the next one, it moves.
    expect(AimSearch.snap(between(k, 0.45), 200, on).angle).not.toBe(on.angle);
  });

  it('asking again for the same notch gives the same answer, for free', () => {
    const search = new AimSearch(start(), holds);
    const first = search.resolve('RH', up - deg(10), 0.6, 999);
    const again = search.resolve('RH', up - deg(10), 0.6, 0);
    expect(again.prediction).toBe(first.prediction);
    expect(again.settled).toBe(true);
  });

  it('a slow sweep across the wall changes its answer a handful of times, not every notch', () => {
    for (const power of [0.45, 0.6, 0.75]) {
      const search = new AimSearch(start(), holds);
      let flips = 0;
      let last = '';
      for (let d = -50; d <= 50; d += 0.5) {
        const r = search.resolve('RH', up - deg(d), power, 999);
        const out = r.prediction.caught ? String(r.prediction.caught.holdId) : '-';
        if (out !== last) { flips++; last = out; }
      }
      // A few holds across the fan, each a clean stretch: no catch-miss-catch flicker.
      expect(flips).toBeLessThanOrEqual(7);
    }
  });

  it('what it shows is what happens: the answer, thrown for real, catches the same hold', () => {
    for (const d of [-25, -12, 0, 8, 20]) {
      const s = start();
      const r = new AimSearch(s, holds).resolve('RH', up - deg(d), 0.6, 999);
      const events: SlingEvent[] = [];
      launch(s, r.aim, events);
      for (let i = 0; i < Math.round(1.2 / SLING.dt); i++) stepSling(s, holds, SLING.dt, 0, events);
      const caught = events.find((e) => e.kind === 'catch');
      expect(caught && caught.kind === 'catch' ? caught.holdId : null).toBe(r.prediction.caught?.holdId ?? null);
    }
  });

  it('spreads the search over frames and only ever gets better', () => {
    const search = new AimSearch(start(), holds);
    // An aim that needs steering: walk it off the jug until the raw throw misses.
    let angle = up;
    for (let d = 4; d <= 30; d++) {
      angle = up - deg(d);
      const raw = new AimSearch(start(), holds).resolve('RH', angle, 0.6, 1);
      if (!raw.prediction.caught) break;
    }
    let r = search.resolve('RH', angle, 0.6, 2);
    let frames = 1;
    while (!r.settled && frames < 60) { r = search.resolve('RH', angle, 0.6, 2); frames++; }
    expect(r.settled).toBe(true);
    expect(r.assisted).not.toBeNull();
    // Settled is settled.
    expect(search.resolve('RH', angle, 0.6, 2).assisted).toBe(r.assisted);
  });

  it('the dyno for a notch is kept too', () => {
    const search = new AimSearch(start(), holds);
    const a = search.dyno(up, 0.4);
    const b = search.dyno(up + AIM_STEP * 0.3, 0.4);
    expect(b.prediction).toBe(a.prediction);
  });
});
