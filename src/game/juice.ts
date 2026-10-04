import type { MoveGrade } from './types';

/**
 * The dyno meter.
 *
 * A dyno is earned. Every limb that sticks puts juice in the tank — more the
 * cleaner it lands, more again on a flow streak — and every whiff and slip
 * takes some out. Fill it and the belly lights up: the dyno is live. Fire it
 * and the tank is empty again, whatever happens next, so it had better stick.
 * Stick it clean and some of the style comes back.
 *
 * Pure numbers, no clock. The climbing screen owns one of these per attempt.
 */

export type Juice = {
  /** 0..1. Full means the dyno is live. */
  level: number;
};

/** What a stuck move is worth, by how well it stuck. */
export const JUICE_FOR: Record<Exclude<MoveGrade, 'MISS' | 'YEET'>, number> = {
  PERFECT: 0.26,
  GOOD: 0.16,
  SCRAPE: 0.04,
};
/** A throw that caught nothing. */
export const JUICE_MISS = -0.12;
/** A limb that was on and came off. */
export const JUICE_SLIP = -0.18;
/** Arms opening because they are done. */
export const JUICE_PUMPED = -0.3;
/** A limb put back on by hand is safe, and safe is not exciting. */
export const JUICE_PLACE = 0;
/** Each move of a flow streak past the second adds this much on top, up to the cap. */
export const FLOW_BONUS = 0.08;
export const FLOW_BONUS_MAX = 0.4;
/** Juice handed back for sticking the dyno itself, by how cleanly. */
export const DYNO_REFUND: Record<Exclude<MoveGrade, 'MISS' | 'YEET'>, number> = {
  PERFECT: 0.4,
  GOOD: 0.2,
  SCRAPE: 0,
};
/** Extra juice back per metre the hands went up past the first, up to the cap. */
export const DYNO_HEIGHT_BONUS = 0.15;
export const DYNO_HEIGHT_BONUS_MAX = 0.3;

export function freshJuice(full = false): Juice {
  return { level: full ? 1 : 0 };
}

export function isFull(j: Juice): boolean {
  return j.level >= 1 - 1e-9;
}

function add(j: Juice, amount: number): Juice {
  return { level: Math.min(1, Math.max(0, j.level + amount)) };
}

/** A limb stuck. `streak` is the flow streak including this move. */
export function onStick(j: Juice, grade: Exclude<MoveGrade, 'MISS' | 'YEET'>, streak = 0): Juice {
  const flow = Math.min(FLOW_BONUS_MAX, Math.max(0, streak - 2) * FLOW_BONUS);
  return add(j, JUICE_FOR[grade] * (1 + flow));
}

export function onMiss(j: Juice): Juice {
  return add(j, JUICE_MISS);
}

export function onSlip(j: Juice): Juice {
  return add(j, JUICE_SLIP);
}

export function onPumped(j: Juice): Juice {
  return add(j, JUICE_PUMPED);
}

/** Firing the dyno spends all of it. Only a full tank can be fired. */
export function spendDyno(j: Juice): Juice | null {
  return isFull(j) ? { level: 0 } : null;
}

/**
 * The dyno stuck. Clean ones give some back, and big ones more again:
 * `gain` is how far the hands went up the wall, metres.
 */
export function onDynoStuck(j: Juice, grade: Exclude<MoveGrade, 'MISS' | 'YEET'>, gain = 0): Juice {
  const big = grade === 'SCRAPE' ? 0 : Math.min(DYNO_HEIGHT_BONUS_MAX, Math.max(0, gain - 1) * DYNO_HEIGHT_BONUS);
  return add(j, DYNO_REFUND[grade] + big);
}

/** A word for the bar, the way the pump has one. */
export function juiceWord(level: number): string {
  if (level >= 1 - 1e-9) return 'DYNO READY';
  if (level >= 0.75) return 'almost';
  if (level >= 0.45) return 'charging';
  if (level > 0.05) return 'warming up';
  return 'empty';
}
