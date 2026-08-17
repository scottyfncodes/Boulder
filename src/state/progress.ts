import type { Grade, Route } from '../game/types';
import { GRADES, gradeIndex } from '../game/types';
import type { Beta } from '../game/attempt';
import type { ScoreCard } from '../game/scoring';
import type { DailyState } from '../game/daily';

/**
 * What the player keeps.
 *
 * Sends, projects, personal bests and the highest grade they have actually
 * pulled off. Grades are not unlocked by playing — they open when you send
 * something at the grade below, which is roughly how it works outside.
 */

export const SAVE_VERSION = 1;

export type RouteRecord = {
  routeId: string;
  attempts: number;
  falls: number;
  sent: boolean;
  /** True when the first ever attempt was topped without falling. */
  onsighted: boolean;
  /** Furthest move index reached, for the project card. */
  bestMove: number;
  best: ScoreCard | null;
  beta: Beta | null;
  /** Player pinned this as something they are working. */
  project: boolean;
  lastPlayed: number;
};

export type Profile = {
  version: number;
  createdAt: number;
  records: Record<string, RouteRecord>;
  /** Highest grade with at least one send. Null before the first send. */
  topGrade: Grade | null;
  /** Grades the player has been shown the breakthrough screen for. */
  celebrated: Grade[];
  daily: DailyState | null;
  totalSends: number;
  totalFalls: number;
  points: number;
};

export function freshProfile(now = Date.now()): Profile {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    records: {},
    topGrade: null,
    celebrated: [],
    daily: null,
    totalSends: 0,
    totalFalls: 0,
    points: 0,
  };
}

export function recordFor(profile: Profile, routeId: string): RouteRecord {
  return profile.records[routeId] ?? {
    routeId, attempts: 0, falls: 0, sent: false, onsighted: false,
    bestMove: 0, best: null, beta: null, project: false, lastPlayed: 0,
  };
}

/** An onsight is only available while the route has never been attempted. */
export function onsightAvailable(profile: Profile, routeId: string): boolean {
  return recordFor(profile, routeId).attempts === 0;
}

/**
 * Which grades the player can see. Everything up to their top grade plus one,
 * so there is always exactly one rung above them to stare at.
 */
export function unlockedGrades(profile: Profile): Grade[] {
  const top = profile.topGrade ? gradeIndex(profile.topGrade) : -1;
  return GRADES.slice(0, Math.min(GRADES.length, top + 2));
}

export function isUnlocked(profile: Profile, grade: Grade): boolean {
  return unlockedGrades(profile).includes(grade);
}

export type Breakthrough = { grade: Grade; previous: Grade | null };

/** Folds a completed attempt into the profile. */
export function applySend(
  profile: Profile,
  route: Route,
  card: ScoreCard,
  beta: Beta,
): { profile: Profile; breakthrough: Breakthrough | null } {
  const prev = recordFor(profile, route.id);
  const better = !prev.best || card.efficiency > prev.best.efficiency;

  const record: RouteRecord = {
    ...prev,
    routeId: route.id,
    attempts: prev.attempts + 1,
    sent: true,
    onsighted: prev.onsighted || (card.onsight && prev.attempts === 0),
    bestMove: Math.max(prev.bestMove, card.moves),
    best: better ? card : prev.best,
    beta: better || !prev.beta ? beta : prev.beta,
    // Sending it retires it as a project.
    project: false,
    lastPlayed: card.sentAt,
  };

  const prevTop = profile.topGrade;
  const raised = prevTop === null || gradeIndex(route.grade) > gradeIndex(prevTop);
  const topGrade = raised ? route.grade : prevTop;

  const next: Profile = {
    ...profile,
    records: { ...profile.records, [route.id]: record },
    topGrade,
    totalSends: profile.totalSends + 1,
    points: profile.points + (better ? card.points - (prev.best?.points ?? 0) : 0),
  };

  const breakthrough =
    raised && !profile.celebrated.includes(route.grade)
      ? { grade: route.grade, previous: prevTop }
      : null;

  return { profile: next, breakthrough };
}

/** Folds a failed attempt in. Falls are worth keeping — they are the project. */
export function applyFall(profile: Profile, route: Route, movesReached: number, now = Date.now()): Profile {
  const prev = recordFor(profile, route.id);
  const record: RouteRecord = {
    ...prev,
    routeId: route.id,
    attempts: prev.attempts + 1,
    falls: prev.falls + 1,
    bestMove: Math.max(prev.bestMove, movesReached),
    lastPlayed: now,
  };
  return {
    ...profile,
    records: { ...profile.records, [route.id]: record },
    totalFalls: profile.totalFalls + 1,
  };
}

export function markCelebrated(profile: Profile, grade: Grade): Profile {
  if (profile.celebrated.includes(grade)) return profile;
  return { ...profile, celebrated: [...profile.celebrated, grade] };
}

export function toggleProject(profile: Profile, routeId: string): Profile {
  const prev = recordFor(profile, routeId);
  return {
    ...profile,
    records: { ...profile.records, [routeId]: { ...prev, project: !prev.project } },
  };
}

/** Status line for a project card. Deadpan on purpose. */
export function projectStatus(record: RouteRecord, par: number): string {
  if (record.sent) return 'SENT';
  if (record.attempts === 0) return 'UNTOUCHED';
  const frac = record.bestMove / Math.max(par, 1);
  if (frac > 0.85) return 'SO CLOSE';
  if (frac > 0.6) return 'GETTING THERE';
  if (record.attempts > 12) return 'PERSONAL';
  if (record.attempts > 5) return 'ONGOING';
  return 'EARLY DAYS';
}
