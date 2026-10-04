import { describe, expect, it } from 'vitest';
import {
  freshJuice, isFull, juiceWord, onDynoStuck, onMiss, onPumped, onSlip, onStick, spendDyno,
} from './juice';

describe('the dyno meter', () => {
  it('starts empty, and full on the practice wall', () => {
    expect(freshJuice().level).toBe(0);
    expect(isFull(freshJuice(true))).toBe(true);
  });

  it('pays the same for every stick: it stuck or it did not', () => {
    const j = freshJuice();
    expect(onStick(j).level).toBeGreaterThan(0);
  });

  it('pays a flow streak extra, up to a cap', () => {
    const j = freshJuice();
    expect(onStick(j, 5).level).toBeGreaterThan(onStick(j, 1).level);
    expect(onStick(j, 50).level).toBeCloseTo(onStick(j, 7).level, 9);
  });

  it('takes juice away for a whiff, a slip and a pump-out, never below empty', () => {
    const j = { level: 0.5 };
    expect(onMiss(j).level).toBeLessThan(0.5);
    expect(onSlip(j).level).toBeLessThan(onMiss(j).level);
    expect(onPumped(j).level).toBeLessThan(onSlip(j).level);
    expect(onPumped(freshJuice()).level).toBe(0);
  });

  it('does not come cheap: five sticks without a streak', () => {
    let j = freshJuice();
    let n = 0;
    while (!isFull(j)) { j = onStick(j, 0); n++; }
    expect(n).toBe(5);
  });

  it('caps at full, and only a full tank fires — and empties it', () => {
    let j = freshJuice();
    for (let i = 0; i < 10; i++) j = onStick(j);
    expect(j.level).toBe(1);
    expect(spendDyno({ level: 0.99 })).toBeNull();
    expect(spendDyno(j)!.level).toBe(0);
  });

  it('gives some back for sticking the dyno, more for a bigger one', () => {
    const empty = freshJuice();
    expect(onDynoStuck(empty).level).toBeGreaterThan(0);
    expect(onDynoStuck(empty, 2.5).level).toBeGreaterThan(onDynoStuck(empty, 1).level);
  });

  it('has a word for the bar', () => {
    expect(juiceWord(1)).toBe('DYNO READY');
    expect(juiceWord(0)).toBe('empty');
  });
});
