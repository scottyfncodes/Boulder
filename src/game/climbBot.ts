import type { Hold, LimbId, Route, Vec2 } from './types';
import { LIMBS, isHand } from './types';
import {
  type LaunchAim, type SlingEvent, type SlingState, SLING, arcAngle, bodyAngle, bodySpeed, canDyno, canLaunch,
  dyno, heldCount, initialSling, isSlingSent, launch, launchSpeed, postureOf, predictDyno, predictLaunch,
  pumpOut, reachableHolds, stepSling, assistLaunch, placeLimb, placeableHolds, cloneSling, letGo,
} from './sling';
import {
  type ArmId, type Pump, blownArms, catchCost, dynoCost, flingCost, freshPump, gain, restRate, tickPump,
} from './pump';
import { profileOf } from './profile';
import { freshJuice, isFull, onMiss, onStick, spendDyno, onDynoStuck, type Juice } from './juice';

/**
 * A climber that plays the real game: the sling physics, the pump, the dyno
 * meter, the time it takes to think. Not a solver — it is greedy and it
 * misreads things — but it climbs the way a person does, one throw at a
 * time, and it is how the pump numbers get tuned: if the efficient climber
 * cannot get up a route, or the reckless one can get up everything, the
 * numbers are wrong, not the routes.
 *
 * `efficient` keeps feet on, moves one limb at a time on the softest throw
 * that works, and stops to shake out when it is somewhere it can. `reckless`
 * throws for the highest thing in reach, ignores its feet, and dynos the
 * moment the meter lets it.
 */

export type Style = 'efficient' | 'reckless';

export type ClimbReport = {
  route: string;
  style: Style;
  outcome: 'sent' | 'fell' | 'pumped' | 'stuck' | 'timeout';
  moves: number;
  dynos: number;
  misses: number;
  /** Seconds on the wall. */
  time: number;
  /** Seconds spent resting, hands on or shaking out. */
  rested: number;
  /** Times a hand came off to be shaken out. */
  shakeouts: number;
  maxPump: number;
  endPump: number;
  floor: number;
  /** Highest hand hold reached, metres up the wall. */
  high: number;
  /** [time, pump, wall angle at the body in degrees], twice a second. */
  trace: [number, number, number][];
};

type Ctx = {
  route: Route;
  holds: Hold[];
  sim: SlingState;
  pump: Pump;
  juice: Juice;
  t: number;
  trace: [number, number, number][];
  maxPump: number;
  nextTrace: number;
};

const DT = SLING.dt;

function step(c: Ctx, events: SlingEvent[] = []): SlingEvent[] {
  const seen = events.length;
  stepSling(c.sim, c.holds, DT, 0, events);
  c.t += DT;
  if (!c.sim.fallen) {
    const posture = postureOf(c.sim);
    c.pump = tickPump(c.pump, posture, DT);
    const blown = blownArms(c.pump).filter((a) => c.sim.limbs[a].phase === 'held');
    if (blown.length) pumpOut(c.sim, events, blown);
  }
  for (let i = seen; i < events.length; i++) {
    const e = events[i];
    if (e.kind === 'catch') {
      const hands = LIMBS.filter((id) => isHand(id) && c.sim.limbs[id].phase === 'held').length;
      c.pump = gain(c.pump, catchCost(bodySpeed(c.sim), isHand(e.limb), hands, bodyAngle(c.sim)), isHand(e.limb) ? e.limb as ArmId : undefined);
    }
  }
  c.maxPump = Math.max(c.maxPump, c.pump.pump);
  if (c.t >= c.nextTrace) {
    c.trace.push([round(c.t), round(c.pump.pump), Math.round((bodyAngle(c.sim) * 180) / Math.PI)]);
    c.nextTrace += 0.5;
  }
  return events;
}

/** Runs until the body is still and nothing is in the air, or `max` seconds. */
function settle(c: Ctx, max = 2.5): SlingEvent[] {
  const events: SlingEvent[] = [];
  const end = c.t + max;
  let quiet = 0;
  while (c.t < end && !c.sim.fallen) {
    step(c, events);
    const flying = LIMBS.some((id) => c.sim.limbs[id].phase === 'flying') || c.sim.dyno;
    quiet = !flying && bodySpeed(c.sim) < 0.25 ? quiet + DT : 0;
    if (quiet > 0.25) break;
  }
  return events;
}

function wait(c: Ctx, seconds: number): void {
  const end = c.t + seconds;
  while (c.t < end && !c.sim.fallen) step(c);
}

/**
 * One shakeout: the worse forearm comes off and hangs while the other holds
 * on, then goes back on the hold it came off. Tried on a copy first — a
 * climber can feel whether the feet will take it — and only done for real if
 * the copy is still on and the bar came down. Returns whether it happened.
 */
function shakeOnce(c: Ctx): boolean {
  const s = c.sim;
  const held = (['LH', 'RH'] as ArmId[]).filter((a) => s.limbs[a].phase === 'held' && s.limbs[a].holdId !== null);
  if (held.length < 2) return false;
  const arm = c.pump.arms.LH.pump >= c.pump.arms.RH.pump ? 'LH' : 'RH';
  const hold = c.holds.find((h) => h.id === s.limbs[arm].holdId);
  if (!hold) return false;
  const run = (k: Ctx): boolean => {
    const before = k.pump.pump;
    if (!letGo(k.sim, arm)) return false;
    // Long enough to get something back; no longer than it takes to catch the other arm up.
    const end = k.t + 6;
    while (k.t < end && !k.sim.fallen) {
      step(k);
      if (k.pump.arms[arm].pump <= k.pump.arms[arm === 'LH' ? 'RH' : 'LH'].pump - 0.02) break;
    }
    if (k.sim.fallen) return false;
    placeLimb(k.sim, arm, hold.id, k.holds, []);
    settle(k, 1);
    return !k.sim.fallen && k.sim.limbs[arm].phase === 'held' && k.pump.pump < before - 0.005;
  };
  const ghost: Ctx = { ...c, sim: cloneSling(c.sim), trace: [], nextTrace: Infinity };
  if (!run(ghost)) return false;
  return run(c);
}

/** The softest throw at `hold` the physics says catches it, if there is one. */
export function aimAt(state: SlingState, holds: Hold[], limb: LimbId, hold: Hold, soft = true): LaunchAim | null {
  const from = state.limbs[limb].pos;
  const want = Math.atan2(hold.pos.y - from.y, hold.pos.x - from.x);
  const powers = [0.32, 0.42, 0.52, 0.62, 0.72, 0.84, 0.96];
  if (!soft) powers.reverse();
  for (const power of powers) {
    const a = arcAngle(from, hold.pos, launchSpeed(limb, power), want);
    if (a === null) continue;
    for (const nudge of [0, 0.06, -0.06, 0.13, -0.13]) {
      const aim = { limb, dir: { x: Math.cos(a + nudge), y: Math.sin(a + nudge) }, power };
      const p = predictLaunch(state, holds, aim, 1.0);
      if (p.caught?.holdId === hold.id) return aim;
    }
  }
  // Roughly at it, and let the assist do what it does for a person.
  for (const power of [0.5, 0.75, 1]) {
    const aim = { limb, dir: { x: Math.cos(want + 0.35), y: Math.sin(want + 0.35) }, power };
    const a = assistLaunch(state, holds, aim, 1.0, hold.id);
    if (a.prediction.caught?.holdId === hold.id) return a.aim;
  }
  return null;
}

type Option =
  | { kind: 'throw'; aim: LaunchAim; hold: Hold }
  | { kind: 'place'; limb: LimbId; hold: Hold }
  | { kind: 'dyno'; dir: Vec2; power: number };

function handTop(s: SlingState): number {
  let top = -9;
  for (const id of ['LH', 'RH'] as LimbId[]) if (s.limbs[id].phase === 'held') top = Math.max(top, s.limbs[id].pos.y);
  return top;
}

/** Every move worth considering from here: throws at reachable holds, placements, and the dyno. */
function options(c: Ctx, style: Style): Option[] {
  const s = c.sim;
  const out: Option[] = [];
  const finish = new Set(c.route.finish);
  const taken = new Set(LIMBS.map((id) => s.limbs[id].holdId).filter((x) => x !== null));
  for (const limb of LIMBS) {
    const l = s.limbs[limb];
    if (l.phase === 'free') {
      for (const h of placeableHolds(s, c.holds, limb)) {
        if (isHand(limb) && h.type === 'foothold') continue;
        out.push({ kind: 'place', limb, hold: h });
      }
    }
    if (!canLaunch(s, limb)) continue;
    // Something has to stay on while it flies: two at least, three if you are careful and can.
    if (l.phase === 'held' && heldCount(s) < (style === 'efficient' && heldCount(s) === 4 ? 3 : 3)) continue;
    const holds = reachableHolds(s, c.holds, limb)
      .filter((h) => h.id !== l.holdId && (!taken.has(h.id) || (finish.has(h.id) && isHand(limb))))
      .filter((h) => !(isHand(limb) && h.type === 'foothold'))
      // Up, mostly: nobody climbs down to climb up.
      .filter((h) => h.pos.y > l.pos.y - (isHand(limb) ? 0.05 : 0.15) || l.phase !== 'held')
      // Feet go somewhere between under the hips and a high step beside them.
      .filter((h) => isHand(limb) || (h.pos.y < s.hip.y + 0.45 && h.pos.y > s.hip.y - 1.05))
      .sort((a, b) => b.pos.y - a.pos.y)
      .slice(0, isHand(limb) ? 7 : 6);
    for (const h of holds) {
      const aim = aimAt(s, c.holds, limb, h, style === 'efficient');
      if (aim) out.push({ kind: 'throw', aim, hold: h });
    }
  }
  if (style === 'reckless' && isFull(c.juice) && canDyno(s)) {
    const d = bestDyno(c);
    if (d) out.push({ kind: 'dyno', dir: d.dir, power: d.power });
  }
  return out;
}

/** Plays an option forward on a copy and says how good the result is. */
function judge(c: Ctx, o: Option, style: Style, visits: Map<string, number>): number {
  const ghost: Ctx = { ...c, sim: cloneSling(c.sim), trace: [], nextTrace: Infinity };
  apply(ghost, o);
  settle(ghost, 3);
  const s = ghost.sim;
  if (s.fallen) return -1e6;
  const held = heldCount(s);
  const handsOn = (['LH', 'RH'] as LimbId[]).filter((id) => s.limbs[id].phase === 'held').length;
  if (handsOn === 0) return -1e5;
  const finish = c.route.finish;
  const onFinish = (['LH', 'RH'] as LimbId[]).filter((id) => s.limbs[id].phase === 'held' && finish.includes(s.limbs[id].holdId ?? -1)).length;
  if (isSlingSent(s, finish)) return 1e6 - ghost.pump.pump;
  const spent = ghost.pump.pump - c.pump.pump;
  const progress = 2 * handTop(s) + s.hip.y + 1.2 * onFinish;
  const support = 0.35 * held;
  const care = style === 'efficient' ? 0.8 : 0.6;
  // Somewhere already been is somewhere that did not work out.
  const again = visits.get(keyOf(s)) ?? 0;
  return progress + support - care * spent - 1.2 * again;
}

function keyOf(s: SlingState): string {
  return LIMBS.map((id) => s.limbs[id].holdId).join(',');
}

function apply(c: Ctx, o: Option): void {
  const s = c.sim;
  if (o.kind === 'place') { placeLimb(s, o.limb, o.hold.id, c.holds, []); return; }
  if (o.kind === 'throw') {
    const leftOn = heldCount(s) - (s.limbs[o.aim.limb].phase === 'held' ? 1 : 0);
    c.pump = gain(c.pump, flingCost(o.aim.power, bodyAngle(s), leftOn));
    launch(s, o.aim, []);
    return;
  }
  const spent = spendDyno(c.juice);
  if (spent) c.juice = spent;
  c.pump = gain(c.pump, dynoCost(o.power, bodyAngle(s)));
  dyno(s, { dir: o.dir, power: o.power }, []);
}

/** The biggest dyno the physics says sticks, as a pair of hands going up. */
function bestDyno(c: Ctx): { dir: Vec2; power: number; high: number } | null {
  let best: { dir: Vec2; power: number; high: number } | null = null;
  const now = handTop(c.sim);
  for (let power = 0.35; power <= 1.001; power += 0.08) {
    for (const x of [-0.5, -0.3, -0.15, 0, 0.15, 0.3, 0.5]) {
      const dir = { x, y: Math.sqrt(1 - x * x) };
      const p = predictDyno(c.sim, c.holds, { dir, power }, 1.5);
      if (!p.caught.length) continue;
      const high = Math.max(...p.caught.map((k) => k.at.y));
      if (high > now + 0.5 && (!best || high > best.high)) best = { dir, power, high };
    }
  }
  return best;
}

export function climb(
  route: Route, style: Style,
  opts: { maxSeconds?: number; maxMoves?: number; fitness?: number; think?: number; shake?: boolean } = {},
): ClimbReport {
  const maxSeconds = opts.maxSeconds ?? 300;
  const maxMoves = opts.maxMoves ?? 70;
  const sim = initialSling(route.holds, route.start, profileOf(route));
  const c: Ctx = {
    route, holds: route.holds, sim, pump: freshPump(opts.fitness ?? 1), juice: freshJuice(),
    t: 0, trace: [], maxPump: 0, nextTrace: 0,
  };
  let moves = 0;
  let dynos = 0;
  let misses = 0;
  let rested = 0;
  let shakeouts = 0;
  let high = handTop(sim);
  let outcome: ClimbReport['outcome'] = 'timeout';
  const visits = new Map<string, number>();

  while (c.t < maxSeconds && moves < maxMoves) {
    const events = settle(c);
    if (c.sim.fallen) { outcome = c.pump.pump >= 1 ? 'pumped' : 'fell'; break; }
    if (isSlingSent(c.sim, route.finish)) { outcome = 'sent'; break; }
    high = Math.max(high, handTop(c.sim));
    void events;

    // Rest, if this is somewhere that gives anything back: hands on if the
    // stance is a rest by itself, and the careful climber shakes out one
    // arm at a time if the feet will take it.
    const restAt = style === 'efficient' ? 0.45 : 0.85;
    if (c.pump.pump > restAt) {
      const before = c.t;
      const goal = Math.max(c.pump.floor + 0.04, 0.2);
      while (c.pump.pump > goal && c.t - before < 40 && !c.sim.fallen) {
        if (style === 'efficient' && opts.shake !== false && shakeOnce(c)) { shakeouts++; continue; }
        if (restRate(postureOf(c.sim), c.pump.pump) >= -0.002) break;
        wait(c, 0.5);
      }
      rested += c.t - before;
    }

    // Reading the next move takes a moment, wherever you are hanging.
    // A person takes a couple of seconds to read a move and pull it back; the
    // reckless one less, because they are not really reading.
    wait(c, opts.think ?? (style === 'efficient' ? 1.8 : 1.0));
    if (c.sim.fallen) continue;

    const opts2 = options(c, style);
    if (!opts2.length) {
      if (process.env.DBG) {
        console.log('no options', LIMBS.map((id) => `${id}:${c.sim.limbs[id].phase[0]}${c.sim.limbs[id].holdId}@${c.sim.limbs[id].pos.x.toFixed(2)},${c.sim.limbs[id].pos.y.toFixed(2)}`).join(' '), 'hip', c.sim.hip.y.toFixed(2), 'sh', c.sim.shoulder.y.toFixed(2));
        for (const limb of LIMBS) {
          for (const h of reachableHolds(c.sim, c.holds, limb).filter((h) => h.pos.y > c.sim.limbs[limb].pos.y)) {
            let best = 9;
            for (let p = 0.3; p <= 1; p += 0.05) for (let a = 0; a < 6.28; a += 0.05) {
              const pr = predictLaunch(c.sim, c.holds, { limb, dir: { x: Math.cos(a), y: Math.sin(a) }, power: p }, 1);
              if (pr.caught?.holdId === h.id) { best = 0; break; }
              for (const q of pr.path) best = Math.min(best, Math.hypot(q.x - h.pos.x, q.y - h.pos.y));
            }
            console.log('  ', limb, '->', h.id, h.type, h.pos.x, h.pos.y, 'closest', best.toFixed(2));
          }
        }
      }
      outcome = 'stuck'; break;
    }
    // Do not shuffle between the same two positions for ever.
    const key = keyOf(c.sim);
    const seen = visits.get(key) ?? 0;
    visits.set(key, seen + 1);
    if (seen > 5) { if (process.env.DBG) console.log('loop', key); outcome = 'stuck'; break; }
    let best: Option | null = null;
    let bestV = -Infinity;
    for (const o of opts2) {
      const v = judge(c, o, style, visits);
      if (v > bestV) { bestV = v; best = o; }
    }
    if (!best || bestV < -1e4) { outcome = 'stuck'; break; }
    if (process.env.DBG) {
      const L = (id: LimbId) => `${id}:${c.sim.limbs[id].phase[0]}${c.sim.limbs[id].holdId ?? '-'}`;
      const d = best.kind === 'throw' ? `${best.aim.limb}->${best.hold.id}` : best.kind === 'place' ? `place ${best.limb}->${best.hold.id}` : 'DYNO';
      console.log(c.t.toFixed(1), LIMBS.map(L).join(' '), 'pump', c.pump.pump.toFixed(2), 'opts', opts2.length, 'do', d, bestV.toFixed(2));
    }
    const before = handTop(c.sim);
    apply(c, best);
    const out = settle(c, 3);
    moves++;
    if (best.kind === 'dyno') {
      dynos++;
      if (out.some((e) => e.kind === 'catch')) c.juice = onDynoStuck(c.juice, handTop(c.sim) - before);
    } else if (best.kind === 'throw') {
      if (out.some((e) => e.kind === 'catch')) c.juice = onStick(c.juice);
      if (out.some((e) => e.kind === 'miss')) { misses++; c.juice = onMiss(c.juice); }
    }
  }
  if (outcome === 'timeout' && c.sim.fallen) outcome = 'fell';
  return {
    route: route.id, style, outcome, moves, dynos, misses, time: round(c.t), rested: round(rested), shakeouts,
    maxPump: round(c.maxPump), endPump: round(c.pump.pump), floor: round(c.pump.floor), high: round(high),
    trace: c.trace,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
