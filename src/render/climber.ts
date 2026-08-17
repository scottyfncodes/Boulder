import * as THREE from 'three';
import type { LimbId, Pose, Vec2 } from '../game/types';
import { isHand } from '../game/types';
import { anchorFor, BODY } from '../game/body';
import { BERNIE } from './palette';
import { ARM_Z, FOOT_Z, HAND_Z, HEAD_Z, HIP_Z, LEG_Z, TORSO_Z } from './depths';

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

/** How hard the neck pulls the head back upright. Low, because it is Bernie. */
const LOLL_SPRING = 0.055;
/** How much of the swing survives each frame. High, so it keeps going. */
const LOLL_DAMPING = 0.93;
/** Furthest the head lolls, radians. */
const LOLL_LIMIT = 0.55;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

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

  private skinParts: THREE.Mesh[] = [];
  private torso: THREE.Mesh;
  private head: THREE.Group;
  private brows: THREE.Mesh[] = [];
  /** Where the head is lolling, and how fast. Lags the body on purpose. */
  private loll = 0;
  private lollVel = 0;
  private lastHip: Vec2 | null = null;
  private mouth: THREE.Mesh;
  private smile: THREE.Mesh;
  private hips: THREE.Mesh;
  private bones: Record<LimbId, { upper: Bone; lower: Bone; end: THREE.Mesh }>;

  constructor() {
    const skin = limbMaterial(BERNIE.skin);

    const torsoGeo = new THREE.CapsuleGeometry(0.125, BODY.torso * 0.66, 4, 10);
    this.torso = new THREE.Mesh(torsoGeo, limbMaterial(BERNIE.shirt));
    this.torso.castShadow = true;
    this.group.add(this.torso);

    this.hips = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), limbMaterial(BERNIE.slacks));
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
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.024, 0.02), inkMat);
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
    const bagMat = limbMaterial(BERNIE.chalkBag);
    const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.072, 0.135, 12), bagMat);
    bag.position.set(0.055, -0.055, 0.155);
    bag.castShadow = true;
    this.hips.add(bag);

    // Chalky rim, because a used chalk bag is never clean.
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.017, 6, 14),
      limbMaterial('#efe9de'),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0.055, 0.012, 0.155);
    this.hips.add(rim);

    // The belt it hangs off, right around the waist.
    const belt = new THREE.Mesh(
      new THREE.TorusGeometry(0.125, 0.014, 6, 18),
      limbMaterial('#3c3227'),
    );
    belt.rotation.x = Math.PI / 2;
    belt.position.set(0, 0.03, 0.02);
    this.hips.add(belt);

    // Drawstring, with the two ends hanging.
    for (const sx of [-1, 1]) {
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.07, 5),
        limbMaterial('#efe9de'),
      );
      cord.position.set(0.055 + sx * 0.045, -0.02, 0.235);
      cord.rotation.z = sx * 0.35;
      this.hips.add(cord);
    }



    const mk = (limb: LimbId) => {
      const hand = isHand(limb);
      const mat = hand ? skin : limbMaterial(BERNIE.slacks);
      const upper = new Bone(hand ? 0.052 : 0.068, hand ? mat.clone() : mat);
      const lower = new Bone(hand ? 0.044 : 0.055, hand ? skin.clone() : limbMaterial(BERNIE.slacks));
      if (hand) this.skinParts.push(upper.mesh, lower.mesh);
      const footGeo = new THREE.BoxGeometry(0.1, 0.058, 0.17);
      // Shift the shoe forward of the ankle so the toe points at the wall.
      footGeo.translate(0, 0, -0.045);
      const end = new THREE.Mesh(
        hand ? new THREE.SphereGeometry(0.056, 8, 6) : footGeo,
        hand ? skin.clone() : limbMaterial(BERNIE.shoe),
      );
      end.castShadow = true;
      if (hand) this.skinParts.push(end);
      this.group.add(upper.mesh, lower.mesh, end);
      return { upper, lower, end };
    };
    this.bones = { LH: mk('LH'), RH: mk('RH'), LF: mk('LF'), RF: mk('RF') };

    // Last, because the sleeves attach to arms that have to exist first.
    this.dressAsBernie(inkMat);
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

    // The head is along for the ride. It swings when the body moves, keeps
    // swinging after the body stops, and settles slowly — a neck that is not
    // being held. This is most of what makes him read as cargo rather than as
    // a climber.
    const dx = this.lastHip ? hip.x - this.lastHip.x : 0;
    const dy = this.lastHip ? hip.y - this.lastHip.y : 0;
    this.lastHip = { x: hip.x, y: hip.y };
    this.lollVel += -dx * 2.6 - Math.abs(dy) * 0.5 - this.loll * LOLL_SPRING;
    this.lollVel *= LOLL_DAMPING;
    this.loll = clamp(this.loll + this.lollVel, -LOLL_LIMIT, LOLL_LIMIT);
    this.head.rotation.z = -pose.lean * 0.7 + this.loll;

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
  /**
   * The Bernie kit: greying hair, sunglasses he never takes off, and a shirt
   * loud enough to see from the café.
   *
   * The shades are the whole problem with this look, because the eyes are how
   * effort is read. So the lenses are dark but translucent: they read as
   * sunglasses from any distance and the eyes still show through them. Solid
   * black lenses would have cost the face half its range.
   */
  private dressAsBernie(inkMat: THREE.Material): void {
    // Hair: grey, over the back and sides, sitting well back off the forehead.
    // Bringing it any further forward turns it into a swim cap and buries the
    // brows, which are half the expression.
    const hairMat = new THREE.MeshStandardMaterial({ color: BERNIE.hair, roughness: 0.9 });
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.139, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.44),
      hairMat,
    );
    hair.position.set(0, 0.026, -0.03);
    hair.rotation.x = -0.22;
    hair.castShadow = true;
    this.head.add(hair);

    // Sideburns, because it is that kind of decade.
    for (const sx of [-1, 1]) {
      const burn = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.055, 0.05), hairMat);
      burn.position.set(sx * 0.125, 0.01, 0.01);
      this.head.add(burn);
    }

    // Sunglasses: two lenses, a bridge, and arms going back over the ears.
    // Fully opaque, and unlit so no highlight softens them. You cannot see his
    // eyes at all, which is the point of the character and the reason the brows
    // and the mouth have to do every bit of the expression on their own.
    const lensMat = new THREE.MeshBasicMaterial({ color: BERNIE.shades });
    const glasses = new THREE.Group();
    for (const sx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.07, 0.014), lensMat);
      // In front of the eyeball's front face (~0.126), or the eye renders
      // through the lens and the shades read as pale reading glasses.
      lens.position.set(sx * 0.058, 0.022, 0.138);
      glasses.add(lens);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.011, 0.1), inkMat);
      arm.position.set(sx * 0.1, 0.03, 0.07);
      glasses.add(arm);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.011, 0.012), inkMat);
    bridge.position.set(0, 0.03, 0.138);
    glasses.add(bridge);
    this.head.add(glasses);

    // The shirt. Approximated rather than textured: scattered blooms and leaves
    // stuck to the torso, which at this scale reads as a pattern and costs one
    // draw call per petal instead of an image to load.
    const bloom = new THREE.MeshStandardMaterial({ color: BERNIE.shirtPattern, roughness: 0.85 });
    const leaf = new THREE.MeshStandardMaterial({ color: BERNIE.shirtLeaf, roughness: 0.85 });
    const spots: [number, number, number, THREE.Material][] = [
      [-0.075, 0.15, 0.05, bloom], [0.08, 0.06, 0.042, leaf],
      [-0.06, -0.05, 0.045, bloom], [0.07, -0.16, 0.04, bloom],
      [-0.085, -0.2, 0.036, leaf], [0.02, 0.21, 0.038, leaf],
      [0.095, -0.05, 0.03, bloom], [-0.02, -0.12, 0.032, leaf],
    ];
    for (const [x, y, r, mat] of spots) {
      const petal = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
      // Pushed onto the surface of the torso capsule and flattened into it.
      petal.position.set(x, y, 0.105);
      petal.scale.set(1, 1, 0.22);
      this.torso.add(petal);
    }

    // Short sleeves: the upper arm is simply shirt-coloured. A separate sleeve
    // mesh would be a child of a bone that gets scaled to its own length every
    // frame, and would stretch and slide with it.
    for (const limb of ['LH', 'RH'] as LimbId[]) {
      const mat = this.bones[limb].upper.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(BERNIE.shirt);
    }

    // Collar.
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.115, 0.02, 6, 14),
      new THREE.MeshStandardMaterial({ color: BERNIE.shirt, roughness: 0.85 }),
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, BODY.torso * 0.42, 0.02);
    this.torso.add(collar);
  }

  private setMood(mood: Mood): void {
    type Face = {
      /**
       * Brow angle, radians. Never positive: a positive angle drives the inner
       * ends down into a scowl, and this character does not scowl.
       */
      brow: number;
      /**
       * Brow height. Higher is more amazed, but it has to stay between the top
       * of the lenses and the hairline — above that the brow disappears into
       * the hair and the face loses its only working half.
       */
      browY: number;
      /**
       * Difference between the two brows. One up and one down is worth more
       * than both together — it is the whole quizzical register, and with the
       * eyes behind opaque lenses it is most of what is left.
       */
      browSkew: number;
      /** True for a closed-mouth grin, false for an open mouth. */
      grin: boolean;
      /** Width and height multipliers for whichever mouth is showing. */
      mouth: [number, number];
      /** Mouth vertical offset, metres. */
      mouthY: number;
      /** Whole-head squash. */
      head: [number, number];
    };

    // Every bit of this is brows and mouth. There are no eyes to help — the
    // lenses are opaque — so the ranges are wider than they would otherwise be
    // and the asymmetry is doing real work.
    const F: Record<Mood, Face> = {
      calm:       { brow: 0,     browY: 0.072, browSkew: 0,     grin: true,  mouth: [1, 1],       mouthY: -0.038, head: [1, 1] },
      keen:       { brow: -0.12, browY: 0.079, browSkew: 0.012, grin: true,  mouth: [1.3, 1.2],   mouthY: -0.04,  head: [1, 1] },
      impressed:  { brow: -0.28, browY: 0.086, browSkew: 0.022, grin: true,  mouth: [1.7, 1.6],   mouthY: -0.042, head: [1.01, 1.01] },
      surprised:  { brow: -0.42, browY: 0.092, browSkew: 0.03,  grin: false, mouth: [1.25, 1.7],  mouthY: -0.064, head: [1.01, 1.03] },
      astonished: { brow: -0.56, browY: 0.098, browSkew: 0.036, grin: false, mouth: [1.5, 2.15],  mouthY: -0.072, head: [1.02, 1.05] },
      shocked:    { brow: -0.68, browY: 0.104, browSkew: 0.014, grin: false, mouth: [1.6, 2.05],  mouthY: -0.078, head: [0.99, 1.06] },
      whooping:   { brow: -0.62, browY: 0.101, browSkew: 0,     grin: false, mouth: [2.0, 2.25],  mouthY: -0.082, head: [1.03, 1.07] },
      delighted:  { brow: -0.2,  browY: 0.088, browSkew: 0.04,  grin: true,  mouth: [2.0, 1.65],  mouthY: -0.036, head: [1, 1] },
      dazed:      { brow: -0.04, browY: 0.076, browSkew: 0.05,  grin: true,  mouth: [1.6, 0.85],  mouthY: -0.034, head: [1.04, 0.98] },
    };
    const f = F[mood];

    // Brows mirror. Negative angles lift the inner ends, which is the only
    // direction this face goes.
    this.brows.forEach((brow, i) => {
      const side = i === 0 ? -1 : 1;
      brow.rotation.z = side * f.brow;
      brow.position.y = f.browY + side * f.browSkew;
      brow.position.x = side * 0.058;
    });

    this.mouth.visible = !f.grin;
    this.smile.visible = f.grin;
    const active = f.grin ? this.smile : this.mouth;
    active.scale.set(f.mouth[0], f.mouth[1], 1);
    active.position.y = f.mouthY;

    this.head.scale.set(f.head[0], f.head[1], 1);

    const alert = mood === 'shocked' || mood === 'whooping' || mood === 'astonished';
    this.head.rotation.y = alert ? HEAD_TURN_ALERT : HEAD_TURN;
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
