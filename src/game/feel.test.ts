import { describe, expect, it } from 'vitest';
import type { MoveGrade } from './types';
import { flowStreak, longestFlow } from './scoring';
import {
  introAlpha, shoutText, INTRO_FADE_MS, INTRO_HOLD_MS, SHOUT_MS,
} from '../render/overlay';

const m = (grade: MoveGrade, holdId: number | null = 1) => ({ grade, holdId });

describe('flow', () => {
  it('counts clean placements back from the latest', () => {
    expect(flowStreak([])).toBe(0);
    expect(flowStreak([m('PERFECT'), m('GOOD'), m('PERFECT')])).toBe(3);
    expect(flowStreak([m('PERFECT'), m('SCRAPE'), m('GOOD')])).toBe(1);
    expect(flowStreak([m('PERFECT'), m('GOOD'), m('MISS', null)])).toBe(0);
  });

  it('does not count a clean-looking grade that caught nothing', () => {
    expect(flowStreak([m('PERFECT'), m('PERFECT', null)])).toBe(0);
  });

  it('finds the longest run anywhere', () => {
    expect(longestFlow([
      m('PERFECT'), m('PERFECT'), m('PERFECT'), m('SCRAPE'), m('GOOD'),
    ])).toBe(3);
    expect(longestFlow([m('YEET', null)])).toBe(0);
  });
});

describe('the noise he makes', () => {
  it('stretches the vowel the whole way down', () => {
    const start = shoutText(0);
    const mid = shoutText(SHOUT_MS / 2);
    const end = shoutText(SHOUT_MS);
    expect(start).toBe('Bruh');
    expect(start.length).toBeLessThan(mid.length);
    expect(mid.length).toBeLessThan(end.length);
    // A long fall earns a long vowel.
    expect(end.match(/u/g)!.length).toBeGreaterThanOrEqual(8);
  });

  it('is always recognisably the same word', () => {
    for (const age of [-500, 0, 200, 1000, 5000]) {
      const t = shoutText(age);
      expect(t).toMatch(/^Bru+h$/);
    }
  });
});

describe('the introductory labels', () => {
  it('are fully legible for long enough to read', () => {
    expect(introAlpha(0)).toBe(1);
    expect(introAlpha(INTRO_HOLD_MS)).toBe(1);
    expect(INTRO_HOLD_MS).toBeGreaterThanOrEqual(1500);
  });

  it('then get out of the way completely', () => {
    expect(introAlpha(INTRO_HOLD_MS + INTRO_FADE_MS)).toBe(0);
    expect(introAlpha(INTRO_HOLD_MS + INTRO_FADE_MS * 10)).toBe(0);
  });

  it('fade rather than blinking out', () => {
    const mid = introAlpha(INTRO_HOLD_MS + INTRO_FADE_MS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    let prev = 1;
    for (let a = 0; a <= INTRO_HOLD_MS + INTRO_FADE_MS; a += 50) {
      const v = introAlpha(a);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});
