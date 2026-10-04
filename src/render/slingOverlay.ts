import type { Hold, LimbId, Vec2 } from '../game/types';
import { LIMB_SHORT, isHand } from '../game/types';
import { contactRadius } from '../game/holds';
import type { DynoPrediction, LimbPhase, Prediction } from '../game/sling';
import {
  AIM_HOT, AIM_TARGET, LIMB_PIP_RADIUS, type Shout, drawShout,
} from './overlay';
import { ARM_Z, FOOT_Z, HAND_Z, HIP_Z, HOLD_Z, TORSO_Z } from './depths';
import type { WallScene } from './scene';

/**
 * The slingshot layer.
 *
 * What the player reads while aiming is: the limb, the band they are pulling
 * it back on, the arc it will fly, the wall, and the holds. Nothing else. The
 * arc is the true one — it comes from running the launch forward on a copy of
 * the body — so the interface never promises a catch the physics will refuse.
 */

/** The hips are a tap target too: pull them and the whole body goes. */
export type Selection = LimbId | 'BODY';

export type PullView = {
  limb: Selection;
  /** Where the thing being pulled actually is, wall space. */
  from: Vec2;
  /** The shoulder or hip it swings from, wall space. */
  anchor: Vec2;
  /** Where the finger has dragged it to, screen pixels. */
  ghost: { x: number; y: number };
  power: number;
  prediction: Prediction | null;
  dynoPrediction: DynoPrediction | null;
  /**
   * On a dyno, every limb that is on something is a band: from where it is
   * on the wall to its joint on the drawn-back body.
   */
  bands: { limb: LimbId; at: Vec2; anchor: Vec2 }[];
  /** Holds this limb could plausibly reach from here, for a subtle ring. */
  reachable: Hold[];
  /** Holds a dangling limb can simply be put back on. Tap one. */
  placeable: Hold[];
  /** The tether: how far from its anchor this limb can possibly get. */
  reach: { anchor: Vec2; radius: number } | null;
};

/** The bands contracting after a release, drawn for a few frames. */
export type SnapView = {
  /** Each band: its fixed end, where its free end let go from, and where that end is now. */
  bands: { anchor: Vec2; from: Vec2; to: Vec2 }[];
  /** 0..1 through the snap. */
  t: number;
};

export type SlingOverlayInput = {
  scene: WallScene;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  limbs: Record<LimbId, Vec2>;
  phases: Record<LimbId, LimbPhase>;
  /** The belly: where the dyno is grabbed. */
  core: Vec2;
  selected: Selection | null;
  /** Limbs that can be picked up right now. */
  launchable: Set<LimbId>;
  /** Whether the hips can be pulled: something to jump off. */
  canDyno: boolean;
  /** The dyno meter, 0..1. The belly shows it filling; full is when it lights up. */
  dynoCharge: number;
  /** Frame time, ms, for the things that pulse. */
  now: number;
  pull: PullView | null;
  snap: SnapView | null;
  /** Recent positions of limbs in flight, oldest first. */
  trails: Partial<Record<LimbId, Vec2[]>>;
  shout: Shout | null;
  accent: string;
  showLimbs: boolean;
  /** Opacity of the introductory limb names. */
  intro: number;
};

export function drawSlingOverlay(input: SlingOverlayInput): void {
  const { ctx, width, height } = input;
  ctx.clearRect(0, 0, width, height);

  if (input.pull) drawReachRing(input);
  if (input.pull) drawReachable(input);
  if (input.snap) drawSnap(input);
  drawTrails(input);
  if (input.pull) drawPrediction(input);
  if (input.pull) drawDynoPrediction(input);
  if (input.pull && input.pull.power > 0) drawBand(input);
  if (input.showLimbs) drawPips(input);
  if (input.showLimbs) drawBodyPip(input);
  if (input.pull && input.pull.power > 0) drawGhost(input);
  if (input.shout) drawShout(ctx, input.scene, input.shout);
}

/** The hard edge of what this limb can do from here. */
function drawReachRing({ ctx, scene, pull }: SlingOverlayInput): void {
  if (!pull || !pull.reach) return;
  const a = scene.project(pull.reach.anchor, ARM_Z);
  const e = scene.project({ x: pull.reach.anchor.x + pull.reach.radius, y: pull.reach.anchor.y }, ARM_Z);
  ctx.save();
  ctx.setLineDash([5, 7]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.beginPath();
  ctx.arc(a.x, a.y, Math.abs(e.x - a.x), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The elastic going slack: from where the limb was held back to where it is now. */
function drawSnap({ ctx, scene, snap, accent }: SlingOverlayInput): void {
  if (!snap) return;
  const t = snap.t;
  const k = 1 - (1 - t) ** 3;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.lineCap = 'round';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5 * (1 - t) + 1;
  ctx.beginPath();
  for (const band of snap.bands) {
    const a = scene.project(band.anchor, ARM_Z);
    const f = scene.project(band.from, HAND_Z);
    const to = scene.project(band.to, HAND_Z);
    const x = f.x + (to.x - f.x) * k;
    const y = f.y + (to.y - f.y) * k;
    ctx.moveTo(a.x - 6, a.y);
    ctx.lineTo(x, y);
    ctx.moveTo(a.x + 6, a.y);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Faint rings on the holds this limb could get to; solid ones it can be tapped onto. */
function drawReachable({ ctx, scene, pull }: SlingOverlayInput): void {
  if (!pull) return;
  const caught = new Set<number>();
  if (pull.prediction?.caught) caught.add(pull.prediction.caught.holdId);
  for (const c of pull.dynoPrediction?.caught ?? []) caught.add(c.holdId);
  const placeable = new Set(pull.placeable.map((h) => h.id));
  const rings = pull.placeable.length ? pull.placeable : pull.reachable;

  for (const h of rings) {
    const c = scene.project(h.pos, HOLD_Z);
    if (!c.visible) continue;
    const edge = scene.project({ x: h.pos.x + contactRadius(h.size, h.type), y: h.pos.y }, HOLD_Z);
    const r = Math.abs(edge.x - c.x) + 5;
    ctx.save();
    if (caught.has(h.id)) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = AIM_TARGET;
    } else if (placeable.has(h.id) && pull.power === 0) {
      // Tap targets: solid, white, and obviously buttons.
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
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

function drawEndMarker(
  ctx: CanvasRenderingContext2D, e: { x: number; y: number }, caught: boolean,
): void {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.strokeStyle = caught ? AIM_TARGET : 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.stroke();
  if (caught) {
    ctx.fillStyle = AIM_TARGET;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(-5, -5); ctx.lineTo(5, 5);
    ctx.moveTo(5, -5); ctx.lineTo(-5, 5);
    ctx.stroke();
  }
  ctx.restore();
}

/** The arc, dotted, fading toward where the flight ends. */
function drawPrediction({ ctx, scene, pull }: SlingOverlayInput): void {
  if (!pull || !pull.prediction || pull.limb === 'BODY') return;
  const p = pull.prediction;
  const z = isHand(pull.limb) ? HAND_Z : FOOT_Z;
  const n = p.path.length;
  if (n === 0) return;
  const step = Math.max(1, Math.round(n / 34));
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

  const end = p.caught ? p.caught.at : p.end;
  const e = scene.project(end, p.caught ? HOLD_Z : z);
  drawEndMarker(ctx, e, !!p.caught);

  if (p.slips.length > 0) {
    ctx.save();
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = AIM_HOT;
    ctx.fillText(`${p.slips.map((l) => LIMB_SHORT[l]).join(' ')} will let go`, e.x, e.y - 18);
    ctx.restore();
  }
}

/** The whole body's arc for a dyno, and where the hands end up. */
function drawDynoPrediction({ ctx, scene, pull }: SlingOverlayInput): void {
  if (!pull || !pull.dynoPrediction || pull.limb !== 'BODY') return;
  const p = pull.dynoPrediction;
  const n = p.path.length;
  if (n === 0) return;
  const step = Math.max(1, Math.round(n / 26));
  ctx.save();
  for (let i = 0; i < n; i += step) {
    const s = scene.project(p.path[i], HIP_Z);
    const t = i / n;
    ctx.globalAlpha = 0.9 - 0.55 * t;
    ctx.fillStyle = AIM_HOT;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4.4 - 1.6 * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Fingertips: the hand gets there and rips off. Shown, because the preview
  // never lies — the precision is in letting go where it says STICKS.
  for (const rip of p.ripped) {
    const at = scene.project(rip.at, HOLD_Z);
    ctx.save();
    ctx.strokeStyle = '#e8564f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(at.x - 8, at.y - 8); ctx.lineTo(at.x + 8, at.y + 8);
    ctx.moveTo(at.x + 8, at.y - 8); ctx.lineTo(at.x - 8, at.y + 8);
    ctx.stroke();
    ctx.font = '800 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8564f';
    ctx.fillText('RIPS', at.x, at.y + 22);
    ctx.restore();
  }
  if (p.caught.length) {
    for (const c of p.caught) drawEndMarker(ctx, scene.project(c.at, HOLD_Z), true);
    const first = scene.project(p.caught[0].at, HOLD_Z);
    ctx.save();
    ctx.font = '800 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = AIM_TARGET;
    const how = p.caught[0].grade === 'PERFECT' ? 'STICKS CLEAN' : 'STICKS';
    ctx.fillText(`${how} · ${p.caught.length === 2 ? 'BOTH HANDS' : 'ONE HAND'}`, first.x, first.y - 20);
    ctx.restore();
  } else if (!p.ripped.length) {
    drawEndMarker(ctx, scene.project(p.hands, HAND_Z), false);
  }
}

/**
 * The band. Two lines from the anchor to the pulled-back limb, the way an
 * elastic runs round the thing it is about to fire, plus the stretch itself.
 */
function drawBand({ ctx, scene, pull, accent }: SlingOverlayInput): void {
  if (!pull) return;
  const body = pull.limb === 'BODY';
  const a = scene.project(pull.anchor, body ? HIP_Z : ARM_Z);
  const f = scene.project(pull.from, pull.limb === 'BODY' ? TORSO_Z : isHand(pull.limb) ? HAND_Z : FOOT_Z);
  const g = pull.ghost;
  const hot = pull.power > 0.96;

  ctx.save();
  ctx.lineCap = 'round';
  if (!body) {
    ctx.strokeStyle = hot ? AIM_HOT : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x - 6, a.y);
    ctx.lineTo(g.x, g.y);
    ctx.moveTo(a.x + 6, a.y);
    ctx.lineTo(g.x, g.y);
    ctx.stroke();
  } else {
    // Four bands, or however many limbs are on something: each one from the
    // wall to the body, thinning as it stretches.
    ctx.strokeStyle = hot ? AIM_HOT : accent;
    ctx.lineWidth = 4 - 2 * pull.power;
    ctx.beginPath();
    for (const band of pull.bands) {
      const w = scene.project(band.at, isHand(band.limb) ? HAND_Z : FOOT_Z);
      const j = scene.project(band.anchor, isHand(band.limb) ? ARM_Z : HIP_Z);
      ctx.moveTo(w.x - 4, w.y);
      ctx.lineTo(j.x, j.y);
      ctx.moveTo(w.x + 4, w.y);
      ctx.lineTo(j.x, j.y);
    }
    ctx.stroke();
  }
  // The stretch: where it is, to where it has been pulled.
  ctx.strokeStyle = hot || body ? AIM_HOT : accent;
  ctx.lineWidth = body ? 6 : 4;
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(g.x, g.y);
  ctx.stroke();
  // Launch direction: a short arrow out of the thing, opposite the pull.
  const dx = f.x - g.x;
  const dy = f.y - g.y;
  const l = Math.max(Math.hypot(dx, dy), 1);
  const ux = dx / l;
  const uy = dy / l;
  const len = body ? 40 : 28;
  const tipX = f.x + ux * len;
  const tipY = f.y + uy * len;
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

/** The limb (or the body), pulled back to the finger, growing with the pull. */
function drawGhost({ ctx, pull, accent }: SlingOverlayInput): void {
  if (!pull) return;
  const g = pull.ghost;
  const body = pull.limb === 'BODY';
  const r = (body ? 25 : LIMB_PIP_RADIUS + 2) + pull.power * 6;
  ctx.save();
  ctx.beginPath();
  ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
  ctx.fillStyle = pull.power > 0.96 || body ? AIM_HOT : accent;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#11141a';
  ctx.font = `700 ${body ? 12 : 15}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pull.limb === 'BODY' ? 'DYNO' : LIMB_SHORT[pull.limb], g.x, g.y + 0.5);
  ctx.restore();
}

function drawPips(input: SlingOverlayInput): void {
  const { ctx, scene, limbs, phases, selected, launchable, pull } = input;
  for (const limb of ['LF', 'RF', 'LH', 'RH'] as LimbId[]) {
    if (pull && pull.limb === limb && pull.power > 0) continue;
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

/** The belly: grab it to dyno. Named while the introduction lasts, and when picked. */
function drawBodyPip(input: SlingOverlayInput): void {
  const { ctx, scene, selected, pull, canDyno, dynoCharge, now } = input;
  if (pull && pull.limb === 'BODY' && pull.power > 0) return;
  const p = scene.project(input.core, TORSO_Z);
  if (!p.visible) return;
  const isSel = selected === 'BODY';
  const live = canDyno;
  const pulse = 0.5 + 0.5 * Math.sin(now / 140);

  ctx.save();
  if (live) {
    // Live: it glows and it breathes, so nobody can miss that it is on.
    const glow = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 48 + pulse * 10);
    glow.addColorStop(0, 'rgba(255,143,60,0.55)');
    glow.addColorStop(1, 'rgba(255,143,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 58 + pulse * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = live ? 1 : 0.42;
  const r = isSel ? 27 : live ? 24 + pulse * 3 : 21;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = isSel ? AIM_HOT : live ? '#ff8f3c' : 'rgba(18,20,26,0.62)';
  ctx.fill();
  ctx.lineWidth = isSel ? 3 : 2;
  ctx.strokeStyle = isSel || live ? '#fff' : 'rgba(255,255,255,0.45)';
  ctx.stroke();
  if (!live && dynoCharge > 0.001) {
    // Charging: the meter, wrapped round the belly.
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ff8f3c';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, dynoCharge));
    ctx.stroke();
    ctx.globalAlpha = 0.42;
  }
  const nameAlpha = isSel || live ? 1 : Math.max(input.intro, 0.55);
  ctx.globalAlpha *= nameAlpha;
  ctx.fillStyle = isSel || live ? '#11141a' : '#fff';
  ctx.font = `${live ? 900 : 700} ${live ? 12 : 11}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(live ? 'DYNO!' : 'DYNO', p.x, p.y + 0.5);
  ctx.restore();
}
