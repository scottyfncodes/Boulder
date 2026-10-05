import type { Grade, HoldType } from '../../game/types';

/**
 * Difficulty, as a setter thinks about it.
 *
 * A harder route is not the same ladder tipped back further. It is a route
 * with more going on: more sections, more of them sideways, more changes of
 * mind, a crux that arrives when you thought it was over. Every number here is
 * about the *shape* of the route first and the holds second; pitch is the last
 * and smallest lever, and it only moves much when the route has a roof or a
 * steep section that earns it.
 */

export type Difficulty = 'easy' | 'moderate' | 'hard' | 'veryHard' | 'brutal' | 'elite' | 'mythic';

export const DIFFICULTIES: readonly Difficulty[] = [
  'easy', 'moderate', 'hard', 'veryHard', 'brutal', 'elite', 'mythic',
] as const;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  veryHard: 'Very Hard',
  brutal: 'Brutal',
  elite: 'Elite',
  mythic: 'Mythic',
};

/**
 * Movement identities a section of route can have. These are generation
 * templates, not labels the player is shown — the player sees the holds and
 * works out what the route wants.
 */
export type Archetype =
  | 'slab'
  | 'zigzag'
  | 'traverse'
  | 'roof'
  | 'overhang'
  | 'dihedral'
  | 'crack'
  | 'arete'
  | 'compression';

/** Archetypes whose job is to gain height. The rest move you somewhere else. */
export const RISING: ReadonlySet<Archetype> = new Set<Archetype>([
  'slab', 'zigzag', 'overhang', 'dihedral', 'crack', 'arete', 'compression',
]);

/** Archetypes whose job is to move you sideways. */
export const LATERAL: ReadonlySet<Archetype> = new Set<Archetype>(['traverse', 'roof']);

export type CruxKind =
  /** One big committing move sideways off small holds. */
  | 'span'
  /** The line doubles back on itself — the obvious next hold is the wrong way. */
  | 'reversal'
  /** Down and across before you are allowed to go up again. */
  | 'drop'
  /** A long move straight up between poor holds. */
  | 'lunge'
  /** Two or three bad holds in a row with almost nothing for the feet. */
  | 'squeeze';

export type Weighted<T> = readonly (readonly [T, number])[];

export type TierParams = {
  difficulty: Difficulty;
  /** Grades this tier is published at, easiest first. */
  grades: readonly Grade[];
  /**
   * Height the line tops out at, metres; the finish jug goes just above it.
   * Harder routes go further up the cave: more wall, more moves, more pump
   * before the jug.
   */
  top: number;
  /** How many sections the route is built from. */
  sections: readonly [min: number, max: number];
  /** Which archetypes the tier draws from, and how often. */
  pool: Weighted<Archetype>;
  /**
   * Combinations the plan must contain. Each inner list is "at least one of",
   * so `[['traverse'], ['roof', 'overhang']]` means a traverse and something
   * steep. This is what makes harder routes combine ideas rather than just
   * pick a harder single one.
   */
  require: readonly (readonly Archetype[])[];
  /** Archetypes the tier never uses. */
  forbid: readonly Archetype[];
  /** Sideways component of a zigzag step, metres. */
  zigLateral: readonly [number, number];
  /** Steps in one leg of a zigzag before it changes its mind. */
  zigLeg: readonly [number, number];
  /** Length of a traverse, metres of wall. */
  traverseLength: readonly [number, number];
  /** Longest run of purely sideways moves before the route must go up. */
  maxConsecutiveLateral: number;
  /** Small sideways wander added to rising sections, metres per step. */
  drift: number;
  /** Probability a rising section bends to a new heading halfway through. */
  bendChance: number;
  /** How many cruxes, and how likely each one is. */
  cruxes: readonly [min: number, max: number];
  cruxChance: number;
  cruxKinds: Weighted<CruxKind>;
  /** Fraction of the route at which the (last) crux sits. */
  cruxAt: readonly [number, number];
  /** Hand holds, by shape, for ordinary sections. */
  handPalette: Weighted<HoldType>;
  /** Per-hold difficulty nudge range for ordinary holds. */
  hard: readonly [number, number];
  /** Fraction of steps that get a foothold of their own. */
  footDensity: number;
  /** Base wall angle, degrees; roofs and steep sections add to it. */
  overhang: readonly [number, number];
  /** Degrees added per roof or steep section. */
  steepBonus: number;
  /** Shape thresholds the validator holds the route to. See `shape.ts`. */
  shape: {
    minLateralTravel: number;
    maxLateralExtent: number;
    minDirectionChanges: number;
    maxDirectionChanges: number;
  };
};

export const TIERS: Record<Difficulty, TierParams> = {
  easy: {
    difficulty: 'easy',
    top: 3.66,
    grades: ['V0', 'V1'],
    sections: [1, 2],
    pool: [['slab', 5], ['zigzag', 2], ['dihedral', 1]],
    require: [],
    forbid: ['traverse', 'roof', 'overhang', 'crack', 'arete', 'compression'],
    zigLateral: [0.07, 0.11],
    zigLeg: [3, 4],
    traverseLength: [0, 0],
    maxConsecutiveLateral: 0,
    drift: 0.05,
    bendChance: 0.35,
    cruxes: [0, 0],
    cruxChance: 0,
    cruxKinds: [['lunge', 1]],
    cruxAt: [0.8, 0.9],
    handPalette: [['jug', 9], ['pocket', 1]],
    hard: [1, 1],
    footDensity: 1,
    overhang: [0, 4],
    steepBonus: 0,
    shape: { minLateralTravel: 0.2, maxLateralExtent: 0.95, minDirectionChanges: 0, maxDirectionChanges: 4 },
  },
  moderate: {
    difficulty: 'moderate',
    top: 3.9,
    grades: ['V2', 'V3'],
    sections: [2, 2],
    pool: [['zigzag', 4], ['slab', 2], ['traverse', 2], ['dihedral', 2], ['arete', 1]],
    require: [['zigzag', 'traverse', 'arete']],
    forbid: ['roof', 'overhang', 'compression'],
    zigLateral: [0.11, 0.16],
    zigLeg: [2, 3],
    traverseLength: [0.55, 0.9],
    maxConsecutiveLateral: 3,
    drift: 0.07,
    bendChance: 0.4,
    cruxes: [0, 1],
    cruxChance: 0.35,
    cruxKinds: [['lunge', 2], ['span', 1]],
    cruxAt: [0.7, 0.85],
    handPalette: [['jug', 5], ['crimp', 3], ['pocket', 2], ['pinch', 1], ['sidepull', 1]],
    hard: [1, 1],
    footDensity: 1,
    overhang: [2, 10],
    steepBonus: 0,
    shape: { minLateralTravel: 0.6, maxLateralExtent: 1.7, minDirectionChanges: 1, maxDirectionChanges: 8 },
  },
  hard: {
    difficulty: 'hard',
    top: 4.3,
    grades: ['V4', 'V5'],
    sections: [2, 3],
    pool: [
      ['traverse', 4], ['zigzag', 3], ['roof', 2], ['overhang', 2],
      ['dihedral', 2], ['crack', 1], ['arete', 1], ['compression', 1], ['slab', 1],
    ],
    require: [['traverse', 'roof'], ['zigzag', 'overhang', 'dihedral', 'crack', 'arete', 'compression', 'slab']],
    forbid: [],
    zigLateral: [0.15, 0.2],
    zigLeg: [2, 3],
    traverseLength: [0.8, 1.3],
    maxConsecutiveLateral: 5,
    drift: 0.08,
    bendChance: 0.5,
    cruxes: [1, 1],
    cruxChance: 1,
    cruxKinds: [['span', 3], ['reversal', 2], ['lunge', 2], ['drop', 1], ['squeeze', 1]],
    cruxAt: [0.6, 0.9],
    handPalette: [
      ['jug', 3], ['crimp', 3], ['pinch', 2], ['sloper', 1], ['sidepull', 2], ['pocket', 2], ['gaston', 1],
    ],
    hard: [1, 1.1],
    footDensity: 0.9,
    overhang: [6, 14],
    steepBonus: 4,
    shape: { minLateralTravel: 1.2, maxLateralExtent: 2.8, minDirectionChanges: 2, maxDirectionChanges: 12 },
  },
  veryHard: {
    difficulty: 'veryHard',
    top: 4.8,
    grades: ['V6', 'V7'],
    sections: [3, 3],
    pool: [
      ['traverse', 4], ['zigzag', 3], ['roof', 3], ['overhang', 2],
      ['dihedral', 1], ['crack', 2], ['arete', 1], ['compression', 2], ['slab', 1],
    ],
    require: [['traverse'], ['roof', 'overhang'], ['zigzag', 'slab', 'crack', 'dihedral', 'arete', 'compression']],
    forbid: [],
    zigLateral: [0.17, 0.22],
    zigLeg: [2, 3],
    traverseLength: [1.1, 1.8],
    maxConsecutiveLateral: 7,
    drift: 0.09,
    bendChance: 0.6,
    cruxes: [1, 2],
    cruxChance: 0.6,
    cruxKinds: [['span', 3], ['reversal', 3], ['drop', 2], ['lunge', 2], ['squeeze', 2]],
    cruxAt: [0.7, 0.92],
    handPalette: [
      ['jug', 1], ['crimp', 3], ['pinch', 2], ['sloper', 2], ['sidepull', 2],
      ['gaston', 2], ['pocket', 2], ['undercling', 1],
    ],
    hard: [1.05, 1.15],
    footDensity: 0.8,
    overhang: [10, 18],
    steepBonus: 4,
    shape: { minLateralTravel: 1.9, maxLateralExtent: 3.0, minDirectionChanges: 3, maxDirectionChanges: 16 },
  },
  brutal: {
    difficulty: 'brutal',
    top: 5.3,
    grades: ['V8', 'V9', 'V10'],
    sections: [4, 4],
    pool: [
      ['traverse', 4], ['zigzag', 3], ['roof', 3], ['overhang', 2],
      ['crack', 2], ['dihedral', 1], ['arete', 1], ['compression', 2], ['slab', 1],
    ],
    require: [['traverse'], ['roof', 'overhang'], ['zigzag'], ['crack', 'compression', 'arete', 'dihedral', 'slab', 'roof']],
    forbid: [],
    zigLateral: [0.19, 0.24],
    zigLeg: [2, 2],
    traverseLength: [1.2, 2.0],
    maxConsecutiveLateral: 8,
    drift: 0.1,
    bendChance: 0.7,
    cruxes: [2, 2],
    cruxChance: 1,
    cruxKinds: [['span', 3], ['reversal', 3], ['drop', 3], ['lunge', 2], ['squeeze', 2]],
    cruxAt: [0.82, 0.95],
    handPalette: [
      ['jug', 1], ['crimp', 3], ['pinch', 2], ['sloper', 3], ['sidepull', 2],
      ['gaston', 2], ['pocket', 2], ['undercling', 1],
    ],
    hard: [1.1, 1.2],
    footDensity: 0.7,
    overhang: [14, 22],
    steepBonus: 4,
    shape: { minLateralTravel: 2.6, maxLateralExtent: 3.0, minDirectionChanges: 4, maxDirectionChanges: 22 },
  },
  /**
   * Past V10 the routes stop being boulder problems you can see the whole of
   * from the mat. They go a long way up the cave, and the crux is the third
   * hard thing on them.
   */
  elite: {
    difficulty: 'elite',
    top: 6.0,
    grades: ['V11', 'V12', 'V13'],
    sections: [5, 5],
    pool: [
      ['traverse', 3], ['zigzag', 3], ['roof', 3], ['overhang', 3],
      ['crack', 2], ['dihedral', 1], ['arete', 1], ['compression', 2], ['slab', 1],
    ],
    require: [['traverse'], ['roof'], ['zigzag'], ['overhang', 'crack', 'compression', 'arete', 'dihedral', 'slab']],
    forbid: [],
    zigLateral: [0.19, 0.24],
    zigLeg: [2, 2],
    traverseLength: [1.2, 2.0],
    maxConsecutiveLateral: 8,
    drift: 0.1,
    bendChance: 0.75,
    cruxes: [2, 3],
    cruxChance: 0.6,
    cruxKinds: [['span', 3], ['reversal', 3], ['drop', 3], ['lunge', 3], ['squeeze', 2]],
    cruxAt: [0.84, 0.95],
    handPalette: [
      ['jug', 1], ['crimp', 3], ['pinch', 3], ['sloper', 3], ['sidepull', 2],
      ['gaston', 2], ['pocket', 2], ['undercling', 1],
    ],
    hard: [1.12, 1.22],
    footDensity: 0.65,
    overhang: [16, 24],
    steepBonus: 4,
    shape: { minLateralTravel: 2.8, maxLateralExtent: 3.0, minDirectionChanges: 5, maxDirectionChanges: 28 },
  },
  mythic: {
    difficulty: 'mythic',
    top: 6.8,
    grades: ['V14', 'V15', 'V16', 'V17'],
    sections: [5, 6],
    pool: [
      ['traverse', 3], ['zigzag', 3], ['roof', 4], ['overhang', 3],
      ['crack', 2], ['dihedral', 1], ['arete', 1], ['compression', 2], ['slab', 1],
    ],
    require: [['traverse'], ['roof'], ['zigzag'], ['overhang', 'crack', 'compression', 'arete']],
    forbid: [],
    zigLateral: [0.19, 0.24],
    zigLeg: [2, 2],
    traverseLength: [1.2, 2.0],
    maxConsecutiveLateral: 8,
    drift: 0.1,
    bendChance: 0.8,
    cruxes: [3, 3],
    cruxChance: 1,
    cruxKinds: [['span', 3], ['reversal', 3], ['drop', 3], ['lunge', 3], ['squeeze', 2]],
    cruxAt: [0.86, 0.96],
    handPalette: [
      ['crimp', 3], ['pinch', 3], ['sloper', 3], ['sidepull', 2],
      ['gaston', 2], ['pocket', 2], ['undercling', 1], ['jug', 1],
    ],
    hard: [1.15, 1.25],
    footDensity: 0.6,
    overhang: [18, 26],
    steepBonus: 4,
    shape: { minLateralTravel: 2.8, maxLateralExtent: 3.0, minDirectionChanges: 6, maxDirectionChanges: 34 },
  },
};

/** Which difficulty a stored generated route was set at. */
export function isDifficulty(s: string): s is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(s);
}
