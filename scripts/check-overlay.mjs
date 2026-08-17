/**
 * Checks that the 2D overlay agrees with the 3D scene about where things are.
 *
 * The overlay draws reticles, rings and limb pips on a separate canvas on top
 * of the WebGL one, with no depth buffer keeping it honest. If the two sides
 * disagree about how far a thing stands out of the wall, its marker sits off
 * the thing it marks — a small constant error on a flat wall, which the pitch
 * then rotates into a vertical one that grows with the angle.
 *
 * This walks every hold of routes at three pitches and compares the overlay's
 * projection against where the hold's mesh actually lands on screen. It needs a
 * browser, so it is not part of `npm test`.
 *
 *   npm run dev            # in one terminal
 *   npm run check:overlay  # in another
 */
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://127.0.0.1:5173/';
/** Fail above this. Sub-pixel differences are just float noise. */
const TOLERANCE_PX = 0.5;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => { console.error('page error:', e.message); });

await page.goto(URL, { waitUntil: 'networkidle' });

const rows = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { WallScene } = await import('/src/render/scene.ts');
  const { routeById } = await import('/src/content/routes.ts');

  document.body.innerHTML = '<canvas id="probe" style="width:390px;height:844px"></canvas>';
  const canvas = document.getElementById('probe');
  const scene = new WallScene(canvas);
  const out = [];

  for (const id of ['warmup', 'full-send', 'grip-it']) {
    const route = routeById(id);
    const deg = route.overhang ?? 0;
    scene.setRoute(route);
    scene.setOverhang((deg * Math.PI) / 180);
    scene.setCamera({ focusY: 2.4, frame: 3.9, orbit: 0 });
    scene.resize();
    scene.render();

    let worst = 0;
    let worstHold = null;
    let count = 0;
    for (const hold of route.holds) {
      const mesh = scene.holdMeshFor(hold.id);
      if (!mesh) continue;
      count++;
      mesh.updateMatrixWorld();
      const v = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).project(scene.camera);
      const rect = canvas.getBoundingClientRect();
      const actual = {
        x: (v.x * 0.5 + 0.5) * rect.width,
        y: (-v.y * 0.5 + 0.5) * rect.height,
      };
      const drawn = scene.project(hold.pos);
      const d = Math.hypot(actual.x - drawn.x, actual.y - drawn.y);
      if (d > worst) { worst = d; worstHold = hold.id; }
    }
    out.push({ id, deg, count, worst, worstHold });
  }
  return out;
});

let failed = false;
for (const r of rows) {
  const ok = r.worst <= TOLERANCE_PX;
  if (!ok) failed = true;
  const note = ok ? 'aligned' : `OFF by ${r.worst.toFixed(1)}px at hold #${r.worstHold}`;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(12)} pitch ${String(r.deg).padStart(2)}°  ${String(r.count).padStart(2)} holds  ${note}`);
}

await browser.close();
process.exit(failed ? 1 : 0);
