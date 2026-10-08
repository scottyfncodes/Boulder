import type { Hold, LimbId, Vec2 } from './types';
import { LIMBS, isHand } from './types';
import { BODY, anchorFor } from './body';
import { canUse, contactRadius } from './holds';
import { dist } from './vec';

/**
 * Free reach.
 *
 * A limb does not reach from a fixed shoulder. The climber moves their body to
 * get it there: hips shift, the torso leans, whatever is still on the wall
 * stretches out — and only as far as those limbs let it. So where a limb can
 * get to is every point within its length of anywhere its anchor could be
 * carried by a body that keeps everything else on.
 *
 * That makes the next move depend on the last one. A hand on a far left hold
 * pins the shoulders left; a high foot holds the hips up; feet wide apart let
 * the hips go sideways. The envelope is the shape all of that leaves.
 *
 * It is pure geometry and deterministic. The sim (`sling.ts`) is what actually
 * moves the body on a throw; this is the same constraint set, solved ahead of
 * time, so the outline on screen is where the physics can go.
 */

/** A body position the climber could hold: where the hips and shoulders are. */
export type BodyPose = { hip: Vec2; shoulder: Vec2 };

/** The limits the physics uses. Passed in so the two cannot drift apart. */
export type ReachLimits = {
  arm: number; leg: number; maxLean: number; hipMin: number; stance: number;
  /** How far the shoulders can go over the highest hand that is holding them. */
  press: number;
  /** Highest a foot goes over its own hip: a high step, not a foot by your ear. */
  highStep: number;
  /** How much of its length a standing foot lets the hips stretch away from it. */
  footHold: number;
};

/** What the envelope needs to know about the body: where it is and what is on. */
export type ReachBody = {
  hip: Vec2;
  shoulder: Vec2;
  /** Where each limb is, and whether it is holding on. */
  limbs: Record<LimbId, { pos: Vec2; held: boolean; hooked?: boolean }>;
};

/** Grid the hips are searched over, metres. */
const STEP = 0.06;
/** Torso leans tried, radians off vertical. */
const LEANS = [-0.55, -0.28, 0, 0.28, 0.55];

/** Hip positions (and torso leans) the climber can hold while keeping `limb`'s companions on. */
export function bodyPoses(body: ReachBody, limb: LimbId, lim: ReachLimits): BodyPose[] {
  const held = LIMBS.filter((id) => id !== limb && body.limbs[id].held);
  const now: BodyPose = { hip: { ...body.hip }, shoulder: { ...body.shoulder } };
  // Nothing else on: the body has nowhere to push from. It reaches from where it is.
  if (held.length === 0) return [now];

  const maxOf = (id: LimbId) => (isHand(id) ? lim.arm : body.limbs[id].hooked ? lim.leg : lim.leg * lim.footHold);
  // Every limb that stays on bounds where the hips can go: within its length
  // of the hold, give or take the torso and the width of the shoulders.
  let x0 = -Infinity; let x1 = Infinity; let y0 = lim.hipMin; let y1 = Infinity;
  for (const id of held) {
    const p = body.limbs[id].pos;
    const r = maxOf(id) + (isHand(id) ? BODY.torso + BODY.shoulderHalf : BODY.hipHalf) + STEP;
    x0 = Math.max(x0, p.x - r); x1 = Math.min(x1, p.x + r);
    y0 = Math.max(y0, p.y - r); y1 = Math.min(y1, p.y + r);
  }
  if (x0 > x1 || y0 > y1) return [now];

  // Balance. With no hand and no hook left on, the hips have to stay over the
  // feet: a climber standing on two footholds cannot lean out to reach.
  const handOn = held.some((id) => isHand(id) || body.limbs[id].hooked);
  if (!handOn) {
    const fx = held.map((id) => body.limbs[id].pos.x);
    x0 = Math.max(x0, Math.min(...fx) - lim.stance);
    x1 = Math.min(x1, Math.max(...fx) + lim.stance);
  }

  // Hands pull the body up to them, not over them.
  const hands = held.filter(isHand);
  const shoulderTop = hands.length ? Math.max(...hands.map((id) => body.limbs[id].pos.y)) + lim.press : Infinity;

  const out: BodyPose[] = [now];
  const leans = handOn ? LEANS : [0];
  for (let x = x0; x <= x1; x += STEP) {
    for (let y = y0; y <= y1; y += STEP) {
      for (const a of leans) {
        if (Math.abs(a) > lim.maxLean) continue;
        const hip = { x, y };
        const shoulder = { x: x + Math.sin(a) * BODY.torso, y: y + Math.cos(a) * BODY.torso };
        if (shoulder.y > shoulderTop) continue;
        let ok = true;
        for (const id of held) {
          if (dist(anchorFor(id, hip, shoulder), body.limbs[id].pos) > maxOf(id)) { ok = false; break; }
        }
        if (ok) out.push({ hip, shoulder });
      }
    }
  }
  return out;
}

/** The reach envelope for one limb: every body pose it can reach from, solved once. */
export type Envelope = {
  limb: LimbId;
  max: number;
  /** Where the limb's shoulder or hip can be carried to. */
  anchors: Vec2[];
  /** The body poses those anchors come from, same order. */
  poses: BodyPose[];
  /** Highest the limb can go from each of them: a foot no higher than a high step. */
  tops: number[];
};

export function envelopeOf(body: ReachBody, limb: LimbId, lim: ReachLimits): Envelope {
  const poses = bodyPoses(body, limb, lim);
  return {
    limb,
    max: isHand(limb) ? lim.arm : lim.leg,
    anchors: poses.map((p) => anchorFor(limb, p.hip, p.shoulder)),
    poses,
    // A foot can go up past a high step — a heel or toe hook — only from
    // where the hips already are; the hips do not climb to put it there.
    tops: poses.map((p, i) => (isHand(limb) || i === 0 ? Infinity : p.hip.y + lim.highStep)),
  };
}

/** Whether a point is in the envelope, with `slack` metres of give (a hold's radius). */
export function inEnvelope(env: Envelope, p: Vec2, slack = 0): boolean {
  const r = env.max + slack;
  for (let i = 0; i < env.anchors.length; i++) {
    if (p.y - slack <= env.tops[i] && dist(env.anchors[i], p) <= r) return true;
  }
  return false;
}

/**
 * The outline of the envelope as a ring of points around the limb's anchor:
 * in each direction, the furthest the limb can get. Not a circle — it bulges
 * wherever the body can follow and pinches wherever it is pinned.
 */
export function envelopeOutline(env: Envelope, centre: Vec2, n = 96): Vec2[] {
  const out: Vec2[] = [];
  const r = env.max;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let far = 0;
    for (let k = 0; k < env.anchors.length; k++) {
      const a = env.anchors[k];
      // The stretch of the ray centre + s·d inside the disc round `a`...
      const ox = centre.x - a.x;
      const oy = centre.y - a.y;
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      let lo = -b - Math.sqrt(disc);
      let hi = -b + Math.sqrt(disc);
      // ...and under that pose's ceiling.
      const top = env.tops[k];
      if (top !== Infinity) {
        if (Math.abs(dy) < 1e-9) { if (centre.y > top) continue; }
        else if (dy > 0) hi = Math.min(hi, (top - centre.y) / dy);
        else lo = Math.max(lo, (top - centre.y) / dy);
      }
      if (hi >= Math.max(lo, 0) && hi > far) far = hi;
    }
    out.push({ x: centre.x + dx * far, y: centre.y + dy * far });
  }
  return out;
}

/** Holds a limb can get to in the envelope: usable by it, and not in `blocked`. */
export function holdsInEnvelope(env: Envelope, holds: Hold[], blocked: Set<number>, slack = 0.05): Hold[] {
  return holds.filter((h) =>
    canUse(h.type, env.limb) && !blocked.has(h.id) && inEnvelope(env, h.pos, slack + contactRadius(h.size, h.type)),
  );
}
