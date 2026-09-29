import { describe, expect, it } from 'vitest';
import type { Hold, LimbId } from './types';
import { LIMBS, isHand } from './types';
import { SLING_LAB } from '../content/lab';
import {
  type SlingEvent, type SlingState,
  SLING, aimFromPull, bodySpeed, canDyno, canLaunch, cloneSling, dyno, gradeOfSeat, heldCount,
  initialSling, isSlingSent, launch, launchSpeed, limbPositions, placeLimb, placeableHolds, poseOf,
  predictDyno, predictLaunch, seatOn, stepSling, dynoWindup, assistLaunch, type LaunchAim, isBand, SLING_LIMITS,
} from './sling';
import { anchorFor } from './body';
import { dist } from './vec';
import { beginAttempt, pullOn } from './attempt';

const holds = SLING_LAB.holds;
const byId = new Map(holds.map((h) => [h.id, h]));

function run(state: SlingState, seconds: number, events: SlingEvent[] = []): SlingEvent[] {
  const n = Math.round(seconds / SLING.dt);
  for (let i = 0; i < n; i++) stepSling(state, holds, SLING.dt, 0, events);
  return events;
}

const kinds = (events: SlingEvent[]) => events.map((e) => e.kind);
const start = () => initialSling(holds, SLING_LAB.start);

/** Scans directions and powers for a throw the preview says catches `holdId`. */
function findAim(state: SlingState, wall: Hold[], limb: LimbId, holdId: number) {
  for (let deg = -60; deg <= 60; deg += 5) {
    for (const power of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      const a = (deg * Math.PI) / 180;
      const aim = { limb, dir: { x: Math.sin(a), y: Math.cos(a) }, power };
      if (predictLaunch(state, wall, aim).caught?.holdId === holdId) return aim;
    }
  }
  return null;
}

describe('limb selection', () => {
  it('any limb can be picked up while it is holding on or dangling', () => {
    const s = start();
    for (const limb of LIMBS) expect(canLaunch(s, limb)).toBe(true);
  });

  it('a limb already in the air cannot be thrown again until it lands', () => {
    const s = start();
    expect(launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.6 })).toBe(true);
    expect(canLaunch(s, 'RH')).toBe(false);
    expect(launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.6 })).toBe(false);
    // The others are still free to go.
    expect(canLaunch(s, 'LH')).toBe(true);
  });

  it('nothing can be thrown once the climber is on the mat', () => {
    const s = start();
    s.fallen = true;
    for (const limb of LIMBS) expect(canLaunch(s, limb)).toBe(false);
  });
});

describe('the pull', () => {
  it('fires the limb the opposite way to the drag', () => {
    const aim = aimFromPull('RH', { x: 0, y: -100 }, 200);
    expect(aim.dir.x).toBeCloseTo(0, 6);
    expect(aim.dir.y).toBeCloseTo(1, 6);
    const diag = aimFromPull('LF', { x: 30, y: 40 }, 200);
    expect(diag.dir.x).toBeCloseTo(-0.6, 6);
    expect(diag.dir.y).toBeCloseTo(-0.8, 6);
    expect(Math.hypot(diag.dir.x, diag.dir.y)).toBeCloseTo(1, 6);
  });

  it('pulls harder the further it is drawn back, and no harder than full', () => {
    expect(aimFromPull('RH', { x: 0, y: -50 }, 200).power).toBeCloseTo(0.25, 6);
    expect(aimFromPull('RH', { x: 0, y: -200 }, 200).power).toBeCloseTo(1, 6);
    expect(aimFromPull('RH', { x: 0, y: -900 }, 200).power).toBe(1);
    expect(aimFromPull('RH', { x: 0, y: 0 }, 200).power).toBe(0);
  });

  it('turns power into speed, and a nothing pull into no launch', () => {
    expect(launchSpeed('RH', 1)).toBe(SLING.maxSpeedHand);
    expect(launchSpeed('LF', 0.5)).toBeCloseTo(SLING.maxSpeedFoot / 2, 6);
    const s = start();
    expect(launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.01 })).toBe(false);
    expect(s.limbs.RH.phase).toBe('held');
  });
});

describe('the launch', () => {
  it('lets go of the hold and sends the limb along the aim at the pulled speed', () => {
    const s = start();
    run(s, 0.5);
    const events: SlingEvent[] = [];
    const shV = { ...s.shV };
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.8 }, events);
    const rh = s.limbs.RH;
    expect(rh.phase).toBe('flying');
    expect(rh.holdId).toBeNull();
    expect(rh.leftHoldId).toBe(2);
    expect(rh.vel.x - shV.x).toBeCloseTo(0, 3);
    expect(rh.vel.y - shV.y).toBeCloseTo(launchSpeed('RH', 0.8), 3);
    expect(events).toEqual([{ kind: 'launch', limb: 'RH', from: rh.prev, power: 0.8 }]);
    // The body went with it — a throw is a lunge, not a detached hand.
    expect(s.shV.y).toBeGreaterThan(shV.y);
  });

  it('is deterministic: the same throws from the same state land the same', () => {
    const a = start();
    const b = cloneSling(a);
    for (const s of [a, b]) {
      launch(s, { limb: 'RH', dir: { x: 0.1, y: 1 }, power: 0.7 });
      run(s, 0.4);
      launch(s, { limb: 'LF', dir: { x: -0.2, y: 1 }, power: 0.9 });
      run(s, 1.5);
    }
    expect(limbPositions(a)).toEqual(limbPositions(b));
    expect(a.hip).toEqual(b.hip);
    expect(a.shoulder).toEqual(b.shoulder);
  });
});

describe('finding a hold', () => {
  it('a hand thrown through a jug grabs it, where it passed closest', () => {
    const s = start();
    const events = [] as SlingEvent[];
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.62 }, events);
    run(s, 1.2, events);
    const c = events.find((e) => e.kind === 'catch');
    expect(c && c.kind === 'catch' && c.holdId).toBe(8);
    expect(c && c.kind === 'catch' && c.grade).toBe('PERFECT');
    expect(s.limbs.RH.phase).toBe('held');
    expect(s.limbs.RH.holdId).toBe(8);
    const hold = byId.get(8)!;
    expect(Math.hypot(s.limbs.RH.pos.x - hold.pos.x, s.limbs.RH.pos.y - hold.pos.y)).toBeLessThan(0.08);
  });

  it('a foot thrown at a foot chip stands on it', () => {
    const s = start();
    const events = [] as SlingEvent[];
    launch(s, { limb: 'RF', dir: { x: 0.1, y: 1 }, power: 0.7 }, events);
    run(s, 1.2, events);
    expect(kinds(events)).toContain('catch');
    expect(s.limbs.RF.holdId).toBe(6);
  });

  it('a hand thrown at a foot chip goes straight through it', () => {
    // A hand-only wall: one chip directly above the start jug.
    const chipWall: Hold[] = [
      ...holds.filter((h) => [1, 2, 3, 4].includes(h.id)),
      { id: 99, pos: { x: 0.3, y: 2.0 }, type: 'foothold', size: 0.12, dir: -Math.PI / 2 },
    ];
    const s = initialSling(chipWall, SLING_LAB.start);
    const events = [] as SlingEvent[];
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.62 }, events);
    for (let i = 0; i < 150; i++) stepSling(s, chipWall, SLING.dt, 0, events);
    expect(kinds(events)).not.toContain('catch');
    const miss = events.find((e) => e.kind === 'miss');
    expect(miss && miss.kind === 'miss' && miss.reason).toMatch(/foot chip/);
  });

  it('will not put a second hand on a hold with no room for one', () => {
    const crimpWall: Hold[] = [
      ...holds.filter((h) => [1, 2, 3, 4].includes(h.id)),
      { id: 50, pos: { x: 0.0, y: 2.0 }, type: 'crimp', size: 0.095, dir: -Math.PI / 2 },
    ];
    const s = initialSling(crimpWall, SLING_LAB.start);
    // Both hands can get there from the start.
    expect(findAim(s, crimpWall, 'LH', 50)).not.toBeNull();
    expect(findAim(s, crimpWall, 'RH', 50)).not.toBeNull();
    launch(s, findAim(s, crimpWall, 'LH', 50)!);
    for (let i = 0; i < 150; i++) stepSling(s, crimpWall, SLING.dt);
    expect(s.limbs.LH.holdId).toBe(50);
    // Now there is a hand on it, and a crimp has no room for two.
    expect(findAim(s, crimpWall, 'RH', 50)).toBeNull();
  });

  it('grades a catch by which part of the shape it found', () => {
    const jug = byId.get(8)!;
    const centre = seatOn(jug, jug.pos);
    const edge = seatOn(jug, { x: jug.pos.x + 0.1, y: jug.pos.y });
    expect(centre.seat).toBeGreaterThan(edge.seat);
    expect(gradeOfSeat(centre.seat)).toBe('PERFECT');
    expect(gradeOfSeat(0.6)).toBe('GOOD');
    expect(gradeOfSeat(0.3)).toBe('SCRAPE');
  });
});

describe('attachment', () => {
  it('pins the limb, then the body settles onto it', () => {
    const s = start();
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.62 });
    run(s, 2.0);
    expect(s.limbs.RH.phase).toBe('held');
    expect(s.limbs.RH.vel).toEqual({ x: 0, y: 0 });
    expect(heldCount(s)).toBe(4);
    expect(bodySpeed(s)).toBeLessThan(0.2);
  });

  it('the hold takes the load — it reports it, and it is under what it can hold', () => {
    const s = initialSling(holds, { LH: 18 });
    run(s, 2.5);
    const lh = s.limbs.LH;
    expect(lh.phase).toBe('held');
    // One arm, hanging still: about one body weight.
    expect(lh.tension).toBeGreaterThan(0.5);
    expect(lh.tension).toBeLessThan(1.1);
    expect(lh.tension).toBeLessThan(lh.capacity);
  });
});

describe('a miss', () => {
  it('actually misses: the limb dangles and is not snapped to the nearest hold', () => {
    const s = start();
    const events = [] as SlingEvent[];
    // A limp throw straight up: the hand comes back down right past the jug
    // it left, and the jug does not take it back.
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.3 }, events);
    run(s, 1.5, events);
    expect(kinds(events)).toContain('miss');
    expect(kinds(events)).not.toContain('catch');
    expect(s.limbs.RH.phase).toBe('free');
    expect(s.limbs.RH.holdId).toBeNull();
    // Dangling below the shoulder, not parked on a hold.
    expect(s.limbs.RH.pos.y).toBeLessThan(s.shoulder.y);
    const miss = events.find((e) => e.kind === 'miss');
    expect(miss && miss.kind === 'miss' && miss.reason.length).toBeGreaterThan(0);
  });

  it('a dangling limb does not grab holds it swings past', () => {
    const s = start();
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.3 });
    run(s, 1.5);
    expect(s.limbs.RH.phase).toBe('free');
    const events = run(s, 3.0);
    expect(kinds(events)).not.toContain('catch');
    expect(s.limbs.RH.phase).toBe('free');
  });

  it('a limb thrown too far for the body simply cannot arrive', () => {
    const s = start();
    const events = [] as SlingEvent[];
    // The far jug, a metre and a half up from a low stance.
    launch(s, { limb: 'RH', dir: { x: -0.2, y: 1 }, power: 1 }, events);
    run(s, 1.5, events);
    expect(s.limbs.RH.holdId).not.toBe(17);
  });
});

describe('the body', () => {
  it('stands still at the start with all four limbs on', () => {
    const s = start();
    run(s, 3);
    expect(heldCount(s)).toBe(4);
    expect(bodySpeed(s)).toBeLessThan(0.05);
    const lean = Math.atan2(s.shoulder.x - s.hip.x, s.shoulder.y - s.hip.y);
    expect(Math.abs(lean)).toBeLessThan(0.05);
  });

  it('comes with a thrown limb once the tether goes taut', () => {
    const s = initialSling(holds, { LH: 7, RH: 8 });
    run(s, 1);
    const before = { ...s.shoulder };
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 1 });
    let highest = before.y;
    for (let i = 0; i < 60; i++) {
      stepSling(s, holds, SLING.dt);
      highest = Math.max(highest, s.shoulder.y);
    }
    expect(highest).toBeGreaterThan(before.y + 0.05);
  });

  it('swings under a single hand held off to the side', () => {
    const s = initialSling(holds, { LH: 18 }, 0, 0);
    // Start the body displaced to one side of the hold.
    s.hip.x = s.limbs.LH.pos.x + 0.5;
    s.shoulder.x = s.hip.x;
    const xs: number[] = [];
    for (let i = 0; i < 240; i++) {
      stepSling(s, holds, SLING.dt);
      if (i % 20 === 0) xs.push(s.hip.x);
    }
    // It went back toward under the hold, and it did not simply stop there.
    expect(Math.min(...xs)).toBeLessThan(s.limbs.LH.pos.x + 0.2);
    const leans = xs.map((_, i) => i);
    expect(leans.length).toBeGreaterThan(0);
    expect(s.limbs.LH.phase).toBe('held');
  });

  it('rotates: a sideways throw off one hand turns the torso', () => {
    const s = initialSling(holds, { LH: 18 });
    run(s, 1);
    const before = Math.atan2(s.shoulder.x - s.hip.x, s.shoulder.y - s.hip.y);
    launch(s, { limb: 'RH', dir: { x: 1, y: 0.2 }, power: 1 });
    let most = 0;
    for (let i = 0; i < 90; i++) {
      stepSling(s, holds, SLING.dt);
      const lean = Math.atan2(s.shoulder.x - s.hip.x, s.shoulder.y - s.hip.y);
      most = Math.max(most, Math.abs(lean - before));
    }
    expect(most).toBeGreaterThan(0.12);
  });

  it('an undercling loaded from below lets go, and says why', () => {
    const s = initialSling(holds, { LH: 23, RH: 25 });
    const events = run(s, 2);
    const slip = events.find((e) => e.kind === 'slip' && e.limb === 'LH');
    expect(slip).toBeDefined();
    expect(slip && slip.kind === 'slip' && slip.reason).toMatch(/angle/i);
    // The jug next to it took the weight instead.
    expect(s.limbs.RH.holdId).toBe(25);
  });

  it('with nothing left holding on, the climber comes off and meets the mat', () => {
    const s = start();
    run(s, 1);
    const events: SlingEvent[] = [];
    // Everything thrown at the mat. There is nothing down there to catch.
    for (const limb of LIMBS) launch(s, { limb, dir: { x: 0, y: -1 }, power: 0.6 }, events);
    run(s, 4, events);
    expect(kinds(events)).toContain('off');
    expect(kinds(events)).toContain('fell');
    expect(s.fallen).toBe(true);
    expect(s.hip.y).toBeLessThanOrEqual(SLING.matHip + 1e-6);
    // Nothing moves once it is over.
    const hip = { ...s.hip };
    run(s, 1);
    expect(s.hip).toEqual(hip);
  });

  it('reads out as a pose the renderer can draw', () => {
    const s = start();
    const pose = poseOf(s);
    expect(pose.head.y).toBeGreaterThan(pose.shoulder.y);
    expect(pose.shoulder.y).toBeGreaterThan(pose.hip.y);
    expect(pose.stability).toBeGreaterThan(0);
  });
});

describe('the aim preview is honest', () => {
  it('predicts the hold the real launch catches', () => {
    const s = start();
    const aim = { limb: 'RH' as LimbId, dir: { x: 0, y: 1 }, power: 0.62 };
    const guess = predictLaunch(s, holds, aim);
    expect(guess.caught?.holdId).toBe(8);
    expect(guess.path.length).toBeGreaterThan(5);
    const events: SlingEvent[] = [];
    launch(s, aim, events);
    run(s, 1.2, events);
    const real = events.find((e) => e.kind === 'catch');
    expect(real && real.kind === 'catch' && real.holdId).toBe(guess.caught!.holdId);
  });

  it('does not touch the state it was asked about', () => {
    const s = start();
    const snap = JSON.stringify(s);
    predictLaunch(s, holds, { limb: 'LF', dir: { x: 0, y: 1 }, power: 0.9 });
    expect(JSON.stringify(s)).toBe(snap);
  });
});

describe('aim assist', () => {
  const rotate = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: Math.sin(a), y: Math.cos(a) };
  };

  it('steers a near miss onto the hold it was meant for, and the real throw agrees', () => {
    const s = start();
    // Walk the throw off the jug until it misses outright.
    let aim: LaunchAim | null = null;
    for (let deg = 4; deg <= 20; deg += 1) {
      const a = { limb: 'RH' as LimbId, dir: rotate(deg), power: 0.62 };
      if (!predictLaunch(s, holds, a).caught) { aim = a; break; }
    }
    expect(aim).not.toBeNull();
    const help = assistLaunch(s, holds, aim!);
    expect(help.assisted).not.toBeNull();
    expect(help.prediction.caught?.holdId).toBe(help.assisted);
    expect(Math.abs(help.aim.power - aim!.power)).toBeLessThanOrEqual(0.12 + 1e-9);
    const events: SlingEvent[] = [];
    launch(s, help.aim, events);
    run(s, 1.2, events);
    const real = events.find((e) => e.kind === 'catch');
    expect(real && real.kind === 'catch' && real.holdId).toBe(help.assisted);
  });

  it('leaves a throw alone that already catches, or is nowhere near anything', () => {
    const s = start();
    const good = { limb: 'RH' as LimbId, dir: { x: 0, y: 1 }, power: 0.62 };
    expect(assistLaunch(s, holds, good)).toMatchObject({ aim: good, assisted: null });
    const wild = { limb: 'RH' as LimbId, dir: { x: 0, y: -1 }, power: 0.6 };
    expect(assistLaunch(s, holds, wild)).toMatchObject({ aim: wild, assisted: null });
  });
});

describe('sending', () => {
  it('is both hands matched on the finish, settled', () => {
    const s = initialSling(holds, { LH: 30, RH: 30, LF: 26, RF: 27 });
    run(s, 2);
    expect(isSlingSent(s, SLING_LAB.finish)).toBe(true);
    const one = initialSling(holds, { LH: 30, RH: 25, LF: 26, RF: 27 });
    run(one, 2);
    expect(isSlingSent(one, SLING_LAB.finish)).toBe(false);
  });
});

describe('the dyno', () => {
  it('needs something to jump off', () => {
    const s = start();
    expect(canDyno(s)).toBe(true);
    for (const limb of LIMBS) launch(s, { limb, dir: { x: 0, y: -1 }, power: 0.5 });
    expect(canDyno(s)).toBe(false);
    expect(dyno(s, { dir: { x: 0, y: 1 }, power: 1 })).toBe(false);
  });

  it('takes everything off the wall and throws the whole body', () => {
    const s = start();
    run(s, 0.5);
    const hip = { ...s.hip };
    const events: SlingEvent[] = [];
    expect(dyno(s, { dir: { x: 0, y: 1 }, power: 0.8 }, events)).toBe(true);
    expect(heldCount(s)).toBe(0);
    expect(s.limbs.LH.phase).toBe('flying');
    expect(s.limbs.RH.phase).toBe('flying');
    expect(s.limbs.LF.phase).toBe('free');
    expect(s.dyno).toBe(true);
    expect(events[0].kind).toBe('dyno');
    expect(s.hipV.y).toBeGreaterThan(3);
    for (let i = 0; i < 24; i++) stepSling(s, holds, SLING.dt);
    expect(s.hip.y).toBeGreaterThan(hip.y + 0.2);
  });

  it('sticks it two-handed on a good pull, and the preview agrees', () => {
    const s = start();
    run(s, 0.5);
    const aim = { dir: { x: 0, y: 1 }, power: 0.8 };
    const guess = predictDyno(s, holds, aim);
    expect(guess.caught.map((c) => c.holdId).sort()).toEqual([7, 8]);
    const events: SlingEvent[] = [];
    dyno(s, aim, events);
    run(s, 2.5, events);
    const catches = events.filter((e) => e.kind === 'catch');
    expect(catches).toHaveLength(2);
    expect(catches.every((c) => c.kind === 'catch' && c.dyno)).toBe(false);
    expect(catches.some((c) => c.kind === 'catch' && c.dyno)).toBe(true);
    expect(s.limbs.LH.holdId).toBe(7);
    expect(s.limbs.RH.holdId).toBe(8);
    expect(s.dyno).toBe(false);
    expect(s.fallen).toBe(false);
  });

  it('can be stuck one-handed, swinging', () => {
    const s = start();
    run(s, 0.5);
    const events: SlingEvent[] = [];
    dyno(s, { dir: { x: 0.55, y: 0.83 }, power: 1 }, events);
    run(s, 2.5, events);
    const held = LIMBS.filter((l) => s.limbs[l].phase === 'held');
    expect(held).toHaveLength(1);
    expect(s.fallen).toBe(false);
  });

  it('draws back against the limbs on the wall, and lets go from there', () => {
    const s = start();
    run(s, 0.5);
    const pull = { x: 0, y: -1 };
    const wind = dynoWindup(s, pull, 1);
    expect(wind.y).toBeLessThan(0);
    expect(wind.y).toBeGreaterThanOrEqual(-SLING.dynoWindup - 1e-9);
    // No band is stretched past what the limb can do.
    const hip = { x: s.hip.x + wind.x, y: s.hip.y + wind.y };
    const shoulder = { x: s.shoulder.x + wind.x, y: s.shoulder.y + wind.y };
    for (const id of LIMBS) {
      if (!isBand(s.limbs[id])) continue;
      const before = dist(anchorFor(id, s.hip, s.shoulder), s.limbs[id].pos);
      const max = Math.max(before, (isHand(id) ? SLING_LIMITS.ARM_MAX : SLING_LIMITS.LEG_MAX) * 0.97);
      expect(dist(anchorFor(id, hip, shoulder), s.limbs[id].pos)).toBeLessThanOrEqual(max + 1e-6);
    }
    const aim = { dir: { x: 0, y: 1 }, power: 0.8, wind };
    const guess = predictDyno(s, holds, aim);
    const events: SlingEvent[] = [];
    const hipBefore = { ...s.hip };
    expect(dyno(s, aim, events)).toBe(true);
    const ev = events[0];
    expect(ev.kind === 'dyno' && ev.from.y).toBeCloseTo(hipBefore.y + wind.y, 9);
    run(s, 2.5, events);
    const caught = events.filter((e) => e.kind === 'catch').map((e) => e.kind === 'catch' && e.holdId);
    expect(caught.slice(0, guess.caught.length)).toEqual(guess.caught.map((c) => c.holdId));
  });

  it('a weak one is a fall, not a dangle', () => {
    const s = start();
    run(s, 0.5);
    const events: SlingEvent[] = [];
    dyno(s, { dir: { x: 0, y: 1 }, power: 0.4 }, events);
    run(s, 3, events);
    expect(kinds(events)).not.toContain('catch');
    expect(kinds(events)).toContain('fell');
    expect(s.fallen).toBe(true);
  });
});

describe('putting a dangling limb back', () => {
  it('only offers holds within reach that the limb can use', () => {
    const s = start();
    expect(placeableHolds(s, holds, 'RH')).toHaveLength(0); // it is holding on
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.3 });
    run(s, 1.5);
    expect(s.limbs.RH.phase).toBe('free');
    const ids = placeableHolds(s, holds, 'RH').map((h) => h.id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(17); // a metre and a half up
    expect(ids).not.toContain(4); // a foot chip
  });

  it('puts it straight on, as a sound placement rather than a perfect one', () => {
    const s = start();
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.3 });
    run(s, 1.5);
    const events: SlingEvent[] = [];
    expect(placeLimb(s, 'RH', 2, holds, events)).toBe(true);
    expect(events[0]).toMatchObject({ kind: 'place', limb: 'RH', holdId: 2 });
    expect(s.limbs.RH.phase).toBe('held');
    expect(s.limbs.RH.grade).toBe('GOOD');
    run(s, 1);
    expect(heldCount(s)).toBe(4);
    expect(bodySpeed(s)).toBeLessThan(0.2);
  });

  it('refuses a limb that is holding on, and a hold that is out of reach', () => {
    const s = start();
    expect(placeLimb(s, 'LH', 7, holds)).toBe(false);
    launch(s, { limb: 'RH', dir: { x: 0, y: 1 }, power: 0.3 });
    run(s, 1.5);
    expect(placeLimb(s, 'RH', 17, holds)).toBe(false);
    expect(s.limbs.RH.phase).toBe('free');
  });
});

describe('no clock', () => {
  it('the attempt record has no endurance and nothing drains', () => {
    const attempt = pullOn(beginAttempt(SLING_LAB, 'onsight', 0));
    expect('endurance' in attempt).toBe(false);
    const s = start();
    expect('endurance' in s).toBe(false);
    // Standing on the wall for half a minute changes nothing: nobody comes
    // off for taking their time.
    const hip = { ...s.hip };
    const events = run(s, 30);
    expect(kinds(events)).not.toContain('slip');
    expect(kinds(events)).not.toContain('off');
    expect(s.fallen).toBe(false);
    expect(heldCount(s)).toBe(4);
    expect(bodySpeed(s)).toBeLessThan(0.01);
    expect(Math.hypot(s.hip.x - hip.x, s.hip.y - hip.y)).toBeLessThan(0.01);
  });
});
