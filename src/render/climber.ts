import * as THREE from 'three';
import type { LimbId, Pose, Vec2 } from '../game/types';
import { isHand } from '../game/types';
import { anchorFor, BODY } from '../game/body';
import { GYM } from './palette';
import { type Outfit, awardById } from '../game/awards';

/**
 * The climber.
 *
 * A jointed puppet rather than a person: chunky limbs, a big readable head, and
 * no pretence that it is enjoying this. Everything is driven from the two
 * points the sim actually solves — hip and shoulder — plus wherever the four
 * limbs currently are. The renderer never invents body positions the sim did
 * not produce, which is what keeps a failure legible: if the climber looks
 * stretched, it is because it is stretched.
 */

/**
 * What the face is doing.
 *
 * The face is the strain readout now — there are no coloured lines on the wall
 * telling you a limb is loaded, because a climber reads that off another
 * climber's face, not off a diagram.
 */
export type Mood =
  | 'calm' | 'focus' | 'working' | 'strain' | 'gurn' | 'panic'
  | 'smug' | 'done' | 'yell';

const UPPER_ARM = BODY.arm * 0.5;
const LOWER_ARM = BODY.arm * 0.5;
const UPPER_LEG = BODY.leg * 0.5;
const LOWER_LEG = BODY.leg * 0.5;

/**
 * Places the elbow or knee for a two-bone limb.
 *
 * There are always two valid solutions — the joint can pop out either side of
 * the line from shoulder to hand. Picking a fixed side looks fine when the limb
 * is extended and grotesque when it is folded up, so instead both are solved
 * and the one that looks like a body is chosen: elbows hang toward the floor,
 * knees splay away from the midline.
 */
export function twoBoneJoint(
  a: Vec2, b: Vec2, l1: number, l2: number, prefer: 'down' | 'out', midX: number,
): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(Math.hypot(dx, dy), 1e-5);
  const reach = Math.min(d, (l1 + l2) * 0.999);
  // Distance along the a→b axis to the joint's projection.
  const t = (reach * reach + l1 * l1 - l2 * l2) / (2 * reach);
  const h = Math.sqrt(Math.max(l1 * l1 - t * t, 0));
  const ux = dx / d;
  const uy = dy / d;
  const baseX = a.x + ux * t;
  const baseY = a.y + uy * t;

  const one = { x: baseX - uy * h, y: baseY + ux * h };
  const two = { x: baseX + uy * h, y: baseY - ux * h };

  if (prefer === 'down') return one.y <= two.y ? one : two;
  return Math.abs(one.x - midX) >= Math.abs(two.x - midX) ? one : two;
}

function limbMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02 });
}

/** A cylinder that can be re-aimed between two points each frame. */
class Bone {
  mesh: THREE.Mesh;
  constructor(radius: number, mat: THREE.Material) {
    const g = new THREE.CylinderGeometry(radius, radius * 0.92, 1, 7, 1);
    g.translate(0, 0.5, 0); // origin at the base so scaling stretches forward
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true;
  }
  aim(a: Vec2, b: Vec2, z: number): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.max(Math.hypot(dx, dy), 1e-4);
    this.mesh.position.set(a.x, a.y, z);
    this.mesh.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
    this.mesh.scale.set(1, len, 1);
  }
}

export class Climber {
  readonly group = new THREE.Group();

  private hat: THREE.Group | null = null;
  private skinParts: THREE.Mesh[] = [];
  private torso: THREE.Mesh;
  private head: THREE.Group;
  private brow: THREE.Mesh;
  private mouth: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private hips: THREE.Mesh;
  private bones: Record<LimbId, { upper: Bone; lower: Bone; end: THREE.Mesh }>;

  constructor() {
    const skin = limbMaterial(GYM.skin);

    const torsoGeo = new THREE.CapsuleGeometry(0.125, BODY.torso * 0.66, 4, 10);
    this.torso = new THREE.Mesh(torsoGeo, limbMaterial(GYM.shirt));
    this.torso.castShadow = true;
    this.group.add(this.torso);

    this.hips = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), limbMaterial(GYM.shorts));
    this.hips.castShadow = true;
    this.group.add(this.hips);

    // Head, with just enough face to read an opinion off it.
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.132, 14, 12), skin.clone());
    skull.castShadow = true;
    this.skinParts.push(skull);
    this.head.add(skull);

    const eyeMat = new THREE.MeshBasicMaterial({ color: '#22252c' });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), eyeMat);
      eye.position.set(sx * 0.052, 0.024, 0.12);
      this.eyes.push(eye);
      this.head.add(eye);
    }
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.014, 0.02), eyeMat);
    this.mouth.position.set(0, -0.052, 0.126);
    this.head.add(this.mouth);

    this.brow = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.016, 0.02), eyeMat);
    this.brow.position.set(0, 0.074, 0.118);
    this.brow.visible = false;
    this.head.add(this.brow);

    this.group.add(this.head);

    const mk = (limb: LimbId) => {
      const hand = isHand(limb);
      const mat = hand ? skin : limbMaterial(GYM.shorts);
      const upper = new Bone(hand ? 0.052 : 0.068, hand ? mat.clone() : mat);
      const lower = new Bone(hand ? 0.044 : 0.055, skin.clone());
      if (hand) { this.skinParts.push(upper.mesh, lower.mesh); }
      else this.skinParts.push(lower.mesh);
      const end = new THREE.Mesh(
        hand
          ? new THREE.SphereGeometry(0.056, 8, 6)
          : new THREE.BoxGeometry(0.11, 0.06, 0.15),
        hand ? skin.clone() : limbMaterial('#2f3542'),
      );
      end.castShadow = true;
      if (hand) this.skinParts.push(end);
      this.group.add(upper.mesh, lower.mesh, end);
      return { upper, lower, end };
    };
    this.bones = { LH: mk('LH'), RH: mk('RH'), LF: mk('LF'), RF: mk('RF') };
  }

  /**
   * Drives the whole rig from a pose plus wherever the four limbs are. Limbs
   * that are not on a hold get passed their dangling position by the caller,
   * so flails and swings come from one place rather than being faked here.
   */
  setPose(pose: Pose, limbs: Record<LimbId, Vec2>, mood: Mood = 'calm'): void {
    const { hip, shoulder, head } = pose;

    const mid = { x: (hip.x + shoulder.x) / 2, y: (hip.y + shoulder.y) / 2 };
    this.torso.position.set(mid.x, mid.y, 0.16);
    this.torso.rotation.z = -pose.lean;
    this.hips.position.set(hip.x, hip.y, 0.15);

    this.head.position.set(head.x, head.y, 0.2);
    this.head.rotation.z = -pose.lean * 0.7;

    for (const limb of ['LH', 'RH', 'LF', 'RF'] as LimbId[]) {
      const rig = this.bones[limb];
      const anchor = anchorFor(limb, hip, shoulder);
      const target = limbs[limb];
      const hand = isHand(limb);
      const l1 = hand ? UPPER_ARM : UPPER_LEG;
      const l2 = hand ? LOWER_ARM : LOWER_LEG;
      const joint = twoBoneJoint(anchor, target, l1, l2, hand ? 'down' : 'out', hip.x);
      const z = hand ? 0.12 : 0.1;
      rig.upper.aim(anchor, joint, z);
      rig.lower.aim(joint, target, z);
      rig.end.position.set(target.x, target.y, hand ? 0.09 : 0.07);
      rig.end.rotation.z = Math.atan2(target.y - joint.y, target.x - joint.x);
    }

    this.setMood(mood);
  }

  /**
   * The whole emotional range, which is narrow but works hard. Eyes squeeze
   * shut under load and go wide in panic, the brow drops as effort climbs, and
   * the mouth does most of the acting. This is the strain readout — there are
   * no coloured lines on the wall telling you a limb is loaded, because you
   * read that off a climber's face, not off a diagram.
   */
  private setMood(mood: Mood): void {
    const eyeShape: Record<Mood, number> = {
      calm: 1, focus: 0.85, working: 0.62, strain: 0.34, gurn: 0.14,
      panic: 2.1, smug: 0.7, done: 0.2, yell: 1.5,
    };
    for (const eye of this.eyes) eye.scale.set(1, eyeShape[mood], 1);

    // Brow angle is the effort gauge: flat when fresh, driven down when fighting.
    const browAngle: Record<Mood, number> = {
      calm: 0, focus: 0.06, working: 0.12, strain: 0.2, gurn: 0.3,
      panic: -0.22, smug: -0.1, done: 0.04, yell: 0.24,
    };
    this.brow.visible = mood !== 'calm';
    this.brow.rotation.z = browAngle[mood];
    this.brow.position.y = mood === 'panic' ? 0.086 : 0.07 - Math.abs(browAngle[mood]) * 0.1;

    const m = this.mouth.scale;
    switch (mood) {
      case 'panic': m.set(1.5, 3.4, 1); break;
      case 'yell': m.set(2.0, 4.4, 1); break;
      case 'gurn': m.set(2.1, 1.5, 1); break;
      case 'strain': m.set(1.5, 2.2, 1); break;
      case 'working': m.set(1.2, 1.5, 1); break;
      case 'smug': m.set(1.35, 1, 1); break;
      case 'done': m.set(1.1, 2.4, 1); break;
      default: m.set(1, 1, 1);
    }
    this.mouth.position.y = mood === 'smug' ? -0.046 : -0.056;
    this.head.scale.setScalar(mood === 'gurn' || mood === 'yell' ? 1.06 : 1);
  }

  /** Dresses the climber. Called when the outfit changes, not per frame. */
  setOutfit(outfit: Outfit): void {
    const top = awardById(outfit.top)?.color ?? GYM.shirt;
    const legs = awardById(outfit.legs)?.color ?? GYM.shorts;
    (this.torso.material as THREE.MeshStandardMaterial).color.set(top);
    (this.hips.material as THREE.MeshStandardMaterial).color.set(legs);
    for (const limb of ['LF', 'RF'] as LimbId[]) {
      (this.bones[limb].upper.mesh.material as THREE.MeshStandardMaterial).color.set(legs);
    }
    for (const part of this.skinParts) {
      (part.material as THREE.MeshStandardMaterial).color.set(outfit.skin);
    }
    this.setHat(outfit.hat);
  }

  /** Builds the hat mesh. Rebuilt on change; there is only ever one. */
  private setHat(id: string | null): void {
    if (this.hat) {
      this.head.remove(this.hat);
      this.hat.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      this.hat = null;
    }
    if (!id) return;
    const award = awardById(id);
    if (!award?.shape) return;
    const mat = new THREE.MeshStandardMaterial({ color: award.color, roughness: 0.8 });
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, y: number, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    switch (award.shape) {
      case 'headband': add(new THREE.TorusGeometry(0.128, 0.022, 6, 14), 0.04); break;
      case 'beanie': {
        const b = add(new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 0.03);
        b.rotation.x = Math.PI;
        add(new THREE.SphereGeometry(0.034, 8, 6), 0.17);
        break;
      }
      case 'cap': {
        const c = add(new THREE.SphereGeometry(0.138, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0.035);
        c.rotation.x = Math.PI;
        add(new THREE.BoxGeometry(0.15, 0.016, 0.11), 0.045, -0.15);
        break;
      }
      case 'bucket': {
        add(new THREE.CylinderGeometry(0.125, 0.135, 0.1, 12), 0.09);
        add(new THREE.CylinderGeometry(0.135, 0.2, 0.018, 14), 0.04);
        break;
      }
      case 'cowboy': {
        add(new THREE.CylinderGeometry(0.1, 0.125, 0.11, 12), 0.1);
        add(new THREE.CylinderGeometry(0.135, 0.24, 0.014, 16), 0.045).rotation.z = 0.06;
        break;
      }
      case 'traffic-cone': {
        add(new THREE.ConeGeometry(0.125, 0.26, 12), 0.16);
        add(new THREE.BoxGeometry(0.24, 0.014, 0.24), 0.035);
        break;
      }
      case 'helmet': {
        const h = add(new THREE.SphereGeometry(0.152, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.6), 0.02);
        h.rotation.x = Math.PI;
        break;
      }
      case 'crown': {
        add(new THREE.CylinderGeometry(0.125, 0.125, 0.05, 5, 1, true), 0.11);
        add(new THREE.ConeGeometry(0.128, 0.07, 5), 0.17);
        break;
      }
    }
    this.hat = g;
    this.head.add(g);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}
