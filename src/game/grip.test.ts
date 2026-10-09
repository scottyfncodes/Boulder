import { describe, expect, it } from 'vitest';
import type { Hold, LimbId, StartAssignment } from './types';
import {
  type SlingEvent, type SlingState, SLING, FRESH, contactState, initialSling, launch, placeLimb, stepSling,
} from './sling';
import { holdCapacity, gripCost, establishFactor, stepSlip, ESTABLISH_TIME } from './grip';
import { readTechnique, type TechBody } from './technique';
import { flatProfile } from './profile';
import { deg, DOWN, LEFT, RIGHT, UP, crimp, foot, jug, sloper, volume, sidepull } from '../content/holdKit';

const run = (s: SlingState, holds: Hold[], seconds: number, events: SlingEvent[] = []) => {
  for (let i = 0; i < Math.round(seconds / SLING.dt); i++) stepSling(s, holds, SLING.dt, 0, events);
  return events;
};

/** Pulls on and leaves the ground, so the arms carry what the feet do not. */
function onWall(holds: Hold[], start: StartAssignment, angle = 0): SlingState {
  const s = initialSling(holds, start, flatProfile(deg(angle)));
  s.left = true;
  return s;
}

function reach(s: SlingState, holds: Hold[], limb: LimbId, id: number, power = 0.6): boolean {
  const h = holds.find((x) => x.id === id)!;
  const l = s.limbs[limb];
  const d = { x: h.pos.x - l.pos.x, y: h.pos.y - l.pos.y };
  const n = Math.hypot(d.x, d.y);
  return launch(s, { limb, dir: { x: d.x / n, y: d.y / n }, power, target: { id, at: { ...h.pos } } });
}

const H = (limb: LimbId) => ({ limb, force: { x: 0, y: -1 }, angle: 0 });

describe('holds are not all the same', () => {
  it('a jug takes far more than a crimp, and a crimp more than a sloper', () => {
    const j = holdCapacity(jug(1, 0, 2), H('RH'));
    const c = holdCapacity(crimp(1, 0, 2), H('RH'));
    const sl = holdCapacity(sloper(1, 0, 2), H('RH'));
    expect(j).toBeGreaterThan(c * 2);
    expect(c).toBeGreaterThan(sl * 0.9);
  });

  it('size matters more to an edge than to a jug', () => {
    const smallCrimp = holdCapacity({ ...crimp(1, 0, 2), size: 0.06 }, H('RH')) / holdCapacity(crimp(1, 0, 2), H('RH'));
    const smallJug = holdCapacity({ ...jug(1, 0, 2), size: 0.07 }, H('RH')) / holdCapacity(jug(1, 0, 2), H('RH'));
    expect(smallCrimp).toBeLessThan(smallJug);
  });

  it('a big sloper on a steep wall is worse than a small positive edge on a vertical one', () => {
    const bigSloper = holdCapacity({ ...sloper(1, 0, 2), size: 0.16 }, { ...H('RH'), angle: deg(45) });
    const smallEdge = holdCapacity({ ...crimp(1, 0, 2), size: 0.08 }, H('RH'));
    expect(bigSloper).toBeLessThan(smallEdge);
  });

  it('friction holds want slab; positive holds do not care much about the angle', () => {
    const slabFoot = holdCapacity(volume(1, 0, 1), { limb: 'LF', force: { x: 0, y: -1 }, angle: deg(-15) });
    const steepFoot = holdCapacity(volume(1, 0, 1), { limb: 'LF', force: { x: 0, y: -1 }, angle: deg(45) });
    expect(slabFoot).toBeGreaterThan(steepFoot * 2.5);
    const jugFlat = holdCapacity(jug(1, 0, 2), H('RH'));
    const jugSteep = holdCapacity(jug(1, 0, 2), { ...H('RH'), angle: deg(60) });
    expect(jugSteep).toBeGreaterThan(jugFlat * 0.95);
  });

  it('loaded off its line a directional hold gives up most of what it has', () => {
    const right = holdCapacity(sidepull(1, 0, 2, { dir: LEFT }), { ...H('RH'), force: { x: -1, y: 0 } });
    const wrong = holdCapacity(sidepull(1, 0, 2, { dir: LEFT }), { ...H('RH'), force: { x: 1, y: 0 } });
    expect(wrong).toBeLessThan(right * 0.35);
  });

  it('a squeeze lets a hand point its force where gravity alone would peel it off', () => {
    const hold = sidepull(1, 0, 2, { dir: RIGHT });
    const gravityOnly = holdCapacity(hold, { ...H('LH'), force: { x: 0, y: -1 } });
    const squeezed = holdCapacity(hold, { ...H('LH'), force: { x: 0, y: -1 }, opposition: { x: 1, y: 0 } });
    expect(squeezed).toBeGreaterThan(gravityOnly * 1.5);
  });

  it('pumped forearms close on less, gradually', () => {
    const c = crimp(1, 0, 2);
    const fresh = holdCapacity(c, { ...H('RH'), grip: 1 });
    const mid = holdCapacity(c, { ...H('RH'), grip: 0.5 });
    const blown = holdCapacity(c, { ...H('RH'), grip: 0.05 });
    expect(fresh).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(blown);
    expect(blown).toBeGreaterThan(fresh * 0.4);
  });

  it('a worse hold costs the forearm more to keep holding: overgripping is priced', () => {
    expect(gripCost(crimp(1, 0, 2), H('RH'))).toBeGreaterThan(gripCost(jug(1, 0, 2), H('RH')) * 1.4);
  });
});

describe('contacts have a life', () => {
  it('a catch ramps in: slopers have to be arrived at, jugs can be slammed', () => {
    expect(establishFactor('sloper', 0)).toBeLessThan(establishFactor('jug', 0));
    expect(establishFactor('sloper', ESTABLISH_TIME)).toBeCloseTo(1);
  });

  it('slipping builds over capacity and heals under it, rather than snapping', () => {
    let slip = 0;
    slip = stepSlip(slip, 1.05, 0.1);
    expect(slip).toBeGreaterThan(0);
    expect(slip).toBeLessThan(1);
    const after = stepSlip(slip, 0.5, 0.1);
    expect(after).toBeLessThan(slip);
    expect(stepSlip(0, 2, 0.1)).toBeGreaterThan(0.9);
  });

  it('goes searching, establishing, then engaged or loaded', () => {
    const holds = [jug(1, -0.3, 1.5), jug(2, 0.3, 1.5), foot(3, -0.3, 0.6), foot(4, 0.3, 0.6), jug(5, 0.3, 1.95)];
    const s = onWall(holds, { LH: 1, RH: 2, LF: 3, RF: 4 });
    expect(reach(s, holds, 'RH', 5)).toBe(true);
    expect(contactState(s, 'RH')).toBe('searching');
    const seen = new Set<string>();
    for (let i = 0; i < 240; i++) {
      stepSling(s, holds);
      seen.add(contactState(s, 'RH'));
    }
    expect(seen.has('establishing')).toBe(true);
    expect(['engaged', 'loaded']).toContain(contactState(s, 'RH'));
  });
});

describe('in reach is not the same as holding it', () => {
  // Feet cut on a steep wall, one hand on a jug: reach the other for a hold.
  const steep = (target: Hold) => {
    const holds = [jug(1, -0.3, 2.0), jug(2, 0.3, 2.0), target];
    const s = onWall(holds, { LH: 1, RH: 2 }, 35);
    run(s, holds, 0.5);
    return { s, holds };
  };

  it('the jug sticks', () => {
    const { s, holds } = steep(jug(9, 0.45, 2.45));
    reach(s, holds, 'RH', 9);
    const events = run(s, holds, 2.5);
    expect(events.some((e) => e.kind === 'catch' && e.holdId === 9)).toBe(true);
    expect(s.limbs.RH.holdId).toBe(9);
  });

  it('the sloper, same place, same body: caught and then lost', () => {
    const { s, holds } = steep(sloper(9, 0.45, 2.45));
    reach(s, holds, 'RH', 9);
    const events = run(s, holds, 2.5);
    expect(events.some((e) => e.kind === 'catch' && e.holdId === 9)).toBe(true);
    expect(events.some((e) => e.kind === 'slip' && e.limb === 'RH')).toBe(true);
    expect(s.limbs.RH.holdId).not.toBe(9);
  });

  it('a tired forearm loses a crimp a fresh one keeps', () => {
    const holds = [crimp(1, -0.3, 2.0), crimp(2, 0.3, 2.0)];
    const fresh = onWall(holds, { LH: 1, RH: 2 }, 20);
    const tired = onWall(holds, { LH: 1, RH: 2 }, 20);
    tired.cond = { ...FRESH, grip: { LH: 0.08, RH: 0.08 } };
    const a = run(fresh, holds, 3);
    const b = run(tired, holds, 3);
    expect(a.some((e) => e.kind === 'slip')).toBe(false);
    expect(b.some((e) => e.kind === 'slip')).toBe(true);
  });
});

describe('feet', () => {
  it('a foot on a sloper on a steep wall skates; on a foothold it stays', () => {
    const make = (f: Hold) => {
      const holds = [jug(1, -0.3, 2.0), jug(2, 0.3, 2.0), f, foot(4, 0.3, 1.05)];
      const s = onWall(holds, { LH: 1, RH: 2, LF: 3, RF: 4 }, 50);
      return { s, holds, events: run(s, holds, 3) };
    };
    const good = make(foot(3, -0.3, 1.05));
    const bad = make({ ...sloper(3, -0.3, 1.05), size: 0.08 });
    expect(good.events.some((e) => e.kind === 'slip' && e.limb === 'LF')).toBe(false);
    expect(bad.events.some((e) => e.kind === 'slip' && e.limb === 'LF')).toBe(true);
  });

  it('a foot pressed on blank vertical wall below the hips smears; on a roof it does not', () => {
    const flat = [jug(1, -0.3, 2.0), jug(2, 0.3, 2.0), foot(3, -0.3, 1.0), foot(4, 0.3, 1.0)];
    const s = onWall(flat, { LH: 1, RH: 2, LF: 3, RF: 4 }, 0);
    run(s, flat, 0.5);
    launch(s, { limb: 'RF', dir: { x: 0.25, y: 0.97 }, power: 0.2 });
    const events = run(s, flat, 1.5);
    expect(events.some((e) => e.kind === 'tech' && e.tech === 'smear')).toBe(true);
    expect(s.limbs.RF.phase).toBe('held');
    expect(s.limbs.RF.holdId).toBeLessThan(0);

    const roof = onWall(flat, { LH: 1, RH: 2, LF: 3, RF: 4 }, 50);
    run(roof, flat, 0.5);
    launch(roof, { limb: 'RF', dir: { x: 0.25, y: 0.97 }, power: 0.2 });
    const ev2 = run(roof, flat, 1.5);
    expect(ev2.some((e) => e.kind === 'tech' && e.tech === 'smear')).toBe(false);
  });

  it('a foot out to the side at hip height flags, and stays out with the hips', () => {
    const holds = [jug(1, -0.3, 2.0), jug(2, 0.3, 2.0), foot(3, -0.3, 1.0), foot(4, 0.3, 1.0)];
    const s = onWall(holds, { LH: 1, RH: 2, LF: 3, RF: 4 }, 5);
    run(s, holds, 0.5);
    launch(s, { limb: 'RF', dir: { x: 0.7, y: 0.71 }, power: 0.4 });
    const events = run(s, holds, 1.5);
    expect(events.some((e) => e.kind === 'tech' && e.tech === 'flag')).toBe(true);
    expect(contactState(s, 'RF')).toBe('flagging');
    const off = s.limbs.RF.pos.x - s.hip.x;
    run(s, holds, 1);
    expect(s.limbs.RF.pos.x - s.hip.x).toBeCloseTo(off, 2);
  });

  it('a foot can take the other foot’s hold: the other hops off', () => {
    const holds = [jug(1, -0.3, 2.0), jug(2, 0.3, 2.0), foot(3, -0.1, 0.95), foot(4, 0.45, 1.0)];
    const s = onWall(holds, { LH: 1, RH: 2, LF: 3, RF: 4 });
    run(s, holds, 0.5);
    s.limbs.RF.phase = 'free';
    s.limbs.RF.holdId = null;
    run(s, holds, 0.8);
    const events: SlingEvent[] = [];
    expect(placeLimb(s, 'RF', 3, holds, events)).toBe(true);
    expect(events.some((e) => e.kind === 'tech' && e.tech === 'footSwap')).toBe(true);
    expect(s.limbs.LF.phase).toBe('free');
    expect(s.limbs.RF.holdId).toBe(3);
  });
});

describe('dynamic catches', () => {
  it('a dyno slammed into a jug sticks; the same dyno into a sloper does not hold', () => {
    const go = (top: Hold) => {
      const holds = [jug(1, -0.25, 1.6), jug(2, 0.25, 1.6), foot(3, -0.3, 0.7), foot(4, 0.3, 0.7), top];
      const s = onWall(holds, { LH: 1, RH: 2, LF: 3, RF: 4 }, 25);
      run(s, holds, 0.4);
      // A deliberately big one: the hands arrive still going up.
      expect(dynoGo(s)).toBe(true);
      const events = run(s, holds, 2.5);
      return { s, events };
    };
    const j = go({ ...jug(9, 0, 2.55), size: 0.16 });
    const sl = go({ ...sloper(9, 0, 2.55), size: 0.16 });
    expect(j.events.some((e) => e.kind === 'catch' && e.holdId === 9)).toBe(true);
    expect(j.s.fallen).toBe(false);
    expect(sl.s.limbs.LH.holdId === 9 && sl.s.limbs.RH.holdId === 9).toBe(false);
  });
});

import { dyno } from './sling';
function dynoGo(s: SlingState): boolean {
  return dyno(s, { dir: { x: 0, y: 1 }, power: 0.8 });
}

describe('technique is read off the body', () => {
  const holds = new Map<number, Hold>();
  const add = (h: Hold) => { holds.set(h.id, h); return h; };
  const limb = (pos: { x: number; y: number }, holdId: number | null, extra = {}) => ({ pos, phase: holdId === null ? 'free' as const : 'held' as const, holdId, ...extra });
  const read = (b: TechBody, angle = 0) => readTechnique(b, (id) => holds.get(id), () => deg(angle));

  it('a foot level with the hips and out wide on a steep wall is a drop knee', () => {
    add(jug(1, -0.3, 2.2)); add(jug(2, 0.3, 2.2)); add(foot(3, 0.5, 1.15)); add(foot(4, -0.2, 0.5));
    const b: TechBody = {
      hip: { x: 0, y: 1.2 }, shoulder: { x: 0, y: 1.72 },
      limbs: { LH: limb({ x: -0.3, y: 2.2 }, 1), RH: limb({ x: 0.3, y: 2.2 }, 2), RF: limb({ x: 0.5, y: 1.15 }, 3), LF: limb({ x: -0.2, y: 0.5 }, 4) },
    };
    expect(read(b, 30).active).toContain('dropKnee');
    expect(read(b, 0).active).not.toContain('dropKnee');
  });

  it('hands on holds facing each other are a compression move', () => {
    add(sidepull(11, -0.4, 2.0, { dir: RIGHT })); add(sidepull(12, 0.4, 2.0, { dir: LEFT }));
    const b: TechBody = {
      hip: { x: 0, y: 1.1 }, shoulder: { x: 0, y: 1.62 },
      limbs: { LH: limb({ x: -0.4, y: 2.0 }, 11), RH: limb({ x: 0.4, y: 2.0 }, 12), LF: limb({ x: -0.3, y: 0.5 }, null), RF: limb({ x: 0.3, y: 0.5 }, null) },
    };
    const r = read(b, 20);
    expect(r.active).toContain('compression');
    expect(r.active).toContain('cutLoose');
    expect(r.opposition.LH?.x).toBeGreaterThan(0);
    expect(r.opposition.RH?.x).toBeLessThan(0);
  });

  it('shoulders over a hand on a hold that faces up is a mantle', () => {
    add(jug(21, 0.1, 3.0, { dir: DOWN })); add(jug(22, -0.2, 3.0));
    const b: TechBody = {
      hip: { x: 0, y: 2.8 }, shoulder: { x: 0, y: 3.32 },
      limbs: { LH: limb({ x: -0.2, y: 3.0 }, 22), RH: limb({ x: 0.1, y: 3.0 }, 21), LF: limb({ x: -0.3, y: 2.0 }, null), RF: limb({ x: 0.3, y: 2.0 }, null) },
    };
    expect(read(b).active).toContain('mantle');
    // An undercling with the hips over it is being used the way it works.
    add({ ...jug(23, 0.1, 2.5), type: 'undercling', dir: UP });
    b.limbs.RH = limb({ x: 0.1, y: 2.5 }, 23);
    expect(read(b).active).toContain('undercling');
  });
});
