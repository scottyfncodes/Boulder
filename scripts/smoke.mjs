/**
 * A playable smoke test: drives the built game in a real browser at phone
 * size through all three modes — a boulder throw, a highball, a tread wall
 * session — and saves screenshots. Needs a server:
 *
 *   npm run build && npx vite preview --port 4173   # one terminal
 *   npm run smoke                                   # another
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://127.0.0.1:4173/?debug';
const OUT = process.env.OUT ?? 'node_modules/.cache/smoke';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);
const step = (msg) => console.log('·', msg);

await page.goto(URL, { waitUntil: 'networkidle' });
await shot('01-title');
await page.locator('.title__go').click();
await wait(600);
await shot('02-board');
step('board up');

// A boulder: pull on, throw a hand up.
await page.getByRole('button', { name: /This Is A Warmup/ }).click();
await wait(900);
await page.getByRole('button', { name: /Start onsight|Pull on/ }).click();
await wait(1200);
const pip = async () => {
  // The right hand pip: find it by projecting through the page's scene is not exposed, so
  // press the right hand's key and pull from the middle of the screen.
  await page.keyboard.press('w');
  await page.mouse.move(195, 520);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(195 + i * 1.5, 520 + i * 9); await wait(16); }
  await wait(250);
  await shot('03-boulder-aim');
  await page.mouse.up();
};
await pip();
await wait(1500);
await shot('04-boulder-after');
const moves = await page.locator('.climb__stats b').first().textContent();
step(`boulder: ${moves} move(s) after one throw`);
if (Number(moves) < 1) throw new Error('the throw did not register');
await page.getByRole('button', { name: 'Back to routes' }).click();
await wait(500);

// Highball.
await page.getByRole('button', { name: /Highball/ }).first().click();
await wait(500);
await shot('05-highballs');
await page.locator('.hbcard').first().click();
await wait(1000);
await shot('06-highball-inspect');
await page.getByRole('button', { name: 'Commit to it' }).click();
await wait(1500);
await shot('07-highball-climbing');
const height = await page.locator('.heighthud__now').textContent();
step(`highball: height readout ${height}`);
// A fall from near the top: the landing is judged, and the next go waits for a breath.
await page.evaluate(() => window.__bruh.fallFrom(6.5));
await page.waitForSelector('.falloff__landing', { timeout: 30000 });
await wait(300);
await shot('07b-highball-landing');
const landing = await page.locator('.falloff__landing').textContent();
const retry = page.locator('.falloff__row .btn--primary');
const waiting = await retry.isDisabled();
step(`highball fall: "${landing}" · retry waits: ${waiting}`);
if (!/heavy/i.test(landing)) throw new Error('a fall from the top was not judged heavy');
if (!waiting) throw new Error('retry did not wait for a breath');
await page.waitForFunction(() => !document.querySelector('.falloff__row .btn--primary').disabled, null, { timeout: 15000 });
await retry.click();
await wait(600);
if (!(await page.getByRole('button', { name: 'Commit to it' }).isVisible())) throw new Error('retry did not reset the climb');
step('highball retry: back at the start');
await page.getByRole('button', { name: 'Commit to it' }).click();
await wait(500);
await page.getByRole('button', { name: 'Back to routes' }).click();
await wait(500);

// Tread wall.
await page.getByRole('button', { name: /Tread Wall/ }).first().click();
await wait(500);
await shot('08-tread-lobby');
await page.getByRole('button', { name: 'Start a session' }).click();
await wait(900);
await page.getByRole('button', { name: 'Pull on' }).click();
await wait(6000);
await shot('09-tread-climbing');
const t1 = await page.locator('.treadhud__time').textContent();
await wait(2000);
const t2 = await page.locator('.treadhud__time').textContent();
step(`tread: clock ${t1} -> ${t2}`);
if (t1 === t2) throw new Error('the tread clock is not running');
await page.getByRole('button', { name: /Step off/ }).click();
await wait(800);
await shot('10-tread-result');
const result = await page.locator('.treadres__time').textContent();
step(`tread result: ${result}`);
await page.getByRole('button', { name: 'Go again' }).click();
await wait(800);
await page.getByRole('button', { name: 'Pull on' }).click();
await wait(1500);
await page.getByRole('button', { name: /Step off/ }).click();
await wait(800);
await shot('11-tread-result-2');
await page.getByRole('button', { name: 'Lobby' }).click();
await wait(500);
// Hang there and do nothing: the floor comes up and ends it.
await page.getByRole('button', { name: 'Start a session' }).click();
await wait(600);
await page.getByRole('button', { name: 'Pull on' }).click();
await page.waitForSelector('.treadres__time', { timeout: 170000 });
const why = await page.locator('.treadres__why').textContent();
step(`tread, standing still: "${why}"`);
if (!/floor/i.test(why)) throw new Error('standing still did not end at the floor');
await shot('11b-tread-floor');
await page.getByRole('button', { name: 'Lobby' }).click();
await wait(500);
await shot('12-tread-lobby-after');
const rows = await page.locator('.lboard tr').count();
step(`leaderboard rows: ${rows}`);

// Reload: the personal best must survive.
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.title__go').click();
await wait(400);
await page.getByRole('button', { name: /Tread Wall/ }).first().click();
await wait(400);
const pb = await page.locator('.modeboard__title').textContent();
step(`personal best after reload: ${pb}`);
if (pb === '—') throw new Error('personal best did not persist');

await browser.close();
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
console.log('smoke ok');
