import type { Grade, LimbId, MoveGrade, Route } from './types';
import { isHand } from './types';
import { type Aim, type ClimbState, type MoveResult, initialState, resolveMove } from './move';

/**
 * One go on a route, from pulling on to either topping out or hitting the mat.
 *
 * An attempt owns the move log, which doubles as the beta — the sequence a
 * send is stored as, and the thing ghosts replay from.
 */

export type AttemptMode = 'onsight' | 'project';

export type AttemptPhase = 'inspect' | 'climbing' | 'fallen' | 'sent';

/** One entry in a beta: which limb went where, and how well. */
export type BetaMove = {
  limb: LimbId;
  /** Null when the limb caught nothing. */
  holdId: number | null;
  grade: MoveGrade;
  /** Aim the player used, so a ghost can replay the attempt exactly. */
  aim: Aim;
};

export type Attempt = {
  routeId: string;
  mode: AttemptMode;
  phase: AttemptPhase;
  state: ClimbState;
  moves: BetaMove[];
  falls: number;
  /** Wall-clock ms spent climbing, excluding inspection. */
  elapsedMs: number;
  startedAt: number;
  /** Furthest move index reached across this session's attempts on the route. */
  highWater: number;
};

export function beginAttempt(route: Route, mode: AttemptMode, now = Date.now()): Attempt {
  return {
    routeId: route.id,
    mode,
    phase: 'inspect',
    state: initialState(route.holds, route.start),
    moves: [],
    falls: 0,
    elapsedMs: 0,
    startedAt: now,
    highWater: 0,
  };
}

export function pullOn(attempt: Attempt, now = Date.now()): Attempt {
  if (attempt.phase !== 'inspect') return attempt;
  return { ...attempt, phase: 'climbing', startedAt: now };
}

/** True once both hands are matched on the route's finish holds. */
export function isSent(state: ClimbState, route: Route): boolean {
  const hands = state.contacts.filter((c) => isHand(c.limb));
  return hands.length === 2 && hands.every((c) => route.finish.includes(c.holdId));
}

export type StepOutcome = {
  attempt: Attempt;
  result: MoveResult;
  /** Set when this move ended the attempt one way or the other. */
  ended: 'sent' | 'fallen' | null;
};

/** Plays one move and folds the outcome back into the attempt. */
export function step(attempt: Attempt, route: Route, aim: Aim, now = Date.now()): StepOutcome {
  const result = resolveMove({ state: attempt.state, aim, holds: route.holds });
  const moves = [...attempt.moves, {
    limb: aim.limb, holdId: result.holdId, grade: result.grade, aim,
  }];

  const sent = !result.fell && isSent(result.next, route);
  const phase: AttemptPhase = sent ? 'sent' : result.fell ? 'fallen' : 'climbing';

  const next: Attempt = {
    ...attempt,
    phase,
    state: result.next,
    moves,
    falls: attempt.falls + (result.fell ? 1 : 0),
    elapsedMs: now - attempt.startedAt,
    highWater: Math.max(attempt.highWater, moves.length),
  };

  return { attempt: next, result, ended: sent ? 'sent' : result.fell ? 'fallen' : null };
}

/**
 * Restarts after a fall. An onsight does not survive one — that is the entire
 * point of an onsight — so the retry comes back as a project.
 */
export function retry(attempt: Attempt, route: Route, now = Date.now()): Attempt {
  return {
    ...attempt,
    mode: 'project',
    phase: 'inspect',
    state: initialState(route.holds, route.start),
    moves: [],
    elapsedMs: 0,
    startedAt: now,
  };
}

/** The stored form of a beta: limb and hold only, aim dropped. */
export type Beta = { limb: LimbId; holdId: number }[];

export function toBeta(moves: BetaMove[]): Beta {
  return moves
    .filter((m): m is BetaMove & { holdId: number } => m.holdId !== null)
    .map((m) => ({ limb: m.limb, holdId: m.holdId }));
}

/** Renders a beta the way climbers write one down. */
export function formatBeta(beta: Beta): string[] {
  return beta.map((m) => `${m.limb} → ${m.holdId}`);
}

/** How much two betas differ, 0 (identical) .. 1 (nothing in common). */
export function betaDistance(a: Beta, b: Beta): number {
  const key = (m: { limb: LimbId; holdId: number }) => `${m.limb}:${m.holdId}`;
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  if (sa.size === 0 && sb.size === 0) return 0;
  let shared = 0;
  for (const k of sa) if (sb.has(k)) shared++;
  const union = sa.size + sb.size - shared;
  return union === 0 ? 0 : 1 - shared / union;
}

export const GRADE_OF_ROUTE = (r: Route): Grade => r.grade;
