import type { Grade, LimbId, MoveGrade, Route, Vec2 } from './types';
import { isHand } from './types';
import {
  type Aim, type ClimbState, type DynoResult, type MoveResult, type ShiftResult,
  initialState, resolveDyno, resolveMove, shiftBody,
} from './move';
import {
  type Endurance, capacityFor, drainEndurance, freshEndurance, isRest, routeDrain,
} from './endurance';

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
  /** True when this entry was a dyno rather than a single limb placement. */
  dyno?: boolean;
  limb: LimbId;
  /** Null when the limb caught nothing. */
  holdId: number | null;
  grade: MoveGrade;
  /** Aim the player used, so a ghost can replay the attempt exactly. */
  aim: Aim;
};

/**
 * A weight shift, pinned to the point in the sequence it happened at, so a
 * recorded attempt can be replayed exactly without shifts having to pretend
 * to be moves.
 */
export type ShiftRecord = { afterMove: number; to: Vec2 | null };

export type Attempt = {
  routeId: string;
  mode: AttemptMode;
  phase: AttemptPhase;
  state: ClimbState;
  moves: BetaMove[];
  /** Body positioning, in sequence order. Not moves, and not scored as moves. */
  shifts: ShiftRecord[];
  falls: number;
  /** Wall-clock ms spent climbing, excluding inspection. */
  elapsedMs: number;
  startedAt: number;
  /** Furthest move index reached across this session's attempts on the route. */
  highWater: number;
  /** What is left in the tank. */
  endurance: Endurance;
  /** Route difficulty multiplier, cached so the tick stays cheap. */
  drain: number;
};

export function overhangOf(route: Route): number {
  return ((route.overhang ?? 0) * Math.PI) / 180;
}

export function beginAttempt(
  route: Route, mode: AttemptMode, now = Date.now(), capacity = capacityFor(null, 0),
): Attempt {
  return {
    routeId: route.id,
    mode,
    phase: 'inspect',
    state: initialState(route.holds, route.start, overhangOf(route)),
    moves: [],
    shifts: [],
    falls: 0,
    elapsedMs: 0,
    startedAt: now,
    highWater: 0,
    endurance: freshEndurance(capacity),
    drain: routeDrain(route),
  };
}

export type TickResult = {
  attempt: Attempt;
  /** The pool emptied — pumped off the wall. */
  pumped: boolean;
};

/**
 * Advances endurance. Called every frame while climbing.
 *
 * `reaching` is true from the moment a limb is committed to a move until it
 * finds a hold, which is the only time the fast pool moves.
 */
export function tickEndurance(
  attempt: Attempt, dtMs: number, reaching: boolean, route: Route,
): TickResult {
  if (attempt.phase !== 'climbing') return { attempt, pumped: false };

  // Resting only counts when you are actually settled on a rest hold, not
  // merely touching one on the way past.
  const restIds = new Set(route.holds.filter(isRest).map((h) => h.id));
  const resting = !reaching
    && attempt.state.pose.stability > 0.55
    && attempt.state.contacts.some((c) => restIds.has(c.holdId));

  const { endurance, pumped } = drainEndurance({
    endurance: attempt.endurance,
    dtMs,
    drain: attempt.drain,
    stability: attempt.state.pose.stability,
    reaching,
    resting,
  });

  return {
    attempt: {
      ...attempt,
      endurance,
      phase: pumped ? 'fallen' : attempt.phase,
      falls: attempt.falls + (pumped ? 1 : 0),
    },
    pumped,
  };
}

export type ShiftOutcome = {
  attempt: Attempt;
  result: ShiftResult;
  ended: 'fallen' | null;
};

/**
 * Commands a new body position. Costs no move — this is not a placement, and
 * scoring counts placements — but it can absolutely put you on the mat, which
 * is the whole tension of moving your weight around on small holds.
 */
export function shiftStep(
  attempt: Attempt, route: Route, target: Vec2 | null, now = Date.now(),
): ShiftOutcome {
  const result = shiftBody(attempt.state, target, route.holds);
  const next: Attempt = {
    ...attempt,
    phase: result.fell ? 'fallen' : attempt.phase,
    state: result.next,
    shifts: [...attempt.shifts, { afterMove: attempt.moves.length, to: target }],
    falls: attempt.falls + (result.fell ? 1 : 0),
    elapsedMs: now - attempt.startedAt,
  };
  return { attempt: next, result, ended: result.fell ? 'fallen' : null };
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
    state: initialState(route.holds, route.start, overhangOf(route)),
    moves: [],
    shifts: [],
    elapsedMs: 0,
    startedAt: now,
    endurance: freshEndurance(attempt.endurance.capacity),
  };
}

/** The stored form of a beta: limb and hold only, aim dropped. */
export type DynoOutcome = {
  attempt: Attempt;
  result: DynoResult;
  ended: 'sent' | 'fallen' | null;
};

/** Commits a dyno. Everything leaves the wall; the hands sort it out. */
export function dynoStep(attempt: Attempt, route: Route, aim: Aim, now = Date.now()): DynoOutcome {
  const result = resolveDyno(attempt.state, aim, route.holds);
  const moves = [...attempt.moves, {
    limb: aim.limb, holdId: result.caught[0]?.holdId ?? null, grade: result.grade, aim, dyno: true,
  }];
  const sent = !result.fell && isSent(result.next, route);
  const phase: AttemptPhase = sent ? 'sent' : result.fell ? 'fallen' : 'climbing';
  return {
    attempt: {
      ...attempt,
      phase,
      state: result.next,
      moves,
      falls: attempt.falls + (result.fell ? 1 : 0),
      elapsedMs: now - attempt.startedAt,
      highWater: Math.max(attempt.highWater, moves.length),
    },
    result,
    ended: sent ? 'sent' : result.fell ? 'fallen' : null,
  };
}

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
