import { describe, expect, it } from 'vitest';
import type { Hold, Route } from './types';
import { SLING_LAB } from '../content/lab';
import { crimp, jug, pinch, sloper, LEFT, RIGHT, deg } from '../content/holdKit';
import {
  SLING, capacityOf, catchSeat, cloneSling, initialSling, launch, launchSpeed, loadAlignment, reachOf,
  type SlingState,
} from './sling';
import {
  UNTRAINED, attemptTraining, breakthroughTraining, strengthLevel, strengthMods, strengthNote,
} from './strength';
import { applyFall, applySend, freshProfile } from '../state/progress';
import type { ScoreCard } from './scoring';

const holds = SLING_LAB.holds;

describe('strength', () => {
  it('grows with training, quickly at first and then barely', () => {
    expect(strengthLevel(0)).toBe(0);
    const a = strengthLevel(20);
    const b = strengthLevel(40);
    const c = strengthLevel(400);
    const d = strengthLevel(420);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeGreaterThan(d - c);
    expect(strengthLevel(1e6)).toBeLessThanOrEqual(1);
  });

  it('untrained is exactly the base sim', () => {
    expect(strengthMods(0)).toEqual(UNTRAINED);
    expect(launchSpeed('RH', 1, UNTRAINED)).toBe(SLING.maxSpeedHand);
  });

  it('a fall trains, a send trains more, a harder route trains more, and a new grade most of all', () => {
    expect(attemptTraining('V3', true)).toBeGreaterThan(attemptTraining('V3', false));
    expect(attemptTraining('V8', false)).toBeGreaterThan(attemptTraining('V0', false));
    expect(breakthroughTraining('V4')).toBeGreaterThan(attemptTraining('V4', true) * 4);
  });

  it('is kept on the profile, and a new grade is a step', () => {
    const route = { id: 'r', grade: 'V2', holds: [], start: {}, finish: [], par: 10 } as unknown as Route;
    const card = { efficiency: 0.5, points: 10, moves: 10, onsight: false, sentAt: 1 } as unknown as ScoreCard;
    let p = freshProfile(0);
    p = applyFall(p, route, 3, 1);
    expect(p.training).toBeCloseTo(attemptTraining('V2', false), 6);
    const fallen = p.training;
    const { profile, breakthrough } = applySend(p, route, card, { routeId: 'r', moves: [] } as never);
    expect(profile.training).toBeCloseTo(fallen + attemptTraining('V2', true) + breakthroughTraining('V2'), 6);
    expect(breakthrough?.stronger).toBeTruthy();
    // Sending it again is just another session.
    const again = applySend(profile, route, card, { routeId: 'r', moves: [] } as never);
    expect(again.profile.training - profile.training).toBeCloseTo(attemptTraining('V2', true), 6);
    expect(again.breakthrough).toBeNull();
  });

  it('only says so when the difference is noticeable', () => {
    expect(strengthNote(100, 100.01)).toBeNull();
    expect(strengthNote(0, 10)).toBeTruthy();
  });

  it('lets a trained climber reach further and throw harder', () => {
    const weak = initialSling(holds, SLING_LAB.start);
    const strong = initialSling(holds, SLING_LAB.start, 0, 240, strengthMods(200));
    expect(reachOf(strong, 'RH')).toBeGreaterThan(reachOf(weak, 'RH'));
    expect(reachOf(strong, 'LF')).toBeGreaterThan(reachOf(weak, 'LF'));
    const fling = (s: SlingState) => {
      launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 1 });
      return s.limbs.RH.vel.y - s.shV.y;
    };
    expect(fling(cloneSling(strong))).toBeGreaterThan(fling(cloneSling(weak)));
  });

  it('helps on a crimp far more than on a jug', () => {
    const s = initialSling(holds, SLING_LAB.start);
    const l = { ...s.limbs.RH, seat: 0.9 };
    const anchor = { x: 0, y: 1.0 };
    const c = crimp(1, 0, 1.6);
    const j = jug(2, 0, 1.6);
    const trained = strengthMods(300);
    const gainCrimp = capacityOf(c, l, anchor, 0, trained) / capacityOf(c, l, anchor, 0);
    const gainJug = capacityOf(j, l, anchor, 0, trained) / capacityOf(j, l, anchor, 0);
    expect(gainCrimp).toBeGreaterThan(1.2);
    expect(gainJug).toBeLessThan(1.15);
    expect(gainCrimp).toBeGreaterThan(gainJug);
  });
});

describe('hold temperament', () => {
  const s = initialSling(holds, SLING_LAB.start);
  const l = { ...s.limbs.RH, seat: 0.9 };
  const below = { x: 0, y: 1.0 };
  const cap = (h: Hold, overhang = 0, speed = 0) => capacityOf(h, l, below, overhang, UNTRAINED, speed);

  it('a steep wall costs a sloper far more than a pinch or a jug', () => {
    const steep = deg(40);
    const loss = (h: Hold) => cap(h, steep) / cap(h);
    expect(loss(sloper(1, 0, 1.6))).toBeLessThan(loss(pinch(2, 0, 1.6)));
    expect(loss(sloper(1, 0, 1.6))).toBeLessThan(loss(jug(3, 0, 1.6)));
    expect(loss(sloper(1, 0, 1.6))).toBeLessThan(0.85);
  });

  it('a swinging body costs a crimp or a sloper far more than a jug', () => {
    const loss = (h: Hold) => cap(h, 0, 3) / cap(h);
    expect(loss(jug(1, 0, 1.6))).toBeGreaterThan(0.95);
    expect(loss(crimp(2, 0, 1.6))).toBeLessThan(0.8);
    expect(loss(sloper(3, 0, 1.6))).toBeLessThan(loss(crimp(2, 0, 1.6)));
  });

  it('a pinch is squeezed: pulled sideways either way, it holds', () => {
    const p = pinch(1, 0, 1.6);
    const c = crimp(2, 0, 1.6);
    for (const dir of [LEFT, RIGHT]) {
      const pull = { x: Math.cos(dir), y: Math.sin(dir) };
      expect(loadAlignment(p, pull)).toBeGreaterThan(0.6);
      expect(loadAlignment(p, pull)).toBeGreaterThan(loadAlignment(c, pull));
    }
    // Pulled the wrong way along its length, it still opens.
    expect(loadAlignment(p, { x: 0, y: 1 })).toBeLessThan(0.3);
  });

  it('stabbing a pocket at speed lands worse than slapping a jug, and control helps', () => {
    const p = { id: 1, pos: { x: 0, y: 2 }, type: 'pocket', size: 0.1, dir: -Math.PI / 2 } as Hold;
    const j = jug(2, 0, 2);
    expect(catchSeat(p, 0.9, 1.5)).toBeCloseTo(0.9, 6);
    expect(catchSeat(p, 0.9, 5)).toBeLessThan(catchSeat(j, 0.9, 5));
    expect(catchSeat(p, 0.9, 5, strengthMods(300))).toBeGreaterThan(catchSeat(p, 0.9, 5));
  });
});
