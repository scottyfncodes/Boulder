import type { Vec2 } from '../game/types';
import type { WallScene } from './scene';
import { HOLD_Z } from './depths';

/**
 * Feel: chalk, confetti and the camera being knocked about.
 *
 * None of this is information. The sim decides everything and the overlay
 * tells the truth about it; this file only makes the truth land harder. It
 * lives in wall space so a puff stays on the hold it came off while the camera
 * follows the climber, and it is drawn on the overlay canvas in the same frame
 * as everything else so it never lags the wall.
 */

type Kind = 'puff' | 'spark' | 'confetti' | 'dust' | 'ring';

type Particle = {
  kind: Kind;
  x: number; y: number; z: number;
  vx: number; vy: number;
  age: number; life: number;
  size: number;
  color: string;
  spin: number; rot: number;
};

const GRAVITY: Record<Kind, number> = {
  puff: -0.25, spark: 5.5, confetti: 2.2, dust: 0.6, ring: 0,
};
const DRAG: Record<Kind, number> = {
  puff: 3.2, spark: 1.2, confetti: 2.6, dust: 3.8, ring: 0,
};

const CONFETTI = ['#6ef2b4', '#f2c249', '#ff8f3c', '#00e5ff', '#ff5fa2', '#ffffff', '#b28cff'];

export class Fx {
  private parts: Particle[] = [];
  /** 0..1. Shake grows faster than trauma, so small knocks stay small. */
  private trauma = 0;
  private t = 0;

  /** Chalk off a hand on contact. More chalk for a cleaner catch. */
  chalk(at: Vec2, amount = 1, color = 'rgba(255,255,255,0.9)'): void {
    const n = Math.round(7 + amount * 9);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.25 + Math.random() * 0.75 * amount;
      this.parts.push({
        kind: 'puff', x: at.x, y: at.y, z: HOLD_Z + 0.04,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.8 + 0.1,
        age: 0, life: 0.55 + Math.random() * 0.5,
        size: 0.03 + Math.random() * 0.035, color, spin: 0, rot: 0,
      });
    }
  }

  /** A clean catch gets a ring and a few sparks in the grade's colour. */
  perfect(at: Vec2, color: string): void {
    this.parts.push({
      kind: 'ring', x: at.x, y: at.y, z: HOLD_Z + 0.05, vx: 0, vy: 0,
      age: 0, life: 0.42, size: 0.22, color, spin: 0, rot: 0,
    });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.3;
      const s = 1.6 + Math.random() * 1.2;
      this.parts.push({
        kind: 'spark', x: at.x, y: at.y, z: HOLD_Z + 0.06,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + 0.6,
        age: 0, life: 0.35 + Math.random() * 0.2,
        size: 2.2, color, spin: 0, rot: 0,
      });
    }
  }

  /** Crash pad dust, kicked out sideways. */
  dust(at: Vec2): void {
    for (let i = 0; i < 26; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.parts.push({
        kind: 'dust', x: at.x + side * Math.random() * 0.2, y: 0.12 + Math.random() * 0.1, z: 0.35,
        vx: side * (0.8 + Math.random() * 2.2), vy: 0.3 + Math.random() * 1.1,
        age: 0, life: 0.7 + Math.random() * 0.6,
        size: 0.05 + Math.random() * 0.07, color: 'rgba(235,228,214,0.75)', spin: 0, rot: 0,
      });
    }
  }

  /** The top. Everything, everywhere. */
  confetti(at: Vec2): void {
    for (let i = 0; i < 90; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = 2.2 + Math.random() * 3.6;
      this.parts.push({
        kind: 'confetti', x: at.x, y: at.y, z: HOLD_Z + 0.2,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        age: 0, life: 1.8 + Math.random() * 1.4,
        size: 5 + Math.random() * 5,
        color: CONFETTI[i % CONFETTI.length],
        spin: (Math.random() - 0.5) * 18, rot: Math.random() * Math.PI,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.parts.push({
        kind: 'ring', x: at.x, y: at.y, z: HOLD_Z + 0.05, vx: 0, vy: 0,
        age: -i * 0.12, life: 0.6, size: 0.5 + i * 0.3, color: CONFETTI[i], spin: 0, rot: 0,
      });
    }
  }

  kick(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  get busy(): boolean {
    return this.parts.length > 0 || this.trauma > 0.001;
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const keep: Particle[] = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age < 0) { keep.push(p); continue; }
      if (p.age >= p.life) continue;
      const drag = Math.exp(-DRAG[p.kind] * dt);
      p.vx *= drag; p.vy *= drag;
      p.vy -= GRAVITY[p.kind] * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'confetti') {
        p.rot += p.spin * dt;
        // Flutter, so it drifts rather than drops.
        p.x += Math.sin(p.age * 7 + p.spin) * 0.25 * dt;
      }
      if (p.kind === 'dust' && p.y < 0.05) { p.y = 0.05; p.vy = 0; }
      keep.push(p);
    }
    this.parts = keep;
  }

  /** Pixel offset to apply to the whole scene this frame. */
  shake(): { x: number; y: number; r: number } {
    const s = this.trauma ** 1.6;
    if (s < 1e-4) return { x: 0, y: 0, r: 0 };
    const t = this.t * 60;
    return {
      x: s * 14 * (Math.sin(t * 1.3) + Math.sin(t * 2.9) * 0.5),
      y: s * 11 * (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.3) * 0.5),
      r: s * 1.6 * Math.sin(t * 1.1 + 2),
    };
  }

  draw(ctx: CanvasRenderingContext2D, scene: WallScene): void {
    if (!this.parts.length) return;
    const mpp = scene.metresPerPixel();
    ctx.save();
    for (const p of this.parts) {
      if (p.age < 0) continue;
      const k = p.age / p.life;
      const at = scene.project({ x: p.x, y: p.y }, p.z);
      if (!at.visible) continue;
      switch (p.kind) {
        case 'puff':
        case 'dust': {
          const r = (p.size * (1 + k * 1.6)) / mpp;
          ctx.globalAlpha = (1 - k) * (p.kind === 'puff' ? 0.55 : 0.6);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'spark': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          const tail = scene.project({ x: p.x - p.vx * 0.035, y: p.y - p.vy * 0.035 }, p.z);
          ctx.beginPath();
          ctx.moveTo(tail.x, tail.y);
          ctx.lineTo(at.x, at.y);
          ctx.stroke();
          break;
        }
        case 'ring': {
          const r = (p.size * (0.35 + easeOut(k) * 1.1)) / mpp;
          ctx.globalAlpha = (1 - k) * 0.9;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 4 * (1 - k) + 1;
          ctx.beginPath();
          ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'confetti': {
          ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(at.x, at.y);
          ctx.rotate(p.rot);
          // The squash is the flip — a rectangle turning over in the air.
          ctx.fillRect(-p.size / 2, (-p.size / 4) * Math.cos(p.rot * 1.7), p.size, (p.size / 2) * Math.cos(p.rot * 1.7));
          ctx.restore();
          break;
        }
      }
    }
    ctx.restore();
  }
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
