import type { Grade } from '../game/types';
import type { RouteStyle } from '../game/grading';
import type { TechniqueId } from '../game/technique';

/**
 * Route assessments — GENERATED, do not edit by hand.
 * Regenerate with \`npm run gen:grades\` after changing routes, the physics or the grader.
 *
 * What each curated route's moves add up to (\`src/game/grading.ts\`): the
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

const DATA: Record<string, Assessment> = {
  "warmup": {
    "grade": "V1",
    "score": 1.28,
    "crux": {
      "move": 9,
      "holdId": 16,
      "difficulty": 0.16
    },
    "sustained": 0.13,
    "rests": 15,
    "solutions": 3,
    "moves": 15,
    "styles": [
      "vertical",
      "dynamic"
    ],
    "techniques": [
      "highStep",
      "heelHook",
      "match"
    ]
  },
  "trust-feet": {
    "grade": "V2",
    "score": 1.93,
    "crux": {
      "move": 14,
      "holdId": 22,
      "difficulty": 0.15
    },
    "sustained": 0.06,
    "rests": 14,
    "solutions": 3,
    "moves": 14,
    "styles": [
      "vertical"
    ],
    "techniques": [
      "match",
      "highStep"
    ]
  },
  "just-reach": {
    "grade": "V2",
    "score": 1.92,
    "crux": {
      "move": 1,
      "holdId": 8,
      "difficulty": 0.2
    },
    "sustained": 0.11,
    "rests": 13,
    "solutions": 3,
    "moves": 14,
    "styles": [
      "vertical",
      "dynamic"
    ],
    "techniques": [
      "highStep",
      "match"
    ]
  },
  "accountant": {
    "grade": "V2",
    "score": 1.85,
    "crux": {
      "move": 6,
      "holdId": 5,
      "difficulty": 0.21
    },
    "sustained": 0.15,
    "rests": 13,
    "solutions": 3,
    "moves": 13,
    "styles": [
      "vertical",
      "crimpy"
    ],
    "techniques": [
      "highStep",
      "heelHook",
      "match"
    ]
  },
  "corporate-ladder": {
    "grade": "V1",
    "score": 1.48,
    "crux": {
      "move": 6,
      "holdId": 12,
      "difficulty": 0.23
    },
    "sustained": 0.13,
    "rests": 15,
    "solutions": 3,
    "moves": 15,
    "styles": [
      "vertical",
      "compression",
      "dynamic",
      "technical"
    ],
    "techniques": [
      "highStep",
      "pinch",
      "heelHook",
      "compression",
      "match"
    ]
  },
  "one-weird-foot": {
    "grade": "V2",
    "score": 1.97,
    "crux": {
      "move": 5,
      "holdId": 12,
      "difficulty": 0.19
    },
    "sustained": 0.12,
    "rests": 15,
    "solutions": 3,
    "moves": 15,
    "styles": [
      "vertical",
      "dynamic"
    ],
    "techniques": [
      "match",
      "highStep"
    ]
  },
  "lower-back-pain": {
    "grade": "V3",
    "score": 2.83,
    "crux": {
      "move": 1,
      "holdId": 8,
      "difficulty": 0.21
    },
    "sustained": 0.12,
    "rests": 11,
    "solutions": 3,
    "moves": 16,
    "styles": [
      "overhang",
      "technical"
    ],
    "techniques": [
      "sidepull",
      "dropKnee",
      "heelHook",
      "highStep",
      "match"
    ]
  },
  "definitely-not-beta": {
    "grade": "V2",
    "score": 2.03,
    "crux": {
      "move": 6,
      "holdId": 12,
      "difficulty": 0.28
    },
    "sustained": 0.16,
    "rests": 11,
    "solutions": 3,
    "moves": 13,
    "styles": [
      "vertical",
      "slopey",
      "dynamic"
    ],
    "techniques": [
      "dropKnee",
      "heelHook",
      "match"
    ]
  },
  "long-haul": {
    "grade": "V4",
    "score": 4.12,
    "crux": {
      "move": 14,
      "holdId": 24,
      "difficulty": 0.26
    },
    "sustained": 0.18,
    "rests": 21,
    "solutions": 3,
    "moves": 29,
    "styles": [
      "vertical",
      "technical",
      "endurance"
    ],
    "techniques": [
      "highStep",
      "heelHook",
      "dropKnee",
      "match"
    ]
  },
  "full-send": {
    "grade": "V3",
    "score": 3.41,
    "crux": {
      "move": 10,
      "holdId": 16,
      "difficulty": 0.24
    },
    "sustained": 0.17,
    "rests": 7,
    "solutions": 3,
    "moves": 16,
    "styles": [
      "overhang",
      "technical"
    ],
    "techniques": [
      "dropKnee",
      "pinch",
      "heelHook",
      "toeHook",
      "highStep",
      "match"
    ]
  },
  "absolutely-not": {
    "grade": "V2",
    "score": 2.4,
    "crux": {
      "move": 1,
      "holdId": 8,
      "difficulty": 0.27
    },
    "sustained": 0.14,
    "rests": 12,
    "solutions": 3,
    "moves": 14,
    "styles": [
      "overhang",
      "crimpy",
      "dynamic",
      "technical"
    ],
    "techniques": [
      "dropKnee",
      "heelHook",
      "sidepull",
      "match"
    ]
  },
  "leftovers": {
    "grade": "V6",
    "score": 5.71,
    "crux": {
      "move": 10,
      "holdId": 17,
      "difficulty": 0.27
    },
    "sustained": 0.24,
    "rests": 4,
    "solutions": 3,
    "moves": 14,
    "styles": [
      "roof",
      "technical"
    ],
    "techniques": [
      "dropKnee",
      "gaston",
      "pinch",
      "heelHook",
      "highStep",
      "sidepull",
      "toeHook",
      "match"
    ]
  },
  "warmup-for-who": {
    "grade": "V3",
    "score": 3.48,
    "crux": {
      "move": 2,
      "holdId": 8,
      "difficulty": 0.31
    },
    "sustained": 0.25,
    "rests": 12,
    "solutions": 3,
    "moves": 18,
    "styles": [
      "overhang",
      "crimpy",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "heelHook",
      "pinch",
      "dropKnee",
      "highStep",
      "match"
    ]
  },
  "hr-meeting": {
    "grade": "V7",
    "score": 6.83,
    "crux": {
      "move": 12,
      "holdId": 18,
      "difficulty": 0.39
    },
    "sustained": 0.26,
    "rests": 4,
    "solutions": 3,
    "moves": 16,
    "styles": [
      "roof",
      "technical"
    ],
    "techniques": [
      "heelHook",
      "dropKnee",
      "sidepull",
      "highStep",
      "gaston",
      "toeHook",
      "match"
    ]
  },
  "the-cave": {
    "grade": "V9",
    "score": 9.1,
    "crux": {
      "move": 9,
      "holdId": 20,
      "difficulty": 0.27
    },
    "sustained": 0.21,
    "rests": 12,
    "solutions": 3,
    "moves": 27,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "highStep",
      "heelHook",
      "dropKnee",
      "toeHook",
      "sidepull",
      "match"
    ]
  },
  "exit-interview": {
    "grade": "V10",
    "score": 9.75,
    "crux": {
      "move": 18,
      "holdId": 14,
      "difficulty": 0.72
    },
    "sustained": 0.48,
    "rests": 4,
    "solutions": 2,
    "moves": 24,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "heelHook",
      "pinch",
      "dropKnee",
      "sidepull",
      "highStep",
      "toeHook",
      "match"
    ]
  },
  "wide-load": {
    "grade": "V10",
    "score": 10.47,
    "crux": {
      "move": 14,
      "holdId": 22,
      "difficulty": 0.87
    },
    "sustained": 0.75,
    "rests": 0,
    "solutions": 3,
    "moves": 20,
    "styles": [
      "roof",
      "crimpy",
      "dynamic",
      "powerful",
      "technical",
      "endurance"
    ],
    "techniques": [
      "highStep",
      "pinch",
      "heelHook",
      "dropKnee",
      "gaston",
      "toeHook",
      "match"
    ]
  },
  "ceiling": {
    "grade": "V11",
    "score": 10.97,
    "crux": {
      "move": 11,
      "holdId": 16,
      "difficulty": 0.49
    },
    "sustained": 0.33,
    "rests": 7,
    "solutions": 3,
    "moves": 26,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "heelHook",
      "dropKnee",
      "toeHook",
      "pinch",
      "sidepull",
      "match"
    ]
  },
  "read-it-again": {
    "grade": "V11",
    "score": 11.13,
    "crux": {
      "move": 11,
      "holdId": 18,
      "difficulty": 0.56
    },
    "sustained": 0.48,
    "rests": 1,
    "solutions": 1,
    "moves": 21,
    "styles": [
      "roof",
      "crimpy",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "heelHook",
      "sidepull",
      "dropKnee",
      "highStep",
      "toeHook",
      "gaston",
      "match"
    ]
  },
  "grip-it": {
    "grade": "V9",
    "score": 8.55,
    "crux": {
      "move": 7,
      "holdId": 6,
      "difficulty": 0.72
    },
    "sustained": 0.43,
    "rests": 1,
    "solutions": 3,
    "moves": 17,
    "styles": [
      "roof",
      "crimpy",
      "technical"
    ],
    "techniques": [
      "highStep",
      "pinch",
      "heelHook",
      "dropKnee",
      "toeHook",
      "match"
    ]
  },
  "hostile-takeover": {
    "grade": "V11",
    "score": 10.98,
    "crux": {
      "move": 14,
      "holdId": 25,
      "difficulty": 0.6
    },
    "sustained": 0.43,
    "rests": 4,
    "solutions": 3,
    "moves": 30,
    "styles": [
      "roof",
      "crimpy",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "highStep",
      "heelHook",
      "toeHook",
      "sidepull",
      "match"
    ]
  },
  "quarterly-review": {
    "grade": "V11",
    "score": 11.11,
    "crux": {
      "move": 13,
      "holdId": 19,
      "difficulty": 0.52
    },
    "sustained": 0.45,
    "rests": 12,
    "solutions": 3,
    "moves": 50,
    "styles": [
      "roof",
      "slopey",
      "compression",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "sidepull",
      "compression",
      "highStep",
      "heelHook",
      "pinch",
      "toeHook",
      "match"
    ]
  },
  "scope-creep": {
    "grade": "V9",
    "score": 8.92,
    "crux": {
      "move": 6,
      "holdId": 16,
      "difficulty": 0.53
    },
    "sustained": 0.31,
    "rests": 10,
    "solutions": 3,
    "moves": 31,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "gaston",
      "highStep",
      "heelHook",
      "pinch",
      "toeHook",
      "sidepull",
      "match"
    ]
  },
  "golden-handcuffs": {
    "grade": "V10",
    "score": 9.92,
    "crux": {
      "move": 3,
      "holdId": 12,
      "difficulty": 0.36
    },
    "sustained": 0.3,
    "rests": 6,
    "solutions": 3,
    "moves": 41,
    "styles": [
      "roof",
      "crimpy",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "highStep",
      "heelHook",
      "pinch",
      "toeHook",
      "match"
    ]
  },
  "synergy": {
    "grade": "V10",
    "score": 9.8,
    "crux": {
      "move": 18,
      "holdId": 41,
      "difficulty": 0.41
    },
    "sustained": 0.31,
    "rests": 4,
    "solutions": 3,
    "moves": 32,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "pinch",
      "heelHook",
      "highStep",
      "toeHook",
      "sidepull",
      "match"
    ]
  },
  "restructuring": {
    "grade": "V12",
    "score": 12.25,
    "crux": {
      "move": 15,
      "holdId": 23,
      "difficulty": 0.55
    },
    "sustained": 0.45,
    "rests": 2,
    "solutions": 3,
    "moves": 44,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "match",
      "heelHook",
      "highStep",
      "pinch",
      "toeHook"
    ]
  },
  "out-of-office": {
    "grade": "V12",
    "score": 11.69,
    "crux": {
      "move": 14,
      "holdId": 24,
      "difficulty": 0.46
    },
    "sustained": 0.32,
    "rests": 4,
    "solutions": 3,
    "moves": 41,
    "styles": [
      "overhang",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "heelHook",
      "dropKnee",
      "pinch",
      "toeHook",
      "sidepull",
      "highStep",
      "match"
    ]
  },
  "the-long-game": {
    "grade": "V9",
    "score": 9.47,
    "crux": {
      "move": 6,
      "holdId": 11,
      "difficulty": 0.57
    },
    "sustained": 0.38,
    "rests": 15,
    "solutions": 3,
    "moves": 51,
    "styles": [
      "roof",
      "compression",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "highStep",
      "sidepull",
      "toeHook",
      "pinch",
      "compression",
      "heelHook",
      "gaston",
      "match"
    ]
  },
  "reply-all": {
    "grade": "V10",
    "score": 9.87,
    "crux": {
      "move": 21,
      "holdId": 18,
      "difficulty": 0.41
    },
    "sustained": 0.34,
    "rests": 18,
    "solutions": 3,
    "moves": 50,
    "styles": [
      "roof",
      "compression",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "highStep",
      "heelHook",
      "pinch",
      "dropKnee",
      "compression",
      "sidepull",
      "match",
      "toeHook"
    ]
  },
  "business-class": {
    "grade": "V15",
    "score": 14.87,
    "crux": {
      "move": 30,
      "holdId": 18,
      "difficulty": 0.74
    },
    "sustained": 0.58,
    "rests": 3,
    "solutions": 3,
    "moves": 82,
    "styles": [
      "roof",
      "slopey",
      "compression",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "sidepull",
      "compression",
      "highStep",
      "heelHook",
      "toeHook",
      "match"
    ]
  },
  "hard-pivot": {
    "grade": "V11",
    "score": 11.23,
    "crux": {
      "move": 44,
      "holdId": 47,
      "difficulty": 0.49
    },
    "sustained": 0.4,
    "rests": 19,
    "solutions": 1,
    "moves": 56,
    "styles": [
      "roof",
      "crimpy",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "match",
      "sidepull",
      "highStep",
      "heelHook",
      "gaston",
      "pinch",
      "toeHook"
    ]
  },
  "burnout": {
    "grade": "V14",
    "score": 13.95,
    "crux": {
      "move": 26,
      "holdId": 21,
      "difficulty": 0.57
    },
    "sustained": 0.41,
    "rests": 4,
    "solutions": 3,
    "moves": 55,
    "styles": [
      "overhang",
      "slopey",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "match",
      "sidepull",
      "highStep",
      "heelHook",
      "pinch",
      "toeHook"
    ]
  },
  "unpaid-overtime": {
    "grade": "V10",
    "score": 10.22,
    "crux": {
      "move": 24,
      "holdId": 44,
      "difficulty": 0.52
    },
    "sustained": 0.35,
    "rests": 7,
    "solutions": 3,
    "moves": 36,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "heelHook",
      "highStep",
      "sidepull",
      "toeHook",
      "pinch",
      "match"
    ]
  },
  "bruh": {
    "grade": "V11",
    "score": 11.07,
    "crux": {
      "move": 39,
      "holdId": 44,
      "difficulty": 0.49
    },
    "sustained": 0.31,
    "rests": 56,
    "solutions": 3,
    "moves": 101,
    "styles": [
      "roof",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "highStep",
      "dropKnee",
      "match",
      "heelHook",
      "pinch",
      "sidepull",
      "toeHook"
    ]
  },
  "hb-lighthouse": {
    "grade": "V4",
    "score": 4.02,
    "crux": {
      "move": 13,
      "holdId": 22,
      "difficulty": 0.24
    },
    "sustained": 0.17,
    "rests": 38,
    "solutions": 3,
    "moves": 39,
    "styles": [
      "slab",
      "crimpy",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "sidepull",
      "heelHook",
      "highStep",
      "pinch",
      "match"
    ]
  },
  "hb-second-thoughts": {
    "grade": "V3",
    "score": 3.45,
    "crux": {
      "move": 20,
      "holdId": 26,
      "difficulty": 0.25
    },
    "sustained": 0.2,
    "rests": 25,
    "solutions": 3,
    "moves": 26,
    "styles": [
      "vertical",
      "compression",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "match",
      "heelHook",
      "highStep",
      "gaston",
      "sidepull",
      "pinch",
      "compression"
    ]
  },
  "hb-long-meeting": {
    "grade": "V5",
    "score": 5.18,
    "crux": {
      "move": 4,
      "holdId": 2,
      "difficulty": 0.47
    },
    "sustained": 0.24,
    "rests": 41,
    "solutions": 3,
    "moves": 46,
    "styles": [
      "vertical",
      "compression",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "sidepull",
      "dropKnee",
      "heelHook",
      "pinch",
      "highStep",
      "compression",
      "match"
    ]
  },
  "hb-vertigo": {
    "grade": "V7",
    "score": 6.8,
    "crux": {
      "move": 37,
      "holdId": 56,
      "difficulty": 0.35
    },
    "sustained": 0.3,
    "rests": 26,
    "solutions": 3,
    "moves": 43,
    "styles": [
      "overhang",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "heelHook",
      "pinch",
      "dropKnee",
      "sidepull",
      "highStep",
      "match"
    ]
  },
  "hb-summit-fever": {
    "grade": "V7",
    "score": 6.96,
    "crux": {
      "move": 36,
      "holdId": 52,
      "difficulty": 0.42
    },
    "sustained": 0.32,
    "rests": 15,
    "solutions": 3,
    "moves": 47,
    "styles": [
      "overhang",
      "compression",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "pinch",
      "highStep",
      "sidepull",
      "heelHook",
      "compression",
      "match"
    ]
  },
  "hb-point-of-no-return": {
    "grade": "V9",
    "score": 9.03,
    "crux": {
      "move": 10,
      "holdId": 22,
      "difficulty": 0.37
    },
    "sustained": 0.28,
    "rests": 14,
    "solutions": 3,
    "moves": 38,
    "styles": [
      "overhang",
      "dynamic",
      "technical",
      "endurance"
    ],
    "techniques": [
      "dropKnee",
      "sidepull",
      "pinch",
      "heelHook",
      "toeHook",
      "highStep",
      "match"
    ]
  }
};

export function assessmentOf(routeId: string): Assessment | undefined {
  return DATA[routeId];
}
