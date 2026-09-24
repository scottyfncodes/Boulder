/**
 * Renders the app icons from the game itself.
 *
 * The icon is Bernie as he actually appears on the wall — the real three.js
 * rig, pulled on at the start of "Definitely Not Beta", grinning — rather
 * than a drawing of him, so it can never drift from the character. The camera
 * is framed on his body instead of the wall, which the game's own camera
 * cannot do (it clamps zoom and never pans sideways), so this sets it by hand.
 *
 * iOS ignores SVG for apple-touch-icon and the manifest wants real 192 and 512
 * bitmaps, so the PNGs are generated once and committed. The favicon is a
 * tighter crop on his head, because a whole body is mush at 32 pixels.
 *
 * Starts its own Vite server and drives Playwright's Chromium, so it is not
 * part of the build. Run it after changing the rig or the palette:
 *
 *   npm run gen:icons
 *
 * If the installed Playwright wants a browser build you do not have, point
 * CHROMIUM at any Chromium binary.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = `${root}public/`;

/** Rendered once at this size and scaled down, so small sizes are smoothed. */
const MASTER = 1024;

/** File name -> [pixel size, which shot]. Every one is square and opaque. */
const OUT = {
  'apple-touch-icon.png': [180, 'body'],
  'icon-192.png': [192, 'body'],
  'icon-512.png': [512, 'body'],
  'favicon-32.png': [32, 'head'],
};

/**
 * How each shot is framed: padding around the subject as a multiple of its
 * size, and a nudge in wall metres. The body shot keeps the head clear of the
 * corner that iOS rounds off.
 */
const SHOTS = {
  body: { subject: 'body', pad: 1.4, ox: 0.02, oy: 0.1 },
  head: { subject: 'head', pad: 1, ox: 0, oy: 0 },
};

const server = await createServer({
  root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({ viewport: { width: MASTER / 2, height: MASTER / 2 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => { throw e; });
  await page.goto(url);

  const masters = {};
  for (const [name, shot] of Object.entries(SHOTS)) {
    const png = await page.evaluate(async (shot) => {
      document.body.innerHTML = '<canvas id="c" style="width:100%;height:100vh;display:block"></canvas>';
      document.body.style.margin = '0';
      const { WallScene } = await import('/src/render/scene.ts');
      const { routeById } = await import('/src/content/routes.ts');
      const { initialState } = await import('/src/game/move.ts');
      const { limbsFor } = await import('/src/render/animator.ts');
      const { BODY } = await import('/src/game/body.ts');

      const route = routeById('definitely-not-beta');
      const tilt = ((route.overhang ?? 0) * Math.PI) / 180;
      const canvas = document.getElementById('c');
      const scene = new WallScene(canvas);
      scene.setRoute(route);
      scene.setOverhang(tilt);
      scene.resize();

      const state = initialState(route.holds, route.start, tilt);
      const limbs = limbsFor(state.contacts, state.pose, 0);
      scene.setClimber(state.pose, limbs, 'delighted');

      // The subject's extent in wall space.
      const head = state.pose.head;
      const pts = shot.subject === 'head'
        ? [
            { x: head.x - BODY.head * 1.15, y: head.y - BODY.head * 1.15 },
            { x: head.x + BODY.head * 1.15, y: head.y + BODY.head * 1.15 },
          ]
        : [...Object.values(limbs), head, state.pose.hip];
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2 + shot.ox;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2 + shot.oy;
      const frame = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * shot.pad;

      // Aim at that point through the wall's own tilt, from straight out.
      const dist = frame / 2 / Math.tan((scene.camera.fov * Math.PI) / 360);
      scene.plane.updateMatrixWorld();
      const at = scene.plane.localToWorld(scene.camera.position.clone().set(cx, cy, 0.12));
      scene.camera.position.set(at.x, at.y, at.z + dist);
      scene.camera.lookAt(at);
      scene.camera.updateMatrixWorld();
      scene.renderer.render(scene.scene, scene.camera);
      const data = canvas.toDataURL('image/png');
      scene.dispose();
      return data;
    }, shot);
    masters[name] = png;
  }

  // Scale down in the browser, in halving steps, so the small sizes are
  // properly filtered rather than point-sampled.
  for (const [file, [size, shot]] of Object.entries(OUT)) {
    const out = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await out.setContent('<html><body style="margin:0;background:#171a21"><canvas id="o"></canvas></body></html>');
    await out.evaluate(async ({ src, size }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      let cur = img;
      let w = img.width;
      while (w / 2 >= size) {
        w = Math.floor(w / 2);
        const c = document.createElement('canvas');
        c.width = c.height = w;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cur, 0, 0, w, w);
        cur = c;
      }
      const o = document.getElementById('o');
      o.width = o.height = size;
      o.style.display = 'block';
      const ctx = o.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, size, size);
    }, { src: masters[shot], size });
    await out.screenshot({ path: `${pub}${file}`, clip: { x: 0, y: 0, width: size, height: size } });
    await out.close();
    console.log(`${file} ${size}x${size}`);
  }
} finally {
  await browser.close();
  await server.close();
}
