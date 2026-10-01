import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LimbId, Route, Vec2 } from '../game/types';
import { LIMBS, LIMB_LABEL, isHand } from '../game/types';
import { anchorFor } from '../game/body';
import { type Attempt, type AttemptMode, type BetaMove, beginAttempt, overhangOf } from '../game/attempt';
import {
  type AssistedLaunch, type SlingEvent, type SlingState, SLING, aimFromPull, bodySpeed, canDyno, canLaunch, dyno,
  dynoWindup, handLoad, heldCount, initialSling, isBand, isSlingSent, launch, limbPositions, placeLimb, placeableHolds,
  poseOf, assistLaunch, predictDyno, pumpOut, reachableHolds, restingOn, stepSling, windupPos,
  SLING_LIMITS,
} from '../game/sling';
import {
  type Endurance, DYNO_COST, FLING_COST, drainEndurance, freshEndurance, isRest, pumpWord,
  routeDrain, spend,
} from '../game/endurance';
import { flowStreak } from '../game/scoring';
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
  sfxDynoLaunch, sfxDynoReady, sfxDynoStick, sfxDynoWind, sfxJuice, sfxRip,
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
  return Math.max(130, Math.min(Math.min(w, h) * 0.44, 260));
}

/** How long a catch holds the world still: a scrape, a good one, a perfect one, a dyno. */
const HIT_STOP: Record<string, number> = { SCRAPE: 0, GOOD: 40, PERFECT: 70, DYNO: 220 };
/**
 * Bullet time. A dyno in flight runs slower than the clock — slowest over the
 * top of the arc, where the hands are deciding — so the most committing move
 * on the wall is also the one you get to watch. Only the clock is stretched;
 * the sim steps exactly as it always does.
 */
const DYNO_TIME = 0.62;
const DYNO_APEX_TIME = 0.28;
/** How long the band takes to go slack after a release. */
const SNAP_MS = 110;
/** How long a held-still aim reuses its assisted arc before working it out again. */
const ASSIST_REFRESH_MS = 120;
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
  camFocus: number;
  camOrbit: number;
};

export type SlingScreenProps = {
  route: Route;
  mode: AttemptMode;
  /** Endurance capacity this player has earned, seconds of hanging. */
  capacity: number;
  onExit: () => void;
  onOutcome: (attempt: Attempt, outcome: 'sent' | 'fallen') => void;
  attemptsNote?: string;
};

type Phase = 'inspect' | 'climbing' | 'fallen' | 'sent';

export function SlingScreen({ route, mode, capacity, onExit, onOutcome, attemptsNote }: SlingScreenProps) {
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
  /**
   * The bands going slack after a release. Each is fixed at one end and its
   * other end follows the limb tip (a throw) or its joint on the body (a dyno).
   */
  const snapRef = useRef<{
    bands: { anchor: Vec2; from: Vec2; limb: LimbId; follow: 'tip' | 'joint' }[];
    start: number;
  } | null>(null);
  /** Where aim assist steered this frame's throw, if it did. */
  const assistRef = useRef<{ dir: Vec2; power: number } | null>(null);
  const assistCacheRef = useRef<{ key: string; at: number; result: AssistedLaunch } | null>(null);
  /** How far the body is drawn back on a dyno pull, this frame. What it launches from. */
  const dynoWindRef = useRef<Vec2 | null>(null);
  const settleRef = useRef<Partial<Record<LimbId, { from: Vec2; start: number }>>>({});
  const lastLimbsRef = useRef<Record<LimbId, Vec2> | null>(null);
  // The pump. Changes every frame, so it is written straight to the DOM
  // rather than mirrored into React state sixty times a second.
  const lab0 = isLabRoute(route.id);
  const enduranceRef = useRef<Endurance>(freshEndurance(lab0 ? capacity * 2.5 : capacity));
  const drainRef = useRef(routeDrain(route));
  const restIds = useMemo(() => new Set(route.holds.filter(isRest).map((h) => h.id)), [route]);
  const baseBarRef = useRef<HTMLDivElement>(null);
  const pumpRef = useRef<HTMLSpanElement>(null);
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
    scene.setOverhang(overhangOf(route));
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
          enduranceRef.current = spend(enduranceRef.current, FLING_COST * (0.4 + 0.6 * e.power)).endurance;
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
          sfxDynoLaunch(e.power);
          buzz([10, 20, 40]);
          enduranceRef.current = spend(enduranceRef.current, DYNO_COST).endurance;
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
          // The juice. A dyno's own catch is paid back by the dyno; the second
          // hand arriving after it is part of the same move, not a new one.
          const secondHand = !e.dyno && now - dynoCaughtAtRef.current < 800;
          if (e.dyno) {
            dynoCaughtAtRef.current = now;
            setJuice(onDynoStuck(juiceRef.current, e.grade));
          } else if (!secondHand) {
            setJuice(onStick(juiceRef.current, e.grade, streakNow));
          }
          fx.chalk(e.at, e.grade === 'PERFECT' ? 1.3 : e.grade === 'GOOD' ? 0.9 : 0.6);
          const last = lastLimbsRef.current?.[e.limb];
          if (last) settleRef.current[e.limb] = { from: { ...last }, start: now };
          if (e.dyno) {
            // The biggest thing that happens on the wall short of the top.
            const clean = e.grade === 'PERFECT';
            fx.shockwave(e.at, clean ? '#ffd75e' : '#ff8f3c', clean ? 1.25 : 1);
            if (clean) fx.confetti(e.at);
            fx.kick(clean ? 0.85 : 0.7);
            sfxDynoStick(clean);
            buzz([30, 15, 60]);
            framePunchRef.current = -0.55;
            timeScaleRef.current = 1;
          } else if (e.grade === 'PERFECT') {
            fx.perfect(e.at, '#6ef2b4');
            fx.kick(0.2);
            buzz(12);
          } else {
            fx.kick(e.grade === 'GOOD' ? 0.1 : 0.15);
            buzz(8);
          }
          freezeRef.current = now + (e.dyno ? HIT_STOP.DYNO : HIT_STOP[e.grade]);
          const zone = e.zone;
          if (e.dyno) {
            say(e.grade === 'PERFECT' ? 'STUCK IT' : 'STUCK',
              e.grade === 'PERFECT' ? `Dead centre of ${zone}. Some juice back for style.` : `Caught ${zone}. Hold on.`, 2000);
          } else if (!secondHand) {
            // (The second hand of a dyno that already stuck leaves the banner to the first.)
            say(e.grade,
              e.grade === 'PERFECT' ? `Right on ${zone}.`
              : e.grade === 'GOOD' ? `Got ${zone}.`
              : `${zone.charAt(0).toUpperCase()}${zone.slice(1)}, barely.`);
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
        case 'rip': {
          setStreak(0);
          sfxRip();
          fx.chalk(e.at, 1.4, 'rgba(255,255,255,0.8)');
          fx.perfect(e.at, '#e8564f');
          fx.kick(0.4);
          buzz([40, 20, 40]);
          reasonRef.current = e.reason;
          say('RIPPED', e.reason, 1600);
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
      if ((ph === 'climbing' || ph === 'fallen') && now >= freezeRef.current) {
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
        // The pump drains off what the body is actually doing.
        if (ph === 'climbing' && dt > 0 && !sim.fallen) {
          const { load, hands } = handLoad(sim);
          const reaching = LIMBS.some((l) => sim.limbs[l].phase === 'flying');
          const ticked = drainEndurance({
            endurance: enduranceRef.current, dtMs: dt, drain: drainRef.current,
            handLoad: load, handsOn: hands, reaching, resting: restingOn(sim, restIds),
          });
          enduranceRef.current = ticked.endurance;
          if (ticked.pumped && hands > 0) pumpOut(sim, events);
        }
        if (events.length) handleEvents(events, now);
        if (phaseRef.current === 'climbing' && isSlingSent(sim, route.finish)) celebrate(now);
      }
      fxRef.current.update(dt);

      // The bar, the word, and — on empty — a heartbeat and the edges closing in.
      {
        const e = enduranceRef.current;
        const climbing = phaseRef.current === 'climbing';
        if (baseBarRef.current) baseBarRef.current.style.transform = `scaleX(${e.base})`;
        if (pumpRef.current) pumpRef.current.textContent = pumpWord(e.base);
        const low = climbing && e.base < 0.32 ? 1 - e.base / 0.32 : 0;
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

      // Camera: follows the chest, slowly, and never jumps for a throw.
      const cam = camRef.current;
      if (followRef.current) {
        const want = clamp(pose.com.y + 0.55, 1.7, 3.6);
        cam.focusY += (want - cam.focusY) * 0.045;
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
      const windIn = selectedRef.current === 'BODY' && dynoWindRef.current ? -0.35 * Math.min(1, Math.hypot(dynoWindRef.current.x, dynoWindRef.current.y) / SLING.dynoWindup) : 0;
      scene.setCamera({ ...cam, frame: clamp(cam.frame + framePunchRef.current + windIn, FRAME_MIN, FRAME_MAX) });

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
          let dynoWind: Vec2 | null = null;
          if (pulling && !body) {
            wind = windupPos(sim, sel, { x: dx, y: -dy }, aim.power);
            limbs[sel] = wind;
            aim.from = wind;
          } else if (pulling && body) {
            // The body is the stone and every limb on the wall is band: it
            // draws back against them, they stretch, and they stay put.
            const w = dynoWindup(sim, { x: dx, y: -dy }, aim.power);
            const shift = (p: Vec2) => ({ x: p.x + w.x, y: p.y + w.y });
            pose.hip = shift(pose.hip);
            pose.shoulder = shift(pose.shoulder);
            pose.head = shift(pose.head);
            for (const id of LIMBS) if (!isBand(sim.limbs[id])) limbs[id] = shift(limbs[id]);
            dynoWind = w;
          }
          windRef.current = wind;
          dynoWindRef.current = dynoWind;

          // The ratchet: a creak every notch the band is drawn back.
          const notch = pulling ? Math.floor(aim.power * NOTCHES) : 0;
          if (notch > notchRef.current) {
            sfxStretch(aim.power);
            if (body) sfxDynoWind(aim.power);
            buzz(body ? 6 : 3);
          }
          notchRef.current = notch;

          // Aim assist runs the throw forward a few times; while the finger holds
          // still, reuse the last answer for a moment rather than every frame.
          let assist: AssistedLaunch | null = null;
          if (pulling && !body) {
            const key = `${sel}:${Math.round(dx)}:${Math.round(dy)}`;
            const cached = assistCacheRef.current;
            if (cached && cached.key === key && now - cached.at < ASSIST_REFRESH_MS) assist = cached.result;
            else {
              assist = assistLaunch(sim, route.holds, aim, 1.0);
              assistCacheRef.current = { key, at: now, result: assist };
            }
          }
          const prediction = assist?.prediction ?? null;
          // What lets go is what the arc shows: the steered throw, if it was steered.
          assistRef.current = assist?.assisted != null ? { dir: assist.aim.dir, power: assist.aim.power } : null;
          const dynoPrediction = pulling && body ? predictDyno(sim, route.holds, { dir: aim.dir, power: aim.power, wind: dynoWind ?? undefined }, 1.5) : null;
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
          assistRef.current = null;
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
      dragRef.current = { kind: 'look', startX: x, startY: y, x, y, camFocus: cam.focusY, camOrbit: cam.orbit };
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
    if (sel !== 'BODY' && assistRef.current) {
      aim.dir = assistRef.current.dir;
      aim.power = assistRef.current.power;
    }
    const dynoWind = sel === 'BODY' ? dynoWindRef.current : null;
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
      assistRef.current = null;
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
    simRef.current = initialSling(route.holds, route.start, overhangOf(route));
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
    enduranceRef.current = freshEndurance(lab0 ? capacity * 2.5 : capacity);
    juiceRef.current = freshJuice(lab0);
    juiceBoxRef.current?.classList.toggle('is-ready', lab0);
    timeScaleRef.current = 1;
    framePunchRef.current = 0;
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
          </div>
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
