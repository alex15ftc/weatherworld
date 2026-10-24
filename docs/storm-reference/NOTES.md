# Storm structure references

The tornado references live in `docs/tornado-reference/`. Real photos are in `real/` (sources and licences in `real/SOURCES.md`).

| File | What it shows |
|---|---|
| `clip_twisted_Oi47tIcTvK.mp4` | Severity dev build (watermark "Severity Dev v0.1.3"; the user found it while looking for Twisted). A storm base close up with two wind turbines for scale. |

## What the Severity base clip teaches (frames in `frames/`)

- **The base overhead is one smooth, dark slate-blue deck.** It has almost no texture or lumps, and darkens gently toward the top of the frame. It is not a pile of puffs: that is a mesh or sheet job.
- **Under it, a bright white-grey layer:**
  - It is brightest at the ground and fades up into the base.
  - It has a soft diagonal edge on the left and spreads right.
  - Most likely the rain-wrapped core or rain curtain, lit from behind and side, with low cloud.
  - Its brightness against the dark base gives the scene its depth.
- **Scud hangs from the base into the bright layer:**
  - ragged, dark blue-grey fragments
  - wispy, frayed edges
  - lumpy undersides
  - drifting and changing shape over a few seconds
- **The contrast is the look.** Dark base, bright rain behind, dark scud in between. The scud is only visible because the background behind it is bright.
- **Scale:** the turbines (about 100–150 m) put the scud a few hundred metres up and the base just above it, close to the camera. The particle range (~800 studs) covers this.
- **Colour:** everything is blue-slate. The light is diffuse, with no direct sun under the base.

## For the plan (`docs/storm-visuals/PLAN.md`)

| Element | How to build it |
|---|---|
| Base deck | CloudMesh sheet, smooth, darkening with thickness |
| Rain or low-cloud layer behind | Bright, backlit `Shafts` / curtain mesh, brightest at the ground |
| Scud | Wind-driven tracer puffs (DustView-style), dark and ragged, near the base, carried by the inflow |

## What the real photos teach (`real/`, contact sheets in `frames/real_sheet1-3.jpg`)

The images are Wikimedia Commons, NOAA, NSSL and NWS photos. About half are public domain; the rest are CC and need credit. Treat them as reference only, not game assets (see `real/SOURCES.md`).

**Two materials, by light.**
- Sunlit cloud (towers, anvils, LP updrafts, towering cumulus) is bright cream-white. It has hard, crisp cauliflower edges and deep self-shadow between lobes. Examples: `01_b`, `02_lp_a`, `13_b`, `14_cumulus`.
- Everything under the storm (bases, wall clouds, shelf undersides) is in shadow and lit only by the sky. It is dark slate, blue or teal, soft-edged and low-contrast. Examples: `03_hp_b`, `04_c`, `07_d`.
- The renderer needs both looks from one lighting model: direct sun with self-shadow on top and sides, sky-only light underneath.

**Laminar and striated forms.**
- LP and classic mesocyclones, shelf clouds and long bases are smooth, layered "plates" and corkscrew bands. They are not lumps. Examples: `02_lp_b`, `02_lp_c`, `12_b`, `12_c`, `07_a`, `07_c`.
- Build these as meshes with banded shading: concentric striations wound round the updraft, and tiers on a shelf. This is the Ribbon idea scaled up, with bands from the updraft's rotation.

**Cauliflower forms.**
- Tower tops, overshooting tops and flanking-line towers are lumpy, with sharp sunlit edges. Examples: `01_b`, `08_d`, `13_a`, `13_b`.
- Build them as displaced meshes, with noise lobes sized by updraft speed and shaded by the sun, plus near-field puffs.

**Wall cloud.**
- An abrupt, flat-bottomed lowering, darker than the base, with a ragged edge. Examples: `04_a`, `04_b`.
- From below it is a swirling vortex of ragged cloud (`04_c`).
- The tail cloud is a horizontal ragged band running from the wall cloud toward the core, often backlit (`04_d`).

**Scud.**
- Small ragged white or grey fragments rising in wisps below the base (`05_c`). In the Severity clip they are dark against bright rain.

**Clear slot.**
- A very bright, backlit gap cut into the dark base, wrapping round the wall cloud, with a sharp, frayed lip. It is the highest-contrast feature in a storm. Examples: `06_a`, `06_b`, `06_c`.

**Shelf cloud.**
- A smooth, light-grey laminar upper surface in tiers, with a dark, turbulent, lumpy underside behind it (the whale's mouth). Examples: `07_a`–`07_d`.

**Anvil.**
- A flat, bright top with a sharp upwind edge and a fibrous, streaky underside. Mammatus pouches hang from it, coloured by low sun. Examples: `08_a`, `08_b`, `08_c`, `09_*`.

**Precipitation.**
- Rain shafts are soft grey vertical columns, densest at the core and fading at the edges and top (`10_a`, `10_b`).
- Virga is wispy streaks that stop short of the ground, often backlit gold (`10_c`).
- Hail shafts are whiter and brighter (`10_d`).
- HP cores have a teal or green tint (`03_hp_a`).
- Rain-wrap is a translucent grey veil that lowers contrast between camera and tornado (`11_*`).

**Scale and framing.**
- Most of these are wide shots from kilometres away, beyond particle range. They confirm the plan: storm-scale cloud is mesh, and particles are only for scud, ragged edges and rain near the camera.
