import type { Route } from '../../game/types';
import type { Difficulty } from './difficulty';
import { generateRoute, randomSeed, rememberRoute } from './index';

/**
 * The board's handle on the route setter.
 *
 * Setting a route means climbing it with the headless climber to prove it
 * goes, which takes seconds on a phone, so it happens on worker threads: one
 * for the route the player is waiting on, one quietly setting the next route
 * at the same difficulty so "set another" is usually instant. Where workers
 * are not available it all happens inline, after yielding so a spinner paints.
 */

type Reply = { req: number; route?: Route; error?: string };
type Lane = 'now' | 'later';

const workers: Partial<Record<Lane, Worker | null>> = {};
let nextReq = 1;
const pending = new Map<number, { resolve: (r: Route) => void; reject: (e: Error) => void }>();

function workerFor(lane: Lane): Worker | null {
  if (workers[lane] !== undefined) return workers[lane]!;
  let w: Worker | null = null;
  try {
    w = typeof Worker === 'undefined'
      ? null
      : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    w = null;
  }
  w?.addEventListener('message', (e: MessageEvent<Reply>) => {
    const p = pending.get(e.data.req);
    if (!p) return;
    pending.delete(e.data.req);
    if (e.data.route) {
      rememberRoute(e.data.route);
      p.resolve(e.data.route);
    } else {
      p.reject(new Error(e.data.error ?? 'route setter failed'));
    }
  });
  w?.addEventListener('error', () => {
    // A worker that cannot start (old browser, blocked module workers) is not
    // fatal: the caller falls back to setting the route inline.
    workers[lane] = null;
    for (const [req, p] of pending) {
      pending.delete(req);
      p.reject(new Error('worker unavailable'));
    }
  });
  workers[lane] = w;
  return w;
}

function inline(difficulty: Difficulty, seed: number): Promise<Route> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(generateRoute(difficulty, seed).route);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, 30);
  });
}

function setRoute(difficulty: Difficulty, seed: number, lane: Lane): Promise<Route> {
  const w = workerFor(lane);
  if (!w) return inline(difficulty, seed);
  const req = nextReq++;
  return new Promise<Route>((resolve, reject) => {
    pending.set(req, { resolve, reject });
    w.postMessage({ req, difficulty, seed });
  }).catch(() => inline(difficulty, seed));
}

const ready = new Map<Difficulty, Promise<Route>>();

/** Starts setting the next route at this difficulty in the background, if one is not already coming. */
export function prefetchRoute(difficulty: Difficulty): void {
  if (ready.has(difficulty)) return;
  const p = setRoute(difficulty, randomSeed(), 'later');
  // A failed prefetch is forgotten, not reported: the next request sets its own.
  p.catch(() => {
    if (ready.get(difficulty) === p) ready.delete(difficulty);
  });
  ready.set(difficulty, p);
}

/** A new route at this difficulty: the prefetched one if there is one, otherwise one set now. */
export function nextRoute(difficulty: Difficulty): Promise<Route> {
  const waiting = ready.get(difficulty);
  ready.delete(difficulty);
  if (waiting) return waiting.catch(() => setRoute(difficulty, randomSeed(), 'now'));
  return setRoute(difficulty, randomSeed(), 'now');
}
