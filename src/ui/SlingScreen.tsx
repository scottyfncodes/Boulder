import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LimbId, Route, Vec2 } from '../game/types';
import { LIMBS, LIMB_LABEL, isHand } from '../game/types';
import { anchorFor } from '../game/body';
import {
  type Attempt, type AttemptMode, type BetaMove, beginAttempt, overhangOf,
} from '../game/attempt';
import {
  type SlingEvent, type SlingState, SLING, aimFromPull, bodySpeed, canLaunch, heldCount,
  initialSling, isSlingSent, launch, limbPositions, poseOf, predictLaunch, reachableHolds,
  stepSling,
} from '../game/sling';
import { flowStreak } from '../game/scoring';
import { WallScene, DEFAULT_CAMERA, FRAME_MAX, FRAME_MIN, ORBIT_LIMIT } from '../render/scene';
import type { Mood } from '../render/climber';
import { LIMB_TOUCH_RADIUS, SHOUT_MS, introAlpha, shoutText } from '../render/overlay';
import { drawSlingOverlay, type PullView } from '../render/slingOverlay';
import { GRADE_COLOR } from '../render/palette';
import { HAND_Z, FOOT_Z, HOLD_Z } from '../render/depths';
import { Fx } from '../render/fx';
import {
  buzz, isMuted, setMuted, sfxChalk, sfxFall, sfxGrab, sfxLock, sfxSend, sfxSlip, sfxThrow,
  sfxThud, unlockAudio,
} from '../render/sfx';
import { setterOf } from '../content/setters';
import { isLabRoute } from '../content/lab';
import { HoldInspector } from './HoldInspector';
import './climb.css';
import './sling.css';

/**
 * The slingshot climbing screen.
 *
 * The same three layers as the old one — 3D wall, 2D aiming canvas, React for
 * words — but underneath there is no turn. The body is a live physics thing
 * that runs every frame, and every input is the same gesture: press a limb,
 * pull it back, let go. No bar drains while you think about it.
 */

/** Drag length, in pixels, that corresponds to a full pull. */
function maxDragPx(w: number, h: number): number {
  return Math.max(130, Math.min(Math.min(w, h) * 0.44, 260));
}

/** How long a clean catch holds the world still. */
const HIT_STOP_MS = 70;
/** How long the top-out gets before the scorecard. */
const CELEBRATE_MS = 1900;
/** How long the climber lies on the mat before the screen admits it. */
const MAT_MS = 900;
/** Longest frame the sim will try to catch up on, ms. Tab switches happen. */
const MAX_FRAME_MS = 50;

type Drag = {
  kind: 'aim' | 'look';
  startX: number;
  startY: number;
  x: number;
  y: number;
  camFocus: number;
  camOrbit: number;
};

export type SlingScreenProps = {
  route: Route;
  mode: AttemptMode;
  onExit: () => void;
  onOutcome: (attempt: Attempt, outcome: 'sent' | 'fallen') => void;
  attemptsNote?: string;
};

type Phase = 'inspect' | 'climbing' | 'fallen' | 'sent';

export function SlingScreen({ route, mode, onExit, onOutcome, attemptsNote }: SlingScreenProps) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WallScene | null>(null);
  const rafRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('inspect');
  const [selected, setSelected] = useState<LimbId | null>(null);
  const [flash, setFlash] = useState<{ grade: string; reason: string } | null>(null);
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [inspectHold, setInspectHold] = useState<number | null>(null);
  const [launches, setLaunches] = useState(0);
  const [streak, setStreak] = useState(0);
  const [sentBanner, setSentBanner] = useState(false);
  // True once the fall has been reported and the mat is offering another go.
  const [landed, setLanded] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

  // The sim and everything the frame loop reads live in refs: sixty renders a
  // second of React would make the drag stutter on a phone.
  const simRef = useRef<SlingState>(initialSling(route.holds, route.start, overhangOf(route)));
  const phaseRef = useRef<Phase>('inspect');
  const selectedRef = useRef<LimbId | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const camRef = useRef({ ...DEFAULT_CAMERA });
  const followRef = useRef(true);
  const fxRef = useRef(new Fx());
  const stageRef = useRef<HTMLDivElement>(null);
  const shoutRef = useRef<{ at: Vec2; start: number } | null>(null);
  const movesRef = useRef<BetaMove[]>([]);
  const pendingRef = useRef<Partial<Record<LimbId, number>>>({});
  const trailsRef = useRef<Partial<Record<LimbId, Vec2[]>>>({});
  const modeRef = useRef<AttemptMode>(mode);
  const fallsRef = useRef(0);
  const startedAtRef = useRef(Date.now());
  const introRef = useRef(-Infinity);
  const lastRef = useRef(0);
  const accRef = useRef(0);
  const freezeRef = useRef(0);
  const lockRef = useRef<number | null>(null);
  const endedRef = useRef<{ at: number; outcome: 'sent' | 'fallen' } | null>(null);
  const flashTimer = useRef(0);
  const reasonRef = useRef<string | null>(null);

  phaseRef.current = phase;
  selectedRef.current = selected;

  const accent = GRADE_COLOR[route.grade];
  const setter = setterOf(route.setter);
  const holdsById = useMemo(() => new Map(route.holds.map((h) => [h.id, h])), [route]);
  const lab = isLabRoute(route.id);

  const say = useCallback((grade: string, reason: string, ms = 1500) => {
    setFlash({ grade, reason });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
  }, []);

  // --- scene lifecycle ---------------------------------------------------

  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    const scene = new WallScene(gl);
    sceneRef.current = scene;
    scene.setRoute(route);
    scene.setOverhang(overhangOf(route));
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

  // --- the attempt record ------------------------------------------------

  const buildAttempt = useCallback((outcome: 'sent' | 'fallen'): Attempt => {
    const base = beginAttempt(route, modeRef.current, startedAtRef.current);
    return {
      ...base,
      phase: outcome,
      moves: [...movesRef.current],
      falls: fallsRef.current,
      elapsedMs: Date.now() - startedAtRef.current,
      highWater: movesRef.current.length,
    };
  }, [route]);

  // --- events out of the sim ---------------------------------------------

  const handleEvents = useCallback((events: SlingEvent[], now: number) => {
    const fx = fxRef.current;
    const sim = simRef.current;
    for (const e of events) {
      switch (e.kind) {
        case 'launch': {
          sfxThrow(e.power);
          buzz(6);
          movesRef.current.push({
            limb: e.limb, holdId: null, grade: 'MISS',
            aim: { limb: e.limb, dir: { x: 0, y: 1 }, power: e.power },
          });
          pendingRef.current[e.limb] = movesRef.current.length - 1;
          trailsRef.current[e.limb] = [];
          setLaunches(movesRef.current.length);
          break;
        }
        case 'catch': {
          const idx = pendingRef.current[e.limb];
          if (idx !== undefined) movesRef.current[idx] = { ...movesRef.current[idx], holdId: e.holdId, grade: e.grade };
          delete pendingRef.current[e.limb];
          const streakNow = flowStreak(movesRef.current);
          setStreak(streakNow);
          sfxGrab(e.grade, streakNow);
          fx.chalk(e.at, e.grade === 'PERFECT' ? 1.3 : e.grade === 'GOOD' ? 0.9 : 0.6);
          if (e.grade === 'PERFECT') {
            fx.perfect(e.at, '#6ef2b4');
            fx.kick(0.2);
            buzz(12);
            freezeRef.current = now + HIT_STOP_MS;
          } else {
            fx.kick(e.grade === 'GOOD' ? 0.1 : 0.15);
            buzz(8);
          }
          const zone = e.zone;
          say(e.grade,
            e.grade === 'PERFECT' ? `Right on ${zone}.`
            : e.grade === 'GOOD' ? `Got ${zone}.`
            : `${zone.charAt(0).toUpperCase()}${zone.slice(1)}, barely.`);
          break;
        }
        case 'miss': {
          delete pendingRef.current[e.limb];
          setStreak(0);
          sfxSlip();
          fx.chalk(e.at, 0.4, 'rgba(255,255,255,0.6)');
          fx.kick(0.1);
          buzz(16);
          reasonRef.current = e.reason;
          say('MISS', e.reason);
          break;
        }
        case 'slip': {
          setStreak(0);
          sfxSlip();
          fx.kick(0.2);
          buzz([20, 20, 20]);
          reasonRef.current = e.reason;
          say('SLIP', e.reason);
          break;
        }
        case 'off': {
          sfxFall(900);
          shoutRef.current = { at: { ...poseOf(sim).head }, start: now };
          break;
        }
        case 'fell': {
          sfxThud(e.from);
          fx.dust(e.at);
          fx.kick(0.45 + Math.min(e.from, 3) * 0.14);
          buzz([40, 30, 70]);
          fallsRef.current += 1;
          setStreak(0);
          const reason = reasonRef.current ?? 'Ran out of wall to hold.';
          setLastReason(reason);
          setSelected(null);
          selectedRef.current = null;
          dragRef.current = null;
          setPhase('fallen');
          phaseRef.current = 'fallen';
          endedRef.current = { at: now, outcome: 'fallen' };
          break;
        }
      }
    }
  }, [say]);

  const celebrate = useCallback((now: number) => {
    const sim = simRef.current;
    const at = {
      x: (sim.limbs.LH.pos.x + sim.limbs.RH.pos.x) / 2,
      y: (sim.limbs.LH.pos.y + sim.limbs.RH.pos.y) / 2,
    };
    fxRef.current.confetti(at);
    fxRef.current.kick(0.5);
    sfxSend();
    buzz([20, 40, 20, 40, 60]);
    setSentBanner(true);
    setSelected(null);
    selectedRef.current = null;
    setPhase('sent');
    phaseRef.current = 'sent';
    endedRef.current = { at: now, outcome: 'sent' };
  }, []);

  // --- the frame loop ----------------------------------------------------

  useEffect(() => {
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const scene = sceneRef.current;
      const ui = uiRef.current;
      if (!scene || !ui) return;

      const dt = lastRef.current ? Math.min(now - lastRef.current, MAX_FRAME_MS) : 0;
      lastRef.current = now;
      const sim = simRef.current;
      const ph = phaseRef.current;

      if (ph === 'climbing' && introRef.current === -Infinity) introRef.current = now;

      // The sim runs on a fixed step, however the frames come. It keeps
      // running after a fall — that is the fall — and stops when it is over.
      if ((ph === 'climbing' || ph === 'fallen') && now >= freezeRef.current) {
        accRef.current += dt / 1000;
        const events: SlingEvent[] = [];
        let steps = 0;
        while (accRef.current >= SLING.dt && steps < 12) {
          stepSling(sim, route.holds, SLING.dt, 0, events);
          accRef.current -= SLING.dt;
          steps++;
          for (const limb of LIMBS) {
            const l = sim.limbs[limb];
            const trail = trailsRef.current[limb];
            if (l.phase === 'flying') {
              const t = trail ?? [];
              t.push({ ...l.pos });
              if (t.length > 16) t.shift();
              trailsRef.current[limb] = t;
            } else if (trail && trail.length) {
              trail.shift();
            }
          }
        }
        if (events.length) handleEvents(events, now);
        if (phaseRef.current === 'climbing' && isSlingSent(sim, route.finish)) celebrate(now);
      }
      fxRef.current.update(dt);

      const pose = poseOf(sim);
      const limbs = limbPositions(sim);
      const mood = moodOf(sim, phaseRef.current);

      // Camera: follows the chest, slowly, and never jumps for a throw.
      const cam = camRef.current;
      if (followRef.current) {
        const want = clamp(pose.com.y + 0.55, 1.7, 3.6);
        cam.focusY += (want - cam.focusY) * 0.045;
      }
      if (shoutRef.current) {
        if (now - shoutRef.current.start > SHOUT_MS) shoutRef.current = null;
        else shoutRef.current.at = { ...pose.head };
      }

      const ended = endedRef.current;
      if (ended && now - ended.at > (ended.outcome === 'sent' ? CELEBRATE_MS : MAT_MS)) {
        endedRef.current = null;
        if (ended.outcome === 'fallen') setLanded(true);
        onOutcome(buildAttempt(ended.outcome), ended.outcome);
      }

      const shake = fxRef.current.shake();
      if (stageRef.current) {
        stageRef.current.style.transform = shake.x || shake.y
          ? `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg)`
          : '';
      }

      scene.setCamera(cam);
      scene.setClimber(pose, limbs, mood);

      // --- overlay ---
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = ui.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const rect = ui.getBoundingClientRect();
        const sel = selectedRef.current;
        const drag = dragRef.current;
        const climbing = phaseRef.current === 'climbing';

        let pull: PullView | null = null;
        if (sel && climbing) {
          const limbPx = scene.project(limbs[sel], isHand(sel) ? HAND_Z : FOOT_Z);
          const max = maxDragPx(rect.width, rect.height);
          let dx = 0;
          let dy = 0;
          if (drag?.kind === 'aim') {
            dx = drag.x - drag.startX;
            dy = drag.y - drag.startY;
            const l = Math.hypot(dx, dy);
            if (l > max) { dx *= max / l; dy *= max / l; }
          }
          const aim = aimFromPull(sel, { x: dx, y: -dy }, max);
          const prediction = drag?.kind === 'aim' && aim.power >= SLING.minPower
            ? predictLaunch(sim, route.holds, aim, 1.0)
            : null;
          const lockId = prediction?.caught?.holdId ?? null;
          if (lockId !== lockRef.current) {
            if (lockId !== null) { sfxLock(); buzz(4); }
            lockRef.current = lockId;
          }
          pull = {
            limb: sel,
            from: limbs[sel],
            anchor: anchorFor(sel, pose.hip, pose.shoulder),
            ghost: { x: limbPx.x + dx, y: limbPx.y + dy },
            power: aim.power,
            prediction,
            reachable: reachableHolds(sim, route.holds, sel),
          };
        } else {
          lockRef.current = null;
        }

        const launchable = new Set<LimbId>();
        for (const limb of LIMBS) if (canLaunch(sim, limb)) launchable.add(limb);
        const phases = { LH: sim.limbs.LH.phase, RH: sim.limbs.RH.phase, LF: sim.limbs.LF.phase, RF: sim.limbs.RF.phase };

        drawSlingOverlay({
          scene, ctx,
          width: rect.width, height: rect.height,
          limbs, phases,
          selected: sel,
          launchable,
          pull,
          trails: trailsRef.current,
          shout: shoutRef.current
            ? { text: shoutText(now - shoutRef.current.start), at: shoutRef.current.at, age: now - shoutRef.current.start }
            : null,
          accent,
          showLimbs: climbing,
          intro: introAlpha(now - introRef.current),
          hip: pose.hip,
        });
        fxRef.current.draw(ctx, scene);
      }

      scene.render();
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [route, accent, onOutcome, handleEvents, celebrate, buildAttempt]);

  // --- input -------------------------------------------------------------

  const limbAtPoint = useCallback((x: number, y: number): LimbId | null => {
    const scene = sceneRef.current;
    if (!scene) return null;
    const limbs = limbPositions(simRef.current);
    let best: LimbId | null = null;
    let bestD = LIMB_TOUCH_RADIUS;
    for (const limb of LIMBS) {
      const p = scene.project(limbs[limb], isHand(limb) ? HAND_Z : FOOT_Z);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { best = limb; bestD = d; }
    }
    return best;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    unlockAudio();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cam = camRef.current;

    if (phaseRef.current === 'inspect') {
      const hold = holdAtScreen(sceneRef.current, x, y, route);
      if (hold !== null) { setInspectHold(hold); return; }
      dragRef.current = { kind: 'look', startX: x, startY: y, x, y, camFocus: cam.focusY, camOrbit: cam.orbit };
      return;
    }
    if (phaseRef.current !== 'climbing') return;

    const hit = limbAtPoint(x, y);
    if (hit && canLaunch(simRef.current, hit)) {
      // Press straight onto a limb and pull in one gesture, or tap to pick it
      // up and pull from anywhere. Thumbs differ.
      setSelected(hit);
      selectedRef.current = hit;
      followRef.current = true;
      dragRef.current = { kind: 'aim', startX: x, startY: y, x, y, camFocus: cam.focusY, camOrbit: cam.orbit };
      return;
    }
    if (selectedRef.current) {
      dragRef.current = { kind: 'aim', startX: x, startY: y, x, y, camFocus: cam.focusY, camOrbit: cam.orbit };
      return;
    }
    followRef.current = false;
    dragRef.current = { kind: 'look', startX: x, startY: y, x, y, camFocus: cam.focusY, camOrbit: cam.orbit };
  }, [limbAtPoint, route]);

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
      camRef.current.focusY = clamp(drag.camFocus + (drag.y - drag.startY) * mpp, 0.9, 4.4);
      camRef.current.orbit = clamp(drag.camOrbit - (drag.x - drag.startX) * 0.0022, -ORBIT_LIMIT, ORBIT_LIMIT);
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const sel = selectedRef.current;
    if (drag.kind !== 'aim' || !sel || phaseRef.current !== 'climbing') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const dx = drag.x - drag.startX;
    const dy = drag.y - drag.startY;
    const moved = Math.hypot(dx, dy);
    // A tap with no travel just keeps the limb picked up.
    if (moved < 8) return;
    const aim = aimFromPull(sel, { x: dx, y: -dy }, maxDragPx(rect.width, rect.height));
    const events: SlingEvent[] = [];
    if (launch(simRef.current, aim, events)) {
      handleEvents(events, performance.now());
      setSelected(null);
      selectedRef.current = null;
      followRef.current = true;
    }
  }, [handleEvents]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    camRef.current.frame = clamp(camRef.current.frame + e.deltaY * 0.0035, FRAME_MIN, FRAME_MAX);
  }, []);

  // Desktop: the four limbs on the keys the old game used, space to pull on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (phaseRef.current === 'inspect' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        startClimbRef.current();
        return;
      }
      if (phaseRef.current !== 'climbing') return;
      const map: Record<string, LimbId> = { q: 'LH', w: 'RH', a: 'LF', s: 'RF', Q: 'LH', W: 'RH', A: 'LF', S: 'RF' };
      const limb = map[e.key];
      if (limb && canLaunch(simRef.current, limb)) setSelected((cur) => (cur === limb ? null : limb));
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- derived UI --------------------------------------------------------

  const holdToInspect = inspectHold !== null ? holdsById.get(inspectHold) ?? null : null;
  const finishY = Math.min(...route.holds.filter((h) => route.finish.includes(h.id)).map((h) => h.pos.y));
  const nearTop = simRef.current.shoulder.y > finishY - 1.3;

  const startClimb = () => {
    unlockAudio();
    setPhase('climbing');
    phaseRef.current = 'climbing';
    startedAtRef.current = Date.now();
    introRef.current = -Infinity;
    camRef.current.frame = 3.9;
    followRef.current = true;
    sfxChalk();
    for (const limb of LIMBS) {
      const l = simRef.current.limbs[limb];
      if (isHand(limb) && l.phase === 'held') fxRef.current.chalk(l.pos, 0.8);
    }
  };
  const startClimbRef = useRef(startClimb);
  startClimbRef.current = startClimb;

  const restart = () => {
    simRef.current = initialSling(route.holds, route.start, overhangOf(route));
    movesRef.current = [];
    pendingRef.current = {};
    trailsRef.current = {};
    modeRef.current = 'project';
    accRef.current = 0;
    reasonRef.current = null;
    setLaunches(0);
    setStreak(0);
    setSelected(null);
    setLastReason(null);
    setLanded(false);
    setPhase('inspect');
    phaseRef.current = 'inspect';
    camRef.current = { ...DEFAULT_CAMERA };
    followRef.current = true;
  };

  const toggleMute = () => {
    unlockAudio();
    setMuted(!muted);
    setMutedState(!muted);
  };

  const catches = movesRef.current.filter((m) => m.holdId !== null).length;

  return (
    <div className="climb sling" style={{ ['--accent' as string]: accent }}>
      <div className="climb__stage" ref={stageRef}>
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
      </div>

      <header className="climb__top">
        <button className="climb__back" onClick={onExit} aria-label="Back to routes">←</button>
        <div className="climb__id">
          <div className="climb__name">
            <span className="climb__grade" style={{ background: accent }}>{lab ? 'LAB' : route.grade}</span>
            {route.name}
          </div>
          <div className="climb__setter">{setter.name} — “{setter.line}”</div>
        </div>
        <div className="climb__corner">
          <div className="climb__mode sling__tag">SLINGSHOT</div>
          <button className="climb__mute" onClick={toggleMute} aria-label={muted ? 'Sound on' : 'Sound off'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <div className="climb__stats">
        <span><b>{launches}</b> flings</span>
        <span><b>{catches}</b> caught</span>
        {!lab && <span className="climb__par">par {route.par}</span>}
        {attemptsNote && <span className="climb__note">{attemptsNote}</span>}
      </div>

      {streak >= 3 && phase === 'climbing' && (
        <div className="flow" key={`flow-${streak}`}>
          <span className="flow__word">FLOW</span>
          <span className="flow__n">×{streak}</span>
        </div>
      )}

      {sentBanner && (
        <div className="sent">
          {modeRef.current === 'onsight' && <div className="sent__kicker">onsight</div>}
          <div className="sent__word">SENT</div>
          <div className="sent__sub">{launches} flings{lab ? '' : ` · par ${route.par}`}</div>
        </div>
      )}

      {flash && (
        <div className={`flash flash--${flash.grade.toLowerCase()}`} key={`${launches}-${flash.grade}-${flash.reason}`}>
          <div className="flash__grade">{flash.grade}</div>
          <div className="flash__reason">{flash.reason}</div>
        </div>
      )}

      {phase === 'inspect' && (
        <div className="inspect">
          <div className="inspect__hint">
            <strong>{lab ? 'The lab.' : 'Read the route.'}</strong> Press a hand or a foot, pull it back,
            let go. It flies where you aimed it and the rest of him has to deal with that.
            Take all the time you like — nothing is draining.
          </div>
          {holdToInspect && (
            <HoldInspector hold={holdToInspect} onClose={() => setInspectHold(null)} />
          )}
          <button className="btn btn--primary inspect__go" onClick={startClimb}>
            {mode === 'onsight' && !lab ? 'Start onsight' : 'Pull on'}
          </button>
        </div>
      )}

      {phase === 'climbing' && nearTop && (
        <div className="climb__top-note">
          Match <b>both hands</b> on the white hold to finish.
        </div>
      )}

      {phase === 'climbing' && (
        <div className="climb__hint">
          {selected
            ? `Pull ${LIMB_LABEL[selected].toLowerCase()} back and let go.`
            : heldCount(simRef.current) === 0
              ? 'Airborne. Fling something at the wall.'
              : 'Press a limb, pull it back, let go.'}
        </div>
      )}

      {phase === 'fallen' && landed && (
        <div className="falloff">
          <div className="falloff__word">Bruuuuuuh</div>
          <div className="falloff__reason">{lastReason ?? 'You are on the mat.'}</div>
          <div className="falloff__row">
            <button className="btn" onClick={onExit}>Leave it</button>
            <button className="btn btn--primary" onClick={restart}>Try again</button>
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

/** The face, from what the body is doing. He is never miserable about it. */
function moodOf(sim: SlingState, phase: Phase): Mood {
  if (phase === 'sent') return 'delighted';
  if (sim.fallen) return 'dazed';
  const held = heldCount(sim);
  if (held === 0 && sim.left) return 'whooping';
  const speed = bodySpeed(sim);
  if (speed > 2.4) return 'astonished';
  if (speed > 1.3) return 'surprised';
  if (LIMBS.some((l) => sim.limbs[l].phase === 'flying')) return 'keen';
  if (held <= 1) return 'impressed';
  return 'calm';
}

function holdAtScreen(scene: WallScene | null, x: number, y: number, route: Route): number | null {
  if (!scene) return null;
  let best: number | null = null;
  let bestD = 34;
  for (const h of route.holds) {
    const p = scene.project(h.pos, HOLD_Z);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { best = h.id; bestD = d; }
  }
  return best;
}
