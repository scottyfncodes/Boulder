import type { Hold, LimbId, Vec2 } from '../game/types';
import { LIMB_SHORT, isHand } from '../game/types';
import { contactRadius } from '../game/holds';
import type { LimbPhase, Prediction } from '../game/sling';
import { AIM_HOT, AIM_TARGET, LIMB_PIP_RADIUS, type Shout, drawOverlay } from './overlay';
import { ARM_Z, FOOT_Z, HAND_Z, HOLD_Z } from './depths';
import type { WallScene } from './scene';

/**
 * The slingshot layer.
 *
 * What the player reads while aiming is: the limb, the band they are pulling
 * it back on, the arc it will fly, the wall, and the holds. Nothing else. The
 * arc is the true one — it comes from running the launch forward on a copy of
 * the body — so the interface never promises a catch the physics will refuse.
 */

export type PullView = {
  limb: LimbId;
  /** Where the limb actually is, wall space. */
  from: Vec2;
  /** The shoulder or hip it swings from, wall space. */
  anchor: Vec2;
  /** Where the finger has dragged the limb to, screen pixels. */
  ghost: { x: number; y: number };
  power: number;
  prediction: Prediction | null;
  /** Holds this limb could plausibly reach from here, for a subtle ring. */
  reachable: Hold[];
};

export type SlingOverlayInput = {
  scene: WallScene;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  limbs: Record<LimbId, Vec2>;
  phases: Record<LimbId, LimbPhase>;
  selected: LimbId | null;
  /** Limbs that can be picked up right now. */
  launchable: Set<LimbId>;
  pull: PullView | null;
  /** Recent positions of limbs in flight, oldest first. */
  trails: Partial<Record<LimbId, Vec2[]>>;
  shout: Shout | null;
  accent: string;
  showLimbs: boolean;
  /** Opacity of the introductory limb names. */
  intro: number;
  hip: Vec2;
};

export function drawSlingOverlay(input: SlingOverlayInput): void {
  const { ctx, width, height } = input;
  ctx.clearRect(0, 0, width, height);

  if (input.pull) drawReachable(input);
  drawTrails(input);
  if (input.pull) drawPrediction(input);
  if (input.pull) drawBand(input);
  if (input.showLimbs) drawPips(input);
  if (input.pull) drawGhost(input);

  if (input.shout) {
    // The shout drawing lives with the old overlay; borrow it with everything
    // else switched off.
    drawOverlay({
      scene: input.scene, ctx, width, height,
      limbPositions: input.limbs, hip: input.hip,
      contactLimbs: new Set(), selected: null, locked: new Set(),
      aim: null, shift: null, shout: input.shout, accent: input.accent,
      showLimbs: false, intro: 0,
    });
  }
}

/** Faint rings on the holds this limb could get to. Information, not advice. */
function drawReachable({ ctx, scene, pull }: SlingOverlayInput): void {
  if (!pull) return;
  const caught = pull.prediction?.caught?.holdId ?? null;
  for (const h of pull.reachable) {
    const c = scene.project(h.pos, HOLD_Z);
    if (!c.visible) continue;
    const edge = scene.project({ x: h.pos.x + contactRadius(h.size, h.type), y: h.pos.y }, HOLD_Z);
    const r = Math.abs(edge.x - c.x) + 4;
    ctx.save();
    if (h.id === caught) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = AIM_TARGET;
      ctx.globalAlpha = 0.95;
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.setLineDash([3, 5]);
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** A limb in flight leaves a short tail so the throw reads at a glance. */
function drawTrails({ ctx, scene, trails }: SlingOverlayInput): void {
  for (const key of Object.keys(trails) as LimbId[]) {
    const pts = trails[key];
    if (!pts || pts.length < 2) continue;
    const z = isHand(key) ? HAND_Z : FOOT_Z;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = scene.project(pts[i - 1], z);
      const b = scene.project(pts[i], z);
      const t = i / pts.length;
      ctx.strokeStyle = `rgba(255,255,255,${(0.05 + 0.5 * t).toFixed(3)})`;
      ctx.lineWidth = 2 + 6 * t;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** The arc, dotted, fading toward where the flight ends. */
function drawPrediction({ ctx, scene, pull }: SlingOverlayInput): void {
  if (!pull || !pull.prediction) return;
  const p = pull.prediction;
  const z = isHand(pull.limb) ? HAND_Z : FOOT_Z;
  const n = p.path.length;
  if (n === 0) return;
  const step = Math.max(1, Math.round(n / 22));
  ctx.save();
  for (let i = 0; i < n; i += step) {
    const s = scene.project(p.path[i], z);
    const t = i / n;
    ctx.globalAlpha = 0.95 - 0.6 * t;
    ctx.fillStyle = AIM_TARGET;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3.2 - 1.2 * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Where it ends: on the hold it grabs, or a reticle where it gives up.
  const end = p.caught ? p.caught.at : p.end;
  const e = scene.project(end, p.caught ? HOLD_Z : z);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.strokeStyle = p.caught ? AIM_TARGET : 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.stroke();
  if (p.caught) {
    ctx.fillStyle = AIM_TARGET;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // A cross: this is where the limb ends up dangling.
    ctx.beginPath();
    ctx.moveTo(-5, -5); ctx.lineTo(5, 5);
    ctx.moveTo(5, -5); ctx.lineTo(-5, 5);
    ctx.stroke();
  }
  ctx.restore();

  // Something else is going to let go if you do this. Say so, quietly.
  if (p.slips.length > 0) {
    ctx.save();
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = AIM_HOT;
    ctx.fillText(`${p.slips.map((l) => LIMB_SHORT[l]).join(' ')} will let go`, e.x, e.y - 18);
    ctx.restore();
  }
}

/**
 * The band. Two lines from the anchor to the pulled-back limb, the way an
 * elastic runs round the thing it is about to fire, plus the stretch itself.
 */
function drawBand({ ctx, scene, pull, accent }: SlingOverlayInput): void {
  if (!pull) return;
  const a = scene.project(pull.anchor, ARM_Z);
  const f = scene.project(pull.from, isHand(pull.limb) ? HAND_Z : FOOT_Z);
  const g = pull.ghost;
  const hot = pull.power > 0.96;

  ctx.save();
  ctx.lineCap = 'round';
  // Elastic: from the anchor round the ghost.
  ctx.strokeStyle = hot ? AIM_HOT : 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x - 6, a.y);
  ctx.lineTo(g.x, g.y);
  ctx.moveTo(a.x + 6, a.y);
  ctx.lineTo(g.x, g.y);
  ctx.stroke();
  // The stretch: where the limb is, to where it has been pulled.
  ctx.strokeStyle = hot ? AIM_HOT : accent;
  ctx.lineWidth = 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(g.x, g.y);
  ctx.stroke();
  // Launch direction: a short arrow out of the limb, opposite the pull.
  const dx = f.x - g.x;
  const dy = f.y - g.y;
  const l = Math.max(Math.hypot(dx, dy), 1);
  const ux = dx / l;
  const uy = dy / l;
  const tipX = f.x + ux * 28;
  const tipY = f.y + uy * 28;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(tipX, tipY);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * 9 - uy * 6, tipY - uy * 9 + ux * 6);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * 9 + uy * 6, tipY - uy * 9 - ux * 6);
  ctx.stroke();
  ctx.restore();
}

/** The limb, pulled back to the finger, scaled by how hard it is being pulled. */
function drawGhost({ ctx, pull, accent }: SlingOverlayInput): void {
  if (!pull) return;
  const g = pull.ghost;
  const r = LIMB_PIP_RADIUS + 2 + pull.power * 6;
  ctx.save();
  ctx.beginPath();
  ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
  ctx.fillStyle = pull.power > 0.96 ? AIM_HOT : accent;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#11141a';
  ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(LIMB_SHORT[pull.limb], g.x, g.y + 0.5);
  ctx.restore();
}

function drawPips(input: SlingOverlayInput): void {
  const { ctx, scene, limbs, phases, selected, launchable, pull } = input;
  for (const limb of ['LF', 'RF', 'LH', 'RH'] as LimbId[]) {
    // The selected limb is drawn as the ghost while it is being pulled.
    if (pull && pull.limb === limb) continue;
    const p = scene.project(limbs[limb], isHand(limb) ? HAND_Z : FOOT_Z);
    if (!p.visible) continue;
    const phase = phases[limb];
    const isSel = selected === limb;
    const can = launchable.has(limb);
    const r = isSel ? LIMB_PIP_RADIUS + 4 : LIMB_PIP_RADIUS;

    ctx.save();
    ctx.globalAlpha = can ? 1 : 0.35;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? input.accent : 'rgba(18,20,26,0.62)';
    ctx.fill();
    ctx.lineWidth = isSel ? 3 : 2;
    if (phase === 'flying') ctx.setLineDash([4, 4]);
    ctx.strokeStyle = isSel
      ? '#fff'
      : phase === 'held' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)';
    ctx.stroke();

    const nameAlpha = isSel ? 1 : Math.max(input.intro, phase === 'free' ? 0.7 : 0);
    if (nameAlpha > 0.01) {
      ctx.globalAlpha *= nameAlpha;
      ctx.fillStyle = isSel ? '#11141a' : '#fff';
      ctx.font = `700 ${isSel ? 15 : 13}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LIMB_SHORT[limb], p.x, p.y + 0.5);
    }
    ctx.restore();
  }
}

