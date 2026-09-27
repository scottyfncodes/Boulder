# Boulder

A browser game about flinging your limbs at a climbing wall.

Fling. Stick. Send.

You control four limbs, one at a time. Press one, pull it back like a
slingshot, and let go. It flies, and then the rest of the body has to deal with
whatever that was. Grab the hips and pull, and the whole body goes: a dyno,
everything off the wall, one or two hands to catch it. Fourteen handcrafted
routes from V0 to V7, five route setters with strong opinions and poor
judgement, and a climber who is technically cooperating.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 188 tests, all logic, no DOM
npm run typecheck
npm run build      # -> dist/, static, deploys anywhere as-is
npm run gen:beta   # regenerates community betas after changing routes or the sim

# Needs a browser and a running dev server, so it is not part of npm test:
npm run check:overlay   # asserts the 2D overlay agrees with the 3D scene
```

`check:overlay` exists because the overlay draws on its own canvas with no depth
buffer to keep it honest. If it and the renderer disagree about how far a thing
stands out of the wall, every marker sits slightly off the thing it marks — and
on a pitched wall that offset rotates into a vertical one that grows with the
angle. `src/render/depths.ts` is the single set of numbers both sides read.

Mobile-first — it is built for iPhone Safari and works with a mouse, trackpad
and keyboard on desktop (`Q`/`W` for hands, `A`/`S` for feet, `E` for the body,
`space` to pull on). Nothing is fetched at runtime and there is no backend; progress lives in
local storage.

## Slingshot limbs

The game asks one question: can you work out where to fling the next limb
without screwing up the entire body?

**One gesture.** Press a hand or a foot, pull it back, let go. The pull is the
input: the limb fires the opposite way, as hard as you pulled. Tap a limb first
and pull from anywhere if your thumb is in the way; `Q`/`W`/`A`/`S` pick limbs
on a keyboard, `E` picks the hips.

**The dyno.** Press the hips, pull, let go. Everything leaves the wall at once
and the whole body is the thing that flies; the hands lead and either one of
them catches something on the way past or the mat catches the climber. The
preview shows the body's arc and says whether it will be one hand or both.

**Putting a limb back.** A limb that is dangling can be tapped, and then a
hold in reach can be tapped, and it goes straight on — a sound placement, never
a perfect one. A limb that is holding on has to be flung.

**No clock.** Nothing drains. Stop, look, aim, change your mind, aim again.
The difficulty is the physics, the holds, and the shape your body is in.

**The body is a live thing.** Hip and shoulder are particles on a rigid torso.
Each arm is a rope from the shoulder to the hand; each leg is a strut from the
hip to the foot that pushes when the foot is below you and rocks you up when
it is level with you. A launched limb flies under gravity until its tether
goes taut, at which point the body gets yanked after it — that is the reach,
and a big throw with a bad stance takes the rest of you somewhere. Let go with
everything and you swing. Swing hard enough and holds let go.

**Holds catch what passes through them.** A limb in flight grabs a hold where
it passes closest to its centre, and is graded on which part of the shape it
found, exactly as before. A hand will not grab a foot chip. The hold you just
let go of will not grab you back. A limb that catches nothing dangles, and a
dangling limb does not grab anything — you fling it again.

**Holds care how you load them.** Every attached limb reads the load through
it, in body weights, and compares it against what that shape can take from
that direction: a jug takes a swing, a crimp does not, and an undercling with
your hips below it lets go at once. The face still says how it is going.

**The preview is honest.** While you pull, the arc on screen is the launch run
forward on a copy of the body — tether, yank and all — so what it shows is
what will happen. If something else is going to let go because of the throw,
it says so.

**The practice wall.** The route board has a *Sling Lab* at the top: a wall
with one of everything on it, set so short throws, long throws, diagonals,
misses, swings, rotation, dynos and recovery can all be tried in a minute. It
is not graded, scored or counted.

**Known limits.** The sim is planar, so the body never peels away from the
wall in depth; a barn door is a swing, not a rotation out of the plane. Routes
were set before the physics existed and some will be harder or easier than
their grade says. Steepness only scales leg and hand authority.

## How the game works

**Aim is honest.** The trajectory you see is the trajectory the sim uses, the
reach ring is the exact distance past which the limb cannot arrive, and the
landing reticle is where the limb will actually land. The game is hard because
holds are small and bodies are awkward, not because the interface is lying.

**Holds care how you load them.** The direction of force through a hold comes
from where your weight actually is, so an undercling is useless with your hips
below it and solid once they are above it, and a sidepull wants tension across
the body rather than a straight pull. Ten shapes, each with its own patience
for a bad angle. The inspect panel tells you what a shape is and what it wants;
it never tells you which one to use.

**Moves are graded** PERFECT / GOOD / SCRAPE / MISS / YEET, on where the limb
landed against a window that shrinks with overreach, bad angles, and a poor
stance. Failure always says why.

**Nothing is the clock.** There is no endurance bar, no pump and no timer.
Stop, look, aim, change your mind. The difficulty is the physics, the holds
and the shape your body is in.

**The climber is Bernie.** Teal jacket, striped shirt, cream slacks, moustache,
and sunglasses he is not taking off. Technically present, which is the same joke the original brief wanted from the Weekend at
Bernie's reference: a body being hauled up a wall that it is not especially
invested in. He is not dead, he is just extremely relaxed about all of this.
There is no character customisation — he is who he is.

The sunglasses are opaque. You never see his eyes, which means the brows and
the mouth carry every bit of the expression on their own — the ranges are wider
than they would otherwise be, and one brow raised higher than the other is
doing a lot of the work.

He hangs like cargo. Limbs off the wall dangle at nearly full length and swing
on their own slow pendulum, the head lolls on a spring that lags whatever the
body just did and keeps going after it stops, and a fall is a tumble with all
four limbs trailing rather than a climber trying to land.

**He faces the wall; his head does not.** What the camera sees is a climber's
back — chalk bag, shoulder yoke, toes pointing into the wall — with the head
turned back over the shoulder so the face stays readable. A quarter turn reads
as looking round; pointing it straight out would read as a head mounted
backwards. When something actually happens the head snaps most of the way to
camera, which is where the joke lives.

**The face is the strain readout.** There are no coloured lines on the wall
telling you a limb is loaded, because that is not how you read it off another
climber. There is no anger in it and no misery — the worse things get, the more
delighted and astonished he is that any of it is happening to him. Effort runs
from a small smile through impressed, surprised and astonished to a full
open-mouthed whoop, and the brows only ever go up.

**Falling is informative.** A whiffed limb visibly flies where you actually
aimed it and the body does whatever that made it do, so a spectacular failure
still shows you the mistake that produced it.

**It should feel like something.** Every sound is synthesised on the spot —
there are still no assets and nothing is fetched. A throw whooshes, a catch
slaps, and a clean catch chimes on a pentatonic scale that climbs one note for
every clean placement in a row, so a good run is audible before you look at the
FLOW counter. A PERFECT holds its contact frame for 70ms, throws chalk and a
ring off the hold, and knocks the camera; a fall whistles on the way down and
thuds into the pad with dust and a shake scaled to the height. When the tank is
nearly empty a heartbeat starts and the edges of the screen close in. A send
gets confetti, a fanfare and two seconds to enjoy it before the scorecard, which
counts up. On phones that support it, all of this buzzes too. There is a mute
button, and none of it touches the sim — flow scores nothing, because the score
already rewards clean placements once.

## Architecture

```
src/game/      the sim — pure, deterministic, no DOM, no React
src/game/sling.ts   the body: particles, tethers, launches, dynos, catches, slips
src/content/   routes, setters, wall, generated community betas — plain data
src/render/    three.js scene, the climber rig, the aiming overlay
src/state/     profile, progression, local persistence
src/ui/        React screens
```

### The slingshot body is the same two particles, moving

`src/game/sling.ts` runs the same hip and shoulder on a fixed 120 Hz step with
position-based constraints: the torso is rigid, arms are ropes, legs are
struts, attached limbs are pinned to their holds. Forces on top: gravity, a
core torque that keeps the torso upright while a hand is on, a righting pull
toward whatever is holding you up, leg push with damping so a fresh foot
stands you up rather than bouncing you off, and a small lock-off pull on the
arms. The load through each hold is read off the net constraint impulse, in
body weights, and a hold that is asked for more than its shape and angle can
give lets go. It is deterministic and the aim preview is a copy of it run
forward.

### The route validator's body is two particles

Hip and shoulder, joined by a rigid torso, relaxed against whichever limbs are
on holds over a fixed iteration count. Legs are struts rather than tethers, so
standing a foot up genuinely raises the hip, which raises the shoulder, which
is what puts the next hold in range. Limbs are coupled through the solver
rather than through authored rules, so the sequencing puzzles fall out of the
physics instead of being written down.

Constraints are solved in parallel and averaged, not applied in sequence.
Sequential solving makes the answer depend on the order limbs happen to be
stored in, which tilts a symmetric stance by twenty degrees.

### Determinism is a contract

There is no randomness anywhere in move resolution. Repeat a throw from a
stance and you get the same answer, every time. That is the only way a game
about execution is fair enough to learn from, and it is what makes betas
replayable. The seeded RNG exists only to pick the daily route, which has to be
the same for everyone.

### Routes are data

Nothing in `src/game/` knows any route exists. Adding a hundred more means a
hundred more entries in `src/content/routes.ts` and no game code changes.

Every shipped route is verified climbable at test time by a headless beam-search
climber (`src/game/autoplay.ts`) that never shifts its weight — so every route
is provably climbable on limb placements alone, and body positioning is how you
climb it *better* rather than something par quietly depends on. That solver also sets par — par is what it
found, plus room for a human — and generates the alternative betas the send
screen compares you against. It caught seven unclimbable routes and two real
sim bugs during the build, which is most of why it exists.

## What is not built

- **No backend.** Standings are local to the device and say so. The community
  betas are sequences the route-checker found, not lines real people took, and
  the send screen says that too. Both are shaped like what a server would send.
- **No procedural generation.** The generator hook is there and the validator
  it would need already exists, but handcrafted routes are the primary content
  and generated ones would need to clear the same bar before shipping.
- **One wall.** Routes name their wall, so more can be added without touching
  the sim.

## Tests

```
src/game/sling.test.ts     the body: picking limbs, the pull, launches, dynos,
                           putting limbs back, catching, missing, slipping,
                           swinging, rotating, falling, the honest preview, and
                           that nothing drains
src/game/sim.test.ts       the validator's static solver and move resolution
src/game/feel.test.ts      flow streaks, the shout, and the introductory labels
src/content/routes.test.ts every route: valid data, inside the wall, a start
                           that stands up, a finish near the top, actually
                           climbable, and a par a clean climb could hit
```
