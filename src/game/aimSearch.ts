import type { Hold, LimbId, Vec2 } from './types';
import {
  type DynoPrediction, type LaunchAim, type Prediction, type SlingState, SLING, dynoWindup, pickTarget, predictDyno,
  predictLaunch, windupPos,
} from './sling';
import { clamp01 } from './vec';

/**
 * Aiming against a body that is holding still.
 *
 * While a limb is being pulled the world is paused, so every throw from here
 * has exactly one answer, and this keeps them. The pull is snapped to a fine
 * grid — half a degree, a hundredth of the power — so the same finger
 * position is always the same throw: the arc on screen is the throw that
 * goes, and it only changes when the finger crosses to the next notch.
 *
 * A pull is a reach for a hold first: where it points and how hard pick a
 * hold anywhere in the reach envelope (`pickTarget`), and the limb goes to
 * it, whatever is in front of it. Only a pull that points at nothing in reach
 * is a plain throw, and for that, aim assist is a fan in the real physics: the
 * throws either side of yours, nearest first, a few more each frame, until
 * one catches something. Because the nearest are tried first, the first catch
 * found is the closest one there is, and the answer never jumps back. A hold
 * already locked onto stays locked further off it than it took to lock on.
 */

/** The grid the pull snaps to. */
export const AIM_STEP = (0.5 * Math.PI) / 180;
export const POWER_STEP = 0.01;
/** How far past the middle of a notch the pull must go to move to the next one, in notches. */
const STICK = 0.8;
/** How far either side of the pull the assist looks, in steps: about fourteen degrees. */
const FAN = 28;
/** And further for a hold it is already locked onto, so the lock does not flicker. */
const FAN_STICKY = 40;

export type AimResult = {
  aim: LaunchAim;
  prediction: Prediction;
  /** The hold the throw was steered onto, when it needed steering. */
  assisted: number | null;
  /** False while the fan is still being searched; the answer can only get better. */
  settled: boolean;
};

export class AimSearch {
  private memo = new Map<string, { aim: LaunchAim; prediction: Prediction }>();
  private reaches = new Map<string, { aim: LaunchAim; prediction: Prediction; hold: number } | null>();
  private dynoMemo = new Map<string, { prediction: DynoPrediction; wind: Vec2 }>();
  /** The hold the last answer was on, if any. */
  lock: number | null = null;

  private taken: Set<number>;

  constructor(readonly state: SlingState, readonly holds: Hold[]) {
    this.taken = new Set();
    for (const l of Object.values(state.limbs)) if (l.phase === 'held' && l.holdId !== null) this.taken.add(l.holdId);
  }

  /**
   * The grid notch for a pull: launch direction is opposite the drag. Given
   * the notch it was on, it stays there until the pull is clearly into the
   * next one, so a finger resting on a boundary does not flick between two.
   */
  static snap(pull: Vec2, maxPull: number, prev?: { angle: number; power: number } | null): { angle: number; power: number } {
    const l = Math.hypot(pull.x, pull.y);
    const a = Math.atan2(-pull.y, -pull.x) / AIM_STEP;
    const p = clamp01(l / maxPull) / POWER_STEP;
    let k = Math.round(a);
    let q = Math.round(p);
    if (prev) {
      const pk = Math.round(prev.angle / AIM_STEP);
      const pq = Math.round(prev.power / POWER_STEP);
      if (Math.abs(a - pk) < STICK) k = pk;
      if (Math.abs(p - pq) < STICK) q = pq;
    }
    return { angle: k * AIM_STEP, power: q * POWER_STEP };
  }

  /** The reach for a notch, if it points at a hold in reach, played forward once and kept. */
  private reachAt(limb: LimbId, k: number, power: number): { aim: LaunchAim; prediction: Prediction; hold: number } | null {
    const angle = k * AIM_STEP;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const from = windupPos(this.state, limb, { x: -dir.x, y: -dir.y }, power);
    const base: LaunchAim = { limb, dir, power, from };
    // Picking the hold is geometry, and cheap; playing it forward is kept.
    const hold = pickTarget(this.state, this.holds, base, this.lock);
    if (!hold) return null;
    const key = `${limb}:${k}:${Math.round(power / POWER_STEP)}:${hold.id}`;
    const known = this.reaches.get(key);
    if (known !== undefined) return known;
    const aim = { ...base, target: { id: hold.id, at: { ...hold.pos } } };
    const prediction = predictLaunch(this.state, this.holds, aim, 1.5);
    const hit = prediction.caught?.holdId === hold.id ? { aim, prediction, hold: hold.id } : null;
    this.reaches.set(key, hit);
    return hit;
  }

  /** The throw for a notch, played forward once and kept. */
  private throwAt(limb: LimbId, k: number, power: number): { aim: LaunchAim; prediction: Prediction } {
    const key = `${limb}:${k}:${Math.round(power / POWER_STEP)}`;
    let hit = this.memo.get(key);
    if (!hit) {
      const angle = k * AIM_STEP;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      // It launches from where the pull draws it back to: opposite the throw.
      const from = windupPos(this.state, limb, { x: -dir.x, y: -dir.y }, power);
      const aim: LaunchAim = { limb, dir, power, from };
      hit = { aim, prediction: predictLaunch(this.state, this.holds, aim, 1.0) };
      this.memo.set(key, hit);
    }
    return hit;
  }

  private known(limb: LimbId, k: number, power: number): boolean {
    return this.memo.has(`${limb}:${k}:${Math.round(power / POWER_STEP)}`);
  }

  /**
   * The throw for this notch, assisted if it can be, spending at most
   * `budget` new predictions. Call it again next frame to keep looking.
   */
  resolve(limb: LimbId, angle: number, power: number, budget = 3): AimResult {
    const k0 = Math.round(angle / AIM_STEP);
    const spend = (k: number) => {
      if (!this.known(limb, k, power)) budget--;
      return this.throwAt(limb, k, power);
    };
    if (power >= SLING.minPower) {
      const reach = this.reachAt(limb, k0, power);
      if (reach) return this.answer(reach, true);
    }
    const raw = spend(k0);
    if (raw.prediction.caught || power < SLING.minPower) {
      this.lock = raw.prediction.caught?.holdId ?? null;
      return { ...raw, assisted: null, settled: true };
    }
    let first: { aim: LaunchAim; prediction: Prediction; hold: number } | null = null;
    const reach = this.lock !== null ? FAN_STICKY : FAN;
    for (let i = 1; i <= reach; i++) {
      for (const k of [k0 + i, k0 - i]) {
        if (budget <= 0 && !this.known(limb, k, power)) {
          // Out of time this frame. Show the best so far; keep looking next.
          if (first) return this.answer(first, false);
          return { ...raw, assisted: null, settled: false };
        }
        const t = spend(k);
        const caught = t.prediction.caught?.holdId;
        if (caught === undefined) continue;
        // Matching is something to mean, not something to be steered into.
        if (this.taken.has(caught)) continue;
        // Past the ordinary fan only the locked hold counts.
        if (i > FAN && caught !== this.lock) continue;
        if (this.lock === null || caught === this.lock) return this.answer({ ...t, hold: caught }, true);
        first ??= { ...t, hold: caught };
      }
      // The locked hold is not out there any more: take the nearest catch.
      if (first && i >= FAN) return this.answer(first, true);
    }
    if (first) return this.answer(first, true);
    this.lock = null;
    return { ...raw, assisted: null, settled: true };
  }

  private answer(t: { aim: LaunchAim; prediction: Prediction; hold: number }, settled: boolean): AimResult {
    this.lock = t.hold;
    return { aim: t.aim, prediction: t.prediction, assisted: t.hold, settled };
  }

  /** The dyno for a notch, drawn back against the limbs on the wall, played forward once and kept. */
  dyno(angle: number, power: number): { prediction: DynoPrediction; wind: Vec2; dir: Vec2 } {
    const k = Math.round(angle / AIM_STEP);
    const key = `${k}:${Math.round(power / POWER_STEP)}`;
    const dir = { x: Math.cos(k * AIM_STEP), y: Math.sin(k * AIM_STEP) };
    let hit = this.dynoMemo.get(key);
    if (!hit) {
      const wind = dynoWindup(this.state, { x: -dir.x, y: -dir.y }, power);
      hit = { wind, prediction: predictDyno(this.state, this.holds, { dir, power, wind }, 1.5) };
      this.dynoMemo.set(key, hit);
    }
    return { ...hit, dir };
  }
}
