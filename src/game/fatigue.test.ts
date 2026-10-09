import { describe, expect, it } from 'vitest';
import { conditionOf, freshFatigue, spendDyno, spendThrow, tickFatigue, breathWord } from './fatigue';
import type { Posture } from './pump';
import { FRESH, initialSling, launch, powerScale, stepSling, SLING } from './sling';
import { flatProfile } from './profile';
import { jug, foot } from '../content/holdKit';

const deg = (d: number) => (d * Math.PI) / 180;
const pose = (angle: number, hands: number, feet: number, over: Partial<Posture> = {}): Posture => ({
  angle, hands, feet, speed: 0, reaching: false, ...over,
});
function hold(f: ReturnType<typeof freshFatigue>, p: Posture, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) f = tickFatigue(f, p, 0.1);
  return f;
}

describe('power', () => {
  it('a big throw spends it; a soft one barely does', () => {
    const big = spendThrow(freshFatigue(), 1, 0, 0);
    const soft = spendThrow(freshFatigue(), 0.3, 0, 0);
    expect(big.power).toBeLessThan(soft.power - 0.1);
  });

  it('three big throws in a row cost more than three with a rest between', () => {
    let tight = freshFatigue();
    for (let i = 0; i < 3; i++) tight = spendThrow(tight, 1, deg(30), 0.02);
    let paced = freshFatigue();
    for (let i = 0; i < 3; i++) { paced = spendThrow(paced, 1, deg(30), 0.02); paced = hold(paced, pose(0, 2, 2), 3); }
    expect(paced.power).toBeGreaterThan(tight.power + 0.2);
  });

  it('a dyno takes a big bite', () => {
    expect(spendDyno(freshFatigue(), 1, 0).power).toBeLessThan(0.6);
  });

  it('a tired body throws shorter: the same pull is less of a throw', () => {
    const holds = [jug(1, -0.3, 1.5), jug(2, 0.3, 1.5), foot(3, -0.3, 0.5), foot(4, 0.3, 0.5)];
    const fresh = initialSling(holds, { LH: 1, RH: 2, LF: 3, RF: 4 }, flatProfile(0));
    const tired = initialSling(holds, { LH: 1, RH: 2, LF: 3, RF: 4 }, flatProfile(0));
    tired.cond = { ...FRESH, power: 0.1 };
    expect(powerScale(tired)).toBeLessThan(powerScale(fresh));
    for (const s of [fresh, tired]) launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 1 });
    let a = 0;
    let b = 0;
    for (let i = 0; i < 40; i++) {
      stepSling(fresh, holds, SLING.dt);
      stepSling(tired, holds, SLING.dt);
      a = Math.max(a, fresh.limbs.RH.pos.y);
      b = Math.max(b, tired.limbs.RH.pos.y);
    }
    expect(a).toBeGreaterThan(b);
  });
});

describe('core', () => {
  it('drains holding on to steep ground, faster with the feet cut; comes back upright on good feet', () => {
    const steep = hold(freshFatigue(), pose(deg(45), 2, 2), 30);
    const cut = hold(freshFatigue(), pose(deg(45), 2, 0), 30);
    expect(steep.core).toBeLessThan(1);
    expect(cut.core).toBeLessThan(steep.core);
    const back = hold(cut, pose(0, 2, 2), 30);
    expect(back.core).toBeGreaterThan(cut.core);
  });

  it('technique that asks for tension costs it: a toe hook, a squeeze', () => {
    const plain = hold(freshFatigue(), pose(deg(30), 2, 1), 20);
    const hooked = hold(freshFatigue(), pose(deg(30), 2, 1, { core: 1 }), 20);
    expect(hooked.core).toBeLessThan(plain.core);
  });
});

describe('breath', () => {
  it('builds slowly under effort and slows recovery when it is heavy', () => {
    const hard = hold(freshFatigue(), pose(deg(50), 1, 0), 40);
    expect(hard.breath).toBeGreaterThan(0.3);
    expect(breathWord(hard.breath)).not.toBe('easy');
    // Same forearms, same rest; the gasping one comes back slower.
    const calmLungs = { ...hard, breath: 0, power: 0.4 };
    const gasping = { ...hard, breath: 1, power: 0.4 };
    const a = hold(calmLungs, pose(0, 2, 2), 5);
    const b = hold(gasping, pose(0, 2, 2), 5);
    expect(a.power).toBeGreaterThan(b.power);
  });
});

describe('what the sim reads', () => {
  it('each forearm’s grip is what its pump leaves; power and core pass straight through', () => {
    let f = freshFatigue();
    f = { ...f, pump: { ...f.pump, arms: { LH: { pump: 0.7, floor: 0.1 }, RH: { pump: 0.2, floor: 0 } } }, power: 0.4, core: 0.6 };
    const c = conditionOf(f);
    expect(c.grip.LH).toBeCloseTo(0.3);
    expect(c.grip.RH).toBeCloseTo(0.8);
    expect(c.power).toBe(0.4);
    expect(c.core).toBe(0.6);
  });

  it('is never a switch: a slightly more tired body is slightly worse', () => {
    const a = hold(freshFatigue(), pose(deg(30), 2, 1), 20);
    const b = hold(freshFatigue(), pose(deg(30), 2, 1), 21);
    expect(Math.abs(a.core - b.core)).toBeLessThan(0.02);
    expect(Math.abs(a.pump.pump - b.pump.pump)).toBeLessThan(0.02);
  });
});
