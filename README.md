# Bruh

A browser game about flinging your limbs at a climbing wall.

Fling. Stick. Send. Try not to get pumped.

You control four limbs, one at a time. Press one, pull it back like a
slingshot, and let go. It flies, and then the rest of the body has to deal with
whatever that was. Grab the hips and pull, and the whole body goes: a dyno,
everything off the wall, one or two hands to catch it. Holds are not all the
same: a jug takes a swinging body, a crimp wants your feet on, a sloper wants
your weight under it and a wall that is not tipping it away. What a climb costs
is how you climbed it, and the pump bar is the bill.

Three ways to climb:

- **Bouldering** — twenty handcrafted routes from V0 to V10, fourteen long ones
  up a tall cave that bends into roofs, and a route setter that will set you a
  new problem at any of seven difficulties, graded by what its moves ask for.
- **Highball** — six tall problems on a ten-metre tower, each with its own
  character, a landing spelled out before you commit, and a fall that is
  judged by how far it was and what was under you.
- **Tread Wall** — a wall on a belt that never ends. Stay on as long as you
  can; the score is time on the wall, against your own best.

Five route setters with strong opinions and poor judgement, and a climber who
is technically cooperating.

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
npm run playtest                 # the climbing bot plays every route, prints the pump
npm run playtest -- --human cave # at a person's pace, just routes matching 'cave'
npm run gen:grades     # re-assesses the curated routes after changing them or the physics
npm run fit:grades     # refits the grader's weights against the setters (needs numpy)
npm run find:highballs # searches seeds for the highball tiers

# Needs a browser and a running dev server, so it is not part of npm test:
npm run check:overlay   # asserts the 2D overlay agrees with the 3D scene
npm run smoke           # plays all three modes in Chromium (needs `npx vite preview --port 4173`)
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

**Aiming holds the world still.** From the moment you grab a limb or the
belly until you let go, the body stops moving — the arc you are reading is the
throw, not the last move settling — and the pump keeps counting from the
position you are holding, so taking your time still costs. (If something is
already in the air, it has to land first.) The pull snaps to a fine grid, half
a degree and a hundredth of the power, and only moves to the next notch when
the finger is clearly into it: the same finger position is always the same
throw, and letting go fires exactly the arc on screen
(`src/game/aimSearch.ts`).

**Reaching for a hold.** Every hold inside the reach outline is in play. The
pull picks one: its direction says where, how hard says how far — a light pull
takes the near hold that way, a full one the farthest the body can get to —
and the limb goes to that hold, whatever is in front of it, the body moving
into the position that gets it there. The hold it is going for is marked
before you let go, and stays picked a little past where it took to pick it,
so it does not flicker. A hold another limb is on is only picked when the pull
points straight at it. A pull at nothing in reach is a plain throw: it flies
where you pulled, and a throw that is nearly at a hold is still steered onto
it.

**Room to pull.** A full pull is shorter when you start it low on the screen —
never under half the usual — and shorter for a foot, which needs less of a
fling than an arm; picking a foot up also drops the camera, so the foot is not
sitting on the bottom edge with nowhere to be pulled back to.

**A steady pull.** The drag is lightly smoothed, and letting go fires the aim
you settled on a moment before lift-off, not wherever rolling your thumb off
the glass dragged it.

**The dyno.** It is earned. Every limb that sticks puts a fifth of a tank of
juice in the dyno meter, a flow streak pays extra, and every whiff, slip and
pump-out drains it. Fill it and the belly lights up and breathes: the dyno is live.
Press the belly, pull, let go. Drawing it down pulls the camera back up the
wall — further the harder you pull — so the holds it can reach are on screen to
pick from; it stays wide while you fly and eases back in once you stick. A full
one sends the hands nearly three
metres up the wall: it is for skipping a section, not saving a reach. The
hands sail past whatever they meet while they are still going up fast and
only close near the top of the jump, the deadpoint, so how hard you pull is
how you pick the hold: a light one for the holds overhead, everything for the
one at the top. The body is the stone and every limb on the
wall is a band: it draws back against them, only as far as they stretch, and
fires from there. Firing spends the whole tank, whatever happens next.
Everything leaves the wall at once and the whole body is the thing that flies;
the clock drops into bullet time over the top of the arc, embers peel off the
body, and the hands either catch something or the mat catches the climber.
The preview shows the body's arc and marks the holds it STICKS before you let
go. A dyno costs a big bite of pump — more the harder you pull and the steeper
the wall — and catching a body in flight costs more, double on one hand; it is
how you skip a roof, not a free lunch. Stick it and the wall shakes, a
shockwave goes out and the screen tells you how many metres you just went; the
bigger the dyno, the bigger all of that gets, and some juice comes back, more
for every metre past the first. The practice wall's dynos are free.

**Putting a limb back.** A limb that is dangling can be tapped, and then a
hold in reach can be tapped, and it goes straight on. A limb that is holding on
has to be flung.

**Seeing your reach.** Pick up a limb and the camera zooms in or out and
moves to show every hold that limb can get to, so the whole choice is on
screen; put it down and the view eases back. Pinch to zoom the view yourself
(the mouse wheel does the same on a desktop).

**Restart.** The ↺ in the corner (or `R`) puts you back at the start and
pulls straight back on. Before your first throw it is free and the onsight
survives; after it, tap twice — it counts the way coming off does, a fall on
the record and the onsight gone, so it is not a way round either.

**The pump is the currency.** There is no clock, but the forearms are one:
the bar fills from the moment you leave the ground, by how hard the position
you are in is, and it is the thing you are managing the whole way up. See
*The pump* below.

**The body is a live thing.** Hip and shoulder are particles on a rigid torso.
Each arm is a rope from the shoulder to the hand; each leg is a strut from the
hip to the foot that pushes when the foot is below you and rocks you up when
it is level with you. A launched limb flies under gravity until it is at full
length, and then the body goes after it — hips shift, the torso leans, the
climber moves their weight — for as long as the limb is still going the way
it was thrown and the limbs still on the wall let the body follow. There is
no fixed point it swings round. A reach that lands leaves the climber where
the move put them, which is what decides the next one; a reach that catches
nothing leaves the limb dangling and the body pulls back in to where it
reached from. A big throw with a bad stance still takes the rest of you
somewhere. Let go with everything and you swing. Swing hard enough and holds let go.

**The ground is for falling onto.** Nobody stands on the mat: the climber
starts on the start holds, and while anything is still holding on, a hand or
foot that is off the wall stays clear of the floor — a dangling leg folds at the
knee, and a throw at the floor stops short of it. Only a fall, with nothing
left on, puts a limb on the ground.

**Reaching a hold is not holding it.** A limb in flight that gets to a hold
closes on it — and then the hold has to take what you ask of it. Every contact
lives through states you can see: *searching* while it flies, *establishing*
for a moment after it lands (a ring that shrinks onto the hold), *engaged*,
*loaded* (a thin arc that fills amber, then red, as it nears its limit),
*slipping* (it flickers — get a foot back on, or move), and *released*. A hand
will not grab a foot chip, and the hold you just let go of will not grab you
back.

**What a hold can take** (`src/game/grip.ts`) is worked out every step, in
body weights, from:

- *its shape* — how positive it is (fingers behind an edge) against how much is
  friction; a jug takes a swinging body on one arm, a crimp a still one, a
  sloper not much;
- *its size* — which matters a lot to an edge and hardly at all to a jug;
- *how it is loaded* — the direction your body pulls it from, so an undercling
  is useless with your hips below it and a sidepull wants your body across it;
- *the wall* — friction holds lose most of themselves as the wall leans out,
  and are best on slab; positive holds barely notice;
- *your forearms* — a pumped hand closes on less, gradually, long before it
  opens on its own;
- *how you arrived* — a catch ramps up over a fifth of a second, slowly for a
  sloper, at once for a jug, so a body arriving fast on a bad hold leaves
  again. Arriving slow, at the top of a dynamic move, is a deadpoint.

What the hold is asked for is what each hand is really carrying: the share of
your weight your feet do not take (worse feet, steeper wall or a stretched
stance all leave more on your hands), split by where your weight hangs, plus
whatever a swing or a catch adds. Over capacity a contact does not vanish in a
frame — it starts to slip, faster the further over it is, and comes back if
you take the load off it in time.

**Feet slip too.** A foot pushes on its hold; a foot on a sloper or a smear on
a steep wall skates under a hard push, and keeping feet on steep ground is the
core's job.

**Technique is read off the body** (`src/game/technique.ts`), never pressed as a
button, and each one changes the forces: a **flag** (a free foot thrown out to
the side presses on the wall and counters the barn door), a **smear** (a foot
thrown at blank wall below the hips stands on rubber, not too steep), a **drop
knee** (a foot level with the hips and out wide on a steep wall carries weight
a flat foot could not), **heel and toe hooks**, a **high step**, a **mantle**
(pressing down on a hold below the shoulders), **gastons, underclings and
sidepulls** loaded the way they work, **compression** (two hands on holds that
face each other squeeze, so each can point its force where gravity alone would
peel it off), **stemming**, **matching**, a **foot swap** (a foot can take the
other foot's hold; the other one hops off), a **deadpoint**, and **cutting
loose**. The ones in use are named quietly under the pump bar.

**Any limb can hold you.** A foot on a hold above your hips, or anywhere on a
roof, is a heel or toe hook: let go with both hands and the body hangs off it.

**The wall bends.** A route can start vertical, kick back into a roof, come
out over a lip onto a slab and go steep again to the top. The sim works on the
wall unrolled flat; the physics reads the lean wherever the body is, and the
renderer rolls everything — panels, holds, the climber, the overlay's markers —
back up into the real shape. The route map shades the steep bands.

**The preview is honest.** While you pull, the arc on screen is the launch run
forward on a copy of the body — tether, yank and all — so what it shows is
what will happen. If something else is going to let go because of the throw,
it says so.

**The practice wall.** The route board has a *Sling Lab* at the top: a wall
with one of everything on it, set so short throws, long throws, diagonals,
misses, swings, rotation, dynos and recovery can all be tried in a minute. It
is not graded, scored or counted.

**Known limits.** The sim is planar, so the body never peels away from the
wall in depth; a barn door is a swing, not a rotation out of the plane, and on
a roof the body lies along the underside rather than hanging straight down
from it. Steepness costs pump and takes authority off the legs; it does not
change which way gravity pulls in the wall's plane.

## How the game works

**Aim is honest.** The trajectory you see is the trajectory the sim uses, the
reach outline is the edge of where the limb can get to with the body following
it (`src/game/reach.ts` solves it from what is still on the wall), and the
landing reticle is where the limb will actually land. The game is hard because
holds are small and bodies are awkward, not because the interface is lying.

**Holds care how you load them.** The direction of force through a hold comes
from where your weight actually is, so an undercling is useless with your hips
below it and solid once they are above it, and a sidepull wants tension across
the body rather than a straight pull. Ten shapes, each with its own patience
for a bad angle. The inspect panel tells you what a shape is and what it wants;
it never tells you which one to use.

**A move sticks or it misses.** Failure always says why.

**The pump.** This is the game's currency, and the question every route asks
is how much pump you spend for the height you gain. Nothing about it is
per-hold: it is read off your body, every frame (`src/game/pump.ts`). Each
forearm has its own pump; the bar shows the worse one — the one about to let
go — and fills as it goes, green to red. A faint tick on the bar is the other
arm.

Every frame each forearm gets an *effort*, and above a rest line it fills;
below it, it drains. Roughly, effort is *wall × limbs × feet × movement*, all of
it continuous — no thresholds, so a small shift in the body is a small change
in the rate:

- *The wall where you are.* `1 + 3 × lean^1.6`, lean being the sine of the
  angle: gentle off the vertical, then hard. At a roof a forearm is carrying
  four times what the same grip costs on a vertical wall.
- *What is holding you.* Each foot counts for how good a foot it is, from where
  it is against the body: under the hips and in reach is a foot you stand on;
  hauled up by the hip, at full stretch or way off to the side, it is only
  touching. Standing feet do less the steeper the wall; hooks pull and keep
  working upside down. Whatever the feet leave is the arms' load, split
  between the hands by where the body hangs between them — the hand nearer
  under the weight takes more — and squared per hand, so one hand holding it
  all costs far more than two sharing it.
- *Moving.* Swinging and a limb in the air cost, and recovery needs a still
  body. A throw costs a burst by how hard you pulled, more off a steep wall and
  more with only one limb left on; a dyno costs a big bite, all at once,
  which on a bad sequence is often cheaper than climbing it; stopping a moving
  body on a catch costs the catching arm by the square of its speed.

What that comes to, in % of the bar per second, from a settled stance:

| | vertical | 30° | 60° | 75° | 90° |
|---|---|---|---|---|---|
| four on | −1.4 | −0.8 | −0.2 | +0.2 | +0.3 |
| three on (a foot off) | −0.8 | +0.2 | +1.5 | +2.0 | +2.3 |
| one hand, one foot | +0.3 | +1.9 | +4.4 | +5.7 | +6.4 |
| two hands, feet cut | +0.8 | +2.2 | +4.0 | +4.6 | +4.8 |
| one hand | +4.6 | +9.6 | +16.7 | +19.0 | +19.8 |
| shaking out, both feet on (one arm off, alternating) | −2.4 | −1.7 | −0.3 | +0.1 | +0.3 |

**Resting is taking weight off your hands.** There is no rest button and no
timer: stand somewhere your feet carry you and the bar comes down while you
stay there, faster the better the stance and the stiller you are, slower the
deeper the pump. **Shaking out** is the same idea one arm at a time: tap a
picked-up hand again (or press X) and it comes off the hold and hangs by your
side. A hanging arm recovers about twice as fast as one resting on a hold —
but the other arm is holding everything meanwhile, and recovery needs the rest
of you calm, so it only works where the feet can take it. On a vertical or
gently steep wall with both feet on, *shake one, put it back, shake the other*
recovers about twice as fast as hanging there; with one foot, or no feet, or
under a roof, it is worthless or worse. Tap a hold to put the hand back.

A share of every effort stays for the rest of the climb (the hatched start of
the bar), so a rest buys time and never a free climb. The bar reads *fresh →
pumped → struggling → critical*; while it is coming down the track glows green,
a sheen runs back along the bar, faster the faster it is draining, and there
is one quiet breath out as the rest begins. The line underneath says why
("recovering · shaking out", "burning · one hand, roof"). When a forearm has
nothing left, that hand opens on its own. Fitness grows a little with your grade
and mileage; the practice wall is generous.

**Tuning it.** `src/game/climbBot.ts` plays routes in the real physics with the
real pump and dyno meter — a careful style that keeps feet on, throws soft and
shakes out where it can, and a reckless one that throws big and dynos whenever
the meter allows — looking one move ahead in a copy of the sim. `npm run
playtest` prints what each did. Easy routes stay fresh unless you climb them
sloppily; on the hard ones pump is what decides the send, and resting on the
slab above a roof, or dynoing past it, are both real answers.

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
src/game/reach.ts   free reach: where a limb can get to with the body following it
src/game/pump.ts    the pump: effort from the wall, the limbs on, and moving
src/game/profile.ts the wall's shape: where it bends, how far it leans
src/game/climbBot.ts a climber that plays the real game, for tuning
src/render/fold.ts  rolls the flat wall back up into its bent shape
src/game/aimInput.ts the finger, steadied: smoothing and the release lock
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

`src/content/generator/` sets new problems on demand, at seven difficulties —
Easy, Moderate, Hard, Very Hard, Brutal, Elite (V11–V13) and Mythic (V14–V17). The point is that a harder route is
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
which parts a route has. A *roof* or *overhang* section bends the wall under it
— 55–72° for a roof, 30–44° for a steep section, eased on long stretches — and
it comes back to the route's own lean over the top, so the pump does the rest.

**Difficulty combines archetypes.** `difficulty.ts` is one table. Easy is one
or two rising sections on jugs, no cruxes, nothing sideways. Moderate links two
different sections, one of them a zigzag, traverse or arête. Hard
links two or three, must include a traverse or roof, and always has one crux.
Very Hard links three and must include a traverse *and* a roof or steep
section. Brutal links four — traverse, zigzag, roof or steep, and something
technical — with two cruxes, the last of them near the top. Elite links five
and Mythic five or six, each with a traverse, a roof and a zigzag, two or three
cruxes, and a lot more wall. Every tier has a `top`, the height its line tops
out at — 3.66 m for Easy, then 3.9, 4.3, 4.8, 5.3, 6.0 and 6.8 m — so the
harder the route, the further up the cave it goes and the more moves it takes:
about twelve hand moves on an Easy route, thirty-odd on a Mythic one, on the
same 3.4 m of width. Inside a tier the grade goes to the busier route and the
longer one. The same table
sets zigzag widths, traverse lengths, how long the route may go sideways
before it has to go up, hold shapes and hardness, foot density, and a modest
pitch range; roofs and steep sections add a few degrees, and that is the only
way pitch moves much.

**Cruxes.** Not every move is hard. A crux is two or three moves inserted into
the plan — a long *span* sideways off small holds, a *reversal* where the next
hold is back the way you came, a *drop* down and across before you are allowed
up, a *lunge* between bad holds, or a *squeeze* of three bad holds with almost
nothing for the feet. The last crux goes 60–95% of the way through the route,
and the move before it is a jug — somewhere to get your breath, if your feet are on — so
you reach it thinking you have this.

**The line crosses the wall once.** Hard routes start near one edge and drift
toward the other; sideways sections share out the width that is left between
them. On a wall this narrow, anything set just above an earlier section is in reach
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
— a route you can reroll until it suits you does not get to do that. The
exception is the top of the board: V11 to V17 were set by the generator,
validated once, and pinned in `routes.ts` by their generator ids under names
of their own. They rebuild from the id at load, count like any board route,
and a test checks each one still rebuilds hold for hold and still goes.

**Camera.** Routes that use the whole wall would run off a phone screen, so
the camera now follows the climber sideways as well as up, as far as the wall
goes, and starts on the start holds.

## The body's budget

The pump is grip endurance. Underneath it (`src/game/fatigue.ts`):

- **Power** — short-term pulling. Big throws and dynos spend it, lock-offs
  wear it down, and it comes back in seconds once you stop throwing. Tired
  arms throw shorter: the same pull is less of a throw, and the preview shows
  it, because the preview runs the same tired body.
- **Core** — body tension. Steep ground, cutting loose, toe hooks and
  squeezing cost it; standing upright on good feet gives it back. Low core
  makes feet slip on steep walls and the torso harder to hold still.
- **Breath** — general exertion, smoothed over half a minute. It stops
  nothing on its own; it slows every other recovery, and you can hear it.

The forearms also pay for the hold: the same load on a hold you have to
squeeze costs more than on a jug, and hanging on something you are about to
lose costs most of all. That is overgripping, priced. None of it is a switch.

## Grades come out of the moves

`src/game/grading.ts` replays a route's sequence through the static body and
measures every stance and every move with the same grip and pump functions the
live physics uses: how close each hand is to its hold's limit (with the moving
limb off, and after it lands), how far the reach is against the limb, how
forgiving the target is to arrive on, which techniques the stance needs, how
steep the wall is, how pumped a paced climber is at each move, how many tanks
of pump the whole thing costs net of its rests, how much the sequence changes
its mind, and how many distinct ways up are known. The crux matters most;
endurance, complexity and steepness next; more solutions make it easier.

The weights were fitted by least squares against the setters' grades of the
hand-set routes (`npm run fit:grades`, needs numpy) and then frozen — rank
correlation 0.94 on the hand-set routes. Route-setter routes take the assessed
grade (kept to their tier, give or take one). Curated routes keep their
setter's grade and show the assessment beside it on the board
(`npm run gen:grades`); where they disagree the card says so in amber. Notably
the long board routes published at V11–V17 assess at V9–V15: their length is
real endurance, but their moves are not that hard. Treat every grade as
provisional and the fit as the thing to retune with play data.

## Highball

Six problems on **the Tower** (`src/content/highball.ts`), eight to nine and a
half metres tall, set by the route setter's own section builders from their own
rules and frozen to seeds the solver has proven go: a technical slab, steady
climbing to a crux at the very top, a power-endurance pinch line with no rest,
a steep start under a crimpy headwall, a compression test piece, and a roof
halfway up with the whole tower above it. The climbing does not change at
height — same body, same holds, no hidden penalties. What changes is the
presentation and the consequence: the camera eases out as you go up, a metre
ruler runs up the side, a wind bed rises with you, and the landing is a stack
of highball pads (two or three, with or without a spotter) that is good for a
fall from so high and no higher. A fall is judged from where you came off and
where you land: onto the pads from a height they are good for is fine; heavier
than that, or off the pads, and the game asks you to take a breath — a few
seconds' countdown — before the next go. Nobody gets hurt. Highball sends are
their own tick list and do not open boulder grades.

## Tread Wall

A wall on a belt (`src/game/tread.ts`): it rolls down as you climb, so you stay
put and the climbing never ends. In the sim the holds are fixed and the floor
rises at the belt's speed, which is the same thing; the renderer scrolls the
panels so it looks like a treadwall. Three programs — Warm-up (5°), Classic
(15°) and Steep (30°) — each with its own belt speed and leaderboard. The belt
never stops, not even while you aim.

The holds come from a stream of two-metre sections, each with a job: a jug
ladder to recover on, a crimp line, a pinch column, sloper steps, gaston
zig-zags, an undercling stack, a diagonal, a section of big moves. Harder on
average as the session goes on, never every section harder than the last, a
recovery ladder every few sections and sooner if you are pumped, never the
same kind three times running, feet under at least every other hand, and no
hand move longer than a limb. Tests prove stretches of every program, early and
at their hardest, go for the solver or the real-physics climbing bot.

A session ends when you come off, pump off, the floor reaches your hips, or
you step off. You cannot win by hanging still — the floor catches you in under
half a minute — and you only recover where your feet take the weight. The
result shows time on the wall, distance, holds caught, the hardest section
reached, pace, time spent recovering and peak pump, against your personal best
and a local top five per program, kept in the same local save as everything
else.

## What is not built

- **No backend.** Standings are local to the device and say so. The community
  betas are sequences the route-checker found, not lines real people took, and
  the send screen says that too. Both are shaped like what a server would send.
- **No community betas for generated routes.** They are set on the device, so
  there is nobody else's beta to compare against.
- **Two walls.** The cave and the tower. Routes name their wall, so more can
  be added without touching the sim.
- **Still planar.** Hip rotation, drop knees and flags change the forces and
  the reach the way they would, but the body never twists out of the wall's
  plane, and the rig does not draw a turned hip.

## Tests

```
src/game/sling.test.ts     the body: picking limbs, the pull, launches, dynos,
                           putting limbs back, catching, missing, slipping,
                           swinging, rotating, falling, the honest preview,
                           dynos that stick wherever a hand gets, and that nothing
                           drains
src/game/juice.test.ts     the dyno meter: earned by clean sticks, drained by
                           whiffs, fired only when full, emptied by firing
src/game/aimInput.test.ts  the steadied pull: tremor smoothed out, sweeps kept,
                           lift-off smear ignored
src/game/aimSearch.test.ts aiming: the grid, sticky notches, the same answer for
                           the same notch, a sweep that changes its answer a
                           handful of times, a shown throw that catches what it
                           showed, an assist that only gets better
src/game/pump.test.ts      the pump: steeper costs more, fewer limbs cost more,
                           one hand far more than two, feet count for how good
                           they are, the recovery curve from slab to roof at
                           every limb count, stillness, never below zero or
                           the floor, shakeouts that work on good feet and not
                           on bad, no jumps across angle, foot or limb changes,
                           extreme angles, and what throws, dynos and catches
                           cost
src/game/pumpSim.test.ts   the pump read off the real body: a stance that rests
                           on a vertical wall burns under a roof, foot support
                           and the split between hands from the body, a real
                           shakeout, one blown arm opening one hand, throwing is
                           reaching, hooked feet hold you on a roof and peel
                           off a vertical wall, the bot climbs a vertical route
                           fresh and a roof route pumped, generated roofs go
src/game/grip.test.ts      holds that differ: shape, size, angle, direction,
                           squeeze, fatigue and overgripping; contacts that
                           establish and slip; a jug that holds where a sloper
                           in the same place does not; feet that skate; smears,
                           flags and foot swaps; a dyno into a jug and a sloper;
                           drop knees, compression and mantles read off the body
src/game/fatigue.test.ts   power, core and breath: spent, recovered, and what a
                           tired body can no longer do
src/game/grading.test.ts   grades from moves: agreement with the setters, and a
                           grade that answers to angle, holds, geometry and
                           alternative solutions, not to one number
src/game/tread.test.ts     the belt, the stream's variety, recovery and pacing,
                           move and foot limits, that it goes, that standing
                           still ends it, and personal bests that persist
src/content/highball.test.ts
                           the highballs: tall, distinct, solvable, graded, the
                           landing model, and their own tick list
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
