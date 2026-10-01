import type { Grade, Hold, HoldType, Route, Vec2 } from '../../game/types';
import {
  DOWN, DOWN_LEFT, DOWN_RIGHT, OUT_LEFT, OUT_RIGHT, UP,
} from '../holdKit';
import { HOLD_PROFILES } from '../../game/holds';
import type {
  Archetype, CruxKind, Difficulty, TierParams, Weighted,
} from './difficulty';
import { TIERS } from './difficulty';
import { makePlan, type Plan, type PlanItem } from './plan';
import { Rand } from './rand';
import { describe } from './names';

/**
 * Turns a plan into holds.
 *
 * The generator walks a cursor — the point the climber's hands are working
 * around — across the wall, one step at a time. Every step moves the cursor
 * and sets a hand hold beside it, alternating sides of the line of travel the
 * way hands alternate on real rock: left and right of a line going up,
 * high and low of a line going sideways. Feet are set under the line, about a
 * leg below the hands. Sections decide how the cursor moves and what it sets;
 * this file decides nothing about route shape on its own.
 */

/** Where the line may go. Holds sit a little outside it. */
const LINE_MIN_X = -1.18;
const LINE_MAX_X = 1.18;
/** Sideways sections hug a hold rail rather than a shoulder width, so they may run wider. */
const RAIL_MIN_X = -1.32;
const RAIL_MAX_X = 1.32;
const HOLD_MIN_X = -1.52;
const HOLD_MAX_X = 1.52;
const FOOT_MIN_Y = 0.36;
/** Hands start here, feet a leg below. Same as every route in the book. */
const START_Y = 1.5;
/** The line tops out around here; the finish jug goes just above it. */
const TOP_Y = 3.66;
const CEILING_Y = 3.74;

/** No two holds closer than this, centre to centre. */
const HAND_GAP = 0.17;
const FOOT_GAP = 0.15;

type DirMode = 'auto' | 'inward' | 'outward';

type StepStyle = {
  /** Distance from the line to each hand hold. */
  halfWidth?: number;
  palette?: Weighted<HoldType>;
  type?: HoldType;
  dirMode?: DirMode;
  /** Pretend the body is offset this far from the line when choosing sidepull directions. */
  bodyOffset?: number;
  /** Override which side of the line this hand goes on. */
  side?: 1 | -1;
  hard?: number;
  rest?: boolean;
  /** Chance this step gets its own foothold. */
  footDensity?: number;
  /** How far below the line feet go. */
  footDrop?: number;
  /** How far either side of the line feet go. */
  footSpread?: number;
  footSide?: 1 | -1;
  footType?: HoldType;
  /** Extra smears and chips beside the main foot. */
  extraFoot?: number;
  crux?: boolean;
};

/** One step of the line, kept for shape metrics and tests. */
export type PathStep = {
  from: Vec2;
  to: Vec2;
  tag: string;
  crux: boolean;
};

export type BuildResult = {
  route: Route;
  plan: Plan;
  path: PathStep[];
  /** Hand holds in the order the line visits them. */
  spine: number[];
  /** The section each spine hold belongs to, parallel to `spine`. */
  spineTags: string[];
};

class Setter {
  x: number;
  y: number;
  /** Which side of the line the next hand goes. */
  side: 1 | -1 = 1;
  footSide: 1 | -1 = -1;
  /** Current sideways heading. */
  heading: 1 | -1;
  /**
   * The way the route as a whole travels. Sideways sections all go this way,
   * sharing out the wall's width between them, so the line crosses the wall
   * once rather than doubling back over ground it has already covered — on a
   * wall this short, anything set above an earlier section is in reach of it,
   * and the route would be climbed straight up the middle.
   */
  drift: 1 | -1;
  holds: Hold[] = [];
  spine: number[] = [];
  /** Which section set each spine hold. */
  spineTags: string[] = [];
  path: PathStep[] = [];
  private nextId = 1;
  private stepsSinceFoot = 0;
  tag = 'start';

  constructor(
    readonly t: TierParams,
    readonly r: Rand,
    startX: number,
    heading: 1 | -1,
  ) {
    this.x = startX;
    this.y = START_Y;
    this.heading = heading;
    this.drift = heading;
  }

  /** The standard pull-on: two jugs, two chips. Every route starts standing. */
  start(): void {
    const sx = this.x;
    this.add('jug', sx - 0.3, START_Y, DOWN, { spine: true });
    this.add('jug', sx + 0.3, START_Y + this.r.range(-0.04, 0.04), DOWN, { spine: true });
    this.add('foothold', sx - 0.36, 0.52, DOWN);
    this.add('foothold', sx + 0.38, 0.55, DOWN);
    this.add('foothold', sx + this.r.range(-0.1, 0.1), 0.98, DOWN);
  }

  /** Room left on the side the line is heading. */
  room(heading: 1 | -1, rail = false): number {
    const max = rail ? RAIL_MAX_X : LINE_MAX_X;
    const min = rail ? RAIL_MIN_X : LINE_MIN_X;
    return heading > 0 ? max - this.x : this.x - min;
  }

  /** Points the heading at whichever side has more room. */
  headToRoom(): void {
    this.heading = this.room(1) >= this.room(-1) ? 1 : -1;
  }

  step(dx: number, dy: number, style: StepStyle = {}, rail = false): void {
    const minX = rail ? RAIL_MIN_X : LINE_MIN_X;
    const maxX = rail ? RAIL_MAX_X : LINE_MAX_X;
    // Bounce off the edges of the wall rather than leaving it.
    if (this.x + dx > maxX || this.x + dx < minX) {
      dx = -dx;
      this.heading = (this.heading * -1) as 1 | -1;
    }
    if (this.y + dy > CEILING_Y) dy = Math.max(0, CEILING_Y - this.y);
    if (this.y + dy < START_Y - 0.12) dy = START_Y - 0.12 - this.y;

    const from = { x: this.x, y: this.y };
    this.x += dx;
    this.y += dy;
    this.path.push({ from, to: { x: this.x, y: this.y }, tag: this.tag, crux: !!style.crux });

    // Direction of travel, and the perpendicular the hands alternate across.
    const l = Math.hypot(dx, dy);
    const d = l < 1e-6 ? { x: 0, y: 1 } : { x: dx / l, y: dy / l };
    const perp = { x: -d.y, y: d.x };
    const vertical = Math.abs(d.y);
    const hw = style.halfWidth ?? 0.11 + 0.17 * vertical;
    const side = style.side ?? this.side;
    this.side = (side * -1) as 1 | -1;

    const jitter = () => this.r.range(-0.02, 0.02);
    let hx = this.x + perp.x * side * hw + jitter();
    let hy = this.y + perp.y * side * hw + jitter();
    // A perpendicular that points down-and-left on a line going up-and-right
    // flips the sense of "side"; keep left as left so hands stay readable.
    if (vertical > 0.4 && perp.x * side > 0 !== side > 0) {
      hx = this.x - perp.x * side * hw + jitter();
      hy = this.y - perp.y * side * hw + jitter();
    }

    const type = style.type ?? this.r.weighted(style.palette ?? this.t.handPalette);
    const hard = style.hard ?? this.r.range(this.t.hard[0], this.t.hard[1]);
    const bodyX = this.x - dx * 0.5 + (style.bodyOffset ?? 0);
    this.placeHand(type, hx, hy, bodyX, style, hard, perp, side);

    // Feet: a leg below the line, alternating sides, sometimes skipped. Never
    // skipped twice in a row outside a crux, because a route with no feet for
    // three moves is a campus board, not a boulder.
    const density = style.footDensity ?? this.t.footDensity;
    const need = this.stepsSinceFoot >= (style.crux ? 2 : 1);
    if (this.r.chance(density) || need) {
      const drop = style.footDrop ?? this.r.range(0.96, 1.06);
      const spread = style.footSpread ?? 0.1 + 0.24 * vertical;
      const fs = style.footSide ?? this.footSide;
      this.footSide = (fs * -1) as 1 | -1;
      const fx = this.x + fs * spread * this.r.range(0.85, 1.15);
      const fy = this.y - drop + this.r.range(-0.03, 0.03);
      const placed = this.addFoot(style.footType ?? 'foothold', fx, fy);
      this.stepsSinceFoot = placed ? 0 : this.stepsSinceFoot + 1;
      if (style.extraFoot && this.r.chance(style.extraFoot)) {
        this.addFoot('foothold', this.x - fs * spread * 0.6, fy + this.r.range(0.1, 0.2));
      }
    } else {
      this.stepsSinceFoot++;
    }
  }

  private placeHand(
    type: HoldType, hx: number, hy: number, bodyX: number, style: StepStyle,
    hard: number, perp: Vec2, side: number,
  ): void {
    // Try the spot, then a little further out, then a little further in. A
    // hold that would sit on top of another is not set at all — the line
    // reuses the one already there.
    const tries = [0, 0.08, -0.06, 0.14];
    for (const extra of tries) {
      const x = clampN(hx + perp.x * side * extra, HOLD_MIN_X, HOLD_MAX_X);
      const y = clampN(hy + perp.y * side * extra, FOOT_MIN_Y + 0.4, 4.08);
      if (this.clear(x, y, HAND_GAP)) {
        const dir = holdDir(type, x, bodyX, style.dirMode ?? 'auto');
        // A sidepull with nothing to pull across is just a bad crimp.
        const t2 = dir === null ? 'crimp' : type;
        const id = this.add(t2, x, y, dir ?? DOWN, {
          hard: type === 'jug' && !style.crux ? 1 : hard,
          rest: style.rest,
          spine: true,
        });
        void id;
        return;
      }
    }
    // Reuse whatever is in the way as the spine hold.
    const near = this.nearest(hx, hy);
    if (near && near.type !== 'foothold') {
      this.spine.push(near.id);
      this.spineTags.push(this.tag);
    }
  }

  /**
   * The finish jug. It goes where the line ends; anything already sitting
   * there that is only a foothold makes way, and if a hand hold is there the
   * jug moves up rather than sitting on it.
   */
  finish(x: number, y: number): number {
    const fy = y;
    const blocking = this.holds.filter((h) => Math.hypot(h.pos.x - x, h.pos.y - fy) < HAND_GAP);
    const feet = blocking.filter((h) => h.type === 'foothold');
    this.holds = this.holds.filter((h) => !feet.includes(h));
    const hand = blocking.find((h) => h.type !== 'foothold');
    if (hand) {
      // The line already topped out on a hand hold: that hold is the finish.
      const i = this.holds.indexOf(hand);
      this.holds[i] = { ...hand, type: 'jug', size: HOLD_SIZE.jug, dir: DOWN, finish: true };
      delete this.holds[i].hard;
      for (const h of this.holds) {
        if (h !== this.holds[i] && Math.hypot(h.pos.x - hand.pos.x, h.pos.y - hand.pos.y) < HAND_GAP) {
          return this.add('jug', x, Math.min(4.08, Math.max(fy, hand.pos.y + HAND_GAP)), DOWN, { finish: true, spine: true });
        }
      }
      this.spine.push(hand.id);
      this.spineTags.push(this.tag);
      return hand.id;
    }
    return this.add('jug', x, fy, DOWN, { finish: true, spine: true });
  }

  addFoot(type: HoldType, x: number, y: number): boolean {
    const fx = clampN(x, HOLD_MIN_X, HOLD_MAX_X);
    const fy = Math.max(FOOT_MIN_Y, y);
    if (!this.clear(fx, fy, FOOT_GAP)) return true; // something is already there to stand on
    this.add(type, fx, fy, DOWN, type === 'volume' ? { roll: this.r.range(-0.8, 0.8) } : {});
    return true;
  }

  private clear(x: number, y: number, gap: number): boolean {
    return this.holds.every((h) => Math.hypot(h.pos.x - x, h.pos.y - y) >= gap);
  }

  private nearest(x: number, y: number): Hold | undefined {
    let best: Hold | undefined;
    let bd = Infinity;
    for (const h of this.holds) {
      const d = Math.hypot(h.pos.x - x, h.pos.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  add(
    type: HoldType, x: number, y: number, dir: number,
    o: { hard?: number; rest?: boolean; spine?: boolean; roll?: number; finish?: boolean } = {},
  ): number {
    const id = this.nextId++;
    const hold: Hold = {
      id,
      pos: { x: round(x), y: round(y) },
      type,
      size: HOLD_SIZE[type],
      dir,
      ...(o.roll !== undefined ? { roll: round(o.roll) } : {}),
      ...(o.hard !== undefined && Math.abs(o.hard - 1) > 0.005 ? { hard: round(o.hard) } : {}),
      ...(o.finish ? { finish: true } : {}),
      ...(o.rest ? { rest: true } : {}),
    };
    this.holds.push(hold);
    if (o.spine) {
      this.spine.push(id);
      this.spineTags.push(this.tag);
    }
    return id;
  }
}

/** Same sizes the hand-set routes use, so generated holds read the same. */
const HOLD_SIZE: Record<HoldType, number> = {
  jug: 0.115, crimp: 0.095, sloper: 0.115, pinch: 0.1, pocket: 0.105,
  sidepull: 0.105, undercling: 0.11, gaston: 0.105, foothold: 0.085, volume: 0.15,
};

/**
 * Which way a hold is pulled. Sidepulls pull back toward the body, gastons
 * push away from it, underclings pull up. Returns null when a directional
 * hold would have nothing to pull across, so the caller can set something
 * else instead.
 */
function holdDir(type: HoldType, x: number, bodyX: number, mode: DirMode): number | null {
  const off = x - bodyX;
  switch (type) {
    case 'sidepull': {
      if (Math.abs(off) < 0.05 && mode === 'auto') return null;
      const s = mode === 'outward' ? -Math.sign(off) : Math.sign(off);
      return s > 0 ? DOWN_LEFT : DOWN_RIGHT;
    }
    case 'gaston': {
      if (Math.abs(off) < 0.05) return null;
      return off > 0 ? OUT_RIGHT : OUT_LEFT;
    }
    case 'undercling':
      return UP;
    default:
      if (mode === 'inward' && HOLD_PROFILES[type].directionality > 0.6 && Math.abs(off) > 0.08) {
        // Pinches and slopers in a channel are squeezed toward the middle.
        return off > 0 ? DOWN_LEFT : DOWN_RIGHT;
      }
      return DOWN;
  }
}

// --- sections --------------------------------------------------------------

/**
 * Rising sections are handed a height to gain and decide how to spend it.
 * Sideways ones are handed nothing: they spend the wall's width instead.
 */
type SectionFn = (s: Setter, rise: number, width: number) => void;

const GOOD: Weighted<HoldType> = [['jug', 4], ['pinch', 1], ['pocket', 1]];

function easeFor(t: TierParams): Weighted<HoldType> {
  return t.difficulty === 'easy' ? t.handPalette : t.handPalette.map(([h, w]) => [h, h === 'jug' ? w + 2 : w] as const);
}

const slab: SectionFn = (s, rise) => {
  const { t, r } = s;
  const n = Math.max(2, Math.round(rise / r.range(0.24, 0.27)));
  const dy = rise / n;
  // A slab wanders. It does not go anywhere, but it never goes straight.
  const bend = r.chance(t.bendChance) ? Math.floor(n / 2) : -1;
  let lean = r.range(0.02, t.drift) * s.heading;
  const smallHolds: Weighted<HoldType> = t.difficulty === 'easy'
    ? t.handPalette
    : [['crimp', 3], ['pocket', 2], ['sloper', 1], ['jug', 1]];
  for (let i = 0; i < n; i++) {
    if (i === bend) lean = -lean;
    s.step(lean + r.range(-0.02, 0.02), dy, {
      palette: smallHolds,
      halfWidth: r.range(0.24, 0.3),
      footDensity: 1,
      extraFoot: 0.35,
    });
  }
};

const zigzag: SectionFn = (s, rise) => {
  const { t, r } = s;
  const dyStep = r.range(0.2, 0.24);
  const n = Math.max(3, Math.round(rise / dyStep));
  const dy = rise / n;
  // On harder routes the zigzag also travels: long legs one way, short legs
  // back, so it staircases across the wall instead of wiggling on the spot.
  const travels = t.difficulty !== 'easy' && t.difficulty !== 'moderate' && s.room(s.drift) > 0.4;
  const drift = s.drift;
  if (!travels && s.room(s.heading) < 0.5) s.heading = (s.heading * -1) as 1 | -1;
  let leg = r.int(t.zigLeg[0], t.zigLeg[1]);
  let inLeg = 0;
  for (let i = 0; i < n; i++) {
    const lat = r.range(t.zigLateral[0], t.zigLateral[1]);
    s.step(s.heading * lat, dy, { halfWidth: r.range(0.2, 0.26) });
    inLeg++;
    if (inLeg >= leg) {
      inLeg = 0;
      s.heading = (s.heading * -1) as 1 | -1;
      leg = travels && s.heading !== drift ? 1 : r.int(t.zigLeg[0], t.zigLeg[1]);
    }
  }
};

const traverse: SectionFn = (s, _rise, width) => {
  const { t, r } = s;
  // Its share of the wall's width, within what the tier calls a traverse.
  const want = clampN(width * r.range(0.9, 1.1), t.traverseLength[0], t.traverseLength[1]);
  const length = Math.min(want, s.room(s.heading, true));
  const stepX = r.range(0.3, 0.35);
  const n = Math.max(2, Math.min(t.maxConsecutiveLateral, Math.round(length / stepX)));
  // Traverses on harder routes are allowed to lose height — going down to go
  // across is the kind of thing that makes a route read wrong at first.
  const totalRise = t.difficulty === 'moderate' ? r.range(0, 0.1)
    : t.difficulty === 'hard' ? r.range(-0.2, 0.1) : r.range(-0.3, 0.04);
  const palette: Weighted<HoldType> = t.difficulty === 'moderate'
    ? [['jug', 4], ['sidepull', 2], ['crimp', 2]]
    : [['sidepull', 3], ['crimp', 2], ['pinch', 2], ['jug', 1], ['sloper', 1], ['gaston', 1]];
  for (let i = 0; i < n; i++) {
    s.step(s.heading * (length / n), totalRise / n + r.range(-0.03, 0.03), {
      palette,
      halfWidth: r.range(0.08, 0.13),
      footDrop: r.range(0.95, 1.05),
      footSpread: 0.1,
    }, true);
  }
};

const roof: SectionFn = (s, _rise, width) => {
  const { t, r } = s;
  // In under it, out along it with your feet up near your hands, then over the lip.
  s.step(s.heading * 0.08, 0.22, { palette: GOOD, halfWidth: 0.24 });
  if (s.room(s.heading, true) < 0.6) s.heading = (s.heading * -1) as 1 | -1;
  const n = clampN(Math.round(width / 0.3), 2, 3);
  const palette: Weighted<HoldType> = [['pinch', 3], ['jug', 2], ['pocket', 2], ['sloper', 1]];
  for (let i = 0; i < n; i++) {
    s.step(s.heading * r.range(0.28, 0.33), r.range(-0.04, 0.02), {
      palette,
      halfWidth: r.range(0.08, 0.12),
      footDrop: r.range(0.74, 0.82),
      footSpread: 0.16,
      footDensity: 1,
      footType: r.chance(0.4) ? 'volume' : 'foothold',
      hard: r.range(t.hard[0], t.hard[1]),
    }, true);
  }
  // The lip: out and up to something worth having.
  s.step(s.heading * r.range(0.08, 0.14), r.range(0.3, 0.34), {
    type: 'jug', halfWidth: 0.16, footDensity: 0.5,
  });
};

const overhang: SectionFn = (s, rise) => {
  const { t, r } = s;
  const n = Math.max(2, Math.round(rise / r.range(0.28, 0.32)));
  const dy = rise / n;
  const lean = r.range(0.03, t.drift) * s.heading;
  for (let i = 0; i < n; i++) {
    s.step(lean + r.range(-0.03, 0.03), dy, {
      palette: [['jug', 3], ['pinch', 2], ['pocket', 2], ['sloper', 1]],
      halfWidth: r.range(0.26, 0.32),
      footDensity: 0.55,
    });
  }
};

/** Two walls meeting in a corner. Hands on opposite walls, pulling in; feet stemmed wide. */
const dihedral: SectionFn = (s, rise) => {
  const { t, r } = s;
  const n = Math.max(2, Math.round(rise / r.range(0.24, 0.27)));
  const dy = rise / n;
  const lean = s.heading * r.range(0.03, 0.08);
  const palette: Weighted<HoldType> = t.difficulty === 'easy'
    ? [['jug', 1]]
    : [['sidepull', 4], ['crimp', 1], ['jug', 1], ['pinch', 1]];
  for (let i = 0; i < n; i++) {
    s.step(lean, dy, {
      palette,
      dirMode: 'inward',
      halfWidth: r.range(0.3, 0.34),
      footSpread: r.range(0.4, 0.46),
    });
  }
};

/** A split in the wall: everything is in a narrow line, and you lie off both sides of it. */
const crack: SectionFn = (s, rise) => {
  const { t, r } = s;
  const n = Math.max(3, Math.round(rise / r.range(0.22, 0.25)));
  const dy = rise / n;
  const lean = s.heading * r.range(0.04, 0.1);
  for (let i = 0; i < n; i++) {
    s.step(lean + r.range(-0.01, 0.01), dy, {
      palette: [['sidepull', 4], ['pinch', 2], ['pocket', 2], ['jug', 1]],
      dirMode: 'inward',
      halfWidth: r.range(0.12, 0.16),
      footSpread: r.range(0.18, 0.24),
      hard: r.range(t.hard[0], t.hard[1]),
    });
  }
};

/** Hands on an edge, feet out on the face. Halfway up the edge changes sides. */
const arete: SectionFn = (s, rise) => {
  const { t, r } = s;
  const n = Math.max(3, Math.round(rise / r.range(0.22, 0.25)));
  const dy = rise / n;
  let edge: 1 | -1 = r.sign();
  const swap = t.difficulty === 'moderate' ? -1 : Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    if (i === swap) edge = (edge * -1) as 1 | -1;
    s.step(r.range(-0.015, 0.015), dy, {
      palette: [['sidepull', 3], ['sloper', 2], ['crimp', 1], ['jug', 1]],
      side: edge,
      halfWidth: r.range(0.06, 0.14),
      // The body hangs off the face side, so the edge is pulled toward it.
      bodyOffset: -edge * 0.25,
      footSide: (edge * -1) as 1 | -1,
      footSpread: r.range(0.32, 0.4),
    });
  }
};

/** Two holds too far apart to pull on. Squeeze them together instead. */
const compression: SectionFn = (s, rise) => {
  const { t, r } = s;
  const n = Math.max(2, Math.round(rise / r.range(0.25, 0.28)));
  const dy = rise / n;
  for (let i = 0; i < n; i++) {
    s.step(r.range(-0.03, 0.03), dy, {
      palette: [['sloper', 3], ['pinch', 3], ['volume', 1], ['sidepull', 2]],
      dirMode: 'inward',
      halfWidth: r.range(0.4, 0.46),
      footSpread: r.range(0.26, 0.32),
      footDensity: 0.85,
      hard: r.range(t.hard[0], t.hard[1]),
    });
  }
};

const SECTIONS: Record<Archetype, SectionFn> = {
  slab, zigzag, traverse, roof, overhang, dihedral, crack, arete, compression,
};

/** Rough height each fixed-shape item spends, so rising sections can share what is left. */
const FIXED_RISE: Partial<Record<Archetype | CruxKind, number>> = {
  traverse: -0.05, roof: 0.56, span: 0.51, reversal: 0.43, drop: 0.34, lunge: 0.82, squeeze: 0.88,
};

// --- cruxes ----------------------------------------------------------------

/**
 * A crux is two or three moves, not a section. It arrives after the route has
 * been reasonable for a while, it uses the worst holds on the route, and it
 * asks for something the rest of the route did not.
 */
function crux(s: Setter, kind: CruxKind, final: boolean): void {
  const { t, r } = s;
  const hard = Math.min(1.35, t.hard[1] + 0.12);
  const poor: Weighted<HoldType> = [['crimp', 3], ['sloper', 2], ['pinch', 2], ['pocket', 1]];
  // The calm before it: one good hold, a rest if the route is long enough to need one.
  s.step(r.range(-0.04, 0.04), 0.22, {
    palette: easeFor(t), halfWidth: 0.26, footDensity: 1,
    rest: t.difficulty === 'veryHard' || t.difficulty === 'brutal' ? final : false,
    type: final ? 'jug' : undefined,
  });
  s.tag = `crux:${kind}`;
  const c = { crux: true, hard } as const;
  switch (kind) {
    case 'span': {
      if (s.room(s.heading, true) < 0.45) s.heading = (s.heading * -1) as 1 | -1;
      s.step(s.heading * r.range(0.42, 0.5), r.range(0.04, 0.1), {
        ...c, palette: [['crimp', 2], ['sidepull', 3], ['pinch', 1]], halfWidth: 0.1, footDensity: 0.3,
      }, true);
      s.step(s.heading * 0.08, 0.22, { ...c, palette: poor, halfWidth: 0.22, footDensity: 1 });
      break;
    }
    case 'reversal': {
      // The whole route has been going one way. The next hold is the other way.
      s.heading = (s.drift * -1) as 1 | -1;
      if (s.room(s.heading) < 0.6) s.heading = s.drift;
      s.step(s.heading * r.range(0.3, 0.36), r.range(0.1, 0.14), { ...c, palette: poor, halfWidth: 0.16 });
      s.step(s.heading * r.range(0.24, 0.3), r.range(0.06, 0.12), {
        ...c, palette: [['gaston', 2], ['sidepull', 2], ['crimp', 1]], halfWidth: 0.16, footDensity: 0.4,
      });
      break;
    }
    case 'drop': {
      // Down and across, then you are allowed up again.
      if (s.room(s.heading, true) < 0.5) s.heading = (s.heading * -1) as 1 | -1;
      s.step(s.heading * r.range(0.3, 0.36), -r.range(0.12, 0.18), {
        ...c, palette: [['undercling', 1], ['sidepull', 2], ['pinch', 2]], halfWidth: 0.12,
      }, true);
      s.step(s.heading * r.range(0.16, 0.22), r.range(0.24, 0.3), { ...c, palette: poor, halfWidth: 0.2 });
      break;
    }
    case 'lunge': {
      s.step(r.range(-0.05, 0.05), r.range(0.22, 0.26), { ...c, palette: poor, halfWidth: 0.28, footDensity: 0.4 });
      // Long, straight up, to something good — the reward is the only reason it goes.
      s.step(r.range(-0.06, 0.06), r.range(0.34, 0.38), {
        ...c, type: final ? 'jug' : r.weighted(GOOD), halfWidth: 0.12, footDensity: 0.4,
      });
      break;
    }
    case 'squeeze': {
      const n = 3;
      for (let i = 0; i < n; i++) {
        s.step(r.range(-0.03, 0.03), 0.22, {
          ...c, palette: [['sloper', 3], ['pinch', 2], ['volume', 1]], dirMode: 'inward',
          halfWidth: r.range(0.36, 0.42), footDensity: 0.4, footSpread: 0.3,
        });
      }
      break;
    }
  }
}

// --- assembly --------------------------------------------------------------

export type BuildOptions = {
  /**
   * 0 for the route as planned. Each level backs the route off a notch — a
   * little less reach on the crux, a little more foot — so a seed that keeps
   * failing validation still yields something on the second or third pass.
   */
  relax?: number;
};

export function buildRoute(difficulty: Difficulty, seed: number, opts: BuildOptions = {}): BuildResult {
  const relax = opts.relax ?? 0;
  const base = TIERS[difficulty];
  const t: TierParams = relax === 0 ? base : {
    ...base,
    footDensity: Math.min(1, base.footDensity + 0.15 * relax),
    hard: [Math.max(1, base.hard[0] - 0.05 * relax), Math.max(1, base.hard[1] - 0.05 * relax)],
    zigLateral: [base.zigLateral[0] * (1 - 0.1 * relax), base.zigLateral[1] * (1 - 0.1 * relax)],
  };
  const r = new Rand(seed);
  const plan = makePlan(t, r);

  // Start on the far side of the wall from the first sideways section, so it
  // has somewhere to go.
  const firstLateral = plan.items.findIndex((x) => x.kind === 'section' && (x.archetype === 'traverse' || x.archetype === 'roof'));
  const heading = r.sign();
  const crosses = difficulty === 'hard' || difficulty === 'veryHard' || difficulty === 'brutal';
  const startX = crosses
    ? -heading * r.range(0.7, 0.95)
    : firstLateral >= 0
      ? -heading * r.range(0.4, 0.7)
      : difficulty === 'easy' ? r.range(-0.3, 0.3) : r.range(-0.6, 0.6);
  const s = new Setter(t, r, startX, heading);
  s.start();

  // How much of the wall's width each sideways item still to come gets.
  const lateralItem = (x: PlanItem) => x.kind === 'crux'
    ? x.crux === 'span' || x.crux === 'drop'
    : x.archetype === 'traverse' || x.archetype === 'roof' || (x.archetype === 'zigzag' && crosses);
  let cursor = 0;
  const share = (item: PlanItem): number => {
    const left = items.slice(cursor).filter(lateralItem).length;
    return lateralItem(item) ? s.room(s.drift, true) / Math.max(1, left) : 0;
  };

  const items = plan.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    cursor = i;
    // Height still to climb, minus what the fixed-shape items still to come will use.
    const remainingFixed = items.slice(i + 1).reduce((sum, x) => {
      if (x.kind === 'crux') return sum + (FIXED_RISE[x.crux] ?? 0.3);
      return sum + (SECTIONS_RISE(x.archetype) ?? 0);
    }, 0);
    const risingLeft = items.slice(i).filter((x) => x.kind === 'section' && SECTIONS_RISE(x.archetype) === null).length;
    if (item.kind === 'section') {
      s.tag = item.archetype;
      const fixed = SECTIONS_RISE(item.archetype);
      const rise = fixed === null
        ? Math.max(0.3, (TOP_Y - s.y - remainingFixed) / Math.max(1, risingLeft))
        : fixed;
      s.heading = s.drift;
      SECTIONS[item.archetype](s, rise, share(item));
    } else {
      s.heading = s.drift;
      crux(s, item.crux, item.final);
    }
  }

  // Top out. If the line came up short, climb the rest on whatever the tier
  // climbs on; then one big jug to match.
  s.tag = 'topout';
  while (s.y < TOP_Y - 0.2) {
    s.step(r.range(-0.05, 0.05), Math.min(0.26, TOP_Y - s.y), { palette: easeFor(t), halfWidth: 0.26 });
  }
  const finishY = clampN(s.y + r.range(0.26, 0.32), 3.78, 4.04);
  const finishX = clampN(s.x + r.range(-0.08, 0.08), HOLD_MIN_X + 0.1, HOLD_MAX_X - 0.1);
  const finishId = s.finish(finishX, finishY);

  const steep = plan.sections.filter((a) => a === 'roof' || a === 'overhang').length;
  const overhang = Math.round(r.range(t.overhang[0], t.overhang[1]) + steep * t.steepBonus);
  const grade = gradeFor(t, plan, r);
  const meta = describe(difficulty, plan, s.path, seed, r);

  const route: Route = {
    id: generatedId(difficulty, seed, relax),
    name: meta.name,
    grade,
    setter: meta.setter,
    wall: 'main',
    tagline: meta.tagline,
    ...(overhang > 0 ? { overhang } : {}),
    // Par is set properly once the route has been climbed by the validator.
    par: Math.round(s.spine.length * 2.2),
    start: { LH: 1, RH: 2, LF: 3, RF: 4 },
    finish: [finishId],
    holds: s.holds,
    seed,
    blueprint: {
      difficulty,
      sections: plan.sections,
      cruxes: plan.cruxes,
      relax,
    },
  };
  return { route, plan, path: s.path, spine: s.spine, spineTags: s.spineTags };
}

/** Null for sections that climb; the height spent for sections that do not. */
function SECTIONS_RISE(a: Archetype): number | null {
  return a === 'traverse' || a === 'roof' ? FIXED_RISE[a] ?? 0 : null;
}

/** Inside a tier, the busier route gets the higher grade. */
function gradeFor(t: TierParams, plan: Plan, r: Rand): Grade {
  if (t.grades.length === 1) return t.grades[0];
  const busy = plan.sections.length + plan.cruxes.length * 1.5;
  const lo = t.sections[0] + t.cruxes[0] * 1.5;
  const hi = t.sections[1] + t.cruxes[1] * 1.5;
  const f = hi > lo ? (busy - lo) / (hi - lo) : r.next();
  const idx = Math.round(clampN(f * 0.8 + r.range(0, 0.4), 0, 1) * (t.grades.length - 1));
  return t.grades[idx];
}

export function generatedId(difficulty: Difficulty, seed: number, relax: number): string {
  return `gen-${difficulty}-${(seed >>> 0).toString(36)}-${relax}`;
}

function clampN(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
