import type { Archetype, CruxKind, Difficulty } from './difficulty';
import type { Plan } from './plan';
import type { PathStep } from './build';
import type { Rand } from './rand';

/**
 * Names, setters and taglines for generated routes.
 *
 * The tagline is the one place the route's shape is put into words, and only
 * loosely — "a traverse, a roof, then a hard move near the top" tells you
 * there is a plan without telling you the beta.
 */

const NAMES: Record<Archetype, readonly string[]> = {
  slab: ['Quiet Feet', 'Small Print', 'Balance Sheet', 'Friction Report', 'Tiptoe Policy', 'Read The Room'],
  zigzag: ['Mixed Signals', 'Second Thoughts', 'Both Ways', 'Restructure', 'Pivot Meeting', 'Change Of Plan'],
  traverse: ['Lateral Move', 'Sideways Promotion', 'The Long Commute', 'Scenic Route', 'Cross-Departmental', 'Wrong Turn'],
  roof: ['Glass Ceiling', 'Low Clearance', 'Mind Your Head', 'Overhead Costs', 'Under New Management'],
  overhang: ['Steep Learning Curve', 'Leaning Tower', 'Pump Action', 'Gravity Check', 'Uphill Battle'],
  dihedral: ['Corner Office', 'Open Book', 'Between Two Walls', 'Boxed In'],
  crack: ['Split Decision', 'Fault Line', 'Through The Cracks', 'Hairline'],
  arete: ['Edge Case', 'Fine Line', 'Cutting Corners', 'On The Fence'],
  compression: ['Squeeze Play', 'Budget Squeeze', 'Hug It Out', 'Group Hug'],
};

const SUFFIX = ['', '', '', ' Direct', ' Extension', ' (Sit Start)', ' Variation', ' II'];

/** Who would set a route like this, by its most characteristic section. */
const SETTER_FOR: Record<Archetype, readonly string[]> = {
  slab: ['melissa', 'house'],
  zigzag: ['chad', 'house'],
  traverse: ['kevin', 'melissa'],
  roof: ['dave', 'sadist'],
  overhang: ['dave', 'chad'],
  dihedral: ['melissa', 'house'],
  crack: ['melissa', 'sadist'],
  arete: ['melissa', 'chad'],
  compression: ['kevin', 'sadist'],
};

/** Most-to-least characteristic: the name comes from the first one present. */
const SIGNATURE: readonly Archetype[] = [
  'roof', 'compression', 'crack', 'arete', 'traverse', 'dihedral', 'overhang', 'zigzag', 'slab',
];

const CRUX_WORDS: Record<CruxKind, string> = {
  span: 'one long move sideways',
  reversal: 'a move back the way you came',
  drop: 'a move down before you can go up',
  lunge: 'a long move off bad holds',
  squeeze: 'three bad holds in a row',
};

export function describe(
  difficulty: Difficulty, plan: Plan, path: PathStep[], seed: number, r: Rand,
): { name: string; setter: string; tagline: string } {
  const sig = SIGNATURE.find((a) => plan.sections.includes(a)) ?? 'slab';
  const name = r.pick(NAMES[sig]) + (difficulty === 'easy' ? '' : r.pick(SUFFIX));
  const setter = difficulty === 'easy'
    ? 'house'
    : plan.cruxes.length >= 2 && r.chance(0.6) ? 'sadist' : r.pick(SETTER_FOR[sig]);
  void seed;

  const phrases = plan.items.map((item, i) => {
    const prev = plan.items[i - 1];
    if (item.kind === 'section' && prev?.kind === 'section' && prev.archetype === item.archetype) {
      return `another ${sectionPhrase(item.archetype, path).replace(/^an? (very )?(long )?/, '')}`;
    }
    if (item.kind === 'crux') {
      const where = item.final ? 'near the top' : 'halfway';
      return `${CRUX_WORDS[item.crux]} ${where}`;
    }
    return sectionPhrase(item.archetype, path);
  });
  let tagline: string;
  if (difficulty === 'easy') {
    tagline = plan.sections.includes('zigzag')
      ? 'Up, with a bit of left and right in it.'
      : r.pick(['Up. Mostly up.', 'Follow the jugs. Trust your feet.', 'The holds are where you think they are.']);
  } else {
    tagline = sentence(phrases);
  }
  return { name, setter, tagline };
}

function sectionPhrase(a: Archetype, path: PathStep[]): string {
  if (a === 'traverse') {
    const steps = path.filter((p) => p.tag === 'traverse');
    const dx = steps.reduce((s, p) => s + (p.to.x - p.from.x), 0);
    const long = Math.abs(dx) > 2.6 ? 'a very long ' : Math.abs(dx) > 1.2 ? 'a long ' : 'a ';
    return `${long}traverse ${dx >= 0 ? 'right' : 'left'}`;
  }
  return {
    slab: 'a slab',
    zigzag: 'a zigzag',
    roof: 'a roof',
    overhang: 'a steep wall',
    dihedral: 'a corner',
    crack: 'a crack',
    arete: 'an arête',
    compression: 'a squeeze',
  }[a];
}

function sentence(parts: string[]): string {
  if (parts.length === 0) return '';
  const s = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}`;
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}
