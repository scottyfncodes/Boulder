import type { Difficulty } from '../content/generator';
import { isDifficulty } from '../content/generator/difficulty';

/**
 * Which difficulty the route setter was on, and the route it last set at each
 * one, so leaving the board and coming back finds the same route waiting.
 * Kept apart from the profile: it is a preference, not progress.
 */

const KEY = 'bruh.setter.v1';

export type SetterChoice = {
  difficulty: Difficulty;
  current: Partial<Record<Difficulty, string>>;
};

export function loadSetterChoice(): SetterChoice {
  const fallback: SetterChoice = { difficulty: 'moderate', current: {} };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SetterChoice>;
    return {
      difficulty: parsed.difficulty && isDifficulty(parsed.difficulty) ? parsed.difficulty : fallback.difficulty,
      current: typeof parsed.current === 'object' && parsed.current ? parsed.current : {},
    };
  } catch {
    return fallback;
  }
}

export function saveSetterChoice(choice: SetterChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // Private mode or a full disk: the setter just forgets, which is fine.
  }
}
