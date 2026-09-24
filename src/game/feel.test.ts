import { describe, expect, it } from 'vitest';
import type { MoveGrade } from './types';
import { flowStreak, longestFlow } from './scoring';
import { fallOffResult, initialState } from './move';
import type { Hold } from './types';
import { MoveAnimation, limbsFor } from '../render/animator';

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

describe('animation beats', () => {
  const holds: Hold[] = [
    { id: 1, pos: { x: -0.3, y: 2.4 }, type: 'jug', size: 0.115, dir: -Math.PI / 2 },
    { id: 2, pos: { x: 0.3, y: 2.4 }, type: 'jug', size: 0.115, dir: -Math.PI / 2 },
    { id: 3, pos: { x: -0.35, y: 1.2 }, type: 'foothold', size: 0.085, dir: -Math.PI / 2 },
    { id: 4, pos: { x: 0.35, y: 1.2 }, type: 'foothold', size: 0.085, dir: -Math.PI / 2 },
  ];
  const state = initialState(holds, { LH: 1, RH: 2, LF: 3, RF: 4 });

  it('puts the impact after the fall starts and before the animation ends', () => {
    const result = fallOffResult(state, 'test');
    const anim = new MoveAnimation(state.pose, limbsFor(state.contacts, state.pose), 'RH', result);
    const { contact, fallStart, impact } = anim.beats;
    expect(fallStart).not.toBeNull();
    expect(impact).not.toBeNull();
    expect(contact).toBeLessThan(fallStart!);
    expect(impact!).toBeGreaterThan(fallStart!);
    expect(impact!).toBeLessThanOrEqual(anim.durationMs);
  });

  it('lands the impact on the frame the hip reaches the pad', () => {
    const result = fallOffResult(state, 'test');
    const anim = new MoveAnimation(state.pose, limbsFor(state.contacts, state.pose), 'RH', result);
    const { impact } = anim.beats;
    const before = anim.sample(impact! - 40).pose.hip.y;
    const at = anim.sample(impact! + 1).pose.hip.y;
    expect(before).toBeGreaterThan(0.43);
    expect(at).toBeCloseTo(0.42, 2);
  });
});
