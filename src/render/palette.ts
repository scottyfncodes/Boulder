import type { Grade, HoldType } from '../game/types';

/** Route colours, the way a gym tapes grades. */
export const GRADE_COLOR: Record<Grade, string> = {
  V0: '#5fd1a0',
  V1: '#57b6e8',
  V2: '#f2c249',
  V3: '#f08a3c',
  V4: '#e8564f',
  V5: '#c05ce0',
  V6: '#8f6ce8',
  V7: '#3f7de0',
  V8: '#20c7c7',
  V9: '#e8e2d8',
};

export const GYM = {
  wall: '#dcd8cd',
  wallDark: '#c4bfb1',
  seam: '#b0a894',
  mat: '#3f4a63',
  matEdge: '#333c50',
  back: '#171a21',
  decor: '#8e8677',
  skin: '#e8b48c',
  shirt: '#e6e2da',
  shorts: '#4a5468',
} as const;

/** Rough visual weight per hold type, used to size the meshes. */
export const HOLD_DEPTH: Record<HoldType, number> = {
  jug: 0.1,
  crimp: 0.05,
  sloper: 0.12,
  pinch: 0.09,
  pocket: 0.07,
  sidepull: 0.09,
  undercling: 0.1,
  gaston: 0.09,
  foothold: 0.06,
  volume: 0.22,
};
