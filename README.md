# SEND

A browser game about precision bouldering.

Read the route. Plan your beta. Throw your limbs at the wall. Somehow send it.

You control four limbs, one at a time. Select one, drag away from where you
want it to go, and let go. The limb travels exactly where you aimed it, and
then your body has to deal with the consequences. You can also grab your own
hips and move your weight around, which is usually the difference between a
hold being out of reach and being on it. Fourteen handcrafted routes
from V0 to V7, five route setters with strong opinions and poor judgement, and
a climber who is technically cooperating.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 102 tests, all logic, no DOM
npm run typecheck
npm run build      # -> dist/, static, deploys anywhere as-is
npm run gen:beta   # regenerates community betas after changing routes or the sim
```

Mobile-first — it is built for iPhone Safari and works with a mouse, trackpad
and keyboard on desktop (`Q`/`W` for hands, `A`/`S` for feet, `E` for the body,
`space` to pull on). Nothing is fetched at runtime and there is no backend; progress lives in
local storage.

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

**Body position is a move you make, not a thing that happens to you.** Drag
your hips and the climber pulls toward that position as far as their limbs
allow — the tethers on screen redden as each limb runs out of slack, so you can
see which one is stopping you. Shifting up buys about 40cm of vertical reach
and costs you lateral; shifting out over a foot makes it solid and shifting off
one starts a barn door. Shifts cost no moves and are not scored, because they
are not placements. They will absolutely put you on the mat.

**Falling is informative.** A whiffed limb visibly travels to where you actually
aimed it before the flailing starts, so a spectacular failure still shows you
the mistake that produced it.

## Architecture

```
src/game/      the sim — pure, deterministic, no DOM, no React
src/content/   routes, setters, wall, generated community betas — plain data
src/render/    three.js scene, the climber rig, the aiming overlay
src/state/     profile, progression, local persistence
src/ui/        React screens
```

### The body is two particles

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
src/game/sim.test.ts       the body solver and move resolution, including
                           determinism, reach, hold directionality and barn door
src/game/shift.test.ts     weight shifts: determinism, that they cannot exceed
                           what the limbs allow, that they buy reach, and that
                           they cost stability when the weight leaves the feet
src/content/routes.test.ts every route: valid data, inside the wall, a start
                           that stands up, a finish near the top, actually
                           climbable, and a par a clean climb could hit
```
