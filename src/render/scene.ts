import * as THREE from 'three';
import type { Hold, LimbId, Pose, Route, Vec2 } from '../game/types';
import { WALL, DECOR } from '../content/wall';
import { GRADE_COLOR, GYM } from './palette';
import { contactRadius } from '../game/holds';
import { holdGeometry } from './holdGeometry';
import { Climber, type Mood } from './climber';
import type { Outfit } from '../game/awards';

/**
 * The gym, rendered.
 *
 * Readability is the whole brief: the wall is flat and light, the holds are
 * chunky and cast real shadows so you can see how far they stick out, and the
 * climber is the only saturated thing on screen. Nothing here is trying to look
 * like a photograph.
 */

export type CameraState = {
  /** Height the camera is looking at, metres. */
  focusY: number;
  /** Vertical extent of wall visible, metres. Smaller is more zoomed in. */
  frame: number;
  /** Orbit around the wall's vertical axis, radians. Clamped small. */
  orbit: number;
};

export const DEFAULT_CAMERA: CameraState = { focusY: 1.9, frame: 3.9, orbit: 0 };
export const FRAME_MIN = 2.3;
export const FRAME_MAX = 6.0;
export const ORBIT_LIMIT = 0.5;

const FOV = 42;

export class WallScene {
  readonly scene = new THREE.Scene();
  /**
   * Everything that belongs to the wall plane — panels, holds and the climber —
   * lives under one group that gets tilted. The sim stays flat and works in
   * wall coordinates; only the view knows the wall leans.
   */
  private plane = new THREE.Group();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private climber = new Climber();
  private holdGroup = new THREE.Group();
  private holdMeshes = new Map<number, THREE.Mesh>();
  /** Wall furniture that tilts with the plane. */
  private panels: THREE.Object3D[] = [];
  private canvas: HTMLCanvasElement;
  private cam: CameraState = { ...DEFAULT_CAMERA };
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(GYM.back);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
    this.plane.add(this.holdGroup, this.climber.group);
    this.scene.add(this.plane);
    this.buildEnvironment();
    this.applyCamera();
  }

  // --- environment -------------------------------------------------------

  private buildEnvironment(): void {
    // Generously oversized: at a wide desktop aspect the camera sees far more
    // wall than the climbable area, and running out of gym looks like a bug.
    const w = (WALL.maxX - WALL.minX) * 4;
    const h = WALL.maxY * 2.6;
    const cx = (WALL.minX + WALL.maxX) / 2;

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.3),
      new THREE.MeshStandardMaterial({ color: GYM.wall, roughness: 0.95, metalness: 0 }),
    );
    wall.position.set(cx, h / 2 - 0.6, -0.15);
    wall.receiveShadow = true;
    this.plane.add(wall);

    // Panel seams. Purely visual, but they give the eye a scale reference,
    // which matters when you are judging whether a move is 30cm or 60cm.
    const seamMat = new THREE.MeshBasicMaterial({ color: GYM.seam });
    for (let y = 0.2; y < WALL.maxY + 2.4; y += 1.22) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.014, 0.01), seamMat);
      seam.position.set(cx, y, 0.006);
      this.plane.add(seam);
    }
    for (const x of [WALL.minX - 0.05, cx, WALL.maxX + 0.05]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.014, h, 0.01), seamMat);
      seam.position.set(x, h / 2 - 0.6, 0.006);
      this.plane.add(seam);
    }

    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2, 0.34, 2.6),
      new THREE.MeshStandardMaterial({ color: GYM.mat, roughness: 1 }),
    );
    mat.position.set(cx, -0.17, 1.2);
    mat.receiveShadow = true;
    this.scene.add(mat);

    // Off-route holds: dressing, and the reason reading a line is a skill.
    const decorMat = new THREE.MeshStandardMaterial({
      color: GYM.decor, roughness: 0.9, metalness: 0,
    });
    for (const d of DECOR) {
      const m = new THREE.Mesh(holdGeometry(d.type), decorMat);
      m.position.set(d.x, d.y, 0);
      m.scale.setScalar(contactRadius(d.size, d.type));
      m.rotation.z = d.roll;
      m.castShadow = true;
      this.plane.add(m);
    }

    this.scene.add(new THREE.HemisphereLight('#f2efe8', '#3a3f52', 1.5));
    const key = new THREE.DirectionalLight('#fff6e6', 2.1);
    key.position.set(2.6, 5.2, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 16;
    const s = 4.2;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0012;
    this.scene.add(key, key.target);
    key.target.position.set(0, 2, 0);

    const fill = new THREE.DirectionalLight('#cfe0ff', 0.5);
    fill.position.set(-3.4, 1.4, 3);
    this.scene.add(fill);
  }

  // --- route -------------------------------------------------------------

  /** Rebuilds the on-route holds. Called once per route, not per frame. */
  setRoute(route: Route): void {
    for (const m of this.holdMeshes.values()) {
      this.holdGroup.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.holdMeshes.clear();

    const color = GRADE_COLOR[route.grade];
    for (const hold of route.holds) {
      const isFinish = route.finish.includes(hold.id);
      const mesh = new THREE.Mesh(
        holdGeometry(hold.type),
        new THREE.MeshStandardMaterial({
          // The finish is not the route colour. A player who reaches the top of
          // a route should never have to wonder whether they are done.
          color: isFinish ? '#ffffff' : color,
          roughness: isFinish ? 0.4 : 0.62,
          metalness: 0.04,
          emissive: isFinish ? '#ffffff' : color,
          emissiveIntensity: 0,
        }),
      );
      this.placeHold(mesh, hold);
      mesh.castShadow = true;
      this.holdGroup.add(mesh);
      this.holdMeshes.set(hold.id, mesh);
    }
  }

  private placeHold(mesh: THREE.Mesh, hold: Hold): void {
    // Every hold geometry is authored around a unit radius, so scaling by the
    // contact radius makes what you see the same size as what the sim tests
    // against. A hold that looks like a jug is a jug.
    mesh.position.set(hold.pos.x, hold.pos.y, 0);
    mesh.scale.setScalar(contactRadius(hold.size, hold.type));
    // Rails and undercuts are rotated to face the way they are meant to be
    // used, so the shape on screen tells you what the sim already knows.
    mesh.rotation.z = hold.roll ?? hold.dir + Math.PI / 2;
  }

  /** Lights the finish holds and dims anything the route does not use. */
  highlight(finish: number[], reachable: Set<number>, selected: number | null): void {
    for (const [id, mesh] of this.holdMeshes) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      const isFinish = finish.includes(id);
      m.emissiveIntensity =
        id === selected ? 0.55
        : isFinish ? 0.42 + Math.sin(performance.now() / 420) * 0.18
        : reachable.has(id) ? 0.14
        : 0;
    }
  }

  // --- climber -----------------------------------------------------------

  setClimber(pose: Pose, limbs: Record<LimbId, Vec2>, mood: Mood): void {
    this.climber.setPose(pose, limbs, mood);
  }

  setOutfit(outfit: Outfit): void {
    this.climber.setOutfit(outfit);
  }

  setClimberVisible(visible: boolean): void {
    this.climber.group.visible = visible;
  }

  // --- camera ------------------------------------------------------------

  /** Leans the wall back by `radians`, pivoting about the foot of the wall. */
  setOverhang(radians: number): void {
    this.plane.rotation.x = radians;
    for (const m of this.panels) m.rotation.x = radians;
  }

  setCamera(next: Partial<CameraState>): void {
    this.cam = { ...this.cam, ...next };
    this.cam.frame = clamp(this.cam.frame, FRAME_MIN, FRAME_MAX);
    this.cam.orbit = clamp(this.cam.orbit, -ORBIT_LIMIT, ORBIT_LIMIT);
    this.applyCamera();
  }

  getCamera(): CameraState {
    return { ...this.cam };
  }

  private applyCamera(): void {
    const dist = (this.cam.frame / 2) / Math.tan((FOV * Math.PI) / 360);
    const { focusY, orbit } = this.cam;
    this.camera.position.set(
      Math.sin(orbit) * dist,
      focusY + Math.sin(orbit) * 0.1,
      Math.cos(orbit) * dist,
    );
    this.camera.lookAt(0, focusY, 0);
    this.camera.updateMatrixWorld();
  }

  /** World point to canvas pixels, for drawing the aiming overlay on top. */
  project(p: Vec2, z = 0.12): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(p.x, p.y, z);
    // Wall-space to world: the same tilt the plane group applies.
    this.plane.updateMatrixWorld();
    v.applyMatrix4(this.plane.matrixWorld);
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width,
      y: (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z < 1,
    };
  }

  /** Metres per pixel at the wall plane. Keeps drag feel consistent at any zoom. */
  metresPerPixel(): number {
    const rect = this.canvas.getBoundingClientRect();
    return rect.height > 0 ? this.cam.frame / rect.height : 0.01;
  }

  // --- loop --------------------------------------------------------------

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyCamera();
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.climber.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
