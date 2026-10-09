import { type Posture, type Pump, ARMS, freshPump, gain, stillness, tickPump, armEfforts, PUMP } from './pump';
import type { Condition } from './sling';

/**
 * The body's budget, beyond the forearms.
 *
 * The pump (`pump.ts`) is grip endurance: each forearm filling as it holds
 * on. On top of it:
 *
 * - **Power** is short-term pulling capacity — the thing a big throw, a
 *   lock-off or a dyno spends. It comes back quickly once you stop throwing,
 *   which is why a powerful move after a rest goes and the same move straight
 *   after three others does not.
 * - **Core** is body tension: keeping feet on steep ground, holding a toe
 *   hook, squeezing a compression move, catching a swing with feet cut.
 *   Upright on good feet it comes back.
 * - **Breath** is general exertion, smoothed over the last half minute or so.
 *   It does not stop anything by itself; it slows every other recovery, so
 *   climbing hard without pause makes the next rest worth less.
 *
 * None of these is a switch. Each scales something the sim already does —
 * how far a throw goes, how hard a foot can push on a steep wall, how much a
 * hand can hold — so a tired body is a worse body, gradually.
 */

export type Fatigue = {
  pump: Pump;
  /** 1 fresh .. 0 spent. */
  power: number;
  /** 1 fresh .. 0 spent. */
  core: number;
  /** 0 calm .. 1 gasping. */
  breath: number;
};

export const FATIGUE = {
  /** Power back per second on a still body, at calm breath. */
  powerBack: 0.16,
  /** A full-power throw, before the wall: power spent. */
  throwCost: 0.16,
  /** A full dyno. */
  dynoCost: 0.5,
  /** Locking off: power per second per body weight the arms carry over half. */
  lockOff: 0.03,
  /** Core per second, per unit of the sine of the wall's lean, while hanging on it. */
  coreSteep: 0.018,
  /** Core per second per unit of technique core work (toe hooks, squeezes, cutting loose). */
  coreTech: 0.03,
  /** Core back per second, upright on feet. */
  coreBack: 0.07,
  /** Seconds breath takes to follow effort. */
  breathTau: 22,
  /** Effort (in units of the pump's rest line) that counts as flat-out breathing. */
  breathFull: 3.2,
  /** How much a gasping climber's recovery slows. */
  breathDrag: 0.55,
} as const;

export function freshFatigue(fitness = 1): Fatigue {
  return { pump: freshPump(fitness), power: 1, core: 1, breath: 0 };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Advances everything by `dt` seconds in `posture`. */
export function tickFatigue(f: Fatigue, posture: Posture, dt: number): Fatigue {
  if (dt <= 0) return f;
  const pump = tickPump(f.pump, posture, dt);
  if (posture.grounded) return { ...f, pump };
  const fit = f.pump.fitness;
  const still = stillness(posture.speed);
  const lean = Math.sin(Math.max(0, Math.min(Math.PI / 2, posture.angle)));
  const recover = 1 - FATIGUE.breathDrag * f.breath;

  // Power: back when not throwing; drained by hanging on bent arms.
  const e = armEfforts(posture);
  const load = Math.max(e.LH, e.RH);
  let power = f.power;
  const lock = Math.max(0, load - 2 * PUMP.restLine);
  power -= (FATIGUE.lockOff * lock * dt) / fit;
  if (!posture.reaching) power += FATIGUE.powerBack * still * recover * dt * fit * (1.1 - 0.6 * lean);

  // Core: steep ground and technique cost it; upright on feet gives it back.
  const feetOn = posture.feet > 0;
  const coreWork = (feetOn || posture.hands > 0 ? FATIGUE.coreSteep * lean * (feetOn ? 1 : 1.8) : 0)
    + FATIGUE.coreTech * (posture.core ?? 0);
  let core = f.core - (coreWork * dt) / fit;
  if (coreWork < 0.006 && feetOn) core += FATIGUE.coreBack * still * recover * dt * fit;

  // Breath: follows how hard everything is working, slowly.
  const want = clamp01(load / (PUMP.restLine * FATIGUE.breathFull) + (posture.reaching ? 0.1 : 0));
  const k = 1 - Math.exp(-dt / FATIGUE.breathTau);
  const breath = f.breath + (want - f.breath) * k;

  return { pump, power: clamp01(power), core: clamp01(core), breath: clamp01(breath) };
}

/** A throw: power, by how hard and how steep, and a little pump. */
export function spendThrow(f: Fatigue, power: number, angle: number, pumpCost: number): Fatigue {
  const steep = 1 + Math.sin(Math.max(0, Math.min(Math.PI / 2, angle)));
  const cost = (FATIGUE.throwCost * power * power * steep) / f.pump.fitness;
  // Sloppy when tired: a throw on an empty tank costs the forearms more too.
  const sloppy = 1 + 0.8 * (1 - f.power);
  return { ...f, power: clamp01(f.power - cost), pump: gain(f.pump, pumpCost * sloppy) };
}

export function spendDyno(f: Fatigue, power: number, pumpCost: number): Fatigue {
  const cost = (FATIGUE.dynoCost * (0.4 + 0.6 * power)) / f.pump.fitness;
  return { ...f, power: clamp01(f.power - cost), core: clamp01(f.core - cost * 0.3), pump: gain(f.pump, pumpCost) };
}

/** A catch on a moving body: the arm that stops it, and the core. */
export function spendCatch(f: Fatigue, pumpCost: number, arm?: 'LH' | 'RH'): Fatigue {
  return { ...f, core: clamp01(f.core - pumpCost * 0.6), pump: gain(f.pump, pumpCost, arm) };
}

/** What the sim reads: each forearm's grip left, power, core. */
export function conditionOf(f: Fatigue): Condition {
  return {
    grip: { LH: 1 - f.pump.arms.LH.pump, RH: 1 - f.pump.arms.RH.pump },
    power: f.power,
    core: f.core,
  };
}

/** One word for the breath readout. */
export function breathWord(b: number): string {
  return b < 0.25 ? 'easy' : b < 0.5 ? 'working' : b < 0.75 ? 'heavy' : 'gasping';
}

export { ARMS };
