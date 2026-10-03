import type { Grade } from './types';
import { gradeIndex } from './types';

/**
 * Getting stronger.
 *
 * Every attempt is a session on the wall, and sessions add up. None of this is
 * shown: there is no bar and no number. The climber just starts sticking
 * things that used to spit them off, reaching a little further, throwing a
 * little harder and landing a little cleaner — which is what getting stronger
 * feels like from the inside.
 *
 * Training is a single running total. Every attempt adds to it, a send adds a
 * little more than a fall, harder routes teach more than easy ones, and the
 * first send of a new grade is a step on its own. Strength is that total run
 * through a saturating curve, so the first few weeks matter a lot and the
 * hundredth session barely moves anything — and it never gets anywhere near
 * making a hard route easy. It has nothing to do with the pump: that is
 * stamina, and it has its own clock.
 *
 * The route checker, par and the community betas are all worked out at zero
 * strength, so every route is proven climbable by the weakest climber.
 */

/** What strength does to the body, as multipliers on the base sim. 1 = untrained. */
export type StrengthMods = {
  /** 0..1, how trained the climber is. For flavour text, never shown as a number. */
  level: number;
  /** How much load a hold takes before it lets go. Fingers, mostly. */
  grip: number;
  /** How much further a thrown limb gets before the tether goes taut. */
  reach: number;
  /** How hard a full pull throws. */
  power: number;
  /**
   * 0..1, control. Softens the penalty for grabbing at speed, widens what the
   * aim assist will steer onto, and helps a dyno hand hold on.
   */
  control: number;
};

export const UNTRAINED: StrengthMods = { level: 0, grip: 1, reach: 1, power: 1, control: 0 };

/** Ceiling on each effect, at full strength. */
export const STRENGTH_MAX = {
  grip: 0.3,
  reach: 0.07,
  power: 0.1,
} as const;

/** Training at which strength is ~63% of the way there. */
const SCALE = 60;

/** Training an attempt is worth, before the grade bonus. */
const PER_ATTEMPT = 0.6;
const PER_SEND = 0.6;
/** Bonus for the first send at a grade above everything sent before. */
const PER_NEW_GRADE = 6;

/**
 * How much an attempt is worth. A fall still counts — most training is
 * falling off things — and a harder route teaches more, gently.
 */
export function attemptTraining(grade: Grade, sent: boolean): number {
  const g = gradeIndex(grade);
  const hard = 1 + Math.max(0, g) * 0.08;
  return (PER_ATTEMPT + (sent ? PER_SEND : 0)) * hard;
}

/** The boost for conquering a new V grade: bigger the higher the grade. */
export function breakthroughTraining(grade: Grade): number {
  return PER_NEW_GRADE * (1 + gradeIndex(grade) * 0.15);
}

/** 0..1 strength from the running training total. */
export function strengthLevel(training: number): number {
  return 1 - Math.exp(-Math.max(0, training) / SCALE);
}

export function strengthMods(training: number): StrengthMods {
  const level = strengthLevel(training);
  return {
    level,
    grip: 1 + STRENGTH_MAX.grip * level,
    reach: 1 + STRENGTH_MAX.reach * level,
    power: 1 + STRENGTH_MAX.power * level,
    control: level,
  };
}

/** A line for the breakthrough screen. Deadpan, and never a number. */
export function strengthNote(before: number, after: number): string | null {
  const a = strengthLevel(before);
  const b = strengthLevel(after);
  if (b - a < 0.01) return null;
  if (b > 0.85) return 'Fingers like a hydraulic press. Bernie remains unbothered.';
  if (b > 0.6) return 'The small holds have started to feel like holds.';
  if (b > 0.35) return 'Something in the forearms has quietly changed.';
  return 'Bernie feels slightly stronger. He will not be mentioning it.';
}
