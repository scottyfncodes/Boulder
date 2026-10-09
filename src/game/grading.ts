import type { Contact, Grade, Hold, LimbId, Route, Vec2 } from './types';
import { GRADES, isHand } from './types';
import { type ClimbState, initialState, resolveMove } from './move';
import { aimAtHold } from './autoplay';
import { overhangOf } from './attempt';
import { anchorFor, maxReachOf } from './body';
import { type FootSupport, type Posture, armShare, freshPump, restRate, tickPump } from './pump';
import { GRIP, gripCost, holdCapacity } from './grip';
import { type TechniqueId, readTechnique } from './technique';
import { angleAt, profileOf as wallOf } from './profile';
import type { Beta } from './attempt';

/**
 * Grading a route from what its moves ask for.
 *
 * A route is replayed, move by move, through the static body solver, and
 * every stance and every move is measured with the same functions the live
 * physics uses: how close each hand is to its hold's capacity in that body
 * position, how much the remaining limbs carry while one is moving, how far
 * the reach is against the limb, how forgiving the hold is to arrive on, what
 * technique the stance needs, and how pumped a climber would be by the time
 * they get to each move.
 *
 * The hardest move matters most; the hardest stretch of four next; then how
 * tired you arrive at the crux, how much the sequence changes its mind, and
 * whether there is anywhere to rest. More than one way up makes a route
 * easier. The result is a number, mapped onto the V-scale by a calibration
 * fitted against the hand-set routes — so a grade is provisional, and the
 * calibration is the thing to retune when players disagree.
 */

export type MoveDemand = {
  index: number;
  limb: LimbId;
  holdId: number;
  /** Worst hand load ratio while the limb is in the air. */
  during: number;
  /** Worst hand load ratio once it lands. */
  after: number;
  /** How far the move is against the limb's reach, 0..1+. */
  reach: number;
  /** How hard the target is to arrive on, given the reach: 0 easy. */
  catch: number;
  /** How steep the wall is where the body is, radians. */
  angle: number;
  /** Techniques the stance after the move uses. */
  techniques: TechniqueId[];
  /** Pump on arrival, from a paced climb of the sequence. */
  pump: number;
  /** The move's difficulty, 0 trivial .. 1 at the limit. */
  difficulty: number;
};

export type RouteStyle = 'slab' | 'vertical' | 'overhang' | 'roof' | 'technical' | 'powerful' | 'compression' | 'dynamic' | 'endurance' | 'crimpy' | 'slopey';

export type GradeReport = {
  /** The grade the moves add up to. Provisional by nature. */
  grade: Grade;
  /** The raw score the grade was read off. */
  score: number;
  /** The hardest move, and where it is. */
  crux: { index: number; difficulty: number; holdId: number };
  /** Hardest run of four moves, averaged. */
  sustained: number;
  /** Pump arriving at the crux, 0..1. */
  pumpAtCrux: number;
  /** Stances in the sequence where the forearms come back. */
  rests: number;
  /** How much the sequence changes direction and crosses through. */
  complexity: number;
  /** Distinct sequences known to go. */
  solutions: number;
  techniques: TechniqueId[];
  styles: RouteStyle[];
  moves: MoveDemand[];
  /** How far through the beta the replay got, 0..1. Less than 1 is a beta the static solver could not follow. */
  coverage: number;
};

/** Pacing for the pump estimate. */
export const GRADING = {
  /** Seconds a paced climber spends per move. */
  movePace: 4.5,
  /** Fitness the pump estimate climbs with. */
  fitness: 1.3,
} as const;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Stance = {
  posture: Posture;
  /** Worst hand load ratio. */
  ratio: number;
  techniques: TechniqueId[];
  angle: number;
};

/** Reads a static stance the way the live sim reads a body. */
export function readStance(route: Route, contacts: Contact[], hip: Vec2, shoulder: Vec2): Stance {
  const holds = new Map(route.holds.map((h) => [h.id, h]));
  const profile = wallOf(route);
  const angle = angleAt(profile, (hip.y + shoulder.y) / 2);
  const com = { x: hip.x * 0.56 + shoulder.x * 0.44, y: hip.y * 0.56 + shoulder.y * 0.44 };
  const by = (l: LimbId) => contacts.find((c) => c.limb === l);
  const limbs = {} as Record<LimbId, { pos: Vec2; phase: 'held' | 'free'; holdId: number | null; hooked?: boolean }>;
  for (const l of ['LH', 'RH', 'LF', 'RF'] as LimbId[]) {
    const c = by(l);
    const hooked = !!c && !isHand(l) && (c.pos.y > hip.y - 0.05 || angleAt(profile, c.pos.y) > (40 * Math.PI) / 180);
    limbs[l] = c ? { pos: c.pos, phase: 'held', holdId: c.holdId, hooked } : { pos: anchorFor(l, hip, shoulder), phase: 'free', holdId: null };
  }
  const tech = readTechnique({ hip, shoulder, limbs }, (id) => holds.get(id), (y) => angleAt(profile, y));

  const feet: FootSupport[] = [];
  for (const l of ['LF', 'RF'] as LimbId[]) {
    const c = by(l);
    if (!c) continue;
    const h = holds.get(c.holdId)!;
    const below = hip.y - c.pos.y;
    let support = (0.25 + 0.75 * smooth(-0.15, 0.5, below)) * (1 - 0.45 * smooth(0.35, 0.95, Math.abs(c.pos.x - com.x)));
    const hooked = limbs[l].hooked ?? false;
    const twist = !!tech.dropKnee[l];
    if (twist) support = Math.max(support, 0.72);
    const cap = holdCapacity(h, { limb: l, force: { x: 0, y: -1 }, angle: angleAt(profile, h.pos.y), hooked, opposition: tech.opposition[l] ?? null });
    support *= 0.45 + 0.55 * smooth(0.25, 1.3, cap);
    feet.push({ support: hooked ? Math.max(support, 0.85) : support, hooked, twist });
  }
  const handsOn = (['LH', 'RH'] as LimbId[]).filter((l) => by(l));
  const arms = armShare({ angle, hands: handsOn.length, feet: feet.length, footSupport: feet });
  let ratio = 0;
  const grip = { LH: 1, RH: 1 };
  let leftShare: number | undefined;
  if (handsOn.length === 2) {
    const lx = by('LH')!.pos.x;
    const rx = by('RH')!.pos.x;
    const span = rx - lx;
    leftShare = Math.abs(span) < 0.08 ? 0.5 : 0.2 + 0.6 * smooth(0, 1, (rx - com.x) / span);
  }
  for (const l of handsOn) {
    const c = by(l)!;
    const h = holds.get(c.holdId)!;
    const anchor = anchorFor(l, hip, shoulder);
    let force = norm({ x: anchor.x - h.pos.x, y: anchor.y - h.pos.y });
    if (GRIP[h.type] && h.type === 'gaston') force = { x: -force.x, y: -force.y };
    // Pressing down on top of it, the same rule the live sim uses.
    if (shoulder.y > c.pos.y + 0.08 && Math.sin(h.dir) < -0.3 && h.type !== 'gaston') force = norm({ x: -force.x * 0.4, y: -1 });
    const ctx = { limb: l, force, angle: angleAt(profile, h.pos.y), opposition: tech.opposition[l] ?? null };
    const share = handsOn.length === 2 ? (l === 'LH' ? leftShare! : 1 - leftShare!) : 1;
    const load = arms * share;
    ratio = Math.max(ratio, load / holdCapacity(h, ctx));
    grip[l as 'LH' | 'RH'] = gripCost(h, ctx);
  }
  const posture: Posture = {
    angle, hands: handsOn.length, feet: feet.length, speed: 0, reaching: false,
    held: { LH: !!by('LH'), RH: !!by('RH') }, leftShare, footSupport: feet, grip,
  };
  return { posture, ratio, techniques: tech.active, angle };
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

/** A beta replayed through the static solver: the stances it passes through. */
function replay(route: Route, beta: Beta): { states: ClimbState[]; moves: Beta } {
  let state = initialState(route.holds, route.start, overhangOf(route));
  const states = [state];
  const done: Beta = [];
  const holds = new Map(route.holds.map((h) => [h.id, h]));
  for (const m of beta) {
    const hold = holds.get(m.holdId);
    if (!hold) break;
    if (state.contacts.some((c) => c.limb === m.limb && c.holdId === m.holdId)) continue;
    const r = resolveMove({ state, aim: aimAtHold(state, m.limb, hold), holds: route.holds });
    if (r.fell || r.holdId !== hold.id) break;
    state = r.next;
    states.push(state);
    done.push(m);
  }
  return { states, moves: done };
}

/** Measures one sequence. */
function measure(route: Route, beta: Beta): { moves: MoveDemand[]; coverage: number; rests: number[]; complexity: number; tanks: number } {
  const holds = new Map<number, Hold>(route.holds.map((h) => [h.id, h]));
  const { states, moves } = replay(route, beta);
  const out: MoveDemand[] = [];
  const rests: number[] = [];
  let pump = freshPump(GRADING.fitness);
  // Endurance without a ceiling: how many tanks of pump the sequence costs,
  // net of whatever its rests give back. A real pump bar stops at full; this
  // does not, so three tanks of climbing reads as three, not as one.
  let tank = 0;
  let tanks = 0;
  let lastDx = 0;
  let turns = 0;
  let crosses = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const before = states[i];
    const after = states[i + 1];
    const hold = holds.get(m.holdId)!;
    // While it moves, the rest of the body holds the position it moved from.
    const during = readStance(route, before.contacts.filter((c) => c.limb !== m.limb), before.pose.hip, before.pose.shoulder);
    const landed = readStance(route, after.contacts, after.pose.hip, after.pose.shoulder);
    const from = before.contacts.find((c) => c.limb === m.limb)?.pos ?? anchorFor(m.limb, before.pose.hip, before.pose.shoulder);
    const anchor = anchorFor(m.limb, before.pose.hip, before.pose.shoulder);
    const reach = Math.hypot(hold.pos.x - anchor.x, hold.pos.y - anchor.y) / maxReachOf(m.limb);
    const travel = Math.hypot(hold.pos.x - from.x, hold.pos.y - from.y);
    const dynamic = smooth(0.55, 1.05, reach) * smooth(0.25, 0.7, travel);
    const tol = GRIP[hold.type].catchTolerance;
    const catchD = isHand(m.limb) ? dynamic * (1 - tol) : 0.3 * dynamic * (1 - tol);

    // The pump, paced: the move held for a while, then the landing.
    pump = tickPump(pump, { ...during.posture, reaching: true }, GRADING.movePace * 0.45);
    pump = tickPump(pump, landed.posture, GRADING.movePace * 0.55);
    tank = Math.max(0, tank + restRate({ ...during.posture, reaching: true }, 0.5, GRADING.fitness) * GRADING.movePace * 0.45);
    tank = Math.max(0, tank + restRate(landed.posture, 0.5, GRADING.fitness) * GRADING.movePace * 0.55);
    tanks = Math.max(tanks, tank);
    if (restRate(landed.posture, pump.pump, GRADING.fitness) < -0.003) rests.push(i);

    const technical = landed.techniques.filter((t) => TECH_WEIGHT[t]).reduce((s, t) => s + (TECH_WEIGHT[t] ?? 0), 0);
    const steep = Math.sin(Math.max(0, Math.min(Math.PI / 2, landed.angle)));
    const diff = Math.min(1.4,
      0.42 * smooth(0.05, 1.25, during.ratio)
      + 0.2 * smooth(0.05, 1.1, landed.ratio)
      + 0.16 * smooth(0.45, 1.1, reach)
      + 0.14 * catchD
      + 0.06 * Math.min(1, technical)
      + 0.08 * steep);
    out.push({
      index: i, limb: m.limb, holdId: m.holdId, during: during.ratio, after: landed.ratio, reach, catch: catchD,
      angle: landed.angle, techniques: landed.techniques, pump: pump.pump, difficulty: diff,
    });

    if (isHand(m.limb)) {
      const dx = hold.pos.x - from.x;
      if (Math.abs(dx) > 0.12) {
        if (lastDx && Math.sign(dx) !== Math.sign(lastDx)) turns++;
        lastDx = dx;
      }
      const other = after.contacts.find((c) => isHand(c.limb) && c.limb !== m.limb);
      if (other && (m.limb === 'LH' ? hold.pos.x > other.pos.x + 0.08 : hold.pos.x < other.pos.x - 0.08)) crosses++;
    }
  }
  const handMoves = Math.max(1, moves.filter((m) => isHand(m.limb)).length);
  const complexity = Math.min(1, (turns / handMoves) * 1.4 + (crosses / handMoves) * 1.8);
  return { moves: out, coverage: beta.length ? moves.length / beta.length : 0, rests, complexity, tanks };
}

/** How much a technique adds to how hard a stance is to find and hold. */
const TECH_WEIGHT: Partial<Record<TechniqueId, number>> = {
  dropKnee: 0.35, heelHook: 0.3, toeHook: 0.45, gaston: 0.3, undercling: 0.25, compression: 0.4,
  mantle: 0.35, stem: 0.2, flag: 0.25, highStep: 0.15, smear: 0.2, cutLoose: 0.5, sidepull: 0.1, pinch: 0.15,
};

/**
 * Grades a route from one or more sequences that are known to go. The first
 * is the one measured; the others count as alternative solutions.
 */
export type GradeFeatures = {
  crux: number;
  sustained: number;
  meanDifficulty: number;
  maxPump: number;
  pumpAtCrux: number;
  /** Tanks of pump the whole sequence costs, net of rests. Uncapped. */
  tanks: number;
  complexity: number;
  length: number;
  steep: number;
  restsBeforeCrux: number;
  extraSolutions: number;
};

export const FEATURES: readonly (keyof GradeFeatures)[] = [
  'crux', 'sustained', 'meanDifficulty', 'maxPump', 'pumpAtCrux', 'tanks', 'complexity', 'length', 'steep', 'restsBeforeCrux', 'extraSolutions',
];

/** Everything a grade is made of, measured off the first sequence; the rest are alternatives. */
export function featuresOf(route: Route, betas: Beta[]): { f: GradeFeatures; main: ReturnType<typeof measure>; cruxAt: number; solutions: number } {
  const usable = betas.filter((b) => b.length > 0);
  const main = usable.length ? measure(route, usable[0]) : { moves: [], coverage: 0, rests: [], complexity: 0, tanks: 0 };
  const ms = main.moves;
  let cruxAt = 0;
  for (const m of ms) if (m.difficulty > (ms[cruxAt]?.difficulty ?? -1)) cruxAt = m.index;
  let sustained = 0;
  const W = 4;
  for (let i = 0; i + W <= ms.length; i++) {
    sustained = Math.max(sustained, ms.slice(i, i + W).reduce((s, m) => s + m.difficulty, 0) / W);
  }
  if (ms.length < W) sustained = ms.reduce((s, m) => s + m.difficulty, 0) / W;
  const solutions = distinct(usable);
  const steep = ms.reduce((s, m) => s + Math.sin(Math.max(0, Math.min(Math.PI / 2, m.angle))), 0) / Math.max(1, ms.length);
  const f: GradeFeatures = {
    crux: ms[cruxAt]?.difficulty ?? 0,
    sustained,
    meanDifficulty: ms.reduce((s, m) => s + m.difficulty, 0) / Math.max(1, ms.length),
    maxPump: ms.reduce((s, m) => Math.max(s, m.pump), 0),
    pumpAtCrux: ms[cruxAt]?.pump ?? 0,
    tanks: Math.min(4, main.tanks),
    complexity: main.complexity,
    length: smooth(6, 40, ms.length),
    steep,
    restsBeforeCrux: Math.min(1, main.rests.filter((i) => i < cruxAt).length / 6),
    extraSolutions: Math.min(1, Math.max(0, solutions - 1) / 3),
  };
  return { f, main, cruxAt, solutions };
}

/**
 * Weights on the features, giving a grade index directly. Fitted by least
 * squares against the setters' grades (`npm run fit:grades`) and then
 * frozen; rerun the fit after changing the physics.
 */
export const WEIGHTS: Record<keyof GradeFeatures | 'bias', number> = {
  bias: 1.33, crux: 0.88, sustained: 0, meanDifficulty: 0, maxPump: 3.78, pumpAtCrux: 0, tanks: 1.52,
  complexity: 1.77, length: 1.5, steep: 0.36, restsBeforeCrux: 0, extraSolutions: -0.71,
};

export function scoreOf(f: GradeFeatures, w = WEIGHTS): number {
  let s = w.bias;
  for (const k of FEATURES) s += w[k] * f[k];
  return s;
}

/**
 * Grades a route from one or more sequences that are known to go. The first
 * is the one measured; the others count as alternative solutions.
 */
export function gradeRoute(route: Route, betas: Beta[]): GradeReport {
  const { f, main, cruxAt, solutions } = featuresOf(route, betas);
  const ms = main.moves;
  const score = scoreOf(f);
  const techniques = [...new Set(ms.flatMap((m) => m.techniques))];
  return {
    grade: GRADES[Math.max(0, Math.min(GRADES.length - 1, Math.round(score)))],
    score,
    crux: { index: cruxAt, difficulty: f.crux, holdId: ms[cruxAt]?.holdId ?? -1 },
    sustained: f.sustained,
    pumpAtCrux: f.pumpAtCrux,
    rests: main.rests.length,
    complexity: main.complexity,
    solutions,
    techniques,
    styles: stylesOf(route, ms, techniques, f.sustained, main.complexity),
    moves: ms,
    coverage: main.coverage,
  };
}

function distinct(betas: Beta[]): number {
  const keys: Set<string>[] = [];
  for (const b of betas) {
    const k = new Set(b.map((m) => `${m.limb}:${m.holdId}`));
    if (keys.every((o) => jaccard(o, k) < 0.75)) keys.push(k);
  }
  return keys.length;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union ? shared / union : 1;
}

function stylesOf(route: Route, ms: MoveDemand[], tech: TechniqueId[], sustained: number, complexity: number): RouteStyle[] {
  const out: RouteStyle[] = [];
  const profile = wallOf(route);
  let sum = 0;
  let most = -Infinity;
  for (const h of route.holds) { const a = angleAt(profile, h.pos.y); sum += a; most = Math.max(most, a); }
  const mean = sum / Math.max(1, route.holds.length);
  const deg = (r: number) => (r * 180) / Math.PI;
  if (deg(mean) < -2) out.push('slab');
  else if (deg(most) >= 50) out.push('roof');
  else if (deg(mean) >= 12) out.push('overhang');
  else out.push('vertical');
  const hands = route.holds.filter((h) => h.type !== 'foothold');
  const share = (t: string) => hands.filter((h) => h.type === t).length / Math.max(1, hands.length);
  if (share('crimp') + share('pocket') > 0.35) out.push('crimpy');
  if (share('sloper') + share('volume') > 0.25) out.push('slopey');
  if (tech.includes('compression') || share('pinch') > 0.3) out.push('compression');
  const reachy = ms.filter((m) => m.reach > 0.85).length / Math.max(1, ms.length);
  if (reachy > 0.25 || ms.some((m) => m.catch > 0.4)) out.push('dynamic');
  const intense = ms.filter((m) => m.during > 0.7).length / Math.max(1, ms.length);
  if (intense > 0.3) out.push('powerful');
  if (tech.length >= 4 || complexity > 0.45) out.push('technical');
  if (ms.length >= 18 || (sustained > 0.45 && ms.length >= 12)) out.push('endurance');
  return out;
}

export type { Beta };
