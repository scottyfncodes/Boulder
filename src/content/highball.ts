import type { Route } from '../game/types';
import { buildRoute } from './generator/build';
import { TIERS, type TierParams } from './generator/difficulty';
import { TOWER } from './wall';

/**
 * Highballs.
 *
 * Tall boulder problems on the Tower: the same climbing as the cave — the
 * same body, the same holds, the same physics — on twice the wall, with the
 * top two storeys up. Nothing about the climber changes at height. What
 * changes is that a mistake near the top is a long way to fall, the landing
 * is only as good as the pads under it, and a highball has more than one
 * hard part and very few places to stop and think.
 *
 * Each one is set by the same section builders the route setter uses, from
 * its own rules, then frozen to a seed the solver has proven goes. Their
 * personalities are in the rules: a technical slab, a crux at the very top, a
 * roof low down and a headwall above it, a long pump with nowhere to rest.
 */

export type Landing = {
  /** Highball pads stacked under the line, 1..3. More is softer, never soft. */
  pads: number;
  /** How far either side of the line's centre the pads reach, metres. */
  halfWidth: number;
  /** Where the pads are centred, metres along the wall. */
  centre: number;
  /** A spotter is standing by to steer a fall onto the pads. */
  spotter: boolean;
};

export type Highball = Route & {
  highball: {
    landing: Landing;
    /** One line on what this problem is about. */
    character: string;
    /** Height of the top-out, metres. */
    height: number;
    /** The rules it was set from, in `HIGHBALL_TIERS`. */
    tier: string;
  };
};

/** Shorthand: a tier from a board tier, with the overrides a highball needs. */
function tall(base: keyof typeof TIERS, o: Partial<TierParams>): TierParams {
  return { ...TIERS[base], ...o };
}

/** The rules each highball was set from. */
export const HIGHBALL_TIERS: Record<string, TierParams> = {
  // Balance and feet, on a wall leaning away from you. The top is a long way
  // up a slab, which is its own kind of scary.
  lighthouse: tall('moderate', {
    top: 8.2,
    grades: ['V2', 'V3'],
    sections: [3, 3],
    pool: [['slab', 5], ['zigzag', 2], ['dihedral', 2], ['arete', 1]],
    require: [['slab'], ['dihedral', 'arete', 'zigzag']],
    forbid: ['roof', 'overhang', 'traverse', 'compression', 'crack'],
    cruxes: [1, 1], cruxChance: 1, cruxKinds: [['squeeze', 2], ['lunge', 1]], cruxAt: [0.8, 0.9],
    handPalette: [['jug', 4], ['pocket', 2], ['crimp', 2], ['sloper', 1]],
    overhang: [-10, -6],
    footDensity: 1,
  }),
  // Steady climbing to a crux right at the top, where you least want one.
  secondThoughts: tall('hard', {
    top: 8.5,
    grades: ['V3', 'V4'],
    sections: [3, 3],
    pool: [['zigzag', 3], ['arete', 2], ['crack', 2], ['dihedral', 2], ['slab', 1]],
    require: [['zigzag', 'arete'], ['crack', 'dihedral']],
    forbid: ['roof', 'traverse'],
    cruxes: [1, 1], cruxChance: 1, cruxKinds: [['lunge', 2], ['span', 1]], cruxAt: [0.9, 0.96],
    overhang: [0, 5],
  }),
  // Steep and powerful low, a rest on the vertical middle, small holds high.
  vertigo: tall('hard', {
    top: 8.6,
    grades: ['V4', 'V5'],
    sections: [3, 3],
    pool: [['overhang', 3], ['zigzag', 3], ['crack', 2], ['arete', 2]],
    require: [['overhang'], ['zigzag'], ['crack', 'arete']],
    forbid: ['traverse', 'roof', 'slab'],
    cruxes: [1, 1], cruxChance: 1, cruxKinds: [['lunge', 2], ['squeeze', 2], ['reversal', 1]], cruxAt: [0.85, 0.94],
    handPalette: [['jug', 3], ['crimp', 2], ['pinch', 2], ['pocket', 2], ['sidepull', 1]],
    overhang: [2, 8],
  }),
  // A long pump. No jugs after the start, nowhere obvious to shake out.
  longMeeting: tall('veryHard', {
    top: 8.9,
    grades: ['V5', 'V6'],
    sections: [4, 4],
    pool: [['zigzag', 3], ['compression', 2], ['crack', 2], ['overhang', 2], ['arete', 1], ['traverse', 1]],
    require: [['compression'], ['zigzag'], ['overhang', 'crack']],
    forbid: ['roof', 'slab'],
    cruxes: [1, 1], cruxChance: 1, cruxKinds: [['squeeze', 2], ['span', 1]], cruxAt: [0.7, 0.85],
    handPalette: [['pinch', 4], ['sidepull', 3], ['crimp', 2], ['gaston', 2], ['sloper', 1]],
    overhang: [8, 14],
  }),
  // A roof halfway up, then a tall headwall with the whole of the tower under you.
  pointOfNoReturn: tall('hard', {
    top: 8.8,
    grades: ['V6', 'V7'],
    sections: [4, 4],
    pool: [['roof', 3], ['zigzag', 3], ['overhang', 2], ['crack', 2], ['arete', 1]],
    require: [['roof'], ['zigzag'], ['crack', 'arete', 'overhang']],
    forbid: ['slab', 'traverse'],
    cruxes: [2, 2], cruxChance: 1, cruxKinds: [['lunge', 2], ['reversal', 2], ['squeeze', 1]], cruxAt: [0.8, 0.92],
    handPalette: [['jug', 3], ['crimp', 2], ['pinch', 2], ['sidepull', 2], ['pocket', 1], ['gaston', 1]],
    overhang: [4, 10],
  }),
  // Steep, compression and big moves, three hard sections. The tower's test piece.
  summitFever: tall('veryHard', {
    top: 9.1,
    grades: ['V7', 'V8'],
    sections: [4, 4],
    pool: [['compression', 3], ['overhang', 3], ['zigzag', 2], ['crack', 2], ['roof', 1]],
    require: [['compression'], ['overhang'], ['zigzag', 'crack']],
    forbid: ['slab', 'traverse'],
    cruxes: [2, 2], cruxChance: 1, cruxKinds: [['lunge', 3], ['squeeze', 2], ['span', 1], ['reversal', 1]], cruxAt: [0.86, 0.95],
    handPalette: [['pinch', 3], ['jug', 2], ['sloper', 2], ['crimp', 2], ['sidepull', 2], ['gaston', 1]],
    overhang: [10, 16],
  }),
};

type Entry = {
  id: string;
  tier: keyof typeof HIGHBALL_TIERS;
  seed: number;
  relax: number;
  name: string;
  setter: string;
  tagline: string;
  character: string;
  landing: Omit<Landing, 'centre'>;
  par: number;
  /** The assessed grade (`routeGrades`): what its moves add up to. */
  grade: Route['grade'];
};

/**
 * The curated set: seeds found by `npm run find:highballs`, each proven to go
 * by the solver at test time (`highball.test.ts`), graded by the assessment.
 */
const ENTRIES: Entry[] = [
  {
    id: 'hb-lighthouse', tier: 'lighthouse', seed: 3945626072, relax: 0, par: 40, grade: 'V4',
    name: 'The Lighthouse Keeper', setter: 'melissa',
    tagline: 'Eight and a half metres of slab. Your feet are the only plan.',
    character: 'Technical slab: balance, smears and small feet, all the way up.',
    landing: { pads: 2, halfWidth: 0, spotter: true },
  },
  {
    id: 'hb-second-thoughts', tier: 'secondThoughts', seed: 335382521, relax: 0, par: 49, grade: 'V4',
    name: 'Second Thoughts', setter: 'dave',
    tagline: 'Steady to the top. Then it is not.',
    character: 'Vertical and steady, with the one hard move right at the top.',
    landing: { pads: 2, halfWidth: 0, spotter: false },
  },
  {
    id: 'hb-long-meeting', tier: 'longMeeting', seed: 1953981390, relax: 0, par: 47, grade: 'V6',
    name: 'This Meeting Could Have Been An Email', setter: 'kevin',
    tagline: 'No jugs after the start. Pace it or pump out at seven metres.',
    character: 'Endurance: sustained pinches and sidepulls, no real rest.',
    landing: { pads: 3, halfWidth: 0, spotter: false },
  },
  {
    id: 'hb-vertigo', tier: 'vertigo', seed: 1181037445, relax: 0, par: 42, grade: 'V7',
    name: 'Vertigo Procedure', setter: 'chad',
    tagline: 'Steep and strong low, small and scary high.',
    character: 'Power low on the overhang, a breather, then a crimpy headwall.',
    landing: { pads: 3, halfWidth: 0, spotter: true },
  },
  {
    id: 'hb-summit-fever', tier: 'summitFever', seed: 272210585, relax: 0, par: 48, grade: 'V7',
    name: 'Summit Fever', setter: 'sadist',
    tagline: 'Squeeze everything. Twice.',
    character: 'Compression on steep ground, with two separate cruxes.',
    landing: { pads: 3, halfWidth: 0, spotter: true },
  },
  {
    id: 'hb-point-of-no-return', tier: 'pointOfNoReturn', seed: 1969754688, relax: 0, par: 40, grade: 'V10',
    name: 'Point Of No Return', setter: 'sadist',
    tagline: 'A roof at four metres. Above it, the whole tower.',
    character: 'Roof halfway up, then a committing headwall with two hard moves.',
    landing: { pads: 3, halfWidth: 0, spotter: true },
  },
];

const cache = new Map<string, Highball>();

/** Builds a highball from its tier and seed. Pure geometry, cheap. */
export function buildHighball(e: Entry): Highball {
  const hit = cache.get(e.id);
  if (hit) return hit;
  const t = HIGHBALL_TIERS[e.tier];
  const b = buildRoute(t.difficulty, e.seed, { relax: e.relax, tier: t });
  const route = b.route;
  const xs = route.holds.map((h) => h.pos.x);
  const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  // The pads cover the line, and a little either side of it.
  const halfWidth = e.landing.halfWidth || (Math.max(...xs) - Math.min(...xs)) / 2 + 0.35;
  const top = Math.max(...route.holds.filter((h) => route.finish.includes(h.id)).map((h) => h.pos.y));
  const hb: Highball = {
    ...route,
    id: e.id,
    name: e.name,
    setter: e.setter,
    tagline: e.tagline,
    wall: TOWER.id,
    par: e.par,
    grade: e.grade,
    seed: e.seed,
    highball: {
      landing: { ...e.landing, centre, halfWidth },
      character: e.character,
      height: Math.round(top * 10) / 10,
      tier: e.tier,
    },
  };
  // Not a board-setter route: it is curated, and it counts.
  delete hb.blueprint;
  cache.set(e.id, hb);
  return hb;
}

export function highballs(): Highball[] {
  return ENTRIES.map(buildHighball);
}

export function isHighball(r: Route): r is Highball {
  return 'highball' in r;
}

export type { Entry as HighballEntry };

/**
 * The landing. A fall is judged on where it ends and how far it went:
 * inside the pads from a height the pads are good for is a landing; off the
 * pads, or from higher than they were stacked for, is a heavy one. Nothing
 * here hurts the climber — it decides what the game says, and whether you
 * are asked to take a breath before going again.
 */
export function judgeLanding(l: Landing, fallFrom: number, x: number): { kind: 'clean' | 'heavy' | 'off-pads'; words: string } {
  const onPads = Math.abs(x - l.centre) <= l.halfWidth + (l.spotter ? 0.35 : 0);
  // Each stacked pad is good for about another metre and a bit.
  const goodFor = 2.4 + 1.3 * l.pads;
  if (!onPads) return { kind: 'off-pads', words: 'Off the pads. Shaken, not hurt. Move the pads, take a breath.' };
  if (fallFrom > goodFor) {
    return { kind: 'heavy', words: `${fallFrom.toFixed(1)} m onto ${l.pads} pad${l.pads > 1 ? 's' : ''}. A heavy landing. Take a breath before the next go.` };
  }
  return { kind: 'clean', words: `${fallFrom.toFixed(1)} m, onto the pads. Fine. Go again.` };
}
