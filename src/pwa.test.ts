import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Home screen and install icons.
 *
 * These break silently: a missing PNG or a root-absolute path looks fine on a
 * dev server at / and then shows a blank tile on an iPhone when the game is
 * served from a GitHub Pages repository path. So this checks the real bytes
 * and a real production build.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');

/** Width, height and colour type from a PNG's IHDR, or null if it is not one. */
function pngInfo(file: string): { w: number; h: number } | null {
  const b = readFileSync(file);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => b[i] === v) || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

type Manifest = {
  name: string; short_name: string; start_url: string; scope: string; display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as Manifest;
const html = readFileSync(join(root, 'index.html'), 'utf8');

function linkHref(rel: string, source: string): string | null {
  const m = new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]+)"`).exec(source);
  return m ? m[1] : null;
}

describe('icons', () => {
  it.each([
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['favicon-32.png', 32],
  ])('%s is a real %ipx square PNG', (file, size) => {
    expect(pngInfo(join(pub, file))).toEqual({ w: size, h: size });
  });

});

describe('manifest', () => {
  it('names the app and installs standalone, relative to where it is served', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    // Relative, so a repository subpath is the app's whole world.
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  it('lists 192 and 512 PNGs that exist at the sizes it claims', () => {
    for (const size of [192, 512]) {
      const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}` && i.type === 'image/png');
      expect(icon, `${size} icon`).toBeTruthy();
    }
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/'), icon.src).toBe(false);
      expect(icon.src.startsWith('data:'), icon.src).toBe(false);
      const file = join(pub, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type === 'image/png') {
        const [w, h] = icon.sizes.split('x').map(Number);
        expect(pngInfo(file), icon.src).toEqual({ w, h });
      }
    }
  });
});

describe('index.html', () => {
  it('carries the iOS home screen metadata', () => {
    for (const name of [
      'apple-mobile-web-app-capable',
      'apple-mobile-web-app-status-bar-style',
      'apple-mobile-web-app-title',
    ]) {
      expect(html).toMatch(new RegExp(`<meta name="${name}" content="[^"]+"`));
    }
  });

  it('points every icon link at a real file, never an emoji or a data URI', () => {
    for (const rel of ['icon', 'apple-touch-icon', 'manifest']) {
      const href = linkHref(rel, html);
      expect(href, rel).toBeTruthy();
      expect(href!.startsWith('data:'), rel).toBe(false);
      expect(existsSync(join(pub, href!.replace(/^\.?\//, ''))), href!).toBe(true);
    }
    expect(linkHref('apple-touch-icon', html)).toMatch(/\.png$/);
  });
});

describe('production build', () => {
  it('ships the icons and references them relative to the page', async () => {
    const { build } = await import('vite');
    const out = mkdtempSync(join(tmpdir(), 'bruh-build-'));
    try {
      await build({
        root, logLevel: 'silent', configFile: join(root, 'vite.config.ts'),
        build: { outDir: out, emptyOutDir: true },
      });
      const built = readFileSync(join(out, 'index.html'), 'utf8');
      for (const rel of ['icon', 'apple-touch-icon', 'manifest']) {
        const href = linkHref(rel, built)!;
        // GitHub Pages serves the game from /<repo>/, so a root-absolute path
        // would resolve outside it.
        expect(href, rel).toMatch(/^\.\//);
        expect(existsSync(join(out, href)), href).toBe(true);
      }
      for (const file of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon-32.png']) {
        expect(existsSync(join(out, file)), file).toBe(true);
      }
      const builtManifest = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8')) as Manifest;
      for (const icon of builtManifest.icons) expect(existsSync(join(out, icon.src)), icon.src).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
