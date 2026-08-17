/**
 * Generates the community beta data.
 *
 * Runs the headless climber over every shipped route several times with
 * different style seeds, keeps the sequences that are genuinely distinct from
 * one another, and writes them out as a data file. Doing this at build time
 * rather than in the browser means the send screen can show a rival beta
 * instantly instead of thinking about it for a second and a half.
 *
 *   npm run gen:beta
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTES } from '../src/content/routes';
import { solveRoute } from '../src/game/autoplay';
import { betaDistance, type Beta } from '../src/game/attempt';

const CLIMBER_NAMES = [
  'Most climbers', 'The tall beta', 'The short beta', 'The foot-first beta',
  'The powerful beta', 'The technical beta',
];

type Entry = { name: string; share: number; beta: Beta };

function distinctBetas(routeId: string): Entry[] {
  const route = ROUTES.find((r) => r.id === routeId)!;
  const found: Beta[] = [];

  for (const style of [0, 1337, 24601, 90210, 5150, 8675309]) {
    const sol = solveRoute(route, { beam: 26, depth: 46, style });
    if (!sol.sent) continue;
    const beta: Beta = sol.moves.map((m) => ({ limb: m.limb, holdId: m.holdId }));
    // Only keep a sequence if it is meaningfully unlike the ones already kept.
    if (found.some((f) => betaDistance(f, beta) < 0.3)) continue;
    found.push(beta);
    if (found.length >= 3) break;
  }

  // Share is a plausible popularity split: the first solution found is the
  // obvious one, and the rest tail off.
  const shares = [[1], [0.68, 0.32], [0.54, 0.29, 0.17]][Math.max(found.length - 1, 0)] ?? [1];
  return found.map((beta, i) => ({
    name: CLIMBER_NAMES[i] ?? `Variant ${i + 1}`,
    share: shares[i] ?? 0,
    beta,
  }));
}

const out: Record<string, Entry[]> = {};
for (const route of ROUTES) {
  out[route.id] = distinctBetas(route.id);
  const n = out[route.id].length;
  console.log(`${route.id.padEnd(22)} ${n} beta${n === 1 ? '' : 's'}`);
}

const file = `import type { Beta } from '../game/attempt';

/**
 * Community betas — GENERATED, do not edit by hand.
 * Regenerate with \`npm run gen:beta\` after changing routes or the sim.
 *
 * Each entry is a sequence the headless climber found with a different set of
 * habits. They stand in for other people until there are other people.
 */

export type CommunityBeta = { name: string; share: number; beta: Beta };

const DATA: Record<string, CommunityBeta[]> = ${JSON.stringify(out, null, 2)};

export function communityBetasFor(routeId: string): CommunityBeta[] {
  return DATA[routeId] ?? [];
}
`;
writeFileSync(resolve(process.cwd(), 'src/content/communityBeta.ts'), file);
console.log('\nwrote src/content/communityBeta.ts');
