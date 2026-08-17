import type { Grade, Route } from './types';
import { gradeIndex } from './types';
import { ROUTES } from '../content/routes';
import { hashString, rng } from './rng';

/**
 * The Daily Climb.
 *
 * Everyone gets the same route on the same date, chosen from the date alone so
 * no server has to agree with anyone. Three attempts, and the onsight is the
 * first of them — same rules as the rest of the game, just with a hard stop.
 */

export const DAILY_ATTEMPTS = 3;

/** Local calendar date as YYYY-MM-DD. The day rolls over at the player's midnight. */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Picks the day's route. Weighted toward the middle of the grade range so the
 * daily is usually a fight and occasionally a gift.
 */
export function dailyRoute(key: string = dayKey(), pool: Route[] = ROUTES): Route {
  const r = rng(hashString(`daily:${key}`));
  const target = pickTargetGrade(r());
  const candidates = pool.filter((x) => x.grade === target);
  const from = candidates.length > 0 ? candidates : pool;
  return from[Math.floor(r() * from.length)];
}

function pickTargetGrade(roll: number): Grade {
  // V1 .. V5, centre-weighted.
  const table: Grade[] = ['V1', 'V2', 'V2', 'V3', 'V3', 'V3', 'V4', 'V4', 'V5'];
  return table[Math.min(table.length - 1, Math.floor(roll * table.length))];
}

export type DailyState = {
  day: string;
  routeId: string;
  attemptsUsed: number;
  /** Set once the day's route has been topped. */
  sent: boolean;
  bestMoves: number | null;
  bestEfficiency: number | null;
  falls: number;
  /** True while the first attempt has not been spent. */
  onsightAvailable: boolean;
};

export function freshDaily(key: string = dayKey()): DailyState {
  return {
    day: key,
    routeId: dailyRoute(key).id,
    attemptsUsed: 0,
    sent: false,
    bestMoves: null,
    bestEfficiency: null,
    falls: 0,
    onsightAvailable: true,
  };
}

export function attemptsRemaining(d: DailyState): number {
  return Math.max(0, DAILY_ATTEMPTS - d.attemptsUsed);
}

/** Rolls the daily forward if the stored one is from an earlier day. */
export function refreshDaily(stored: DailyState | null, key: string = dayKey()): DailyState {
  if (stored && stored.day === key) return stored;
  return freshDaily(key);
}

export function gradeRank(g: Grade): number {
  return gradeIndex(g);
}
