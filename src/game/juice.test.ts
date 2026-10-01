import { describe, expect, it } from 'vitest';
import {
  JUICE_FOR, freshJuice, isFull, juiceWord, onDynoStuck, onMiss, onPumped, onSlip, onStick, spendDyno,
} from './juice';

describe('the dyno meter', () => {
  it('starts empty, and full on the practice wall', () => {
    expect(freshJuice().level).toBe(0);
    expect(isFull(freshJuice(true))).toBe(true);
  });

  it('pays more for a cleaner stick', () => {
    const j = freshJuice();
    expect(onStick(j, 'PERFECT').level).toBeGreaterThan(onStick(j, 'GOOD').level);
    expect(onStick(j, 'GOOD').level).toBeGreaterThan(onStick(j, 'SCRAPE').level);
    expect(onStick(j, 'SCRAPE').level).toBeGreaterThan(0);
  });

  it('pays a flow streak extra, up to a cap', () => {
    const j = freshJuice();
    expect(onStick(j, 'GOOD', 5).level).toBeGreaterThan(onStick(j, 'GOOD', 1).level);
    expect(onStick(j, 'GOOD', 50).level).toBeCloseTo(onStick(j, 'GOOD', 7).level, 9);
  });

  it('takes juice away for a whiff, a slip and a pump-out, never below empty', () => {
    const j = { level: 0.5 };
    expect(onMiss(j).level).toBeLessThan(0.5);
    expect(onSlip(j).level).toBeLessThan(onMiss(j).level);
    expect(onPumped(j).level).toBeLessThan(onSlip(j).level);
    expect(onPumped(freshJuice()).level).toBe(0);
  });

  it('does not come cheap: four clean sticks, six good ones, and scrapes barely move it', () => {
    let perfect = freshJuice();
    let n = 0;
    while (!isFull(perfect)) { perfect = onStick(perfect, 'PERFECT', 0); n++; }
    expect(n).toBe(4);
    let good = freshJuice();
    n = 0;
    while (!isFull(good)) { good = onStick(good, 'GOOD', 0); n++; }
    expect(n).toBe(7);
    expect(Math.ceil(1 / JUICE_FOR.SCRAPE)).toBeGreaterThan(20);
  });

  it('caps at full, and only a full tank fires — and empties it', () => {
    let j = freshJuice();
    for (let i = 0; i < 10; i++) j = onStick(j, 'PERFECT');
    expect(j.level).toBe(1);
    expect(spendDyno({ level: 0.99 })).toBeNull();
    expect(spendDyno(j)!.level).toBe(0);
  });

  it('gives some back for sticking the dyno clean', () => {
    const empty = freshJuice();
    expect(onDynoStuck(empty, 'PERFECT').level).toBeGreaterThan(onDynoStuck(empty, 'GOOD').level);
    expect(onDynoStuck(empty, 'GOOD').level).toBeGreaterThan(0);
  });

  it('has a word for the bar', () => {
    expect(juiceWord(1)).toBe('DYNO READY');
    expect(juiceWord(0)).toBe('empty');
  });
});
