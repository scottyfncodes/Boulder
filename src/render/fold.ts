import * as THREE from 'three';
import { type WallProfile, FLAT, angleAt } from '../game/profile';

/**
 * Wall space to the world, for a wall that bends.
 *
 * The sim works on the wall unrolled flat: x across, y up the surface. This
 * rolls it back up. A point at height y sits on the surface where walking y
 * metres up it from the floor gets you, and anything standing out of the wall
 * by z stands out along the surface's own normal there. Everything drawn on
 * or off the wall — panels, holds, the climber, the overlay's markers — goes
 * through here, so a reticle on a hold on a roof is on the hold.
 *
 * The surface is walked once into a table, a centimetre at a time, and read
 * back by interpolation: cheap enough to call for every vertex of the climber
 * every frame.
 */

const STEP = 0.01;
const FROM = -2;
const TO = 20;

export class WallWarp {
  readonly profile: WallProfile;
  private ys: Float64Array;
  private zs: Float64Array;
  private as: Float64Array;

  constructor(profile: WallProfile = FLAT) {
    this.profile = profile;
    const n = Math.round((TO - FROM) / STEP) + 1;
    this.ys = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.as = new Float64Array(n);
    const i0 = Math.round(-FROM / STEP);
    for (let i = 0; i < n; i++) this.as[i] = angleAt(profile, FROM + i * STEP);
    // Walk up from the floor, and down from it for the bit under the mat.
    for (let i = i0 + 1; i < n; i++) {
      const a = (this.as[i - 1] + this.as[i]) / 2;
      this.ys[i] = this.ys[i - 1] + Math.cos(a) * STEP;
      this.zs[i] = this.zs[i - 1] + Math.sin(a) * STEP;
    }
    for (let i = i0 - 1; i >= 0; i--) {
      const a = (this.as[i + 1] + this.as[i]) / 2;
      this.ys[i] = this.ys[i + 1] - Math.cos(a) * STEP;
      this.zs[i] = this.zs[i + 1] - Math.sin(a) * STEP;
    }
  }

  private at(y: number): { i: number; t: number } {
    const f = (Math.min(TO, Math.max(FROM, y)) - FROM) / STEP;
    const i = Math.min(this.as.length - 2, Math.floor(f));
    return { i, t: f - i };
  }

  /** The lean of the surface at height y, radians. */
  angle(y: number): number {
    const { i, t } = this.at(y);
    return this.as[i] + (this.as[i + 1] - this.as[i]) * t;
  }

  /** A wall-space point, out of the wall by z, in the world. */
  point(x: number, y: number, z = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const { i, t } = this.at(y);
    let by = this.ys[i] + (this.ys[i + 1] - this.ys[i]) * t;
    let bz = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    // Off the ends of the table the surface carries straight on.
    if (y > TO) { const a = this.as[this.as.length - 1]; by += Math.cos(a) * (y - TO); bz += Math.sin(a) * (y - TO); }
    if (y < FROM) { const a = this.as[0]; by += Math.cos(a) * (y - FROM); bz += Math.sin(a) * (y - FROM); }
    const a = this.angle(y);
    return out.set(x, by - Math.sin(a) * z, bz + Math.cos(a) * z);
  }

  /** How the wall's own frame is turned at height y: a lean back about x. */
  frame(y: number, out = new THREE.Quaternion()): THREE.Quaternion {
    return out.setFromAxisAngle(X_AXIS, this.angle(y));
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();

/**
 * Puts an object on the wall: at wall point (x, y), z out, turned `roll`
 * about the wall's normal and then by whatever extra it already wants.
 */
export function placeOn(
  warp: WallWarp, obj: THREE.Object3D, x: number, y: number, z: number, roll = 0, extra?: THREE.Euler,
): void {
  warp.point(x, y, z, obj.position);
  warp.frame(y, obj.quaternion);
  if (roll) obj.quaternion.multiply(tmpQ.setFromAxisAngle(Z_AXIS, roll));
  if (extra) obj.quaternion.multiply(tmpQ.setFromEuler(extra));
}

/**
 * A strip of the wall's surface, as geometry: x from x0 to x1, y from y0 to
 * y1, sitting z out. Used for the panels and the seams that run up them.
 */
export function surfaceStrip(
  warp: WallWarp, x0: number, x1: number, y0: number, y1: number, z = 0, dy = 0.05,
): THREE.BufferGeometry {
  const rows = Math.max(1, Math.ceil((y1 - y0) / dy));
  const pos: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let r = 0; r <= rows; r++) {
    const y = y0 + ((y1 - y0) * r) / rows;
    for (const x of [x0, x1]) {
      warp.point(x, y, z, v);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let r = 0; r < rows; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
