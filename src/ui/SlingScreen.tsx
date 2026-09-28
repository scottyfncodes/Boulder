import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LimbId, Route, Vec2 } from '../game/types';
import { LIMBS, LIMB_LABEL, isHand } from '../game/types';
import { anchorFor } from '../game/body';
import { type Attempt, type AttemptMode, type BetaMove, beginAttempt, overhangOf } from '../game/attempt';
import {
  type SlingEvent, type SlingState, SLING, aimFromPull, bodySpeed, canDyno, canLaunch, dyno,
  heldCount, initialSling, isSlingSent, launch, limbPositions, placeLimb, placeableHolds, poseOf,
  predictDyno, predictLaunch, reachableHolds, stepSling, windupPos, SLING_LIMITS,
} from '../game/sling';
import { flowStreak } from '../game/scoring';
import { WallScene, DEFAULT_CAMERA, FRAME_MAX, FRAME_MIN, ORBIT_LIMIT } from '../render/scene';
import type { Mood } from '../render/climber';
import { LIMB_TOUCH_RADIUS, SHOUT_MS, introAlpha, shoutText } from '../render/overlay';
import { drawSlingOverlay, type PullView, type Selection, type SnapView } from '../render/slingOverlay';
import { GRADE_COLOR } from '../render/palette';
import { HAND_Z, FOOT_Z, HIP_Z, HOLD_Z } from '../render/depths';
import { Fx } from '../render/fx';
import {
  buzz, isMuted, setMuted, sfxChalk, sfxFall, sfxGrab, sfxLock, sfxSend, sfxSlip, sfxSnap,
  sfxStretch, sfxThrow, sfxThud, unlockAudio,
} from '../render/sfx';
import { setterOf } from '../content/setters';
import { isLabRoute } from '../content/lab';
import { HoldInspector } from './HoldInspector';
import './climb.css';
import './sling.css';

/**
 * The climbing screen.
 *
 * Three layers stacked: the 3D wall, a 2D canvas for aiming, and React for
 * everything made of words. Underneath there is no turn: the body is a live
 * physics thing that runs every frame, and every input is a gesture. Press a
 * limb, pull it back, let go. Press the hips, pull, let go, and everything
 * leaves the wall at once. Tap a dangling limb, then tap a hold, and it goes
 * back on. No bar drains while you think about it.
 */

/** Drag length, in pixels, that corresponds to a full pull. */
function maxDragPx(w: number, h: number): number {
  return Math.max(130, Math.min(Math.min(w, h) * 0.44, 260));
}

/** How long a catch holds the world still: a scrape, a good one, a perfect one, a dyno. */
const HIT_STOP: Record<string, number> = { SCRAPE: 0, GOOD: 40, PERFECT: 70, DYNO: 90 };
/** How long the band takes to go slack after a release. */
const SNAP_MS = 110;
/** How long a caught limb takes to settle onto the hold. */
const SETTLE_MS = 120;
/** How many notches the pull ratchets through on its way to full. */
const NOTCHES = 8;
/** How long the top-out gets before the scorecard. */
const CELEBRATE_MS = 1900;
/** How long the climber lies on the mat before the screen admits it. */
const MAT_MS = 900;
/** Longest frame the sim will try to catch up on, ms. Tab switches happen. */
const MAX_FRAME_MS = 50;
/** A press that travels less than this is a tap. */
const TAP_PX = 8;

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
  const [selected, setSelected] = useState<Selection | null>(null);
  const [flash, setFlash] = useState<{ grade: string; reason: string } | null>(null);
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [inspectHold, setInspectHold] = useState<number | null>(null);
  const [launches, setLaunches] = useState(0);
  const [streak, setStreak] = useState(0);
  const [sentBanner, setSentBanner] = useState(false);
  const [landed, setLanded] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const [, bump] = useState(0);

  // The sim and everything the frame loop reads live in refs: sixty renders a
  // second of React would make the drag stutter on a phone.
  const simRef = useRef<SlingState>(initialSling(route.holds, route.start, overhangOf(route)));
  const phaseRef = useRef<Phase>('inspect');
  const selectedRef = useRef<Selection | null>(null);
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
  /** Where the pulled limb is wound back to, this frame. What it launches from. */
  const windRef = useRef<Vec2 | null>(null);
  const notchRef = useRef(0);
  const snapRef = useRef<{ anchor: Vec2; from: Vec2; limb: LimbId; start: number } | null>(null);
  const settleRef = useRef<Partial<Record<LimbId, { from: Vec2; start: number }>>>({});
  const lastLimbsRef = useRef<Record<LimbId, Vec2> | null>(null);

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

  const startShout = useCallback((now: number) => {
    if (!shoutRef.current) shoutRef.current = { at: { ...poseOf(simRef.current).head }, start: now };
  }, []);

  const handleEvents = useCallback((events: SlingEvent[], now: number) => {
    const fx = fxRef.current;
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
        case 'dyno': {
          sfxThrow(1);
          buzz([10, 20, 30]);
          fx.kick(0.25);
          fx.chalk(e.from, 0.8, 'rgba(255,255,255,0.7)');
          movesRef.current.push({
            dyno: true, limb: 'RH', holdId: null, grade: 'MISS',
            aim: { limb: 'RH', dir: { x: 0, y: 1 }, power: e.power },
          });
          // Either hand can complete it.
          pendingRef.current.LH = movesRef.current.length - 1;
          pendingRef.current.RH = movesRef.current.length - 1;
          trailsRef.current.LH = [];
          trailsRef.current.RH = [];
          setLaunches(movesRef.current.length);
          say('DYNO', 'Everything off. Go.', 900);
          break;
        }
        case 'place': {
          sfxGrab('GOOD', 0);
          buzz(8);
          fx.chalk(e.at, 0.7);
          movesRef.current.push({
            placed: true, limb: e.limb, holdId: e.holdId, grade: 'GOOD',
            aim: { limb: e.limb, dir: { x: 0, y: 1 }, power: 0 },
          });
          setLaunches(movesRef.current.length);
          setStreak(flowStreak(movesRef.current));
          say('PLACED', `${LIMB_LABEL[e.limb]} back on.`, 1100);
          break;
        }
        case 'catch': {
          const idx = pendingRef.current[e.limb];
          const move = idx !== undefined ? movesRef.current[idx] : undefined;
          if (move && move.holdId === null) {
            movesRef.current[idx!] = { ...move, holdId: e.holdId, grade: e.grade };
          }
          delete pendingRef.current[e.limb];
          if (move?.dyno) {
            // The second hand's catch belongs to the same move, so stop waiting on it.
            for (const l of ['LH', 'RH'] as LimbId[]) if (pendingRef.current[l] === idx) delete pendingRef.current[l];
          }
          const streakNow = flowStreak(movesRef.current);
          setStreak(streakNow);
          sfxGrab(e.grade, streakNow);
          fx.chalk(e.at, e.grade === 'PERFECT' ? 1.3 : e.grade === 'GOOD' ? 0.9 : 0.6);
          const last = lastLimbsRef.current?.[e.limb];
          if (last) settleRef.current[e.limb] = { from: { ...last }, start: now };
          if (e.grade === 'PERFECT' || e.dyno) {
            fx.perfect(e.at, e.dyno ? '#ff8f3c' : '#6ef2b4');
            fx.kick(e.dyno ? 0.35 : 0.2);
            buzz(e.dyno ? [14, 10, 24] : 12);
          } else {
            fx.kick(e.grade === 'GOOD' ? 0.1 : 0.15);
            buzz(8);
          }
          freezeRef.current = now + (e.dyno ? HIT_STOP.DYNO : HIT_STOP[e.grade]);
          const zone = e.zone;
          if (e.dyno) say('STUCK', `Caught ${zone}. Hold on.`);
          else say(e.grade,
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
          startShout(now);
          break;
        }
        case 'fell': {
          startShout(now - 400);
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
  }, [say, startShout]);

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
      lastLimbsRef.current = limbPositions(sim);

      // A caught limb eases onto the hold rather than appearing there.
      for (const limb of LIMBS) {
        const st = settleRef.current[limb];
        if (!st) continue;
        const t = (now - st.start) / SETTLE_MS;
        if (t >= 1) { delete settleRef.current[limb]; continue; }
        const k = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // overshoots a touch
        limbs[limb] = {
          x: st.from.x + (limbs[limb].x - st.from.x) * k,
          y: st.from.y + (limbs[limb].y - st.from.y) * k,
        };
      }

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
          const body = sel === 'BODY';
          const from = body ? pose.hip : limbs[sel];
          const fromPx = scene.project(from, body ? HIP_Z : isHand(sel) ? HAND_Z : FOOT_Z);
          const max = maxDragPx(rect.width, rect.height);
          let dx = 0;
          let dy = 0;
          if (drag?.kind === 'aim') {
            dx = drag.x - drag.startX;
            dy = drag.y - drag.startY;
            const l = Math.hypot(dx, dy);
            if (l > max) { dx *= max / l; dy *= max / l; }
            if (l < TAP_PX) { dx = 0; dy = 0; }
          }
          const aim = aimFromPull(body ? 'RH' : sel, { x: dx, y: -dy }, max);
          const pulling = drag?.kind === 'aim' && aim.power >= SLING.minPower;

          // The wind-up. The limb itself comes back with the finger, the elbow
          // bends, and that is where it fires from — so the release is the
          // band snapping through, not a pip vanishing.
          let wind: Vec2 | null = null;
          if (pulling && !body) {
            wind = windupPos(sim, sel, { x: dx, y: -dy }, aim.power);
            limbs[sel] = wind;
            aim.from = wind;
          } else if (pulling && body) {
            // The crouch: the body dips into the pull before it springs.
            const l = Math.max(Math.hypot(dx, dy), 1);
            const cx = (dx / l) * 0.11 * aim.power;
            const cy = (-dy / l) * 0.11 * aim.power;
            pose.hip = { x: pose.hip.x + cx, y: pose.hip.y + cy };
            pose.shoulder = { x: pose.shoulder.x + cx * 0.7, y: pose.shoulder.y + cy * 0.7 };
            pose.head = { x: pose.head.x + cx * 0.6, y: pose.head.y + cy * 0.6 };
          }
          windRef.current = wind;

          // The ratchet: a creak every notch the band is drawn back.
          const notch = pulling ? Math.floor(aim.power * NOTCHES) : 0;
          if (notch > notchRef.current) { sfxStretch(aim.power); buzz(3); }
          notchRef.current = notch;

          const prediction = pulling && !body ? predictLaunch(sim, route.holds, aim, 1.0) : null;
          const dynoPrediction = pulling && body ? predictDyno(sim, route.holds, aim, 1.5) : null;
          const lockId = prediction?.caught?.holdId ?? dynoPrediction?.caught[0]?.holdId ?? null;
          if (lockId !== lockRef.current) {
            if (lockId !== null) { sfxLock(); buzz(4); }
            lockRef.current = lockId;
          }
          const ghostPx = wind ? scene.project(wind, isHand(sel as LimbId) ? HAND_Z : FOOT_Z) : { x: fromPx.x + dx, y: fromPx.y + dy };
          pull = {
            limb: sel,
            from: wind ?? from,
            anchor: body ? pose.hip : anchorFor(sel, pose.hip, pose.shoulder),
            ghost: { x: ghostPx.x, y: ghostPx.y },
            power: pulling ? aim.power : 0,
            prediction,
            dynoPrediction,
            reachable: body ? [] : reachableHolds(sim, route.holds, sel),
            placeable: body ? [] : placeableHolds(sim, route.holds, sel),
            reach: body ? null : {
              anchor: anchorFor(sel, pose.hip, pose.shoulder),
              radius: isHand(sel) ? SLING_LIMITS.ARM_MAX : SLING_LIMITS.LEG_MAX,
            },
          };
        } else {
          lockRef.current = null;
          windRef.current = null;
          notchRef.current = 0;
        }

        const snapping = snapRef.current;
        let snap: SnapView | null = null;
        if (snapping) {
          const t = (now - snapping.start) / SNAP_MS;
          if (t >= 1) snapRef.current = null;
          else snap = { anchor: snapping.anchor, from: snapping.from, to: limbs[snapping.limb], t };
        }

        const launchable = new Set<LimbId>();
        for (const limb of LIMBS) if (canLaunch(sim, limb)) launchable.add(limb);
        const phases = { LH: sim.limbs.LH.phase, RH: sim.limbs.RH.phase, LF: sim.limbs.LF.phase, RF: sim.limbs.RF.phase };

        drawSlingOverlay({
          scene, ctx,
          width: rect.width, height: rect.height,
          limbs, phases,
          hip: pose.hip,
          selected: sel,
          launchable,
          canDyno: canDyno(sim),
          pull,
          snap,
          trails: trailsRef.current,
          shout: shoutRef.current
            ? { text: shoutText(now - shoutRef.current.start), at: shoutRef.current.at, age: now - shoutRef.current.start }
            : null,
          accent,
          showLimbs: climbing,
          intro: introAlpha(now - introRef.current),
        });
        fxRef.current.draw(ctx, scene);
      }

      // Drawn last so the wind-up and the settle are what the rig shows.
      scene.setClimber(pose, limbs, mood);
      scene.render();
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [route, accent, onOutcome, handleEvents, celebrate, buildAttempt]);

  // --- input -------------------------------------------------------------

  /** The limb, or the hips, under a screen point. Limbs win when they overlap. */
  const targetAtPoint = useCallback((x: number, y: number): Selection | null => {
    const scene = sceneRef.current;
    if (!scene) return null;
    const sim = simRef.current;
    const limbs = limbPositions(sim);
    let best: Selection | null = null;
    let bestD = LIMB_TOUCH_RADIUS;
    for (const limb of LIMBS) {
      const p = scene.project(limbs[limb], isHand(limb) ? HAND_Z : FOOT_Z);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { best = limb; bestD = d; }
    }
    if (best) return best;
    const hip = scene.project(sim.hip, HIP_Z);
    if (Math.hypot(hip.x - x, hip.y - y) < LIMB_TOUCH_RADIUS * 0.8) return 'BODY';
    return null;
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

    const hit = targetAtPoint(x, y);
    const sim = simRef.current;
    const usable = hit === 'BODY' ? canDyno(sim) : hit !== null && canLaunch(sim, hit);
    if (hit && usable) {
      // Press straight onto it and pull in one gesture, or tap to pick it up
      // and pull from anywhere. Thumbs differ.
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
  }, [targetAtPoint, route]);

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

    const sim = simRef.current;
    const dx = drag.x - drag.startX;
    const dy = drag.y - drag.startY;
    const moved = Math.hypot(dx, dy);

    if (moved < TAP_PX) {
      // A tap. With a dangling limb picked up, a tap on a hold in reach puts
      // it there. Otherwise the tap just keeps the thing picked up.
      if (sel !== 'BODY' && sim.limbs[sel].phase === 'free') {
        const hold = holdAtScreen(sceneRef.current, drag.x, drag.y, route);
        if (hold !== null) {
          const events: SlingEvent[] = [];
          if (placeLimb(sim, sel, hold, route.holds, events)) {
            handleEvents(events, performance.now());
            setSelected(null);
            selectedRef.current = null;
            bump((n) => n + 1);
          }
        }
      }
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const aim = aimFromPull(sel === 'BODY' ? 'RH' : sel, { x: dx, y: -dy }, maxDragPx(rect.width, rect.height));
    const events: SlingEvent[] = [];
    const now = performance.now();
    const wind = windRef.current;
    if (sel !== 'BODY' && wind) aim.from = wind;
    const went = sel === 'BODY'
      ? dyno(sim, { dir: aim.dir, power: aim.power }, events)
      : launch(sim, aim, events);
    if (went) {
      if (sel !== 'BODY' && wind) {
        const pose = poseOf(sim);
        snapRef.current = { anchor: anchorFor(sel, pose.hip, pose.shoulder), from: wind, limb: sel, start: now };
      }
      sfxSnap(aim.power);
      fxRef.current.kick(0.05 + 0.08 * aim.power);
      windRef.current = null;
      notchRef.current = 0;
      handleEvents(events, now);
      setSelected(null);
      selectedRef.current = null;
      followRef.current = true;
    }
  }, [handleEvents, route]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    camRef.current.frame = clamp(camRef.current.frame + e.deltaY * 0.0035, FRAME_MIN, FRAME_MAX);
  }, []);

  // Desktop: the four limbs on the keys the game has always used, E for the
  // body, space to pull on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      if (phaseRef.current === 'inspect' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        startClimbRef.current();
        return;
      }
      if (phaseRef.current !== 'climbing') return;
      const map: Record<string, Selection> = {
        q: 'LH', w: 'RH', a: 'LF', s: 'RF', e: 'BODY',
        Q: 'LH', W: 'RH', A: 'LF', S: 'RF', E: 'BODY',
      };
      const pick = map[e.key];
      const sim = simRef.current;
      if (pick && (pick === 'BODY' ? canDyno(sim) : canLaunch(sim, pick))) {
        setSelected((cur) => (cur === pick ? null : pick));
      }
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
    shoutRef.current = null;
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
  const hint = (() => {
    const sim = simRef.current;
    if (selected === 'BODY') return 'Pull the whole body back and let go. Everything leaves the wall.';
    if (selected && sim.limbs[selected].phase === 'free') {
      return `Tap a ringed hold to put ${LIMB_LABEL[selected].toLowerCase()} on it, or pull to fling it.`;
    }
    if (selected) return `Pull ${LIMB_LABEL[selected].toLowerCase()} back and let go.`;
    if (heldCount(sim) === 0) return 'Airborne. Fling something at the wall.';
    return 'Press a limb, pull it back, let go. Grab the hips to dyno.';
  })();

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
          <div className={`climb__mode climb__mode--${modeRef.current}`}>
            {lab ? 'PRACTICE' : modeRef.current === 'onsight' ? 'ONSIGHT' : 'PROJECT'}
          </div>
          <button className="climb__mute" onClick={toggleMute} aria-label={muted ? 'Sound on' : 'Sound off'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <div className="climb__stats">
        <span><b>{launches}</b> moves</span>
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
          {modeRef.current === 'onsight' && !lab && <div className="sent__kicker">onsight</div>}
          <div className="sent__word">SENT</div>
          <div className="sent__sub">{launches} moves{lab ? '' : ` · par ${route.par}`}</div>
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
            <strong>{lab ? 'The practice wall.' : 'Read the route.'}</strong> Press a hand or a foot, pull
            it back, let go. Grab the hips and pull to dyno the whole body. Tap a dangling limb,
            then a hold, to put it back on. Take all the time you like.
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
        <div className="climb__hint">{hint}</div>
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
  if (sim.dyno) return 'whooping';
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
