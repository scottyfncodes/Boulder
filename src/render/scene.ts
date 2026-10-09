import * as THREE from 'three';
import type { Hold, LimbId, Pose, Route, Vec2 } from '../game/types';
import { WALL, DECOR } from '../content/wall';
import { GRADE_COLOR, GYM } from './palette';
import { contactRadius } from '../game/holds';
import { HOLD_Z } from './depths';
import { holdGeometry } from './holdGeometry';
import { Climber, type Mood } from './climber';
import { WallWarp, placeOn, surfaceStrip } from './fold';
import { type WallProfile, FLAT } from '../game/profile';

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
  /**
   * Distance along the wall the camera is looking at, metres. Zero is the
   * middle; routes that wander across the wall pull it sideways after them.
   */
  focusX: number;
  /** Vertical extent of wall visible, metres. Smaller is more zoomed in. */
  frame: number;
  /** Orbit around the wall's vertical axis, radians. Clamped small. */
  orbit: number;
};

export const DEFAULT_CAMERA: CameraState = { focusY: 1.9, focusX: 0, frame: 3.9, orbit: 0 };
export const FRAME_MIN = 2.3;
/** Widest the camera goes: wide enough to show the whole of a long limb's reach on a phone. */
export const FRAME_MAX = 7.5;
export const ORBIT_LIMIT = 0.5;

const FOV = 42;
/** How far under a leaning wall the camera drops, as a share of the lean. */
const CAMERA_UNDER = 0.45;

export class WallScene {
  readonly scene = new THREE.Scene();
  /**
   * Everything that belongs to the wall — panels, holds and the climber — is
   * placed through the warp, which rolls the sim's flat wall coordinates up
   * into the wall's real shape: leaning, bending into a roof, coming back
   * out over a lip. The sim stays flat; only the view knows the wall bends.
   */
  private plane = new THREE.Group();
  private warp = new WallWarp(FLAT);
  private route: Route | null = null;
  /** The panels, seams and dressing: rebuilt whenever the wall changes shape. */
  private wallGroup = new THREE.Group();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private climber = new Climber();
  private holdGroup = new THREE.Group();
  private holdMeshes = new Map<number, THREE.Mesh>();
  private canvas: HTMLCanvasElement;
  private cam: CameraState = { ...DEFAULT_CAMERA };
  private disposed = false;
  private key: THREE.DirectionalLight | null = null;
  /** The tread wall's belt: how far the wall has rolled down, metres. */
  private scroll = 0;
  /** Highball pads, rebuilt when the landing changes. */
  private padGroup = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(GYM.back);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
    this.plane.add(this.wallGroup, this.holdGroup, this.climber.group);
    this.scene.add(this.plane);
    this.buildEnvironment();
    this.buildWall();
    this.applyCamera();
  }

  // --- environment -------------------------------------------------------

  private buildEnvironment(): void {
    const w = (WALL.maxX - WALL.minX) * 4;
    const cx = (WALL.minX + WALL.maxX) / 2;

    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2, 0.34, 2.6),
      new THREE.MeshStandardMaterial({ color: GYM.mat, roughness: 1 }),
    );
    mat.position.set(cx, -0.17, 1.2);
    mat.receiveShadow = true;
    this.scene.add(mat);

    this.scene.add(new THREE.HemisphereLight('#f2efe8', '#3a3f52', 1.5));
    const key = new THREE.DirectionalLight('#fff6e6', 2.1);
    key.position.set(2.6, 5.2, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 16;
    // Tall enough for the long routes up the cave.
    const s = Math.max(4.2, WALL.maxY / 2 + 1.5);
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0012;
    this.scene.add(key, key.target);
    key.target.position.set(0, 2, 0);
    this.key = key;
    this.scene.add(this.padGroup);

    const fill = new THREE.DirectionalLight('#cfe0ff', 0.5);
    fill.position.set(-3.4, 1.4, 3);
    this.scene.add(fill);

    // From the mat, up: a roof faces the floor, and without this its holds
    // are shapes in the dark. Gyms light their caves too.
    const under = new THREE.DirectionalLight('#f4ead8', 0.75);
    under.position.set(0.8, -3, 4);
    this.scene.add(under);
  }

  /**
   * The wall itself, the shape the route says. Generously oversized: at a wide
   * desktop aspect the camera sees far more wall than the climbable area, and
   * running out of gym looks like a bug.
   */
  private buildWall(): void {
    for (const o of [...this.wallGroup.children]) {
      this.wallGroup.remove(o);
      o.traverse((m) => {
        if (m instanceof THREE.Mesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      });
    }
    const warp = this.warp;
    const w = (WALL.maxX - WALL.minX) * 4;
    const h = WALL.maxY * 2.6;
    const cx = (WALL.minX + WALL.maxX) / 2;
    const y0 = -0.6;
    const y1 = h - 0.6;

    const wall = new THREE.Mesh(
      surfaceStrip(warp, cx - w / 2, cx + w / 2, y0, y1, 0),
      new THREE.MeshStandardMaterial({ color: GYM.wall, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    );
    wall.receiveShadow = true;
    this.wallGroup.add(wall);

    // Panel seams. Purely visual, but they give the eye a scale reference,
    // which matters when you are judging whether a move is 30cm or 60cm — and
    // on a bent wall they are what shows you where it bends.
    const seamMat = new THREE.MeshBasicMaterial({ color: GYM.seam, side: THREE.DoubleSide });
    for (let y = 0.2; y < WALL.maxY + 2.4; y += 1.22) {
      const seam = new THREE.Mesh(surfaceStrip(warp, cx - w / 2, cx + w / 2, y - 0.007, y + 0.007, 0.006, 0.02), seamMat);
      this.wallGroup.add(seam);
    }
    for (const x of [WALL.minX - 0.05, cx, WALL.maxX + 0.05]) {
      const seam = new THREE.Mesh(surfaceStrip(warp, x - 0.007, x + 0.007, y0, y1, 0.006), seamMat);
      this.wallGroup.add(seam);
    }

    // Off-route holds: dressing, and the reason reading a line is a skill.
    const decorMat = new THREE.MeshStandardMaterial({
      color: GYM.decor, roughness: 0.9, metalness: 0,
    });
    for (const d of DECOR) {
      const m = new THREE.Mesh(holdGeometry(d.type), decorMat);
      placeOn(warp, m, d.x, d.y, HOLD_Z, d.roll);
      m.scale.setScalar(contactRadius(d.size, d.type));
      m.castShadow = true;
      this.wallGroup.add(m);
    }
  }

  // --- route -------------------------------------------------------------

  /** Rebuilds the on-route holds. Called once per route, not per frame. */
  setRoute(route: Route): void {
    this.route = route;
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

  /**
   * Brings the hold meshes in line with a hold list that changes while you
   * climb — the tread wall's stream. New holds are added, gone ones removed,
   * the rest left alone. `colorOf` paints each new hold.
   */
  syncHolds(holds: Hold[], colorOf: (h: Hold) => string): void {
    const want = new Set(holds.map((h) => h.id));
    for (const [id, m] of this.holdMeshes) {
      if (want.has(id)) continue;
      this.holdGroup.remove(m);
      (m.material as THREE.Material).dispose();
      this.holdMeshes.delete(id);
    }
    for (const hold of holds) {
      if (this.holdMeshes.has(hold.id) || hold.type === 'smear') continue;
      const color = colorOf(hold);
      const mesh = new THREE.Mesh(
        holdGeometry(hold.type),
        new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04, emissive: color, emissiveIntensity: 0 }),
      );
      this.placeHold(mesh, hold);
      mesh.castShadow = true;
      this.holdGroup.add(mesh);
      this.holdMeshes.set(hold.id, mesh);
    }
  }

  /**
   * The belt. Everything on the wall rolls down by `metres`; the floor and the
   * mat stay where they are. Callers keep using wall coordinates — the
   * projection and the camera take the roll out.
   */
  setScroll(metres: number): void {
    this.scroll = metres;
    const a = this.warp.point(0, 0, 0);
    const b = this.warp.point(0, -metres, 0);
    this.plane.position.set(b.x - a.x, b.y - a.y, b.z - a.z);
    // The panels wrap every seam, so a belt that runs for an hour never runs out of wall.
    const seam = 1.22;
    const wrap = Math.floor(metres / seam) * seam;
    const c = this.warp.point(0, wrap, 0);
    this.wallGroup.position.set(c.x - a.x, c.y - a.y, c.z - a.z);
    this.applyCamera();
  }

  /**
   * Highball landing: stacked pads under the line, as many as the problem
   * has, so the screen shows how much is (and is not) under you.
   */
  setLanding(landing: { pads: number; halfWidth: number; centre: number } | null): void {
    for (const o of [...this.padGroup.children]) {
      this.padGroup.remove(o);
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    }
    if (!landing) return;
    const colors = ['#2f4f7a', '#3b6aa0', '#2b5c8c'];
    const width = landing.halfWidth * 2;
    for (let i = 0; i < landing.pads; i++) {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(width - i * 0.06, 0.2, 1.35 - i * 0.04),
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.95 }),
      );
      pad.position.set(landing.centre, 0.1 + i * 0.205, 0.78);
      pad.receiveShadow = true;
      pad.castShadow = true;
      this.padGroup.add(pad);
    }
  }

  private placeHold(mesh: THREE.Mesh, hold: Hold): void {
    // Every hold geometry is authored around a unit radius, so scaling by the
    // contact radius makes what you see the same size as what the sim tests
    // against. Rails and undercuts are rotated to face the way they are meant
    // to be used, so the shape on screen tells you what the sim already knows.
    placeOn(this.warp, mesh, hold.pos.x, hold.pos.y, HOLD_Z, hold.roll ?? hold.dir + Math.PI / 2);
    mesh.scale.setScalar(contactRadius(hold.size, hold.type));
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


  setClimberVisible(visible: boolean): void {
    this.climber.group.visible = visible;
  }

  // --- camera ------------------------------------------------------------

  /** Gives the wall its shape: one lean, or a profile with bends in it. */
  setWall(wall: number | WallProfile): void {
    const profile = typeof wall === 'number' ? { base: wall, bends: [] } : wall;
    this.warp = new WallWarp(profile);
    this.climber.setWarp(this.warp);
    this.buildWall();
    if (this.route) this.setRoute(this.route);
    this.applyCamera();
  }

  /** Leans the whole wall back by `radians`, pivoting about its foot. */
  setOverhang(radians: number): void {
    this.setWall(radians);
  }

  /** The wall-to-world mapping, for anything else that wants to sit on the wall. */
  getWarp(): WallWarp {
    return this.warp;
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
    const { focusY, focusX, orbit } = this.cam;

    // focusY is a distance up the wall's surface, and on a leaning or bent
    // wall that is not a height in the world, so the focus point goes through
    // the same warp as everything on the wall.
    const f = this.warp.point(focusX, focusY - this.scroll, 0);

    // The camera pulls back from the climber mostly level, so an overhang
    // reads the way it does from the mat — wall leaning away overhead — but
    // it drops under a steep wall part of the way, so a roof is something you
    // look up into rather than a sliver seen edge on.
    const under = this.warp.angle(focusY - this.scroll) * CAMERA_UNDER;
    this.camera.position.set(
      f.x + Math.sin(orbit) * dist,
      f.y - Math.sin(under) * dist * Math.cos(orbit) + Math.sin(orbit) * 0.1,
      f.z + Math.cos(under) * dist * Math.cos(orbit),
    );
    this.camera.lookAt(f.x, f.y, f.z);
    this.camera.updateMatrixWorld();
    // The key light goes up the wall with the camera, so a highball's top
    // casts shadows the way its bottom does.
    if (this.key) {
      this.key.position.set(2.6, f.y + 3.2, 4.2);
      this.key.target.position.set(0, f.y, 0);
      this.key.target.updateMatrixWorld();
    }
  }

  /** The mesh for a hold, so a test can check the overlay agrees with it. */
  holdMeshFor(id: number): THREE.Mesh | undefined {
    return this.holdMeshes.get(id);
  }

  /**
   * Wall point to canvas pixels, for drawing the aiming overlay on top.
   *
   * `z` is how far out of the wall the thing being drawn actually sits, and it
   * matters: holds are anchored at z = 0, so anything marking a hold must be
   * projected at z = 0 too. Guessing a forward offset here puts the reticle
   * slightly off the hold even on a flat wall, and once the wall is pitched
   * that offset rotates into a vertical error that grows with the angle.
   */
  project(p: Vec2, z: number = HOLD_Z): { x: number; y: number; visible: boolean } {
    // Wall-space to world: the same warp everything on the wall goes through.
    const v = this.warp.point(p.x, p.y - this.scroll, z);
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (v.x * 0.5 + 0.5) * rect.width,
      y: (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z < 1,
    };
  }

  /**
   * How far sideways the camera may look before it shows more gym than wall.
   * On a wide screen that is nowhere; on a phone held upright it is most of
   * the way to the edge.
   */
  focusXLimit(frame: number = this.cam.frame): number {
    const halfWidth = (frame / 2) * this.camera.aspect;
    return Math.max(0, WALL.maxX + 0.05 - halfWidth);
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
