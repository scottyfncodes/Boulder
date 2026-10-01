/**
 * Prints generated routes as ASCII wall maps, with timing and rejection
 * counts, so the shape of each difficulty can be eyeballed from a terminal.
 *
 *   npm run show:routes            # two of each difficulty
 *   npm run show:routes -- brutal 5
 */
import { DIFFICULTIES, generateRoute, shapeOf, type Difficulty } from '../src/content/generator';

const args = process.argv.slice(2);
const only = args[0] && (DIFFICULTIES as readonly string[]).includes(args[0]) ? [args[0] as Difficulty] : DIFFICULTIES;
const count = Number(args[1] ?? 2);

const COLS = 35; // 0.1 m per column across 3.4 m
const ROWS = 21; // 0.2 m per row up 4.2 m

for (const d of only) {
  for (let i = 0; i < count; i++) {
    const t0 = Date.now();
    const g = generateRoute(d, 1000 + i * 7919);
    const ms = Date.now() - t0;
    const r = g.route;
    const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ' '));
    for (const h of r.holds) {
      const c = Math.round((h.pos.x + 1.7) / 0.1);
      const row = ROWS - 1 - Math.round(h.pos.y / 0.2);
      if (row < 0 || row >= ROWS || c < 0 || c >= COLS) continue;
      const ch = h.finish ? 'F' : h.type === 'foothold' ? '.' : h.type === 'jug' ? 'o' : h.type[0];
      if (grid[row][c] === ' ' || grid[row][c] === '.') grid[row][c] = ch;
    }
    const m = shapeOf(g.build.path);
    console.log(`\n${d.toUpperCase()}  ${r.grade}  "${r.name}"  (${r.setter})  ${r.overhang ?? 0}°  par ${r.par}`);
    console.log(`  ${r.tagline}`);
    console.log(`  sections: ${r.blueprint!.sections.join(' → ')}   cruxes: ${r.blueprint!.cruxes.join(', ') || 'none'}`);
    console.log(`  lateral ${m.lateralTravel.toFixed(2)}m  extent ${m.lateralExtent.toFixed(2)}m  changes ${m.directionChanges}  down ${m.downSteps}  crux@${m.cruxAt?.toFixed(2) ?? '-'}`);
    console.log(`  holds ${r.holds.length}  rejected ${g.rejected} [${g.reasons.join(' | ')}]  ${ms}ms`);
    console.log('  +' + '-'.repeat(COLS) + '+');
    for (const row of grid) console.log('  |' + row.join('') + '|');
    console.log('  +' + '-'.repeat(COLS) + '+');
  }
}
