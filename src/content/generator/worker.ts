import { generateRoute } from './index';
import type { Difficulty } from './difficulty';

/**
 * Sets routes off the main thread. Validating a route means climbing it with
 * the headless climber, which takes a second or two on a phone — long enough
 * that doing it on the UI thread would freeze the board.
 */

type Request = { req: number; difficulty: Difficulty; seed: number };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage: (msg: unknown) => void;
};

scope.onmessage = (e) => {
  const { req, difficulty, seed } = e.data;
  try {
    const g = generateRoute(difficulty, seed);
    scope.postMessage({ req, route: g.route, rejected: g.rejected });
  } catch (err) {
    scope.postMessage({ req, error: String(err) });
  }
};
