/**
 * Plays routes with the climbing bot and prints what the pump did.
 *
 *   npm run playtest                 # every hand-set route, both styles
 *   npm run playtest -- warmup cave  # just these
 */
import { ROUTES } from '../src/content/routes';
import { climb, type Style } from '../src/game/climbBot';

const want = process.argv.slice(2);
const routes = want.length ? ROUTES.filter((r) => want.some((w) => r.id.includes(w))) : ROUTES;
const styles: Style[] = ['efficient', 'reckless'];

console.log('route                 grade style      outcome  moves dynos miss  time  rest  maxPump end  floor high');
for (const route of routes) {
  for (const style of styles) {
    const t0 = Date.now();
    const r = climb(route, style);
    const pad = (s: string | number, n: number) => String(s).padEnd(n);
    console.log(
      pad(route.id, 22) + pad(route.grade, 6) + pad(style, 11) + pad(r.outcome, 9) + pad(r.moves, 6) + pad(r.dynos, 6)
      + pad(r.misses, 5) + pad(r.time, 6) + pad(r.rested, 6) + pad(r.maxPump, 8) + pad(r.endPump, 5) + pad(r.floor, 6)
      + pad(r.high, 5) + `  (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
  }
}
