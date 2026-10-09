import type { Grade, Hold, HoldType } from './types';
import { GRADES } from './types';
import { Rand } from '../content/generator/rand';

/**
 * The tread wall.
 *
 * A treadwall is a wall on a belt: it rolls down as you climb up, so you stay
 * at the same height and the climbing never ends. Here the wall's holds are
 * fixed in its own coordinates and the ground rises at the belt's speed,
 * which is the same thing — the sim does not know the difference, the camera
 * draws it the way it looks, and every move is the same move it is on the
 * boulders. What the belt changes is time: you cannot stop. Hang on one hold
 * and the floor comes up to meet you; climb fast to earn a rest, rest only
 * where your body can actually recover, and keep going.
 *
 * The holds come from a stream of short sections, each with its own job —
 * a ladder of jugs to recover on, a line of crimps, a column of pinches, a
 * sloper staircase, gaston zig-zags, a reachy power section — and the stream
 * gets harder gradually: not every section harder than the last, but harder
 * on average, with a recovery section every few, and an easier one sooner if
 * the climber is on the edge.
 */

export type TreadProgram = {
  id: string;
  name: string;
  blurb: string;
  /** The panel's lean, degrees past vertical. */
  angle: number;
  /** Belt speed at the start, m/s. */
  speed0: number;
  /** Belt speed after `rampSeconds`, m/s, and from then on. */
  speed1: number;
  rampSeconds: number;
  /** Difficulty level the stream starts at, 0..10, and the most it ever gets to. */
  level0: number;
  levelMax: number;
  /** Seconds of climbing per difficulty level, on average. */
  levelSeconds: number;
};

export const TREAD_PROGRAMS: readonly TreadProgram[] = [
  {
    id: 'warmup', name: 'Warm-up', blurb: 'Five degrees, a gentle belt, jugs to find a rhythm on.',
    angle: 5, speed0: 0.03, speed1: 0.055, rampSeconds: 360, level0: 0, levelMax: 6, levelSeconds: 55,
  },
  {
    id: 'classic', name: 'Classic', blurb: 'Fifteen degrees. Where the leaderboard lives.',
    angle: 15, speed0: 0.035, speed1: 0.065, rampSeconds: 300, level0: 1, levelMax: 8, levelSeconds: 45,
  },
  {
    id: 'steep', name: 'Steep', blurb: 'Thirty degrees. Feet matter, and so does pace.',
    angle: 30, speed0: 0.035, speed1: 0.06, rampSeconds: 300, level0: 2, levelMax: 10, levelSeconds: 40,
  },
];

export function programById(id: string): TreadProgram {
  return TREAD_PROGRAMS.find((p) => p.id === id) ?? TREAD_PROGRAMS[1];
}

/** How tall the panel is: holds appear at its top and vanish at its bottom. */
export const PANEL = 4.6;
/** Holds are set this far over the top of the panel before they come on, so the stream always has a section ready. */
const LOOKAHEAD = 1.6;
/** Holds this far below the floor are gone for good. */
const DROP = 0.6;
/** The line stays inside this, so the wall is readable on a phone. */
const LINE_X = 0.95;

export type SectionKind = 'ladder' | 'crimps' | 'pinches' | 'slopers' | 'gastons' | 'reachy' | 'underclings' | 'traverse';

export const SECTION_LABEL: Record<SectionKind, string> = {
  ladder: 'Jug ladder',
  crimps: 'Crimp line',
  pinches: 'Pinch column',
  slopers: 'Sloper steps',
  gastons: 'Gaston zig-zag',
  reachy: 'Big moves',
  underclings: 'Undercling stack',
  traverse: 'Diagonal',
};

export type Section = { kind: SectionKind; level: number; y0: number; y1: number };

export type TreadSession = {
  program: TreadProgram;
  seed: number;
  /** Seconds on the wall. */
  t: number;
  /** How far the belt has moved: the floor's height in wall coordinates. */
  ground: number;
  speed: number;
  /** The holds currently on the panel, plus the next section above it. */
  holds: Hold[];
  /** Bumped whenever `holds` is replaced, so readers know to resync. */
  version: number;
  sections: Section[];
  /** Height the stream has been set up to. */
  setTo: number;
  /** Where the line is, sideways, at `setTo`. */
  lineX: number;
  nextId: number;
  /** Which hand the next hand hold is for, -1 left, 1 right. */
  side: number;
  level: number;
  peakLevel: number;
  sinceRecovery: number;
  rand: Rand;
};

const START_Y = 1.5;

export function startTread(program: TreadProgram, seed: number, prefill = true): TreadSession {
  const s: TreadSession = {
    program, seed, t: 0, ground: 0, speed: program.speed0, holds: [], version: 0, sections: [],
    setTo: START_Y, lineX: 0, nextId: 5, side: 1, level: program.level0, peakLevel: program.level0, sinceRecovery: 0,
    rand: new Rand(seed >>> 0),
  };
  // The start: two jugs and two footholds, the same stance every route starts from.
  s.holds = [
    hold(1, -0.28, START_Y, 'jug', 0.115),
    hold(2, 0.28, START_Y, 'jug', 0.115),
    hold(3, -0.3, START_Y - 1.0, 'foothold', 0.09),
    hold(4, 0.3, START_Y - 1.0, 'foothold', 0.09),
    hold(s.nextId++, -0.32, START_Y - 0.55, 'foothold', 0.09),
    hold(s.nextId++, 0.32, START_Y - 0.5, 'foothold', 0.09),
  ];
  // A warm-up ladder first, so everyone gets a rhythm before anything asks a question.
  addSection(s, 'ladder', Math.min(1, program.level0));
  if (prefill) fill(s);
  return s;
}

export const TREAD_START = { LH: 1, RH: 2, LF: 3, RF: 4 } as const;

function hold(id: number, x: number, y: number, type: HoldType, size: number, dir = -Math.PI / 2): Hold {
  return { id, pos: { x: round(x), y: round(y) }, type, size, dir };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** What the climber's body is telling the stream, for pacing it. */
export type TreadFeedback = { pump: number; power: number };

/**
 * Advances the belt by `dt` seconds of wall time. The stream is set further
 * up as it is needed; what has gone under the floor is dropped.
 */
export function advanceTread(s: TreadSession, dt: number, fb: TreadFeedback = { pump: 0, power: 1 }): void {
  if (dt <= 0) return;
  const p = s.program;
  s.t += dt;
  const k = Math.min(1, s.t / p.rampSeconds);
  s.speed = p.speed0 + (p.speed1 - p.speed0) * k;
  s.ground += s.speed * dt;
  // The level follows the clock, with the climber's state nudging the next section.
  s.level = Math.min(p.levelMax, p.level0 + s.t / p.levelSeconds);
  fill(s, fb);
  const before = s.holds.length;
  const kept = s.holds.filter((h) => h.pos.y > s.ground - DROP);
  if (kept.length !== before) {
    s.holds = kept;
    s.version++;
  }
}

/** Sets sections until the stream reaches past the top of the panel. */
function fill(s: TreadSession, fb: TreadFeedback = { pump: 0, power: 1 }): void {
  let added = false;
  while (s.setTo < s.ground + PANEL + LOOKAHEAD) {
    const kind = nextKind(s, fb);
    const level = kind === 'ladder' ? Math.max(0, s.level - 3) : jitter(s, s.level);
    addSection(s, kind, level);
    added = true;
  }
  if (added) s.version++;
}

function jitter(s: TreadSession, level: number): number {
  // Not every section harder than the last: up a bit, down a bit.
  return Math.max(0, Math.min(s.program.levelMax, level + s.rand.range(-1.2, 0.8)));
}

/**
 * What comes next. A recovery ladder every few sections, sooner when the
 * climber is pumped; otherwise something the level allows, and never the
 * same thing three times running.
 */
function nextKind(s: TreadSession, fb: TreadFeedback): SectionKind {
  const r = s.rand;
  const due = s.sinceRecovery >= 3 + (s.level > 5 ? 1 : 0);
  if (due || (fb.pump > 0.72 && s.sinceRecovery >= 1)) {
    s.sinceRecovery = 0;
    return 'ladder';
  }
  s.sinceRecovery++;
  const L = s.level;
  const pool: [SectionKind, number][] = [
    ['ladder', L < 1.5 ? 3 : 0.4],
    ['crimps', L >= 1 ? 2 : 0.5],
    ['pinches', L >= 1.5 ? 2 : 0.3],
    ['traverse', 1.4],
    ['gastons', L >= 2.5 ? 1.6 : 0],
    ['slopers', L >= 3 && s.program.angle < 25 ? 1.6 : 0],
    ['reachy', L >= 3.5 && fb.power > 0.35 ? 1.4 : 0],
    ['underclings', L >= 4 ? 1.2 : 0],
  ];
  const last = s.sections.slice(-2).map((x) => x.kind);
  const options = pool.filter(([k, w]) => w > 0 && !(last.length === 2 && last[0] === k && last[1] === k));
  return r.weighted(options);
}

/**
 * One section: about two metres of wall. Hands alternate either side of the
 * line, a foothold under each, and the section's kind decides the holds, the
 * spacing and which way the line goes. Spacing is bounded so every move is a
 * move the body can make; the level spends that margin, it never exceeds it.
 */
function addSection(s: TreadSession, kind: SectionKind, level: number): void {
  const r = s.rand;
  const y0 = s.setTo;
  const height = r.range(1.7, 2.3);
  const lv = Math.max(0, Math.min(10, level)) / 10;
  // Vertical spacing between hand holds: closer for the easy stuff.
  // A steep panel is set kinder: the angle is the difficulty there.
  const steep = Math.min(1, Math.max(0, (s.program.angle - 10) / 20));
  let dy = (0.3 + 0.1 * lv) * (1 - 0.1 * steep);
  if (kind === 'reachy') dy = 0.42 + 0.06 * lv;
  if (kind === 'ladder') dy = 0.32;
  const halfWidth = kind === 'pinches' || kind === 'gastons' ? 0.27 + 0.03 * lv : 0.23 + 0.03 * lv;
  let footless = 0;
  // The line's drift: a diagonal heads one way and stays there.
  const heading = kind === 'traverse' ? (s.lineX > 0.4 ? -1 : s.lineX < -0.4 ? 1 : r.sign()) : 0;
  let y = y0;
  while (y < y0 + height) {
    y += dy * r.range(0.9, 1.1);
    const drift = heading ? heading * r.range(0.16, 0.24) : r.range(-0.08, 0.08);
    s.lineX = clamp(s.lineX + drift, -LINE_X, LINE_X);
    const side = s.side;
    s.side = -s.side;
    const x = clamp(s.lineX + side * halfWidth, -1.3, 1.3);
    const { type, size, dir } = handHold(kind, lv, side, r);
    s.holds.push(hold(s.nextId++, x, y, type, size, dir));
    // A foothold a leg below, a little under the line — the worse the
    // section, the smaller and further apart the feet.
    // Never two hands in a row without a foot under them: the level makes
    // feet smaller and sparser, it never takes them away.
    const footChance = kind === 'ladder' ? 1 : 0.95 - 0.3 * lv;
    if (footless >= 1 || r.chance(footChance)) {
      const fy0 = y - r.range(0.85, 0.98);
      const fx0 = s.lineX + side * r.range(0.1, 0.28);
      // If the spot is taken, look a little either side of it, and a little higher.
      let placed = false;
      for (const [ox, oy] of [[0, 0], [-side * 0.16, 0], [side * 0.16, 0], [0, 0.12], [-side * 0.22, 0.1], [side * 0.24, -0.08]]) {
        const fx = clamp(fx0 + ox, -1.35, 1.35);
        const fy = fy0 + oy;
        if (clear(s, fx, fy, 0.15)) {
          s.holds.push(hold(s.nextId++, fx, fy, 'foothold', round(0.095 - 0.022 * lv * (1 - 0.6 * steep))));
          placed = true;
          break;
        }
      }
      footless = placed ? 0 : footless + 1;
    } else footless++;
  }
  s.sections.push({ kind, level, y0, y1: y });
  s.setTo = y;
  s.peakLevel = Math.max(s.peakLevel, level);
}

function handHold(kind: SectionKind, lv: number, side: number, r: Rand): { type: HoldType; size: number; dir: number } {
  const DOWN = -Math.PI / 2;
  // Edges and slopers shrink with the level; jugs do not.
  const shrink = (base: number) => round(base * (1 - 0.22 * lv));
  switch (kind) {
    case 'ladder': return { type: r.chance(0.85) ? 'jug' : 'pocket', size: 0.115, dir: DOWN };
    case 'crimps': return { type: r.chance(0.8) ? 'crimp' : 'pocket', size: shrink(0.105), dir: DOWN };
    case 'pinches': return { type: 'pinch', size: shrink(0.11), dir: DOWN };
    case 'slopers': return { type: 'sloper', size: round(0.13 - 0.02 * lv), dir: DOWN };
    // Gastons push away from the body; sidepulls pull back into it.
    case 'gastons': return r.chance(0.5)
      ? { type: 'gaston', size: shrink(0.11), dir: side > 0 ? 0.26 : Math.PI - 0.26 }
      : { type: 'sidepull', size: shrink(0.11), dir: side > 0 ? Math.PI + 0.6 : -0.6 };
    case 'reachy': return { type: r.chance(0.6) ? 'jug' : 'pinch', size: 0.115, dir: DOWN };
    case 'underclings': return r.chance(0.6)
      ? { type: 'undercling', size: shrink(0.115), dir: Math.PI / 2 }
      : { type: 'crimp', size: shrink(0.105), dir: DOWN };
    case 'traverse': return { type: r.weighted<HoldType>([['jug', 2], ['crimp', 2], ['pinch', 1]]), size: shrink(0.11), dir: DOWN };
  }
}

function clear(s: TreadSession, x: number, y: number, gap: number): boolean {
  return s.holds.every((h) => Math.hypot(h.pos.x - x, h.pos.y - y) >= gap);
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** A level as a climber would say it. */
export function levelGrade(level: number): Grade {
  return GRADES[Math.max(0, Math.min(8, Math.round(level * 0.8)))];
}

/** The section the climber's hands are in. */
export function sectionAt(s: TreadSession, y: number): Section | null {
  return s.sections.find((x) => y >= x.y0 && y < x.y1) ?? null;
}

// --- the result -------------------------------------------------------------

export type TreadEnd = 'fell' | 'pumped' | 'floor' | 'stopped';

export const TREAD_END_WORDS: Record<TreadEnd, string> = {
  fell: 'Came off the wall.',
  pumped: 'Pumped off: the forearms had nothing left.',
  floor: 'The floor caught up with you. Climb faster than the belt, or rest higher up.',
  stopped: 'Stepped off.',
};

export type TreadRun = {
  program: string;
  /** Seconds on the wall. The score. */
  time: number;
  /** Metres of wall climbed past. */
  distance: number;
  /** Holds caught. */
  moves: number;
  /** Hardest section level reached. */
  peakLevel: number;
  /** Seconds spent with the pump coming down. */
  rested: number;
  /** Highest the pump got. */
  maxPump: number;
  /** Slips and misses. */
  slips: number;
  end: TreadEnd;
  /** Why, in words, when the cause is known. */
  reason: string;
  at: number;
};

/** Moves per minute: how efficiently the wall was climbed. */
export function pace(run: TreadRun): number {
  return run.time > 0 ? (run.moves / run.time) * 60 : 0;
}

/** Formats seconds as m:ss.t */
export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/**
 * A stretch of the stream as an ordinary route, belt stopped: for proving
 * the stream goes with the solver and the climbing bot. `level` pins the
 * difficulty (left out, it follows the program as if climbed at the belt's pace).
 */
export function streamRoute(program: TreadProgram, seed: number, height: number, level?: number): import('./types').Route {
  const s = startTread(program, seed, false);
  let t = 0;
  while (s.setTo < height) {
    t += 5;
    s.level = level ?? Math.min(program.levelMax, program.level0 + t / program.levelSeconds);
    const kind = nextKind(s, { pump: 0.3, power: 0.8 });
    addSection(s, kind, kind === 'ladder' ? Math.max(0, s.level - 3) : jitter(s, s.level));
  }
  const top = Math.max(...s.holds.map((h) => h.pos.y));
  const finish = hold(s.nextId++, clamp(s.lineX, -0.8, 0.8), top + 0.3, 'jug', 0.13);
  return {
    id: `tread-${program.id}-${seed}`, name: 'Tread stream', grade: levelGrade(s.peakLevel), setter: 'house', wall: 'main',
    holds: [...s.holds, finish], start: { ...TREAD_START }, finish: [finish.id], par: 99,
    ...(program.angle ? { overhang: program.angle } : {}),
  };
}
