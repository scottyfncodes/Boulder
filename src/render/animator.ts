import type { Contact, LimbId, Pose, Vec2 } from '../game/types';
import { LIMBS, isHand, isLeft } from '../game/types';
import { anchorFor, BODY } from '../game/body';

/**
 * Where limbs hang when nothing is holding them, for stills.
 *
 * The live game gets limb positions from the physics; this is for the places
 * that need a climber drawn from a static set of contacts, like the app icon.
 */

export type LimbMap = Record<LimbId, Vec2>;

/**
 * Dead weight. A limb off the wall hangs from the shoulder or hip at almost
 * full length, points at the floor, and swings on its own slow pendulum.
 */
export function danglePos(limb: LimbId, pose: Pose, t = 0): Vec2 {
  const anchor = anchorFor(limb, pose.hip, pose.shoulder);
  const length = (isHand(limb) ? BODY.arm : BODY.leg) * 0.96;
  const side = isLeft(limb) ? -1 : 1;
  const sway = Math.sin(t * 0.0026 + (isLeft(limb) ? 0 : 1.7)) * 0.13
    + Math.sin(t * 0.0071 + (isHand(limb) ? 0 : 2.3)) * 0.05;
  const outward = side * (isHand(limb) ? 0.1 : 0.14) + sway;
  const angle = -Math.PI / 2 + outward;
  return {
    x: anchor.x + Math.cos(angle) * length,
    y: anchor.y + Math.sin(angle) * length,
  };
}

/** Current position of every limb for a settled set of contacts. */
export function limbsFor(contacts: Contact[], pose: Pose, t = 0): LimbMap {
  const map = {} as LimbMap;
  for (const limb of LIMBS) {
    const c = contacts.find((x) => x.limb === limb);
    map[limb] = c ? { ...c.pos } : danglePos(limb, pose, t);
  }
  return map;
}
