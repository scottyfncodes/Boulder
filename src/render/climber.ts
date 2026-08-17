import * as THREE from 'three';
import type { LimbId, Pose, Vec2 } from '../game/types';
import { isHand } from '../game/types';
import { anchorFor, BODY } from '../game/body';
import { GYM } from './palette';

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

export type Mood = 'calm' | 'focus' | 'strain' | 'panic' | 'smug' | 'done';

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

  private torso: THREE.Mesh;
  private head: THREE.Group;
  private brow: THREE.Mesh;
  private mouth: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private hips: THREE.Mesh;
  private bones: Record<LimbId, { upper: Bone; lower: Bone; end: THREE.Mesh }>;

  constructor() {
    const skin = limbMaterial(GYM.skin);
    const shirt = limbMaterial(GYM.shirt);
    const shorts = limbMaterial(GYM.shorts);

    const torsoGeo = new THREE.CapsuleGeometry(0.125, BODY.torso * 0.66, 4, 10);
    this.torso = new THREE.Mesh(torsoGeo, shirt);
    this.torso.castShadow = true;
    this.group.add(this.torso);

    this.hips = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), shorts);
    this.hips.castShadow = true;
    this.group.add(this.hips);

    // Head, with just enough face to read an opinion off it.
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.132, 14, 12), skin);
    skull.castShadow = true;
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
      const mat = hand ? skin : shorts;
      const upper = new Bone(hand ? 0.052 : 0.068, mat);
      const lower = new Bone(hand ? 0.044 : 0.055, skin);
      const end = new THREE.Mesh(
        hand
          ? new THREE.SphereGeometry(0.056, 8, 6)
          : new THREE.BoxGeometry(0.11, 0.06, 0.15),
        hand ? skin : limbMaterial('#2f3542'),
      );
      end.castShadow = true;
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

  private setMood(mood: Mood): void {
    // Small, cheap tells. The comedy is in the body; the face just agrees.
    const wide = mood === 'panic' ? 1.9 : mood === 'strain' ? 0.6 : 1;
    for (const eye of this.eyes) eye.scale.set(1, wide, 1);

    this.brow.visible = mood === 'strain' || mood === 'focus';
    this.brow.rotation.z = mood === 'strain' ? 0.16 : 0.05;

    const m = this.mouth.scale;
    switch (mood) {
      case 'panic': m.set(1.5, 3.4, 1); break;
      case 'strain': m.set(1.25, 1.9, 1); break;
      case 'smug': m.set(1.35, 1, 1); break;
      case 'done': m.set(1.1, 2.4, 1); break;
      default: m.set(1, 1, 1);
    }
    this.mouth.position.y = mood === 'smug' ? -0.046 : -0.056;
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
