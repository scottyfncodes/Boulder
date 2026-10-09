/**
 * Assesses every curated route — the board and the highballs — from what its
 * moves ask for, and writes src/content/routeGrades.ts. Run after changing
 * routes, the physics or the grader: `npm run gen:grades`.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTES } from '../src/content/routes';
import { highballs } from '../src/content/highball';
import { communityBetasFor } from '../src/content/communityBeta';
import { solveRoute } from '../src/game/autoplay';
import { gradeRoute } from '../src/game/grading';
import type { Beta } from '../src/game/attempt';

const out: Record<string, unknown> = {};
for (const r of [...ROUTES, ...highballs()]) {
  let betas: Beta[] = communityBetasFor(r.id).map((b) => b.beta);
  if (!betas.length) {
    betas = [0, 1337, 24601]
      .map((style) => solveRoute(r, { beam: 20, depth: 160, style }))
      .filter((s) => s.sent)
      .map((s) => s.moves.map((m) => ({ limb: m.limb, holdId: m.holdId })));
  }
  const g = gradeRoute(r, betas);
  out[r.id] = {
    grade: g.grade,
    score: +g.score.toFixed(2),
    crux: { move: g.crux.index + 1, holdId: g.crux.holdId, difficulty: +g.crux.difficulty.toFixed(2) },
    sustained: +g.sustained.toFixed(2),
    rests: g.rests,
    solutions: g.solutions,
    moves: g.moves.length,
    styles: g.styles,
    techniques: g.techniques,
  };
  console.log(`${r.id.padEnd(26)} ${r.grade.padEnd(4)} assessed ${g.grade.padEnd(4)} ${g.styles.join(', ')}`);
}

const file = `import type { Grade } from '../game/types';
import type { RouteStyle } from '../game/grading';
import type { TechniqueId } from '../game/technique';

/**
 * Route assessments — GENERATED, do not edit by hand.
 * Regenerate with \\\`npm run gen:grades\\\` after changing routes, the physics or the grader.
 *
 * What each curated route's moves add up to (\\\`src/game/grading.ts\\\`): the
 * grade the model gives it, where the crux is, what kind of climbing it is.
 * The setter's grade stays on the route; this is the second opinion.
 */

export type Assessment = {
  grade: Grade;
  score: number;
  crux: { move: number; holdId: number; difficulty: number };
  sustained: number;
  rests: number;
  solutions: number;
  moves: number;
  styles: RouteStyle[];
  techniques: TechniqueId[];
};

const DATA: Record<string, Assessment> = ${JSON.stringify(out, null, 2)};

export function assessmentOf(routeId: string): Assessment | undefined {
  return DATA[routeId];
}
`;
writeFileSync(resolve(process.cwd(), 'src/content/routeGrades.ts'), file);
console.log('\nwrote src/content/routeGrades.ts');
