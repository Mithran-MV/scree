# Scree

**A survey map of how you get liquidated.**

Every lending app reduces your risk to a single number: *"liquidated at $3,434."*
That number is a scalar standing in for a field, and it is most wrong exactly
when it matters. Scree renders the field.

## The map

| Axis | Meaning |
|---|---|
| left to right | price of your primary collateral, -60% to +60% of spot, log scale |
| bottom to top | **dwell** — how long price has continuously stayed at or below that level, 0 to 30 days |
| elevation | health factor minus one, minimised across every lending deployment you borrow from |
| sea level | liquidation |

High ground is safe. The coastline is where you die. The dashed line is a
**fold**: the price at which the deployment closest to killing you hands over to
a different one. No dashboard shows you that line, because a dashboard has one
row per protocol and nowhere to put the boundary between them.

## How the ground is drawn

The map is a Phaser 4 game in two scenes. `WorldScene` (`src/game/WorldScene.ts`)
owns the camera and everything standing on the ground; `UIScene` is launched
over it and owns the instrument: the top bar, the bezel, the title plate, the
live feed, the log, the reading panel with its terrace-depth graph, and the
pop-ups, every box a nine-slice of baked pixel-art stock. The world raises events; the interface
listens. Neither scene does arithmetic — the page hands them a terrain grid and
a `readAt` function built from the kernel.

The grid comes from `src/game/terrain.ts`. Elevation is sampled at tile corners
and banded into seven biomes: deep water, the shallow shelf, coast, lowland
grass, midland forest, mountain and snow. Each tile records the lowest band
among its four corners and a 4-bit mask of the corners that rise above it, so
every tile shows exactly one transition and neighbouring tiles agree along the
corner they share. `src/game/tileset.ts` paints the tileset from colours
sampled off the Kenney sheet: eight rolling frames per water band, four frames
of foam on the shore, a lit lip and a two-pixel cliff on every land step.

Health depends on price far more than on dwell, so the raw field is a set of
vertical stripes. Two things bend it into a landscape without moving sea level
(`src/game/terrain.ts`, `RELIEF`): a domain warp lets the price axis wander
with dwell, and the same warp is applied to every reading, so what the map
shows at a point is what the book says there; and simplex noise on the height
fades to nothing at the shore and is clamped so it never crosses it. Coves,
headlands, plateaus and ridges are relief; the liquidation line is exact.

Everything on the land is a rule of the tile under it. `src/game/clutter.ts`
fills each biome from its own catalogue — driftwood on the coast, deciduous
trees on the plains, dense pines and rock in the midlands, peaks, ruins and
aether crystals on the heights — grouped by a slow noise into groves and
fields. Each territory's holdfast is planned onto the highest ground it rules,
clear of the map's edge, built from a blueprint for its protocol's family
(`src/game/holdfasts.ts`), and given living parts: windows that glow, a gear
that turns, an orb that floats, flags that wave. The argmin borders are
faults: a chain of crags over ley that breathes, denser and studded with
ruins on the pass where long meets short. The deep water has its leviathans
(`src/game/SeaMonster.ts`), physics sprites that patrol their basin by tween,
trail bubbles, dive and surface on their own clock, and warn about slippage,
cascades and oracle drift when you hover them.

Depth is strict: water at 0, terrain at 10, the lines above it, the terrace outline
at 16, everything standing on the ground y-sorted inside 20–24, the surveyor at
30, the interface from 90 and its pop-ups at 100.

## Why the ground has shape

Each position moves with price in one direction only. Supply ETH and borrow
stablecoins and you are **long**: price up is safer. Borrow ETH against
stablecoins and you are **short**. In `src/core/kernel.ts`:

```
HF(P, t) = ((a·P + c) · exp(rs·t)) / ((u·P + v) · exp(rb·t))
```

The derivative of that with respect to `P` has numerator `a·v − u·c`, which
carries no `P` at all. So a single position is monotone in price everywhere and
can never turn around. **All structure on the map comes from which position is
lowest**, not from any one of them bending.

Which means:

- A book that is entirely long renders an honest **ramp**. One shoreline, no
  ridge, no pass. The interface says so rather than drawing creases that are
  not there.
- A book holding **both signs** has one position that kills you on the way down
  and another on the way up. Between them is a ridge, and the highest point on
  it is the **pass** — the best health this book can reach at any price.

For two pure legs the ridge sits exactly at the geometric mean of the two
liquidation prices, and the crest is `sqrt(upper/lower) − 1`. That closed form
is in `src/core/bracket.ts` and it reports when it does *not* hold, because an
affine leg shifts the ridge off the mean.

## The geometry gate

It is easy to write a renderer that draws convincing creases over terrain that
is really a smooth ramp. `npm run gate` measures the actual raster and fails the
build when the drawing and the measurement disagree.

```
  wallet shape               MIXED
  binders                    3
  fold lines (8-connected)   2
  basins                     2
  pass                       $4,165.43
  pass elevation             0.160576
  boundary pass              true
  rises with price on        68.997% of steps
  crest drift over dwell     1.00 px
  lower shore drift          0.56 px
  upper shore drift          0.24 px

  verdict                    TOPOGRAPHY
```

## Honest limits

- **The dwell axis moves the terrain very little.** Over the full 30 days the
  shorelines shift 0.56 and 0.24 pixels on a 320-pixel axis. That is interest
  accrual and nothing else, and accrual is slow. The gate prints the number
  every run. The map does not sell the bend.
- **Two axes only.** One asset's price and how long it stayed there. Everything
  else the wallet holds is held constant, and collateral in a third volatile
  asset is badged on screen rather than quietly folded in.
- **The registry is a subset.** A map drawn from four of seven sources is still
  worth reading, but only because it names the three that did not answer.

## Running it

```bash
npm install
npm run dev
```

The page loads a reference book with no configuration, so the map works before
any key is set. To survey a real address, set a gateway key:

```bash
cp .env.example .env.local   # then fill in GRAPH_API_KEY
npm run verify:subgraphs     # resolve every registry id before trusting it
```

| Script | What it does |
|---|---|
| `npm run dev` | development server |
| `npm test` | the full suite |
| `npm run gate` | measure the terrain and fail on a flat map |
| `npm run typecheck` | types |
| `npm run verify:subgraphs` | resolve every subgraph id against the gateway |

## What it will never ask for

Scree reads public positions. It does not request a token approval, hold a key,
or move anyone's funds. Where a defence policy is armed, the system returns an
action and a size; executing it stays the owner's own transaction.


## Assets

Sprites are from two CC0 packs by [Kenney](https://kenney.nl): Tiny Town and
Tiny Dungeon, committed with their licences under `public/assets/kenney/`.
The sheets under `public/assets/scree/` are generated by `npm run bake:sprites`
(`scripts/bake-sprites.ts`): the surveyor's walk cycle and the leviathans'
swim, dive and surface frames are derived from single Tiny Dungeon frames, and
the clutter, peaks, particle motes and interface stock are drawn from
the project's palette. The pixel face is Press Start 2P, served through
`next/font` like the other three.

## Licence

MIT. See [LICENSE](LICENSE).
