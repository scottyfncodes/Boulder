import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LimbId, Route, Vec2 } from '../game/types';
import { LIMBS, LIMB_LABEL, isHand } from '../game/types';
import { anchorFor, maxReachOf } from '../game/body';
import { type Aim, projectLanding } from '../game/move';
import { contactRadius } from '../game/holds';
import {
  type Attempt, type AttemptMode, type StepOutcome, beginAttempt, pullOn, retry, step,
} from '../game/attempt';
import { WallScene, DEFAULT_CAMERA, FRAME_MAX, FRAME_MIN, ORBIT_LIMIT } from '../render/scene';
import { MoveAnimation, type Frame, limbsFor } from '../render/animator';
import { drawOverlay, type AimView, LIMB_TOUCH_RADIUS } from '../render/overlay';
import { GRADE_COLOR } from '../render/palette';
import { setterOf } from '../content/setters';
import { HoldInspector } from './HoldInspector';
import './climb.css';

/**
 * The climbing screen.
 *
 * Three layers stacked: the 3D wall, a 2D overlay for aiming, and React for
 * everything made of words. The first two are driven from one animation frame
 * loop and never re-render React, which is what keeps a drag smooth on a phone.
 */

/** Drag length, in pixels, that corresponds to full power. */
function maxDragPx(w: number, h: number): number {
  return Math.max(130, Math.min(Math.min(w, h) * 0.44, 260));
}

/** Below this the throw is treated as a cancelled drag rather than a move. */
const MIN_POWER = 0.06;

type Drag = {
  kind: 'aim' | 'look';
  startX: number;
  startY: number;
  x: number;
  y: number;
  camFocus: number;
  camOrbit: number;
};

export type ClimbScreenProps = {
  route: Route;
  mode: AttemptMode;
  onExit: () => void;
  onOutcome: (attempt: Attempt, outcome: 'sent' | 'fallen') => void;
  /** Shown in the corner so the daily can say how many goes are left. */
  attemptsNote?: string;
};

export function ClimbScreen({ route, mode, onExit, onOutcome, attemptsNote }: ClimbScreenProps) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WallScene | null>(null);
  const rafRef = useRef(0);

  const [attempt, setAttempt] = useState<Attempt>(() => beginAttempt(route, mode));
  const [selected, setSelected] = useState<LimbId | null>(null);
  const [flash, setFlash] = useState<{ grade: string; reason: string } | null>(null);
  // The flash fades after a second and a half, but the fall animation runs
  // longer than that — so the reason the climber came off is kept separately
  // rather than being gone by the time there is a screen to show it on.
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectHold, setInspectHold] = useState<number | null>(null);
  const [, force] = useState(0);

  // Refs the animation loop reads. React state drives the words on screen;
  // these drive the pixels.
  const attemptRef = useRef(attempt);
  const selectedRef = useRef(selected);
  const dragRef = useRef<Drag | null>(null);
  const animRef = useRef<{ anim: MoveAnimation; start: number; outcome: StepOutcome } | null>(null);
  const camRef = useRef({ ...DEFAULT_CAMERA });
  const followRef = useRef(true);

  attemptRef.current = attempt;
  selectedRef.current = selected;

  const accent = GRADE_COLOR[route.grade];
  const setter = setterOf(route.setter);
  const holdsById = useMemo(
    () => new Map(route.holds.map((h) => [h.id, h])), [route],
  );

  // --- scene lifecycle ---------------------------------------------------

  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    const scene = new WallScene(gl);
    sceneRef.current = scene;
    scene.setRoute(route);
    scene.resize();

    const onResize = () => {
      scene.resize();
      const ui = uiRef.current;
      if (ui) {
        const rect = ui.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        ui.width = Math.floor(rect.width * dpr);
        ui.height = Math.floor(rect.height * dpr);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      cancelAnimationFrame(rafRef.current);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [route]);

  // --- the frame loop ----------------------------------------------------

  useEffect(() => {
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const scene = sceneRef.current;
      const ui = uiRef.current;
      if (!scene || !ui) return;

      const att = attemptRef.current;
      let frame: Frame;

      const playing = animRef.current;
      if (playing) {
        frame = playing.anim.sample(now - playing.start);
        if (frame.done) {
          const done = playing.outcome;
          animRef.current = null;
          setBusy(false);
          setAttempt(done.attempt);
          if (done.ended) onOutcome(done.attempt, done.ended);
        }
      } else {
        frame = {
          pose: att.state.pose,
          limbs: limbsFor(att.state.contacts, att.state.pose, now),
          mood: att.phase === 'sent' ? 'smug' : att.state.pose.stability < 0.45 ? 'strain' : 'calm',
          done: true,
        };
      }

      // Camera follows the climber's chest, smoothly, and only while climbing.
      const cam = camRef.current;
      if (followRef.current) {
        const want = clamp(frame.pose.com.y + 0.62, 1.7, 3.6);
        cam.focusY += (want - cam.focusY) * 0.07;
      }
      scene.setCamera(cam);
      scene.setClimber(frame.pose, frame.limbs, frame.mood);
      scene.render();

      // --- overlay ---
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = ui.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const rect = ui.getBoundingClientRect();
        const sel = selectedRef.current;
        const drag = dragRef.current;

        let aimView: AimView | null = null;
        if (sel && att.phase === 'climbing' && !playing) {
          const aim = aimFromDrag(sel, drag, rect.width, rect.height);
          const { landing } = projectLanding(att.state, aim);
          aimView = {
            limb: sel,
            anchor: anchorFor(sel, att.state.pose.hip, att.state.pose.shoulder),
            landing,
            maxReach: maxReachOf(sel),
            power: aim.power,
            targetHold: holdAt(landing, route, att) ?? null,
            dragging: drag?.kind === 'aim',
          };
        }

        drawOverlay({
          scene, ctx,
          width: rect.width, height: rect.height,
          limbPositions: frame.limbs,
          contactLimbs: new Set(att.state.contacts.map((c) => c.limb)),
          selected: sel,
          locked: lockedLimbs(att),
          aim: aimView,
          accent,
          showLimbs: att.phase === 'climbing' && !playing,
        });
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [route, accent, onOutcome]);

  const holdAt = useCallback((p: Vec2, r: Route, att: Attempt) => {
    const taken = new Set(att.state.contacts.map((c) => c.holdId));
    let best: (typeof r.holds)[number] | undefined;
    let bestD = Infinity;
    for (const h of r.holds) {
      const d = Math.hypot(p.x - h.pos.x, p.y - h.pos.y);
      const zone = contactRadius(h.size, h.type) * 1.25;
      if (d <= zone && d < bestD && (!taken.has(h.id) || contactRadius(h.size, h.type) >= 0.09)) {
        best = h; bestD = d;
      }
    }
    return best;
  }, []);

  // --- input -------------------------------------------------------------

  const limbAtPoint = useCallback((x: number, y: number): LimbId | null => {
    const scene = sceneRef.current;
    const att = attemptRef.current;
    if (!scene) return null;
    const limbs = limbsFor(att.state.contacts, att.state.pose, 0);
    let best: LimbId | null = null;
    let bestD = LIMB_TOUCH_RADIUS;
    for (const limb of LIMBS) {
      const p = scene.project(limbs[limb], isHand(limb) ? 0.16 : 0.13);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { best = limb; bestD = d; }
    }
    return best;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const att = attemptRef.current;
    const cam = camRef.current;

    if (att.phase === 'inspect') {
      // Inspection: tap a hold to read it, drag to look around.
      const hold = holdAtScreen(sceneRef.current, x, y, route);
      if (hold !== null) { setInspectHold(hold); return; }
      dragRef.current = {
        kind: 'look', startX: x, startY: y, x, y,
        camFocus: cam.focusY, camOrbit: cam.orbit,
      };
      return;
    }
    if (att.phase !== 'climbing') return;

    const hit = limbAtPoint(x, y);
    if (hit && !lockedLimbs(att).has(hit)) {
      // Press straight onto a limb and drag in one gesture, or tap to select
      // and drag from anywhere afterwards. Both work; thumbs differ.
      setSelected(hit);
      selectedRef.current = hit;
      dragRef.current = {
        kind: 'aim', startX: x, startY: y, x, y,
        camFocus: cam.focusY, camOrbit: cam.orbit,
      };
      return;
    }
    if (selectedRef.current) {
      dragRef.current = {
        kind: 'aim', startX: x, startY: y, x, y,
        camFocus: cam.focusY, camOrbit: cam.orbit,
      };
      return;
    }
    // Nothing selected: dragging looks around instead.
    followRef.current = false;
    dragRef.current = {
      kind: 'look', startX: x, startY: y, x, y,
      camFocus: cam.focusY, camOrbit: cam.orbit,
    };
  }, [busy, limbAtPoint, route]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.x = e.clientX - rect.left;
    drag.y = e.clientY - rect.top;

    if (drag.kind === 'look') {
      const scene = sceneRef.current;
      if (!scene) return;
      const mpp = scene.metresPerPixel();
      camRef.current.focusY = clamp(drag.camFocus + (drag.y - drag.startY) * mpp, 0.9, 4.0);
      camRef.current.orbit = clamp(
        drag.camOrbit - (drag.x - drag.startX) * 0.0022, -ORBIT_LIMIT, ORBIT_LIMIT,
      );
    }
  }, []);

  const commit = useCallback((aim: Aim) => {
    const att = attemptRef.current;
    const scene = sceneRef.current;
    if (!scene || att.phase !== 'climbing') return;

    const fromPose = att.state.pose;
    const fromLimbs = limbsFor(att.state.contacts, fromPose, performance.now());
    const outcome = step(att, route, aim);

    animRef.current = {
      anim: new MoveAnimation(fromPose, fromLimbs, aim.limb, outcome.result),
      start: performance.now(),
      outcome,
    };
    setBusy(true);
    setSelected(null);
    selectedRef.current = null;
    followRef.current = true;
    setFlash({ grade: outcome.result.grade, reason: outcome.result.reason });
    setLastReason(outcome.result.reason);
    window.setTimeout(() => setFlash(null), 1500);
  }, [route]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

    if (drag.kind !== 'aim') return;
    const scene = sceneRef.current;
    const att = attemptRef.current;
    const sel = selectedRef.current;
    if (!scene || !sel || att.phase !== 'climbing') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const aim = aimFromDrag(sel, drag, rect.width, rect.height);
    const moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
    // A tap with no travel selects the limb rather than throwing it nowhere.
    if (moved < 8 || aim.power < MIN_POWER) return;
    commit(aim);
  }, [commit]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    camRef.current.frame = clamp(
      camRef.current.frame + e.deltaY * 0.0035, FRAME_MIN, FRAME_MAX,
    );
  }, []);

  // Desktop shortcuts: the four limbs, and space to pull on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const att = attemptRef.current;
      if (att.phase === 'inspect' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setAttempt((a) => pullOn(a));
        return;
      }
      if (att.phase !== 'climbing' || busy) return;
      const map: Record<string, LimbId> = {
        q: 'LH', w: 'RH', a: 'LF', s: 'RF',
        Q: 'LH', W: 'RH', A: 'LF', S: 'RF',
      };
      const limb = map[e.key];
      if (limb && !lockedLimbs(att).has(limb)) {
        setSelected((cur) => (cur === limb ? null : limb));
      }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  // --- derived UI --------------------------------------------------------

  const locked = lockedLimbs(attempt);
  const inspecting = attempt.phase === 'inspect';
  const holdToInspect = inspectHold !== null ? holdsById.get(inspectHold) ?? null : null;

  const startClimb = () => {
    setAttempt((a) => pullOn(a));
    camRef.current.frame = 3.9;
    followRef.current = true;
    force((n) => n + 1);
  };

  const restart = () => {
    setAttempt(retry(attempt, route));
    setSelected(null);
    setLastReason(null);
    camRef.current = { ...DEFAULT_CAMERA };
    followRef.current = true;
  };

  return (
    <div className="climb" style={{ ['--accent' as string]: accent }}>
      <canvas ref={glRef} className="climb__gl" />
      <canvas
        ref={uiRef}
        className="climb__ui"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />

      <header className="climb__top">
        <button className="climb__back" onClick={onExit} aria-label="Back to routes">←</button>
        <div className="climb__id">
          <div className="climb__name">
            <span className="climb__grade" style={{ background: accent }}>{route.grade}</span>
            {route.name}
          </div>
          <div className="climb__setter">{setter.name} — “{setter.line}”</div>
        </div>
        <div className={`climb__mode climb__mode--${attempt.mode}`}>
          {attempt.mode === 'onsight' ? 'ONSIGHT' : 'PROJECT'}
        </div>
      </header>

      <div className="climb__stats">
        <span><b>{attempt.moves.length}</b> moves</span>
        <span className="climb__par">par {route.par}</span>
        {attemptsNote && <span className="climb__note">{attemptsNote}</span>}
      </div>

      {flash && (
        <div className={`flash flash--${flash.grade.toLowerCase()}`} key={attempt.moves.length}>
          <div className="flash__grade">{flash.grade}</div>
          <div className="flash__reason">{flash.reason}</div>
        </div>
      )}

      {inspecting && (
        <div className="inspect">
          <div className="inspect__hint">
            <strong>Read the route.</strong> Drag to look around, pinch or scroll to zoom,
            tap a hold to see what it is. Nobody is going to tell you the sequence.
          </div>
          {holdToInspect && (
            <HoldInspector hold={holdToInspect} onClose={() => setInspectHold(null)} />
          )}
          <button className="btn btn--primary inspect__go" onClick={startClimb}>
            {mode === 'onsight' ? 'Start onsight' : 'Pull on'}
          </button>
        </div>
      )}

      {attempt.phase === 'climbing' && (
        <div className="limbbar">
          {LIMBS.map((limb) => {
            const isLocked = locked.has(limb);
            return (
              <button
                key={limb}
                className={`limbbar__btn${selected === limb ? ' is-on' : ''}`}
                disabled={isLocked || busy}
                onClick={() => setSelected((cur) => (cur === limb ? null : limb))}
              >
                {LIMB_LABEL[limb]}
              </button>
            );
          })}
        </div>
      )}

      {attempt.phase === 'climbing' && !busy && (
        <div className="climb__hint">
          {selected
            ? `Drag away from the target to aim ${LIMB_LABEL[selected].toLowerCase()}, then let go.`
            : 'Tap a limb to move it.'}
        </div>
      )}

      {attempt.phase === 'fallen' && !busy && (
        <div className="falloff">
          <div className="falloff__word">OFF</div>
          <div className="falloff__reason">{lastReason ?? 'You are on the mat.'}</div>
          <div className="falloff__row">
            <button className="btn" onClick={onExit}>Leave it</button>
            <button className="btn btn--primary" onClick={restart}>
              {attempt.mode === 'onsight' ? 'Project it' : 'Again'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- helpers -------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Limbs that cannot leave the wall without dropping below two contacts. */
export function lockedLimbs(attempt: Attempt): Set<LimbId> {
  const locked = new Set<LimbId>();
  for (const limb of LIMBS) {
    const on = attempt.state.contacts.some((c) => c.limb === limb);
    if (!on) continue;
    if (attempt.state.contacts.length - 1 < 2) locked.add(limb);
  }
  // A limb that is already off the wall can always be placed.
  for (const limb of LIMBS) {
    if (!attempt.state.contacts.some((c) => c.limb === limb)) locked.delete(limb);
  }
  return locked;
}

/**
 * Turns a drag into an aim. Pulling back and away is the whole input: the limb
 * fires opposite the drag, and how far you pulled is how hard it goes.
 */
function aimFromDrag(limb: LimbId, drag: Drag | null, w: number, h: number): Aim {
  if (!drag || drag.kind !== 'aim') {
    // No drag yet: show a neutral straight-up aim at a readable power.
    return { limb, dir: { x: 0, y: 1 }, power: 0.5 };
  }
  const dx = drag.x - drag.startX;
  const dy = drag.y - drag.startY;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { limb, dir: { x: 0, y: 1 }, power: 0 };
  // Screen Y grows downward; the wall's does not.
  const dir = { x: -dx / len, y: dy / len };
  const power = clamp(len / maxDragPx(w, h), 0, 1);
  return { limb, dir, power };
}

/** Finds a hold under a screen point, for tap-to-inspect during reading. */
function holdAtScreen(scene: WallScene | null, x: number, y: number, route: Route): number | null {
  if (!scene) return null;
  let best: number | null = null;
  let bestD = 34;
  for (const h of route.holds) {
    const p = scene.project(h.pos, 0.14);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { best = h.id; bestD = d; }
  }
  return best;
}
