import type { Grade, MoveGrade, Route } from './types';
import { gradeIndex } from './types';
import type { Attempt } from './attempt';

/**
 * Scoring.
 *
 * Efficiency leads, not speed. A fast sloppy lap scrabbling at four holds per
 * move loses to a slower climb where every placement was where it should be —
 * which is the correct opinion to have about climbing.
 */

export const MOVE_VALUE: Record<MoveGrade, number> = {
  PERFECT: 1,
  GOOD: 0.72,
  SCRAPE: 0.38,
  MISS: 0,
  YEET: 0,
};

export type ScoreCard = {
  routeId: string;
  grade: Grade;
  moves: number;
  par: number;
  falls: number;
  perfect: number;
  good: number;
  scrape: number;
  whiffed: number;
  timeMs: number;
  /** Body positioning used. Reported, not scored — placements are the score. */
  shifts: number;
  /** 0..1. The headline number. */
  efficiency: number;
  /** Points, for leaderboards. */
  points: number;
  onsight: boolean;
  sentAt: number;
};

/** Ratio of par to moves used, capped so beating par cannot run away with it. */
export function moveEfficiency(moves: number, par: number): number {
  if (moves <= 0) return 0;
  return Math.min(1, par / moves);
}

/** Mean quality of the placements that actually stuck. */
export function placementQuality(grades: MoveGrade[]): number {
  const landed = grades.filter((g) => g !== 'MISS' && g !== 'YEET');
  if (landed.length === 0) return 0;
  const sum = landed.reduce((s, g) => s + MOVE_VALUE[g], 0);
  // Whiffs still cost, they just do not get to be averaged away.
  const whiffPenalty = 1 - Math.min(0.4, (grades.length - landed.length) * 0.06);
  return (sum / landed.length) * whiffPenalty;
}

/**
 * Time is a tiebreaker, not a driver: full credit for anything under a
 * generous window, then a gentle taper. Nobody should feel rushed while
 * reading a sequence.
 */
export function paceBonus(timeMs: number, par: number): number {
  const generous = par * 9000;
  if (timeMs <= generous) return 1;
  return Math.max(0.55, 1 - (timeMs - generous) / (generous * 3));
}

export function fallFactor(falls: number): number {
  return 1 / (1 + falls * 0.34);
}

export function scoreAttempt(attempt: Attempt, route: Route, now = Date.now()): ScoreCard {
  const grades = attempt.moves.map((m) => m.grade);
  const moves = attempt.moves.length;
  const perfect = grades.filter((g) => g === 'PERFECT').length;
  const good = grades.filter((g) => g === 'GOOD').length;
  const scrape = grades.filter((g) => g === 'SCRAPE').length;
  const whiffed = grades.filter((g) => g === 'MISS' || g === 'YEET').length;

  const eff =
    (0.46 * moveEfficiency(moves, route.par)
      + 0.4 * placementQuality(grades)
      + 0.14 * paceBonus(attempt.elapsedMs, route.par))
    * fallFactor(attempt.falls);

  const efficiency = Math.max(0, Math.min(1, eff));
  const gradeWeight = 100 + gradeIndex(route.grade) * 55;
  const onsight = attempt.mode === 'onsight' && attempt.falls === 0;
  const points = Math.round(efficiency * gradeWeight * (onsight ? 1.25 : 1));

  return {
    routeId: route.id,
    grade: route.grade,
    moves,
    par: route.par,
    falls: attempt.falls,
    perfect, good, scrape, whiffed,
    timeMs: attempt.elapsedMs,
    shifts: attempt.shifts.length,
    efficiency,
    points,
    onsight,
    sentAt: now,
  };
}

/** Dry one-liner for the send screen. Not a grade, an opinion. */
export function verdict(card: ScoreCard): string {
  if (card.onsight && card.efficiency > 0.9) return 'Flashed it. Insufferable.';
  if (card.onsight) return 'Onsight. First go, no notes.';
  if (card.efficiency > 0.88) return 'Clean. Genuinely clean.';
  if (card.efficiency > 0.72) return 'Solid. A bit of scrabbling.';
  if (card.falls > 6) return 'Sent. Eventually. Loudly.';
  if (card.whiffed > card.moves * 0.3) return 'Half of that was improvisation.';
  if (card.moves > card.par * 1.6) return 'Took the scenic line.';
  return 'It counts. They all count.';
}
