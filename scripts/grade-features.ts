import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { ROUTES } from '../src/content/routes';
import { communityBetasFor } from '../src/content/communityBeta';
import { featuresOf } from '../src/game/grading';
import { solveRoute } from '../src/game/autoplay';
import { GRADES } from '../src/game/types';
const cacheF = 'node_modules/.cache/boardBetas.json';
const cache: Record<string, any> = existsSync(cacheF) ? JSON.parse(readFileSync(cacheF, 'utf8')) : {};
const rows: any[] = [];
for (const r of ROUTES) {
  if (r.id.startsWith('lab')) continue;
  let betas = communityBetasFor(r.id).map((b) => b.beta);
  if (!betas.length) {
    if (!cache[r.id]) {
      cache[r.id] = [0, 1337, 24601].map((style) => solveRoute(r, { beam: 20, depth: 90, style })).filter((s) => s.sent).map((s) => s.moves.map((m) => ({ limb: m.limb, holdId: m.holdId })));
      writeFileSync(cacheF, JSON.stringify(cache));
    }
    betas = cache[r.id];
  }
  const { f } = featuresOf(r, betas);
  rows.push({ id: r.id, g: GRADES.indexOf(r.grade), f, board: !communityBetasFor(r.id).length });
  console.error(r.id, betas.length);
}
writeFileSync('node_modules/.cache/features.json', JSON.stringify(rows));
