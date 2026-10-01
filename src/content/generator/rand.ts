import { rng } from '../../game/rng';
import type { Weighted } from './difficulty';

/**
 * The setter's dice. A thin layer over the seeded PRNG so every decision the
 * generator makes reads as a sentence rather than as arithmetic on `r()`.
 */
export class Rand {
  private readonly r: () => number;

  constructor(seed: number) {
    this.r = rng(seed);
  }

  next(): number {
    return this.r();
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.r();
  }

  /** Inclusive at both ends. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.r() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.r() < p;
  }

  sign(): 1 | -1 {
    return this.r() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.r() * items.length)];
  }

  weighted<T>(items: Weighted<T>): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let roll = this.r() * total;
    for (const [item, w] of items) {
      roll -= w;
      if (roll < 0) return item;
    }
    return items[items.length - 1][0];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
