/**
 * Finds seeds for the highball tiers that set, read right and actually go.
 * Prints entries to paste into src/content/highball.ts.
 *
 *   npm run find:highballs                 # every tier
 *   npm run find:highballs -- vertigo      # one
 */
import { HIGHBALL_TIERS } from '../src/content/highball';
import { buildRoute } from '../src/content/generator/build';
import { checkClimb, checkShape, checkStructure, parFor } from '../src/content/generator/validate';
import { gradeRoute } from '../src/game/grading';
import { TOWER } from '../src/content/wall';
import { hashString } from '../src/game/rng';

const want = process.argv.slice(2);
for (const [key, tier] of Object.entries(HIGHBALL_TIERS)) {
  if (want.length && !want.includes(key)) continue;
  let found = 0;
  for (let i = 0; i < 400 && found < 2; i++) {
    const seed = hashString(`${key}:${i}`);
    const b = buildRoute(tier.difficulty, seed, { tier });
    const cheap = checkStructure(b, TOWER) ?? checkShape(b, tier.difficulty);
    if (cheap) continue;
    const t0 = Date.now();
    const v = checkClimb(b);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!v.ok) { console.error(key, i, 'no:', v.reason, secs + 's'); continue; }
    const par = parFor(b.route, v.solution);
    const g = gradeRoute(b.route, [v.solution.moves.map((m) => ({ limb: m.limb, holdId: m.holdId }))]);
    const top = Math.max(...b.route.holds.map((h) => h.pos.y));
    console.log(JSON.stringify({ key, seed, par, grade: g.grade, score: +g.score.toFixed(2), top: +top.toFixed(1), holds: b.route.holds.length, sections: b.plan.sections, cruxes: b.plan.cruxes, styles: g.styles, secs }));
    found++;
  }
}
