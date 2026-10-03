# Boulder

A browser game about flinging your limbs at a climbing wall.

Fling. Stick. Send.

You control four limbs, one at a time. Press one, pull it back like a
slingshot, and let go. It flies, and then the rest of the body has to deal with
whatever that was. Grab the hips and pull, and the whole body goes: a dyno,
everything off the wall, one or two hands to catch it. Seventeen handcrafted
routes from V0 to V10, a route setter that will set you a new problem at any of
five difficulties, five route setters with strong opinions and poor judgement,
and a climber who is technically cooperating.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # all logic, no DOM
npm run typecheck
npm run build      # -> dist/, static, deploys anywhere as-is
npm run gen:beta   # regenerates community betas after changing routes or the sim
npm run show:routes              # prints generated routes as ASCII wall maps
npm run show:routes -- brutal 5  # five of one difficulty

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
`space` to pull on, `R` to restart). Nothing is fetched at runtime and there is no backend; progress lives in
local storage.

## Slingshot limbs

The game asks one question: can you work out where to fling the next limb
without screwing up the entire body?

**One gesture.** Press a hand or a foot, pull it back, let go. The pull is the
input: the limb fires the opposite way, as hard as you pulled. A limb can be
grabbed where it joins the body instead — a hand at its shoulder, a foot at its
hip — or by the hold it is on. Tap a limb first and pull from anywhere if your
thumb is in the way; `Q`/`W`/`A`/`S` pick limbs on a keyboard, `E` picks the
body.

**Aim assist.** A throw that is nearly at an empty hold in reach — a few
degrees off, a little short — is steered onto it, and the arc and the ringed
hold show that before you let go. The miss that was there stays in where on
the hold it lands. Anything further off flies where you pulled.

**The dyno.** It is earned. Every limb that sticks puts juice in the dyno
meter — a PERFECT about a quarter of the tank, a GOOD a sixth, a scrape next
to nothing, and a flow streak pays extra — and every whiff, slip and pump-out
drains it. Fill it and the belly lights up and breathes: the dyno is live.
Press the belly, pull, let go. The body is the stone and every limb on the
wall is a band: it draws back against them, only as far as they stretch, and
fires from there. Firing spends the whole tank, whatever happens next.
Everything leaves the wall at once and the whole body is the thing that flies —
a full one carries the hips most of two metres up and the hands nearly three,
because nothing but air slows it down;
the clock drops into bullet time over the top of the arc, embers peel off the
body, and the hands either catch something or the mat catches the climber.
It has to be precise: a hand needs a GOOD catch or better to stop a body at
that speed, and fingertips rip straight off. The preview shows the body's
arc and marks every hold as STICKS, STICKS CLEAN or RIPS before you let go.
Stick it and the wall shakes, a shockwave goes out and the screen says so;
stick it dead centre and some of the juice comes back for style. The
practice wall's dynos are free.

**Putting a limb back.** A limb that is dangling can be tapped, and then a
hold in reach can be tapped, and it goes straight on — a sound placement, never
a perfect one. A limb that is holding on has to be flung.

**Restart.** The ↺ in the corner (or `R`) puts you back at the start and
pulls straight back on. Before your first throw it is free and the onsight
survives; after it, tap twice — it counts the way coming off does, a fall on
the record and the onsight gone, so it is not a way round either.

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
their grade says. Steepness scales leg and hand authority and each shape's
grip; the route checker only knows the first part, which is what caps the
hand-set walls at about 36 degrees.

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

**Every shape has a temper, like the real ones.** On top of the angle, each
shape minds different things. A jug takes a swing, a slap and a steep wall. A
crimp wants a still body and a straight pull down, and gets far better as your
fingers do. A sloper only holds while your weight hangs still under it, and on
a steep wall it is barely a hold. A pinch is squeezed, thumb against fingers,
so it holds pulled sideways either way, and it is what overhangs are set with.
A pocket has to be found gently; stab at it at full speed and you land on the
rim. Each hold also has its own hardness, and the inspect panel names it the
way a setter would — a bucket or a shallow jug, an incut crimp or a razor, a
wide pinch or a bad one, a three-finger pocket or a mono — and says whether it
likes an overhang and whether you can swing on it.

**You get stronger.** Every attempt is a session, and sessions add up: a fall
trains a little, a send a little more, a harder route more again, and the first
send of a new V grade is a step on its own. Nothing shows it — no bar, no
number. The climber just starts sticking things that used to spit them off:
holds take more load (crimps and pockets most, jugs barely), thrown limbs reach
a few centimetres further, a full pull throws a little harder, and grabbing at
speed costs less precision, so the aim assist reaches a little wider and a dyno
hand can stop the body on slightly less than a good catch. It saturates — the
first weeks matter a lot, the hundredth session barely moves anything — and it
is not the pump, which is stamina and has its own clock. The breakthrough
screen mentions it, deadpan, when it is enough to notice. Routes, par and the
community betas are all worked out at zero strength, so everything is proven
climbable by the weakest climber.

**Moves are graded** PERFECT / GOOD / SCRAPE / MISS / YEET, on where the limb
landed against a window that shrinks with overreach, bad angles, and a poor
stance. Failure always says why.

**The pump is the clock, and the physics is what fills it.** One bar, running
from the moment you pull on. Every hand on the wall reads the load through it
in body weights, so hanging on one arm burns fast, hanging on two burns less,
and standing on your feet with slack arms barely burns at all. A fling costs a
burst, a dyno costs a chunk, a limb in the air costs more than a limb on the
wall, and a rest hold gives some back. Run it out and your hands open, and the
fall is a real one because everything is. Capacity grows with your grade and
your mileage. The practice wall gets a generous one.

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

### The route setter

`src/content/generator/` sets new problems on demand, at five difficulties —
Easy, Moderate, Hard, Very Hard and Brutal. The point is that a harder route is
a *different shape*, not the same ladder tipped back further: the question a
hard route asks is "how does this want to be climbed?", not "can you hang on".

**Archetypes.** A route is built from sections, each with a movement identity:
*slab* (wandering, small holds, lots of feet), *zigzag* (repeated changes of
direction; on hard routes it staircases across the wall), *traverse* (a hold
rail running sideways, feet underneath), *roof* (in under it, out along pinches
with the feet up high, then over the lip to a jug), *overhang* (big moves
between good holds, feet every other move), *dihedral* (hands on opposing walls
pulling in, feet stemmed wide), *crack* (a narrow split, everything pulled
toward the middle), *arête* (hands on an edge, feet out on the face, swapping
sides halfway) and *compression* (two lines of holds too wide to pull on —
squeeze them). None of these labels are shown on the wall; the board just says
which parts a route has.

**Difficulty combines archetypes.** `difficulty.ts` is one table. Easy is one
or two rising sections on jugs, no cruxes, nothing sideways. Moderate links two
different sections, one of them a zigzag, traverse or arête. Hard
links two or three, must include a traverse or roof, and always has one crux.
Very Hard links three and must include a traverse *and* a roof or steep
section. Brutal links four — traverse, zigzag, roof or steep, and something
technical — with two cruxes, the last of them near the top. The same table
sets zigzag widths, traverse lengths, how long the route may go sideways
before it has to go up, hold shapes and hardness, foot density, and a pitch
range that runs from near-vertical on Easy to well past 20 degrees on the top
two tiers; roofs and steep sections add six degrees each on top.

**Cruxes.** Not every move is hard. A crux is two or three moves inserted into
the plan — a long *span* sideways off small holds, a *reversal* where the next
hold is back the way you came, a *drop* down and across before you are allowed
up, a *lunge* between bad holds, or a *squeeze* of three bad holds with almost
nothing for the feet. The last crux goes 60–95% of the way through the route,
and the move before it is a jug — a marked rest on the two hardest tiers — so
you reach it thinking you have this.

**The line crosses the wall once.** Hard routes start near one edge and drift
toward the other; sideways sections share out the width that is left between
them. On a wall this short, anything set above an earlier section is in reach
of it, so a route that doubled back would just be climbed straight up the
middle. Reversals are local and deliberate — they are cruxes.

**Validation.** Every candidate is checked before anyone sees it, cheapest
first: real data, nothing off the wall or overlapping, a start that stands,
a finish at the top, no gap along the line longer than a limb; a shape that
suits the tier (enough sideways travel and direction changes, not too wide,
not too noisy); then the same headless climber that proves the hand-set
routes go has to send it, *and* the send has to follow the route — touching
nearly every section and covering most of the line's width — rather than
finding a shortcut round it. Rejected candidates are thrown away and the next
seed is tried; geometry is cheap, so up to 400 candidates, but only a handful
get climbed, and every four failed climbs the setter backs the route off a
notch (more feet, softer holds, smaller zigzags). Par comes from the send,
tightened by dropping every move it can do without.

**Determinism.** A generated route's id records the seed and notch that
passed, plus its par, so the route can be rebuilt from the id alone without
climbing it again — that is how records and the setter's "last route" survive
a reload. Generation runs on worker threads (one for the route you asked for,
one quietly setting the next one at the same difficulty, so *Set another* is
usually instant).

**Progression.** Generated routes are scored, kept in your records and show
personal bests, but they never move your grade or open new rungs on the board
— a route you can reroll until it suits you does not get to do that.

**Camera.** Routes that use the whole wall would run off a phone screen, so
the camera now follows the climber sideways as well as up, as far as the wall
goes, and starts on the start holds.

## What is not built

- **No backend.** Standings are local to the device and say so. The community
  betas are sequences the route-checker found, not lines real people took, and
  the send screen says that too. Both are shaped like what a server would send.
- **No community betas for generated routes.** They are set on the device, so
  there is nobody else's beta to compare against.
- **One wall.** Routes name their wall, so more can be added without touching
  the sim.

## Tests

```
src/game/sling.test.ts     the body: picking limbs, the pull, launches, dynos,
                           putting limbs back, catching, missing, slipping,
                           swinging, rotating, falling, the honest preview,
                           dynos that rip off on fingertips, and that nothing
                           drains
src/game/juice.test.ts     the dyno meter: earned by clean sticks, drained by
                           whiffs, fired only when full, emptied by firing
src/game/sim.test.ts       the validator's static solver and move resolution
src/game/feel.test.ts      flow streaks, the shout, and the introductory labels
src/content/routes.test.ts every route: valid data, inside the wall, a start
                           that stands up, a finish near the top, actually
                           climbable, and a par a clean climb could hit
src/content/generator/generator.test.ts
                           generated routes at every difficulty, end to end:
                           the same checks as the hand-set routes, an
                           independent send, rebuilt identically from the id,
                           deterministic per seed; and over hundreds of
                           candidates per tier, that harder tiers go further
                           sideways with more direction changes, combine more
                           archetypes, get traverses, roofs and cruxes at the
                           right tiers with the last crux late, vary from one
                           route to the next, and never move your grade
```
