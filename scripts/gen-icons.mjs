/**
 * Rasterises public/icon.svg into the PNGs that home screens and installers
 * actually use. iOS ignores SVG for apple-touch-icon, and the manifest wants
 * real 192 and 512 bitmaps, so these are generated once and committed.
 *
 * Needs Playwright's Chromium, like check:overlay, so it is not part of the
 * build. Run it after changing icon.svg:
 *
 *   npm run gen:icons
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(`${pub}icon.svg`, 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/** File name -> pixel size. Every one is square and fully opaque. */
const OUT = {
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
  'favicon-32.png': 32,
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
});
for (const [name, size] of Object.entries(OUT)) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:#171a21"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  await page.waitForFunction(() => document.images[0]?.complete);
  await page.screenshot({ path: `${pub}${name}`, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(`${name} ${size}x${size}`);
}
await browser.close();
