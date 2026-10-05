import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LimbId, Route, Vec2 } from '../game/types';
import { LIMBS, LIMB_LABEL, isHand } from '../game/types';
import { anchorFor } from '../game/body';
import { type Attempt, type AttemptMode, type BetaMove, beginAttempt } from '../game/attempt';
import {
  type DynoPrediction, type Prediction, type SlingEvent, type SlingState, SLING, bodySpeed, canDyno, canLaunch, dyno,
  heldCount, initialSling, isBand, isSlingSent, launch, limbPositions, placeLimb, placeableHolds,
  poseOf, pumpOut, reachableHolds, stepSling,
  SLING_LIMITS, bodyAngle, postureOf,
} from '../game/sling';
import { AimSearch } from '../game/aimSearch';
import {
  type Pump, catchCost, dynoCost, flingCost, freshPump, gain as addPump, pumpReason, pumpStage, pumpTrend, tickPump,
} from '../game/pump';
import { profileOf, routeTop } from '../game/profile';
import { flowStreak } from '../game/scoring';
import { type AimFilter, filterAim, freshAimFilter, releaseAim } from '../game/aimInput';
import {
  type Juice, freshJuice, isFull, juiceWord, onDynoStuck, onMiss, onPumped, onSlip, onStick, spendDyno,
} from '../game/juice';
import { WallScene, DEFAULT_CAMERA, FRAME_MAX, FRAME_MIN, ORBIT_LIMIT } from '../render/scene';
import type { Mood } from '../render/climber';
import { LIMB_TOUCH_RADIUS, SHOUT_MS, introAlpha, shoutText } from '../render/overlay';
import { drawSlingOverlay, type PullView, type Selection, type SnapView } from '../render/slingOverlay';
import { GRADE_COLOR } from '../render/palette';
import { HAND_Z, FOOT_Z, HIP_Z, HOLD_Z, TORSO_Z } from '../render/depths';
import { Fx } from '../render/fx';
import {
  buzz, isMuted, setMuted, sfxChalk, sfxFall, sfxGrab, sfxHeartbeat, sfxLock, sfxSend, sfxSlip,
  sfxSnap, sfxStretch, sfxThrow, sfxThud, unlockAudio,
  sfxDynoLaunch, sfxDynoReady, sfxDynoStick, sfxDynoWind, sfxJuice,
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
 * limb, pull it back, let go. Press the belly, pull, let go, and everything
 * leaves the wall at once. Tap a dangling limb, then tap a hold, and it goes
 * back on. No bar drains while you think about it.
 */

/** Drag length, in pixels, that corresponds to a full pull. */
function maxDragPx(w: number, h: number): number {
  return Math.max(150, Math.min(Math.min(w, h) * 0.52, 320));
}

/** The drag as a pull, steadied, and no longer than a full one. Zero while it is still a tap. */
function pullOf(drag: Drag, max: number): { dx: number; dy: number } {
  let dx = drag.px;
  let dy = drag.py;
  if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < TAP_PX) return { dx: 0, dy: 0 };
  const l = Math.hypot(dx, dy);
  if (l > max) { dx *= max / l; dy *= max / l; }
  return { dx, dy };
}

/** How long a catch holds the world still: a limb sticking, and a dyno sticking. */
const HIT_STOP = { STICK: 55, DYNO: 220 };
/**
 * Bullet time. A dyno in flight runs slower than the clock — slowest over the
 * top of the arc, where the hands are deciding — so the most committing move
 * on the wall is also the one you get to watch. Only the clock is stretched;
 * the sim steps exactly as it always does.
 */
const DYNO_TIME = 0.62;
/** How far up the wall the camera looks, metres, when it is pulled all the way back for a dyno. */
const DYNO_LOOK_UP = 1.3;
const DYNO_APEX_TIME = 0.28;
/** Milliseconds a frame may spend searching the aim assist's fan. */
const AIM_BUDGET_MS = 6;
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

/**
 * Where the dyno is grabbed: the belly, a little under halfway up the torso.
 * The hips belong to the feet.
 */
function coreOf(hip: Vec2, shoulder: Vec2): Vec2 {
  return { x: hip.x + (shoulder.x - hip.x) * 0.45, y: hip.y + (shoulder.y - hip.y) * 0.45 };
}

type Drag = {
  kind: 'aim' | 'look';
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** The pull, steadied: what the aim actually reads. */
  px: number;
  py: number;
  filter: AimFilter;
  camFocus: number;
  camOrbit: number;
};

function newDrag(kind: Drag['kind'], x: number, y: number, cam: { focusY: number; orbit: number }): Drag {
  return { kind, startX: x, startY: y, x, y, px: 0, py: 0, filter: freshAimFilter(), camFocus: cam.focusY, camOrbit: cam.orbit };
}

export type SlingScreenProps = {
  route: Route;
  mode: AttemptMode;
  /** How fit this climber is: pump costs are divided by it. */
  fitness: number;
  onExit: () => void;
  onOutcome: (attempt: Attempt, outcome: 'sent' | 'fallen') => void;
  attemptsNote?: string;
};

type Phase = 'inspect' | 'climbing' | 'fallen' | 'sent';

export function SlingScreen({ route, mode, fitness, onExit, onOutcome, attemptsNote }: SlingScreenProps) {
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
  /** The restart button's second tap: armed for a moment after the first. */
  const [confirmRestart, setConfirmRestart] = useState(false);
  const confirmTimer = useRef(0);
  /** Until when a second tap restarts. A ref, so the check never reads a stale render. */
  const restartArmedRef = useRef(0);
  const [, bump] = useState(0);

  // The sim and everything the frame loop reads live in refs: sixty renders a
  // second of React would make the drag stutter on a phone.
  const simRef = useRef<SlingState>(initialSling(route.holds, route.start, profileOf(route)));
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
  /**
   * The bands going slack after a release. Each is fixed at one end and its
   * other end follows the limb tip (a throw) or its joint on the body (a dyno).
   */
  const snapRef = useRef<{
    bands: { anchor: Vec2; from: Vec2; limb: LimbId; follow: 'tip' | 'joint' }[];
    start: number;
  } | null>(null);
  /** Every throw from the held-still body, kept while the pull is being made. */
  const aimSearchRef = useRef<AimSearch | null>(null);
  /** The aiming notch the pull is on, so it only moves when the finger clearly does. */
  const aimNotchRef = useRef<{ angle: number; power: number } | null>(null);
  /** How far the body is drawn back on a dyno pull, this frame. What it launches from. */
  const dynoWindRef = useRef<Vec2 | null>(null);
  const settleRef = useRef<Partial<Record<LimbId, { from: Vec2; start: number }>>>({});
  const lastLimbsRef = useRef<Record<LimbId, Vec2> | null>(null);
  // The pump. Changes every frame, so it is written straight to the DOM
  // rather than mirrored into React state sixty times a second.
  const lab0 = isLabRoute(route.id);
  // The practice wall is for learning moves, so it goes easy on the pump.
  const pumpStateRef = useRef<Pump>(freshPump(lab0 ? fitness * 2.5 : fitness));
  const baseBarRef = useRef<HTMLDivElement>(null);
  const floorBarRef = useRef<HTMLDivElement>(null);
  const pumpRef = useRef<HTMLSpanElement>(null);
  const whyRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const heartRef = useRef(0);
  // The dyno meter. Earned by sticking moves, spent all at once.
  const juiceRef = useRef<Juice>(freshJuice(lab0));
  const juiceBarRef = useRef<HTMLDivElement>(null);
  const juiceWordRef = useRef<HTMLSpanElement>(null);
  const juiceBoxRef = useRef<HTMLDivElement>(null);
  const dynoTimeRef = useRef<HTMLDivElement>(null);
  /** How fast the clock is running, 1 = real time. Eased, never snapped. */
  const timeScaleRef = useRef(1);
  /** Extra camera frame on top of the player's zoom: a punch out on launch, in on the catch. */
  const framePunchRef = useRef(0);
  /** 0..1: how far the camera has pulled back for a dyno. */
  const dynoZoomRef = useRef(0);
  /** How high each hand was when the dyno let go, metres. What it is measured from. */
  const dynoFromRef = useRef<Partial<Record<LimbId, number>>>({});
  /** When a dyno last stuck. The other hand landing just after belongs to the same move. */
  const dynoCaughtAtRef = useRef(-Infinity);

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

  /** Moves the meter, and makes a moment of it when it tops out. */
  const setJuice = useCallback((next: Juice) => {
    const before = juiceRef.current;
    juiceRef.current = lab0 ? freshJuice(true) : next;
    const after = juiceRef.current;
    const box = juiceBoxRef.current;
    if (after.level > before.level + 1e-6) {
      sfxJuice(after.level);
      if (box) {
        box.classList.remove('is-bump');
        void box.offsetWidth;
        box.classList.add('is-bump');
      }
    }
    if (isFull(after) && !isFull(before)) {
      sfxDynoReady();
      buzz([10, 30, 10, 30, 40]);
      fxRef.current.kick(0.15);
      window.setTimeout(() => say('DYNO READY', 'The belly is live. Make it count.', 1700), 320);
    }
    box?.classList.toggle('is-ready', isFull(after));
    bump((n) => n + 1);
  }, [lab0, say]);

  // --- scene lifecycle ---------------------------------------------------

  useEffect(() => {
    const gl = glRef.current;
    if (!gl) return;
    const scene = new WallScene(gl);
    sceneRef.current = scene;
    scene.setRoute(route);
    scene.setWall(profileOf(route));
    scene.resize();
    camRef.current.focusX = startFocusX(route, scene);

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
          {
            const s = simRef.current;
            pumpStateRef.current = addPump(pumpStateRef.current, flingCost(e.power, bodyAngle(s), heldCount(s)));
          }
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
          {
            const s = simRef.current;
            dynoFromRef.current = { LH: s.limbs.LH.pos.y, RH: s.limbs.RH.pos.y };
          }
          sfxDynoLaunch(e.power);
          buzz([10, 20, 40]);
          pumpStateRef.current = addPump(pumpStateRef.current, dynoCost(e.power, bodyAngle(simRef.current)));
          fx.kick(0.45);
          fx.launch(e.from, []);
          framePunchRef.current = 0.7;
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
          say('DYNO', 'Everything off. Stick it.', 900);
          break;
        }
        case 'place': {
          sfxGrab('PERFECT', 0);
          buzz(8);
          fx.chalk(e.at, 0.7);
          movesRef.current.push({
            placed: true, limb: e.limb, holdId: e.holdId, grade: 'PERFECT',
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
          // Stopping a body that is moving costs; stopping it on one hand costs double.
          {
            const s = simRef.current;
            const hands = LIMBS.filter((id) => isHand(id) && s.limbs[id].phase === 'held').length;
            pumpStateRef.current = addPump(pumpStateRef.current, catchCost(bodySpeed(s), isHand(e.limb), hands, bodyAngle(s)));
          }
          sfxGrab(e.grade, streakNow);
          // The juice. A dyno's own catch is paid back by the dyno; the second
          // hand arriving after it is part of the same move, not a new one.
          const secondHand = !e.dyno && now - dynoCaughtAtRef.current < 800;
          // How far up the wall the dyno went: the payoff, said out loud.
          const gain = e.dyno ? Math.max(0, e.at.y - (dynoFromRef.current[e.limb] ?? e.at.y)) : 0;
          const big = clamp((gain - 1) / 1.5, 0, 1);
          if (e.dyno) {
            dynoCaughtAtRef.current = now;
            setJuice(onDynoStuck(juiceRef.current, gain));
          } else if (!secondHand) {
            setJuice(onStick(juiceRef.current, streakNow));
          }
          fx.chalk(e.at, 1.1);
          const last = lastLimbsRef.current?.[e.limb];
          if (last) settleRef.current[e.limb] = { from: { ...last }, start: now };
          if (e.dyno) {
            // The biggest thing that happens on the wall short of the top,
            // and bigger the further it went.
            fx.shockwave(e.at, big > 0.4 ? '#ffd75e' : '#ff8f3c', 1.1 * (1 + 0.6 * big));
            fx.confetti(e.at);
            if (big > 0.5) fx.confetti({ x: e.at.x, y: e.at.y - 0.3 });
            fx.kick(0.75 + 0.3 * big);
            sfxDynoStick(big > 0.4);
            buzz([30, 15, 60]);
            framePunchRef.current = -0.55;
            timeScaleRef.current = 1;
          } else {
            fx.perfect(e.at, '#6ef2b4');
            fx.kick(0.15);
            buzz(10);
          }
          freezeRef.current = now + (e.dyno ? HIT_STOP.DYNO * (1 + 0.6 * big) : HIT_STOP.STICK);
          const zone = e.zone;
          if (e.dyno) {
            const word = big >= 0.99 ? 'Huge dyno: ' : big > 0.4 ? 'Big dyno: ' : '';
            say('STUCK IT', `${word}+${gain.toFixed(1)} m. Caught ${zone}.`, 2200 + 600 * big);
          } else if (!secondHand) {
            // (The second hand of a dyno that already stuck leaves the banner to the first.)
            say('STUCK', `Got ${zone}.`, 1100);
          }
          break;
        }
        case 'miss': {
          delete pendingRef.current[e.limb];
          setStreak(0);
          setJuice(onMiss(juiceRef.current));
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
          setJuice(onSlip(juiceRef.current));
          sfxSlip();
          fx.kick(0.2);
          buzz([20, 20, 20]);
          reasonRef.current = e.reason;
          say('SLIP', e.reason);
          break;
        }
        case 'pumped': {
          sfxSlip();
          setJuice(onPumped(juiceRef.current));
          buzz([30, 20, 30, 20, 60]);
          fx.kick(0.25);
          reasonRef.current = 'Pumped stupid. Arms opened on their own.';
          say('PUMPED', reasonRef.current, 1600);
          setStreak(0);
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
  }, [say, startShout, setJuice]);

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
      // Bullet time while a dyno is in the air, slowest over the top.
      {
        const want = sim.dyno ? (Math.abs(sim.hipV.y) < 1.4 ? DYNO_APEX_TIME : DYNO_TIME) : 1;
        timeScaleRef.current += (want - timeScaleRef.current) * (want < timeScaleRef.current ? 0.25 : 0.12);
        if (dynoTimeRef.current) {
          dynoTimeRef.current.style.opacity = String(clamp((1 - timeScaleRef.current) / 0.72, 0, 1));
        }
      }
      // Aiming holds the world still. While a limb or the belly is being
      // pulled, the body does not sway under the arc, so the arc moves when
      // the finger does and only then — the thing you are reading is the
      // throw, not the last move settling. Not while something is already in
      // the air: that has to land. The pump keeps counting either way.
      const drag = dragRef.current;
      const holding = ph === 'climbing' && drag?.kind === 'aim' && !!selectedRef.current
        && !sim.dyno && !LIMBS.some((id) => sim.limbs[id].phase === 'flying');
      // Throws remembered against a held-still body are only good while it is.
      if (!holding) aimSearchRef.current = null;
      if (holding && dt > 0 && !sim.fallen) {
        accRef.current = 0;
        const posture = { ...postureOf(sim), speed: 0 };
        const events: SlingEvent[] = [];
        pumpStateRef.current = tickPump(pumpStateRef.current, posture, dt / 1000);
        if (pumpStateRef.current.pump >= 1 && posture.hands > 0) {
          pumpOut(sim, events);
          dragRef.current = null;
        }
        if (events.length) handleEvents(events, now);
      }
      if ((ph === 'climbing' || ph === 'fallen') && now >= freezeRef.current && !holding) {
        accRef.current += (dt / 1000) * timeScaleRef.current;
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
        // The pump reads what the body is actually doing: the wall where it
        // is, what is holding on, how much it is moving. Sim time, so bullet
        // time is not a tax.
        if (ph === 'climbing' && dt > 0 && !sim.fallen) {
          const posture = postureOf(sim);
          pumpStateRef.current = tickPump(pumpStateRef.current, posture, (dt / 1000) * timeScaleRef.current);
          if (pumpStateRef.current.pump >= 1 && posture.hands > 0) pumpOut(sim, events);
        }
        if (events.length) handleEvents(events, now);
        if (phaseRef.current === 'climbing' && isSlingSent(sim, route.finish)) celebrate(now);
      }
      fxRef.current.update(dt);

      // The bar, the word, and — on empty — a heartbeat and the edges closing in.
      {
        const p = pumpStateRef.current;
        const climbing = phaseRef.current === 'climbing';
        // The bar is what is left: it empties as the forearms fill. The dark
        // end is what this climb has cost for good — no rest gets that back.
        if (baseBarRef.current) baseBarRef.current.style.transform = `scaleX(${1 - p.pump})`;
        if (floorBarRef.current) floorBarRef.current.style.transform = `scaleX(${p.floor})`;
        if (pumpRef.current || whyRef.current) {
          const posture = postureOf(sim);
          const trend = pumpTrend(posture);
          const arrow = trend === 'recovering' ? ' ↓' : trend === 'steady' ? '' : trend === 'climbing' ? ' ↑' : ' ↑↑';
          if (pumpRef.current) pumpRef.current.textContent = `${pumpStage(p.pump)}${arrow}`;
          if (whyRef.current) {
            whyRef.current.textContent = `${trend} · ${pumpReason(posture)}`;
            whyRef.current.dataset.trend = trend;
          }
        }
        const low = climbing && p.pump > 0.68 ? (p.pump - 0.68) / 0.32 : 0;
        if (vignetteRef.current) vignetteRef.current.style.opacity = String(low * 0.85);
        if (low > 0 && now >= heartRef.current) {
          sfxHeartbeat(low);
          heartRef.current = now + 1100 - low * 620;
        }
      }

      // The dyno meter.
      {
        const j = juiceRef.current.level;
        if (juiceBarRef.current) juiceBarRef.current.style.transform = `scaleX(${j})`;
        if (juiceWordRef.current) juiceWordRef.current.textContent = lab ? 'free here' : juiceWord(j);
      }
      // Embers off a body in flight.
      if (sim.dyno && dt > 0) {
        const hot = timeScaleRef.current < 0.5 ? '#ffd75e' : '#ff8f3c';
        fxRef.current.ember(sim.hip, sim.hipV, hot);
        for (const id of ['LH', 'RH'] as LimbId[]) {
          const l = sim.limbs[id];
          if (l.phase === 'flying') fxRef.current.ember(l.pos, l.vel, '#ffffff');
        }
      }

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

      // The dyno pulls the camera back: drawing the belly down opens the
      // view up the wall, further the harder you pull, so the holds a dyno
      // can reach are on screen to pick from; in the air it stays wide and
      // rides up with the body; after the catch it eases back in.
      {
        const winding = selectedRef.current === 'BODY' && dragRef.current?.kind === 'aim' && dynoWindRef.current;
        const pull = winding ? Math.min(1, Math.hypot(dynoWindRef.current!.x, dynoWindRef.current!.y) / SLING.dynoWindup) : 0;
        const want = sim.dyno ? 1 : winding ? 0.35 + 0.65 * pull : 0;
        dynoZoomRef.current += (want - dynoZoomRef.current) * (want > dynoZoomRef.current ? 0.14 : 0.025);
      }
      const zoom = dynoZoomRef.current;

      // Camera: follows the chest, slowly, and never jumps for a throw.
      const cam = camRef.current;
      if (followRef.current || zoom > 0.05) {
        const want = clamp(pose.com.y + 0.55 + zoom * DYNO_LOOK_UP, 1.7, routeTop(route) - 0.65);
        cam.focusY += (want - cam.focusY) * (zoom > 0.05 ? 0.09 : 0.045);
        // Sideways too, but only as far as the wall goes — a route that
        // traverses off the edge of a phone screen should not leave you there.
        const lim = scene.focusXLimit(cam.frame);
        const wantX = clamp(pose.com.x, -lim, lim);
        cam.focusX += (wantX - cam.focusX) * 0.04;
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

      // The punch: out on the launch, in on the catch, and drawn in a little
      // while the belly is wound back — the camera leaning in to watch.
      framePunchRef.current *= Math.exp(-dt / 260);
      const wide = zoom * Math.max(0, FRAME_MAX - cam.frame);
      scene.setCamera({ ...cam, frame: clamp(cam.frame + framePunchRef.current + wide, FRAME_MIN, FRAME_MAX) });

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
          let from = body ? coreOf(pose.hip, pose.shoulder) : limbs[sel];
          const fromPx = scene.project(from, body ? TORSO_Z : isHand(sel) ? HAND_Z : FOOT_Z);
          const max = maxDragPx(rect.width, rect.height);
          let dx = 0;
          let dy = 0;
          if (drag?.kind === 'aim') {
            // Steadied once a frame, so a finger held still settles too.
            const f = filterAim(drag.filter, { x: drag.x - drag.startX, y: drag.y - drag.startY }, now);
            drag.px = f.x;
            drag.py = f.y;
            ({ dx, dy } = pullOf(drag, max));
          }
          // The pull, snapped to the aiming grid: the same finger position is
          // always the same throw, and the world is holding still under it.
          const snapped = AimSearch.snap({ x: dx, y: -dy }, max, aimNotchRef.current);
          aimNotchRef.current = drag?.kind === 'aim' ? snapped : null;
          const pulling = drag?.kind === 'aim' && snapped.power >= SLING.minPower;
          if (pulling && !aimSearchRef.current) aimSearchRef.current = new AimSearch(sim, route.holds);
          const search = aimSearchRef.current;

          // The wind-up. The limb itself comes back with the finger, the elbow
          // bends, and that is where it fires from — so the release is the
          // band snapping through, not a pip vanishing. Aim assist is a fan
          // of real throws either side of the pull, searched a few a frame.
          let wind: Vec2 | null = null;
          let dynoWind: Vec2 | null = null;
          let prediction: Prediction | null = null;
          let dynoPrediction: DynoPrediction | null = null;
          if (pulling && search && !body) {
            // As much of the fan as fits in a few milliseconds this frame;
            // what is found is kept, so a held-still pull settles at once.
            const t0 = performance.now();
            let r = search.resolve(sel, snapped.angle, snapped.power, 1);
            while (!r.settled && performance.now() - t0 < AIM_BUDGET_MS) r = search.resolve(sel, snapped.angle, snapped.power, 1);
            wind = r.aim.from ?? null;
            if (wind) limbs[sel] = wind;
            prediction = r.prediction;
          } else if (pulling && search && body) {
            // The body is the stone and every limb on the wall is band: it
            // draws back against them, they stretch, and they stay put.
            const d = search.dyno(snapped.angle, snapped.power);
            const w = d.wind;
            const shift = (p: Vec2) => ({ x: p.x + w.x, y: p.y + w.y });
            pose.hip = shift(pose.hip);
            pose.shoulder = shift(pose.shoulder);
            pose.head = shift(pose.head);
            for (const id of LIMBS) if (!isBand(sim.limbs[id])) limbs[id] = shift(limbs[id]);
            dynoWind = w;
            dynoPrediction = d.prediction;
          }
          windRef.current = wind;
          dynoWindRef.current = dynoWind;
          const aim = { power: pulling ? snapped.power : 0 };

          // The ratchet: a creak every notch the band is drawn back.
          const notch = pulling ? Math.floor(aim.power * NOTCHES) : 0;
          if (notch > notchRef.current) {
            sfxStretch(aim.power);
            if (body) sfxDynoWind(aim.power);
            buzz(body ? 6 : 3);
          }
          notchRef.current = notch;

          const lockId = prediction?.caught?.holdId ?? dynoPrediction?.caught[0]?.holdId ?? null;
          if (lockId !== lockRef.current) {
            if (lockId !== null) { sfxLock(); buzz(4); }
            lockRef.current = lockId;
          }
          const ghostPx = wind ? scene.project(wind, isHand(sel as LimbId) ? HAND_Z : FOOT_Z) : { x: fromPx.x + dx, y: fromPx.y + dy };
          if (dynoWind) from = coreOf(pose.hip, pose.shoulder);
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
            bands: body && pulling
              ? LIMBS.filter((id) => isBand(sim.limbs[id])).map((id) => ({
                limb: id, at: limbs[id], anchor: anchorFor(id, pose.hip, pose.shoulder),
              }))
              : [],
            reach: body ? null : {
              anchor: anchorFor(sel, pose.hip, pose.shoulder),
              radius: isHand(sel) ? SLING_LIMITS.ARM_MAX : SLING_LIMITS.LEG_MAX,
            },
          };
        } else {
          lockRef.current = null;
          windRef.current = null;
          dynoWindRef.current = null;
          aimSearchRef.current = null;
          notchRef.current = 0;
        }

        const snapping = snapRef.current;
        let snap: SnapView | null = null;
        if (snapping) {
          const t = (now - snapping.start) / SNAP_MS;
          if (t >= 1) snapRef.current = null;
          else {
            snap = {
              t,
              bands: snapping.bands.map((b) => ({
                anchor: b.anchor,
                from: b.from,
                to: b.follow === 'tip' ? limbs[b.limb] : anchorFor(b.limb, pose.hip, pose.shoulder),
              })),
            };
          }
        }

        const launchable = new Set<LimbId>();
        for (const limb of LIMBS) if (canLaunch(sim, limb)) launchable.add(limb);
        const phases = { LH: sim.limbs.LH.phase, RH: sim.limbs.RH.phase, LF: sim.limbs.LF.phase, RF: sim.limbs.RF.phase };

        drawSlingOverlay({
          scene, ctx,
          width: rect.width, height: rect.height,
          limbs, phases,
          core: coreOf(pose.hip, pose.shoulder),
          selected: sel,
          launchable,
          canDyno: canDyno(sim) && isFull(juiceRef.current),
          dynoCharge: juiceRef.current.level,
          now,
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

  /**
   * The limb, or the body, under a screen point. A limb can be grabbed by its
   * tip, by the hold it is on, or where it joins the body: a hand at its
   * shoulder, a foot at its hip. The belly is the dyno. Tips win when they
   * overlap; otherwise the nearest thing that can be pulled right now.
   */
  const targetAtPoint = useCallback((x: number, y: number): Selection | null => {
    const scene = sceneRef.current;
    if (!scene) return null;
    const sim = simRef.current;
    const limbs = limbPositions(sim);
    let best: Selection | null = null;
    let bestD = LIMB_TOUCH_RADIUS;
    const consider = (sel: Selection, at: Vec2, z: number) => {
      if (sel === 'BODY' ? !(canDyno(sim) && isFull(juiceRef.current)) : !canLaunch(sim, sel)) return;
      const p = scene.project(at, z);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { best = sel; bestD = d; }
    };
    for (const limb of LIMBS) consider(limb, limbs[limb], isHand(limb) ? HAND_Z : FOOT_Z);
    if (best) return best;
    for (const limb of LIMBS) {
      consider(limb, anchorFor(limb, sim.hip, sim.shoulder), isHand(limb) ? TORSO_Z : HIP_Z);
      const l = sim.limbs[limb];
      const hold = l.phase === 'held' && l.holdId !== null ? holdsById.get(l.holdId) : undefined;
      if (hold) consider(limb, hold.pos, HOLD_Z);
    }
    consider('BODY', coreOf(sim.hip, sim.shoulder), TORSO_Z);
    return best;
  }, [holdsById]);

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
      dragRef.current = newDrag('look', x, y, cam);
      return;
    }
    if (phaseRef.current !== 'climbing') return;

    const hit = targetAtPoint(x, y);
    if (hit) {
      // Press straight onto it and pull in one gesture, or tap to pick it up
      // and pull from anywhere. Thumbs differ.
      setSelected(hit);
      selectedRef.current = hit;
      followRef.current = true;
      dragRef.current = newDrag('aim', x, y, cam);
      return;
    }
    if (selectedRef.current) {
      dragRef.current = newDrag('aim', x, y, cam);
      return;
    }
    followRef.current = false;
    dragRef.current = newDrag('look', x, y, cam);
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
      camRef.current.focusY = clamp(drag.camFocus + (drag.y - drag.startY) * mpp, 0.9, routeTop(route) + 0.15);
      camRef.current.orbit = clamp(drag.camOrbit - (drag.x - drag.startX) * 0.0022, -ORBIT_LIMIT, ORBIT_LIMIT);
    }
  }, [route]);

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

    // What fires is the aim the player settled on, not where lift-off
    // smeared it, worked out against the body as it is right now — so the
    // arc on screen a moment ago and the throw are the same throw.
    const rect = e.currentTarget.getBoundingClientRect();
    const max = maxDragPx(rect.width, rect.height);
    const now = performance.now();
    const settled = releaseAim(drag.filter, now);
    if (settled) { drag.px = settled.x; drag.py = settled.y; }
    const pull = pullOf(drag, max);
    const snapped = AimSearch.snap({ x: pull.dx, y: -pull.dy }, max, aimNotchRef.current);
    aimNotchRef.current = null;
    if (snapped.power < SLING.minPower) return;
    const events: SlingEvent[] = [];
    // The world held still while the pull was made, so this is the very
    // throw the screen was showing for this notch.
    const search = aimSearchRef.current ?? new AimSearch(sim, route.holds);
    let aim = { limb: (sel === 'BODY' ? 'RH' : sel) as LimbId, dir: { x: 0, y: 1 }, power: snapped.power } as Parameters<typeof launch>[1];
    let wind: Vec2 | null = null;
    let dynoWind: Vec2 | null = null;
    if (sel !== 'BODY') {
      let r = search.resolve(sel, snapped.angle, snapped.power, 1);
      for (let i = 0; i < 12 && !r.settled; i++) r = search.resolve(sel, snapped.angle, snapped.power, 1);
      aim = r.aim;
      wind = r.aim.from ?? null;
    } else {
      const d = search.dyno(snapped.angle, snapped.power);
      aim = { ...aim, dir: d.dir };
      dynoWind = d.wind;
    }
    // The bands of a dyno, caught before everything lets go: hold to body.
    const dynoBands = sel === 'BODY' && dynoWind
      ? LIMBS.filter((id) => isBand(sim.limbs[id])).map((id) => {
        const hip = { x: sim.hip.x + dynoWind.x, y: sim.hip.y + dynoWind.y };
        const shoulder = { x: sim.shoulder.x + dynoWind.x, y: sim.shoulder.y + dynoWind.y };
        return { anchor: { ...sim.limbs[id].pos }, from: anchorFor(id, hip, shoulder), limb: id, follow: 'joint' as const };
      })
      : [];
    const spent = sel === 'BODY' ? spendDyno(juiceRef.current) : null;
    if (sel === 'BODY' && !spent) return;
    const handsBefore = sel === 'BODY'
      ? LIMBS.filter((id) => isBand(sim.limbs[id])).map((id) => ({ ...sim.limbs[id].pos }))
      : [];
    aimSearchRef.current = null;
    const went = sel === 'BODY'
      ? dyno(sim, { dir: aim.dir, power: aim.power, wind: dynoWind ?? undefined }, events)
      : launch(sim, aim, events);
    if (went && spent) {
      setJuice(spent);
      fxRef.current.launch(sim.hip, handsBefore);
    }
    if (went) {
      if (sel !== 'BODY' && wind) {
        const pose = poseOf(sim);
        snapRef.current = {
          bands: [{ anchor: anchorFor(sel, pose.hip, pose.shoulder), from: wind, limb: sel, follow: 'tip' }],
          start: now,
        };
      } else if (dynoBands.length) {
        snapRef.current = { bands: dynoBands, start: now };
      }
      dynoWindRef.current = null;
      sfxSnap(aim.power);
      fxRef.current.kick(0.05 + 0.08 * aim.power);
      windRef.current = null;
      notchRef.current = 0;
      handleEvents(events, now);
      setSelected(null);
      selectedRef.current = null;
      followRef.current = true;
    }
  }, [handleEvents, route, setJuice]);

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
      if (e.key === 'r' || e.key === 'R') {
        // Straight away on a keyboard: nobody presses R by accident twice.
        restartClimbRef.current();
        return;
      }
      const map: Record<string, Selection> = {
        q: 'LH', w: 'RH', a: 'LF', s: 'RF', e: 'BODY',
        Q: 'LH', W: 'RH', A: 'LF', S: 'RF', E: 'BODY',
      };
      const pick = map[e.key];
      const sim = simRef.current;
      if (pick && (pick === 'BODY' ? canDyno(sim) && isFull(juiceRef.current) : canLaunch(sim, pick))) {
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

  /** Back to the start of the route. The onsight survives only if nothing was thrown yet. */
  const restart = (keepMode = false) => {
    simRef.current = initialSling(route.holds, route.start, profileOf(route));
    movesRef.current = [];
    pendingRef.current = {};
    trailsRef.current = {};
    settleRef.current = {};
    snapRef.current = null;
    dragRef.current = null;
    windRef.current = null;
    dynoWindRef.current = null;
    endedRef.current = null;
    freezeRef.current = 0;
    dynoCaughtAtRef.current = -Infinity;
    selectedRef.current = null;
    if (!keepMode) modeRef.current = 'project';
    setFlash(null);
    setSentBanner(false);
    setConfirmRestart(false);
    accRef.current = 0;
    reasonRef.current = null;
    shoutRef.current = null;
    pumpStateRef.current = freshPump(lab0 ? fitness * 2.5 : fitness);
    juiceRef.current = freshJuice(lab0);
    juiceBoxRef.current?.classList.toggle('is-ready', lab0);
    timeScaleRef.current = 1;
    framePunchRef.current = 0;
    dynoZoomRef.current = 0;
    setLaunches(0);
    setStreak(0);
    setSelected(null);
    setLastReason(null);
    setLanded(false);
    setPhase('inspect');
    phaseRef.current = 'inspect';
    camRef.current = { ...DEFAULT_CAMERA };
    if (sceneRef.current) camRef.current.focusX = startFocusX(route, sceneRef.current);
    followRef.current = true;
  };

  /**
   * Restart mid-climb. Before the first throw it is free. After it, it counts
   * the way coming off counts — a fall on the record, the onsight gone, a daily
   * attempt spent — because otherwise it is a way round all three. Then it
   * pulls straight back on rather than making you read the route again.
   */
  const restartClimb = () => {
    window.clearTimeout(confirmTimer.current);
    const moved = movesRef.current.length > 0;
    if (moved && !lab) {
      fallsRef.current += 1;
      onOutcome(buildAttempt('fallen'), 'fallen');
    }
    restart(!moved);
    startClimb();
  };
  const restartClimbRef = useRef(restartClimb);
  restartClimbRef.current = restartClimb;

  const onRestartTap = () => {
    unlockAudio();
    const now = performance.now();
    if (movesRef.current.length === 0 || now < restartArmedRef.current) {
      restartArmedRef.current = 0;
      restartClimb();
      return;
    }
    restartArmedRef.current = now + 4000;
    setConfirmRestart(true);
    window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => setConfirmRestart(false), 4000);
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
    if (isFull(juiceRef.current)) return 'Dyno ready. Grab the belly, pull, and stick it — fingertips will not hold.';
    return 'Press a limb, pull it back, let go. Clean sticks charge the dyno.';
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
      <div className="climb__vignette" ref={vignetteRef} />
      <div className="climb__dynotime" ref={dynoTimeRef} />

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
          {phase === 'climbing' && (
            <button
              className={`climb__restart${confirmRestart ? ' is-confirm' : ''}`}
              onClick={onRestartTap}
              aria-label={confirmRestart ? 'Tap again to restart' : 'Restart the climb'}
              title="Restart (R)"
            >
              {confirmRestart ? 'Restart?' : '↺'}
            </button>
          )}
          <button className="climb__mute" onClick={toggleMute} aria-label={muted ? 'Sound on' : 'Sound off'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      {phase === 'climbing' && (
        <div className="stamina">
          <div className="stamina__row">
            <span className="stamina__label">Pump</span>
            <span className="stamina__word" ref={pumpRef}>fresh</span>
          </div>
          <div className="stamina__track">
            <div className="stamina__fill" ref={baseBarRef} />
            <div className="stamina__floor" ref={floorBarRef} />
          </div>
          <div className="stamina__why" ref={whyRef} />
          <div className={`juice${lab ? ' is-ready' : ''}`} ref={juiceBoxRef}>
            <div className="stamina__row">
              <span className="stamina__label juice__label">Dyno</span>
              <span className="stamina__word juice__word" ref={juiceWordRef}>empty</span>
            </div>
            <div className="juice__track">
              <div className="juice__fill" ref={juiceBarRef} />
              {[0.25, 0.5, 0.75].map((t) => <i key={t} style={{ left: `${t * 100}%` }} />)}
            </div>
          </div>
        </div>
      )}

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
        <div className={`flash flash--${flash.grade.toLowerCase().replace(/ /g, '-')}`} key={`${launches}-${flash.grade}-${flash.reason}`}>
          <div className="flash__grade">{flash.grade}</div>
          <div className="flash__reason">{flash.reason}</div>
        </div>
      )}

      {phase === 'inspect' && (
        <div className="inspect">
          <div className="inspect__hint">
            <strong>{lab ? 'The practice wall.' : 'Read the route.'}</strong> Press a hand or a foot (or
            its shoulder, its hip, or the hold it is on), pull it back, let go. Grab the belly and
            pull to dyno the whole body — once you have earned it: every clean stick fills the
            dyno meter, every whiff drains it, and a dyno spends the lot. Tap a dangling limb,
            then a hold, to put it back on. The pump runs from the moment you pull on: hanging on
            your arms burns it, standing on your feet barely does.
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
            <button className="btn btn--primary" onClick={() => restart()}>Try again</button>
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

/** Where to look sideways before the climb starts: at the start holds, as far as the wall allows. */
function startFocusX(route: Route, scene: WallScene): number {
  const ids = [route.start.LH, route.start.RH].filter((x): x is number => x !== undefined);
  const hands = route.holds.filter((h) => ids.includes(h.id));
  if (hands.length === 0) return 0;
  const x = hands.reduce((sum, h) => sum + h.pos.x, 0) / hands.length;
  const lim = scene.focusXLimit();
  return clamp(x, -lim, lim);
}
