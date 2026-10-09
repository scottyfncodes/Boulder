import { describe, expect, it } from 'vitest';
import {
  PANEL, TREAD_PROGRAMS, advanceTread, formatTime, levelGrade, programById, startTread, streamRoute,
} from './tread';
import { solveRoute } from './autoplay';
import { climb } from './climbBot';
import { initialSling, stepSling, SLING } from './sling';
import { flatProfile } from './profile';

const classic = programById('classic');

/** Runs a session for `seconds` of wall time, in tenth-second ticks. */
function runFor(seconds: number, pump = 0.3, seed = 7) {
  const s = startTread(classic, seed);
  for (let t = 0; t < seconds; t += 0.1) advanceTread(s, 0.1, { pump, power: 0.8 });
  return s;
}

describe('the belt', () => {
  it('moves the floor up at the belt speed, faster as the session goes on', () => {
    const s = startTread(classic, 1);
    advanceTread(s, 10);
    expect(s.ground).toBeCloseTo(10 * classic.speed0, 1);
    const early = s.speed;
    for (let i = 0; i < 300; i++) advanceTread(s, 1);
    expect(s.speed).toBeGreaterThan(early);
    expect(s.speed).toBeLessThanOrEqual(classic.speed1 + 1e-9);
  });

  it('keeps the panel full: holds ahead of the climber, nothing left under the floor', () => {
    const s = runFor(240);
    const ys = s.holds.map((h) => h.pos.y);
    expect(Math.max(...ys)).toBeGreaterThan(s.ground + PANEL);
    expect(Math.min(...ys)).toBeGreaterThan(s.ground - 0.61);
    // No pile-up: the panel holds a sensible number of holds however long it runs.
    expect(s.holds.length).toBeLessThan(60);
  });

  it('is deterministic for a seed', () => {
    const a = runFor(120, 0.3, 42);
    const b = runFor(120, 0.3, 42);
    expect(a.holds).toEqual(b.holds);
  });

  it('a climber who does not climb is caught by the floor: standing still is not a strategy', () => {
    const s = startTread(classic, 3);
    const sim = initialSling(s.holds, { LH: 1, RH: 2, LF: 3, RF: 4 }, flatProfile((classic.angle * Math.PI) / 180));
    sim.left = true;
    let t = 0;
    while (t < 120 && !sim.fallen) {
      advanceTread(s, SLING.dt);
      sim.ground = s.ground;
      stepSling(sim, s.holds);
      t += SLING.dt;
    }
    // The start holds rolled under the floor and took the climber with them.
    expect(sim.fallen || sim.hip.y - s.ground < 0.9).toBe(true);
    expect(t).toBeLessThan(80);
  });
});

describe('the stream', () => {
  it('varies: many kinds of section, never the same one three times running', () => {
    const s = runFor(900);
    const kinds = s.sections.map((x) => x.kind);
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(5);
    for (let i = 2; i < kinds.length; i++) {
      expect(kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2]).toBe(false);
    }
  });

  it('comes back to a recovery ladder regularly, and sooner when the climber is pumped', () => {
    const calm = runFor(600, 0.2);
    const pumped = runFor(600, 0.9);
    const gaps = (kinds: string[]) => {
      let most = 0;
      let run = 0;
      for (const k of kinds) { run = k === 'ladder' ? 0 : run + 1; most = Math.max(most, run); }
      return most;
    };
    expect(gaps(calm.sections.map((x) => x.kind))).toBeLessThanOrEqual(5);
    const ladders = (xs: { kind: string }[]) => xs.filter((x) => x.kind === 'ladder').length / xs.length;
    expect(ladders(pumped.sections)).toBeGreaterThan(ladders(calm.sections));
  });

  it('gets harder gradually, but not every section harder than the last', () => {
    const s = runFor(600);
    const lv = s.sections.map((x) => x.level);
    const firstHalf = lv.slice(0, lv.length / 2);
    const secondHalf = lv.slice(lv.length / 2);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(secondHalf)).toBeGreaterThan(mean(firstHalf));
    let drops = 0;
    for (let i = 1; i < lv.length; i++) if (lv[i] < lv[i - 1]) drops++;
    expect(drops).toBeGreaterThan(lv.length * 0.2);
  });

  it('never leaves a hand move longer than a limb, or two hands without a foot', () => {
    for (const p of TREAD_PROGRAMS) {
      const r = streamRoute(p, 9, 14, p.levelMax);
      const hands = r.holds.filter((h) => h.type !== 'foothold').sort((a, b) => a.pos.y - b.pos.y);
      for (let i = 2; i < hands.length; i++) {
        const gap = Math.min(
          Math.hypot(hands[i].pos.x - hands[i - 1].pos.x, hands[i].pos.y - hands[i - 1].pos.y),
          Math.hypot(hands[i].pos.x - hands[i - 2].pos.x, hands[i].pos.y - hands[i - 2].pos.y),
        );
        expect(gap).toBeLessThan(0.83);
        const under = (y: number) => r.holds.some((f) => f.type === 'foothold' && f.pos.y < y - 0.6 && f.pos.y > y - 1.45);
        expect(under(hands[i].pos.y) || under(hands[i - 1].pos.y), `feet under hand ${hands[i].id} or the one before`).toBe(true);
      }
    }
  });

  it('goes: every program, early and at its hardest, is climbed by the solver or the real-physics climber', () => {
    for (const p of TREAD_PROGRAMS) {
      for (const level of [3, p.levelMax]) {
        const r = streamRoute(p, 2, 7, level);
        const solved = solveRoute(r, { beam: 16, depth: 120 }).sent;
        const climbed = solved || climb(r, 'efficient', { fitness: 1.3, maxSeconds: 300 }).outcome === 'sent'
          || climb(r, 'reckless', { fitness: 1.3, maxSeconds: 300 }).outcome === 'sent';
        expect(climbed, `${p.id} at level ${level}`).toBe(true);
      }
    }
  }, 240000);
});

describe('reading a session', () => {
  it('formats time and names levels the way the HUD shows them', () => {
    expect(formatTime(75.25)).toBe('1:15.3');
    expect(formatTime(9.04)).toBe('0:09.0');
    expect(levelGrade(0)).toBe('V0');
    expect(levelGrade(10)).toBe('V8');
  });
});

import { freshProfile, recordTreadRun, treadBoard } from '../state/progress';
import type { TreadRun } from './tread';

describe('personal bests', () => {
  const run = (time: number, program = 'classic', at = time): TreadRun => ({
    program, time, distance: time * 0.05, moves: Math.round(time / 4), peakLevel: 3, rested: 5, maxPump: 0.8,
    slips: 1, end: 'pumped', reason: 'Pumped.', at,
  });

  it('keeps the best time per program, and only replaces it with a better one', () => {
    let p = freshProfile();
    let r = recordTreadRun(p, run(60));
    expect(r.isBest).toBe(true);
    p = r.profile;
    r = recordTreadRun(p, run(45));
    expect(r.isBest).toBe(false);
    expect(r.previous?.time).toBe(60);
    p = r.profile;
    r = recordTreadRun(p, run(90));
    expect(r.isBest).toBe(true);
    expect(r.profile.tread.best.classic.time).toBe(90);
    // Programs are never compared with each other.
    expect(recordTreadRun(r.profile, run(10, 'steep')).isBest).toBe(true);
  });

  it('ranks a program’s runs for the local board, best first', () => {
    let p = freshProfile();
    for (const t of [30, 80, 55, 12, 70, 66]) p = recordTreadRun(p, run(t)).profile;
    expect(treadBoard(p, 'classic').map((x) => x.time)).toEqual([80, 70, 66, 55, 30]);
    expect(treadBoard(p, 'steep')).toEqual([]);
  });

  it('survives a round trip through the save', () => {
    const p = recordTreadRun(freshProfile(), run(42)).profile;
    const back = JSON.parse(JSON.stringify(p));
    expect(back.tread.best.classic.time).toBe(42);
    // An old save with no tread record loads with an empty one.
    const old = { ...freshProfile() } as Partial<ReturnType<typeof freshProfile>>;
    delete old.tread;
    expect({ ...freshProfile(), ...old }.tread).toEqual({ best: {}, runs: [] });
  });
});
