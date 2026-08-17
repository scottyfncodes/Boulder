import * as THREE from 'three';
import type { LimbId, Pose, Vec2 } from '../game/types';
import { isHand } from '../game/types';
import { anchorFor, BODY } from '../game/body';
import { GYM } from './palette';
import { ARM_Z, FOOT_Z, HAND_Z, HEAD_Z, HIP_Z, LEG_Z, TORSO_Z } from './depths';
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
 * The face is the strain readout — there are no coloured lines on the wall
 * telling you a limb is loaded, because a climber reads that off another
 * climber's face, not off a diagram.
 *
 * There is no anger here and no misery. This climber does not scowl and does
 * not sulk; the worse things get, the more delighted and astonished he is that
 * any of it is happening to him. Effort reads as escalating surprise rather
 * than as a grimace, which is both funnier and the only register the character
 * has. Brows therefore never drive down — they only ever go up.
 */
export type Mood =
  | 'calm' | 'keen' | 'impressed' | 'surprised' | 'astonished'
  | 'shocked' | 'whooping' | 'delighted' | 'dazed';

/**
 * How far the head is turned back toward the camera, radians.
 *
 * Zero would put the face flat to the camera, which on a body facing the wall
 * reads as a head mounted backwards. A little under a quarter turn keeps the
 * whole face visible while still showing some of the side and back of the
 * skull, so it reads as a climber looking round rather than as a mistake.
 */
const HEAD_TURN = -0.62;

/** How far round he snaps when something actually happens. */
const HEAD_TURN_ALERT = -0.24;

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
  private brows: THREE.Mesh[] = [];
  private pupils: THREE.Mesh[] = [];
  private mouth: THREE.Mesh;
  private smile: THREE.Mesh;
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

    // The face is the readout, so the features are cartoon-sized. Small tidy
    // features read as nothing at all once the head is forty pixels tall on a
    // phone; these are big enough to act with.
    const inkMat = new THREE.MeshBasicMaterial({ color: '#22252c' });
    const whiteMat = new THREE.MeshBasicMaterial({ color: '#fbf7f2' });

    for (const sx of [-1, 1]) {
      const socket = new THREE.Group();
      socket.position.set(sx * 0.058, 0.022, 0.108);

      const white = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), whiteMat);
      white.scale.set(1, 1, 0.42);
      socket.add(white);

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.023, 10, 8), inkMat);
      pupil.position.set(0, 0, 0.026);
      pupil.scale.set(1, 1, 0.5);
      socket.add(pupil);

      this.pupils.push(pupil);
      this.eyes.push(socket as unknown as THREE.Mesh);
      this.head.add(socket);
    }

    // Two mouths, because one shape cannot both gape and grin. The capsule is
    // every open-mouthed expression; the arc is every closed-mouthed smile.
    const mouthGeo = new THREE.CapsuleGeometry(0.03, 0.028, 4, 10);
    mouthGeo.rotateZ(Math.PI / 2);
    this.mouth = new THREE.Mesh(mouthGeo, inkMat);
    this.mouth.position.set(0, -0.056, 0.108);
    this.head.add(this.mouth);

    // A half torus turned upside down, which is a smile.
    const smileGeo = new THREE.TorusGeometry(0.052, 0.012, 6, 14, Math.PI);
    smileGeo.rotateZ(Math.PI);
    this.smile = new THREE.Mesh(smileGeo, inkMat);
    this.smile.position.set(0, -0.038, 0.108);
    this.smile.visible = false;
    this.head.add(this.smile);

    // Two brows, so they can angle independently and actually scowl.
    for (const sx of [-1, 1]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.019, 0.02), inkMat);
      brow.position.set(sx * 0.058, 0.078, 0.112);
      this.brows.push(brow);
      this.head.add(brow);
    }

    // The climber faces the wall, so what the camera sees is his back. The head
    // is turned to look back over his shoulder, which is the only reason any of
    // the face is visible at all. A quarter turn reads as "looking round";
    // pointing it straight out would read as a head on backwards.
    this.head.rotation.y = HEAD_TURN;
    this.group.add(this.head);

    // Cues that say back rather than front, so the turned head reads as a turn
    // rather than as the whole body facing out. A chalk bag at the waist is the
    // single most recognisable thing about a climber seen from behind.
    const chalkBag = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.055, 0.09, 10),
      limbMaterial('#6b5a44'),
    );
    chalkBag.position.set(0.09, -0.03, 0.13);
    chalkBag.castShadow = true;
    this.hips.add(chalkBag);

    const bagRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.058, 0.012, 6, 12),
      limbMaterial('#d8cfc0'),
    );
    bagRim.rotation.x = Math.PI / 2;
    bagRim.position.set(0.09, 0.014, 0.13);
    this.hips.add(bagRim);

    // A yoke seam across the shoulder blades. Semi-transparent black rather
    // than a fixed colour, so it darkens whatever shirt is underneath instead
    // of fighting it — an eight-digit hex is not a colour three.js understands,
    // and the first attempt came out as a bright white stripe.
    const yoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.013, 0.02),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16 }),
    );
    yoke.position.set(0, BODY.torso * 0.22, 0.125);
    this.torso.add(yoke);

    const mk = (limb: LimbId) => {
      const hand = isHand(limb);
      const mat = hand ? skin : limbMaterial(GYM.shorts);
      const upper = new Bone(hand ? 0.052 : 0.068, hand ? mat.clone() : mat);
      const lower = new Bone(hand ? 0.044 : 0.055, skin.clone());
      if (hand) { this.skinParts.push(upper.mesh, lower.mesh); }
      else this.skinParts.push(lower.mesh);
      const footGeo = new THREE.BoxGeometry(0.1, 0.058, 0.17);
      // Shift the shoe forward of the ankle so the toe points at the wall.
      footGeo.translate(0, 0, -0.045);
      const end = new THREE.Mesh(
        hand ? new THREE.SphereGeometry(0.056, 8, 6) : footGeo,
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
    this.torso.position.set(mid.x, mid.y, TORSO_Z);
    this.torso.rotation.z = -pose.lean;
    this.hips.position.set(hip.x, hip.y, HIP_Z);

    this.head.position.set(head.x, head.y, HEAD_Z);
    this.head.rotation.z = -pose.lean * 0.7;

    for (const limb of ['LH', 'RH', 'LF', 'RF'] as LimbId[]) {
      const rig = this.bones[limb];
      const anchor = anchorFor(limb, hip, shoulder);
      const target = limbs[limb];
      const hand = isHand(limb);
      const l1 = hand ? UPPER_ARM : UPPER_LEG;
      const l2 = hand ? LOWER_ARM : LOWER_LEG;
      const joint = twoBoneJoint(anchor, target, l1, l2, hand ? 'down' : 'out', hip.x);
      const z = hand ? ARM_Z : LEG_Z;
      rig.upper.aim(anchor, joint, z);
      rig.lower.aim(joint, target, z);
      rig.end.position.set(target.x, target.y, hand ? HAND_Z : FOOT_Z);
      rig.end.rotation.z = Math.atan2(target.y - joint.y, target.x - joint.x);
    }

    this.setMood(mood);
  }

  /**
   * The whole emotional range, played broadly.
   *
   * This is the strain readout — there are no coloured lines on the wall
   * telling you a limb is loaded, because you read that off a climber's face,
   * not off a diagram. So the face has to carry it from across the room: eyes
   * screw shut under load and go saucer-wide in panic, brows drive down into a
   * scowl or fly up in alarm, and the mouth goes from a flat line to a full
   * open yell. Subtle would be useless here.
   */
  private setMood(mood: Mood): void {
    type Face = {
      /**
       * Vertical squash of the eyes. 0 is shut, 1 is normal, >1 is wide.
       * Kept under about 1.5 — past that the eyes grow into the brows and the
       * mouth and the whole face reads as one dark blob.
       */
      eye: number;
      /** Pupil size multiplier. Big pupils are delight, not fear. */
      pupil: number;
      /**
       * Brow angle, radians. Never positive: a positive angle drives the inner
       * ends down into a scowl, and this character does not scowl.
       */
      brow: number;
      /** Brow height offset, metres. Higher is more amazed. */
      browY: number;
      /** True for a closed-mouth grin, false for an open mouth. */
      grin: boolean;
      /** Width and height multipliers for whichever mouth is showing. */
      mouth: [number, number];
      /** Mouth vertical offset, metres. */
      mouthY: number;
      /** Whole-head squash. */
      head: [number, number];
    };

    // Effort runs left to right as pleasure and amazement, never as anger.
    const F: Record<Mood, Face> = {
      calm:       { eye: 1,    pupil: 1,    brow: 0,     browY: 0.078, grin: true,  mouth: [1, 1],      mouthY: -0.038, head: [1, 1] },
      keen:       { eye: 1.08, pupil: 1.05, brow: -0.1,  browY: 0.084, grin: true,  mouth: [1.2, 1.15], mouthY: -0.04,  head: [1, 1] },
      impressed:  { eye: 1.2,  pupil: 1.12, brow: -0.22, browY: 0.092, grin: true,  mouth: [1.5, 1.5],  mouthY: -0.042, head: [1.01, 1.01] },
      surprised:  { eye: 1.34, pupil: 1.2,  brow: -0.32, browY: 0.099, grin: false, mouth: [1.15, 1.5], mouthY: -0.062, head: [1.01, 1.03] },
      astonished: { eye: 1.44, pupil: 1.26, brow: -0.42, browY: 0.105, grin: false, mouth: [1.35, 1.9], mouthY: -0.07,  head: [1.02, 1.05] },
      shocked:    { eye: 1.48, pupil: 1.3,  brow: -0.5,  browY: 0.11,  grin: false, mouth: [1.45, 1.8], mouthY: -0.075, head: [0.99, 1.06] },
      whooping:   { eye: 1.26, pupil: 1.16, brow: -0.46, browY: 0.106, grin: false, mouth: [1.85, 1.95], mouthY: -0.078, head: [1.03, 1.07] },
      delighted:  { eye: 0.42, pupil: 0.95, brow: -0.14, browY: 0.09,  grin: true,  mouth: [1.75, 1.45], mouthY: -0.036, head: [1, 1] },
      dazed:      { eye: 0.3,  pupil: 0.9,  brow: -0.06, browY: 0.086, grin: true,  mouth: [1.7, 0.9],  mouthY: -0.034, head: [1.04, 0.98] },
    };
    const f = F[mood];

    for (const eye of this.eyes) eye.scale.set(1, f.eye, 1);
    for (const pupil of this.pupils) pupil.scale.set(f.pupil, f.pupil, 0.5);

    // Brows mirror. Negative angles lift the inner ends, which is the only
    // direction this face goes.
    this.brows.forEach((brow, i) => {
      const side = i === 0 ? -1 : 1;
      brow.rotation.z = side * f.brow;
      brow.position.y = f.browY;
      brow.position.x = side * 0.058;
    });

    // He looks further round when something is happening — the whole head
    // snaps to camera for a whoop, which is where the joke lives.
    const alert = mood === 'shocked' || mood === 'whooping' || mood === 'astonished';
    this.head.rotation.y = alert ? HEAD_TURN_ALERT : HEAD_TURN;

    this.mouth.visible = !f.grin;
    this.smile.visible = f.grin;
    const active = f.grin ? this.smile : this.mouth;
    active.scale.set(f.mouth[0], f.mouth[1], 1);
    active.position.y = f.mouthY;

    this.head.scale.set(f.head[0], f.head[1], 1);
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
