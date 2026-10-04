import { describe, expect, it } from 'vitest';
import { RELEASE_LOOKBACK_MS, filterAim, freshAimFilter, releaseAim } from './aimInput';

describe('aim input', () => {
  it('steadies a shaking finger that is holding still', () => {
    const f = freshAimFilter();
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      // A held pull of (-80, 120) with a couple of pixels of tremor.
      const jitter = i % 2 === 0 ? 2.5 : -2.5;
      const out = filterAim(f, { x: -80 + jitter, y: 120 - jitter }, i * 16);
      if (i > 40) worst = Math.max(worst, Math.abs(out.x + 80), Math.abs(out.y - 120));
    }
    expect(worst).toBeLessThan(1);
  });

  it('keeps up with a big sweep', () => {
    const f = freshAimFilter();
    let out = { x: 0, y: 0 };
    for (let i = 0; i <= 10; i++) out = filterAim(f, { x: 0, y: i * 20 }, i * 16);
    // Swept 200px in a sixth of a second: barely behind.
    expect(out.y).toBeGreaterThan(170);
  });

  it('fires the aim from just before lift-off, not the smear on the way up', () => {
    const f = freshAimFilter();
    let t = 0;
    for (; t <= 600; t += 16) filterAim(f, { x: -60, y: 140 }, t);
    // The thumb rolls off the glass: a slow few pixels in the last frames.
    filterAim(f, { x: -54, y: 135 }, t); t += 16;
    filterAim(f, { x: -48, y: 130 }, t);
    const fired = releaseAim(f, t + 8)!;
    expect(Math.abs(fired.x + 60)).toBeLessThan(1.5);
    expect(Math.abs(fired.y - 140)).toBeLessThan(1.5);
  });

  it('a drag shorter than the look-back fires as it stands', () => {
    const f = freshAimFilter();
    filterAim(f, { x: 0, y: 10 }, 0);
    filterAim(f, { x: 0, y: 40 }, RELEASE_LOOKBACK_MS / 2);
    expect(releaseAim(f, RELEASE_LOOKBACK_MS / 2)!.y).toBeGreaterThan(10);
  });
});
