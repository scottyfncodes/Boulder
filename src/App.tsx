import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Grade, Route } from './game/types';
import { GRADES } from './game/types';
import { ROUTES, routeById } from './content/routes';
import { type Attempt, type AttemptMode, toBeta } from './game/attempt';
import { type ScoreCard, scoreAttempt } from './game/scoring';
import {
  type Breakthrough as BreakthroughData,
  applyFall, applySend, markCelebrated, onsightAvailable, recordFor, toggleProject, unlockedGrades,
} from './state/progress';
import { attemptsRemaining, refreshDaily } from './game/daily';
import { useProfile } from './state/useProfile';
import { SlingScreen } from './ui/SlingScreen';
import { ResultScreen } from './ui/ResultScreen';
import { RouteList } from './ui/RouteList';
import { Breakthrough } from './ui/Breakthrough';
import { Title } from './ui/Title';
import { Standings } from './ui/Standings';
import { isLabRoute } from './content/lab';
import { capacityFor } from './game/endurance';
import { type Difficulty, generatedRouteById } from './content/generator';
import { nextRoute, prefetchRoute } from './content/generator/client';
import type { SetterState } from './ui/RouteSetter';
import { loadSetterChoice, saveSetterChoice } from './state/setterChoice';
import './app.css';

/**
 * Top level. Owns which screen is up and the one profile everything writes to.
 */

type Screen =
  | { kind: 'title' }
  | { kind: 'board' }
  | { kind: 'standings' }
  | { kind: 'climb'; route: Route; mode: AttemptMode; daily: boolean }
  | { kind: 'result'; route: Route; attempt: Attempt; card: ScoreCard; best: ScoreCard | null }
  | { kind: 'breakthrough'; data: BreakthroughData; unlocked: number };

export default function App() {
  const { profile, update } = useProfile();
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });

  const daily = useMemo(() => refreshDaily(profile.daily), [profile.daily]);

  // --- the route setter ---
  // Lives up here rather than on the board so a route being set keeps being
  // set while you climb something else, and is still there when you come back.
  const choice = useRef(loadSetterChoice());
  const [setter, setSetter] = useState<SetterState>(() => {
    const d = choice.current.difficulty;
    const id = choice.current.current[d];
    return { difficulty: d, route: id ? generatedRouteById(id) ?? null : null, busy: false, error: null };
  });
  const setterToken = useRef(0);

  const rollRoute = useCallback((d: Difficulty) => {
    const token = ++setterToken.current;
    setSetter((s) => ({ ...s, difficulty: d, busy: true, error: null }));
    nextRoute(d).then(
      (route) => {
        choice.current = { difficulty: d, current: { ...choice.current.current, [d]: route.id } };
        saveSetterChoice(choice.current);
        if (token === setterToken.current) setSetter({ difficulty: d, route, busy: false, error: null });
        prefetchRoute(d);
      },
      (err: unknown) => {
        if (token === setterToken.current) {
          setSetter((s) => ({ ...s, busy: false, error: String(err) }));
        }
      },
    );
  }, []);

  const pickDifficulty = useCallback((d: Difficulty) => {
    const id = choice.current.current[d];
    const kept = id ? generatedRouteById(id) ?? null : null;
    choice.current = { ...choice.current, difficulty: d };
    saveSetterChoice(choice.current);
    if (kept) {
      setterToken.current++;
      setSetter({ difficulty: d, route: kept, busy: false, error: null });
      prefetchRoute(d);
    } else {
      setSetter({ difficulty: d, route: null, busy: true, error: null });
      rollRoute(d);
    }
  }, [rollRoute]);

  // First visit to the board: set something to look at, and get the next one going.
  const onBoard = screen.kind === 'board';
  useEffect(() => {
    if (!onBoard) return;
    if (!setter.route && !setter.busy && !setter.error) rollRoute(setter.difficulty);
    else if (setter.route) prefetchRoute(setter.difficulty);
  }, [onBoard, setter.route, setter.busy, setter.error, setter.difficulty, rollRoute]);

  const startClimb = useCallback((route: Route, opts: { daily?: boolean }) => {
    const mode: AttemptMode = onsightAvailable(profile, route.id) ? 'onsight' : 'project';
    setScreen({ kind: 'climb', route, mode, daily: opts.daily ?? false });
  }, [profile]);

  const handleOutcome = useCallback((attempt: Attempt, outcome: 'sent' | 'fallen') => {
    const route = routeById(attempt.routeId);
    if (!route) return;

    // The practice wall is a sandbox: nothing it does touches the profile.
    if (isLabRoute(route.id)) {
      if (outcome === 'sent') {
        setScreen({ kind: 'result', route, attempt, card: scoreAttempt(attempt, route), best: null });
      }
      return;
    }

    if (outcome === 'fallen') {
      // A fall is not a screen change — the climb screen offers another go.
      update((p) => {
        const next = applyFall(p, route, attempt.moves.length);
        return screenIsDaily(attempt, daily.routeId)
          ? { ...next, daily: { ...daily, attemptsUsed: daily.attemptsUsed + 1, onsightAvailable: false, falls: daily.falls + 1 } }
          : next;
      });
      return;
    }

    const dynos = attempt.moves.filter((m) => m.dyno && m.holdId !== null).length;
    const card = scoreAttempt(attempt, route);
    const previousBest = recordFor(profile, route.id).best;

    update((p) => {
      const { profile: withSend, breakthrough } = applySend(p, route, card, toBeta(attempt.moves));
      let next = { ...withSend, totalDynos: withSend.totalDynos + dynos };
      if (screenIsDaily(attempt, daily.routeId)) {
        next = {
          ...next,
          daily: {
            ...daily,
            attemptsUsed: daily.attemptsUsed + 1,
            sent: true,
            bestMoves: daily.bestMoves === null ? card.moves : Math.min(daily.bestMoves, card.moves),
            bestEfficiency: Math.max(daily.bestEfficiency ?? 0, card.efficiency),
            onsightAvailable: false,
          },
        };
      }
      if (breakthrough) {
        next = markCelebrated(next, breakthrough.grade);
        pendingBreakthrough.current = {
          data: breakthrough,
          unlocked: countNewRoutes(p, next.topGrade),
        };
      }
      return next;
    });

    setScreen({ kind: 'result', route, attempt, card, best: previousBest });
  }, [profile, update, daily]);

  const closeResult = useCallback(() => {
    const pending = pendingBreakthrough.current;
    if (pending) {
      pendingBreakthrough.current = null;
      setScreen({ kind: 'breakthrough', data: pending.data, unlocked: pending.unlocked });
    } else {
      setScreen({ kind: 'board' });
    }
  }, []);

  switch (screen.kind) {
    case 'title':
      return (
        <Title
          profile={profile}
          onStart={() => setScreen({ kind: 'board' })}
          onStandings={() => setScreen({ kind: 'standings' })}
        />
      );

    case 'board':
      return (
        <RouteList
          profile={profile}
          daily={daily}
          onClimb={startClimb}
          onToggleProject={(id) => update((p) => toggleProject(p, id))}
          onStandings={() => setScreen({ kind: 'standings' })}
          setter={setter}
          onSetterPick={pickDifficulty}
          onSetterReroll={() => rollRoute(setter.difficulty)}
        />
      );

    case 'standings':
      return <Standings profile={profile} onBack={() => setScreen({ kind: 'board' })} />;

    case 'climb': {
      const left = attemptsRemaining(daily);
      return (
        <SlingScreen
          key={`${screen.route.id}:${screen.mode}`}
          route={screen.route}
          mode={screen.mode}
          capacity={capacityFor(profile.topGrade, profile.totalSends)}
          onExit={() => setScreen({ kind: 'board' })}
          onOutcome={handleOutcome}
          attemptsNote={screen.daily ? `daily · ${left} left` : undefined}
        />
      );
    }

    case 'result':
      return (
        <ResultScreen
          route={screen.route}
          attempt={screen.attempt}
          card={screen.card}
          personalBest={screen.best}
          onAgain={() => startClimb(screen.route, {})}
          onDone={closeResult}
        />
      );

    case 'breakthrough':
      return (
        <Breakthrough
          grade={screen.data.grade}
          previous={screen.data.previous}
          unlockedCount={screen.unlocked}
          onContinue={() => setScreen({ kind: 'board' })}
        />
      );
  }
}

/** Held between the send landing and the result screen being dismissed. */
const pendingBreakthrough: { current: { data: BreakthroughData; unlocked: number } | null } = {
  current: null,
};

function screenIsDaily(attempt: Attempt, dailyRouteId: string): boolean {
  return attempt.routeId === dailyRouteId;
}

/** How many routes appear on the board that were not there before. */
function countNewRoutes(before: Parameters<typeof unlockedGrades>[0], afterTop: Grade | null): number {
  const wasOpen = new Set(unlockedGrades(before));
  const nowOpen = new Set(
    GRADES.slice(0, Math.min(GRADES.length, (afterTop ? GRADES.indexOf(afterTop) : -1) + 2)),
  );
  let count = 0;
  for (const r of ROUTES) {
    if (!wasOpen.has(r.grade) && nowOpen.has(r.grade)) count++;
  }
  return count;
}
