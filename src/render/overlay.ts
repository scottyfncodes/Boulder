import type { Hold, LimbId, Vec2 } from '../game/types';
import { LIMB_SHORT, isHand } from '../game/types';
import { contactRadius, perfectRadius } from '../game/holds';
import { GRADE_COLOR } from './palette';
import type { WallScene } from './scene';

/**
 * The aiming layer.
 *
 * Drawn on a 2D canvas over the 3D one, in the same frame, so the reticle never
 * lags the wall behind it. Everything it shows is true: the landing marker is
 * the exact point the sim will use, and the reach ring is the exact distance
 * past which the limb cannot arrive. The game is hard because holds are small
 * and bodies are awkward, not because the interface is lying to you.
 */

export type AimView = {
  limb: LimbId;
  anchor: Vec2;
  landing: Vec2;
  maxReach: number;
  power: number;
  /** The hold the landing point would catch, if any. */
  targetHold: Hold | null;
  /** True while the player is mid-drag. */
  dragging: boolean;
};

export type OverlayInput = {
  scene: WallScene;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  limbPositions: Record<LimbId, Vec2>;
  contactLimbs: Set<LimbId>;
  selected: LimbId | null;
  /** Limbs that cannot be moved right now, with the reason. */
  locked: Set<LimbId>;
  aim: AimView | null;
  accent: string;
  /** Suppresses the limb pips during inspection and animation. */
  showLimbs: boolean;
};

export const LIMB_PIP_RADIUS = 21;
/** Fingers are wide. The tap target is much bigger than the thing it hits. */
export const LIMB_TOUCH_RADIUS = 40;

export function drawOverlay(input: OverlayInput): void {
  const { ctx, width, height, scene } = input;
  ctx.clearRect(0, 0, width, height);

  if (input.aim) drawAim(input);
  if (input.showLimbs) drawLimbPips(input);

  void scene;
}

function drawLimbPips(input: OverlayInput): void {
  const { ctx, scene, limbPositions, contactLimbs, selected, locked } = input;
  for (const limb of ['LF', 'RF', 'LH', 'RH'] as LimbId[]) {
    const p = scene.project(limbPositions[limb], isHand(limb) ? 0.16 : 0.13);
    if (!p.visible) continue;
    const isSel = selected === limb;
    const isLocked = locked.has(limb);
    const on = contactLimbs.has(limb);
    const r = isSel ? LIMB_PIP_RADIUS + 4 : LIMB_PIP_RADIUS;

    ctx.save();
    ctx.globalAlpha = isLocked ? 0.32 : 1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? input.accent : 'rgba(18,20,26,0.62)';
    ctx.fill();
    ctx.lineWidth = isSel ? 3 : 2;
    ctx.strokeStyle = isSel ? '#fff' : on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)';
    ctx.stroke();

    ctx.fillStyle = isSel ? '#11141a' : '#fff';
    ctx.font = `700 ${isSel ? 15 : 13}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(LIMB_SHORT[limb], p.x, p.y + 0.5);
    ctx.restore();
  }
}

function drawAim(input: OverlayInput): void {
  const { ctx, scene, aim, accent } = input;
  if (!aim) return;

  const anchor = scene.project(aim.anchor, 0.14);
  const land = scene.project(aim.landing, 0.14);

  // Reach ring — the hard edge of what this limb can do from here.
  const edge = scene.project({ x: aim.anchor.x + aim.maxReach, y: aim.anchor.y }, 0.14);
  const ringR = Math.abs(edge.x - anchor.x);
  ctx.save();
  ctx.setLineDash([5, 7]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Trajectory: dotted, arced, and stopping exactly where the limb will.
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.setLineDash([2, 9]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const lift = -Math.hypot(land.x - anchor.x, land.y - anchor.y) * 0.16;
  ctx.moveTo(anchor.x, anchor.y);
  ctx.quadraticCurveTo(
    (anchor.x + land.x) / 2,
    (anchor.y + land.y) / 2 + lift,
    land.x, land.y,
  );
  ctx.stroke();
  ctx.restore();

  // What the landing would catch.
  if (aim.targetHold) {
    const h = aim.targetHold;
    const c = scene.project(h.pos, 0.14);
    const zoneEdge = scene.project(
      { x: h.pos.x + contactRadius(h.size, h.type), y: h.pos.y }, 0.14,
    );
    const perfEdge = scene.project(
      { x: h.pos.x + perfectRadius(h.size, h.type), y: h.pos.y }, 0.14,
    );
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(zoneEdge.x - c.x), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(perfEdge.x - c.x), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Landing reticle.
  ctx.save();
  ctx.translate(land.x, land.y);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 13, Math.sin(a) * 13);
    ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19);
    ctx.stroke();
  }
  ctx.restore();

  if (aim.dragging) drawPowerMeter(ctx, anchor, land, aim.power, accent);
}

function drawPowerMeter(
  ctx: CanvasRenderingContext2D,
  anchor: { x: number; y: number },
  land: { x: number; y: number },
  power: number,
  accent: string,
): void {
  const dx = land.x - anchor.x;
  const dy = land.y - anchor.y;
  const len = Math.max(Math.hypot(dx, dy), 1);
  // Sits alongside the throw so the finger never covers it.
  const nx = -dy / len;
  const ny = dx / len;
  const cx = anchor.x + dx * 0.5 + nx * 30;
  const cy = anchor.y + dy * 0.5 + ny * 30;
  const w = 54;
  const h = 7;
  const a = Math.atan2(dy, dx);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.fillStyle = 'rgba(10,12,16,0.7)';
  roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = power > 0.96 ? '#ff6b5e' : accent;
  roundRect(ctx, -w / 2, -h / 2, w * Math.min(power, 1), h, h / 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { GRADE_COLOR };
