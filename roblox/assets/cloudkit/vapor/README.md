# Cloud kit vapor sprites

Camera-facing images of the cloud kit's puffy pieces rendered as real volumes (Cycles), to replace
the solid meshes for tower caps, tower bodies, anvils and mammatus. Bases, shelves and the wall
cloud stay meshes. Made by `tools/blender/cloud_vapor_bake.py` from the piece meshes in
`roblox/src/shared/Weather/CloudKit/Pieces/`.

| File | What |
|---|---|
| `<piece>.png` | 1024 × 1024 RGBA sheet, 2 × 2 cells of 512 (one per light), **straight (not premultiplied) alpha** |
| `<piece>_preview.png` | The same sheet over a mid sky blue, for looking at |
| `sheet.png` | Every preview, halved, in the order tower_cap_1-3, tower_body_1-2 / anvil_1-2, mammatus_1 |

Pieces: `tower_cap_1`, `tower_cap_2`, `tower_cap_3`, `tower_body_1`, `tower_body_2`, `anvil_1`,
`anvil_2`, `mammatus_1`.

## Cell layout

| | left | right |
|---|---|---|
| **top** | `lit` | `side` |
| **bottom** | `back` | `high` |

## What a cell covers

Each cell shows the piece's **unit box** (game axes: x, z in -0.5..0.5, y in 0..1) plus a margin
**M = 0.15** of the box on every side:

- image left → right = game x from **-0.65 to +0.65**
- image bottom → top = game y from **-0.15 to +1.15**
- the box's centre (game (0, 0.5, 0)) is the cell's centre; the box itself fills the middle
  1 / 1.3 ≈ 77% of the cell (pixels 59–453 of 512 on each axis).

So for a piece placed with size (sx, sy, sz) and its box bottom at height Y0, the sprite is a
quad of width 1.3 · sx and height 1.3 · sy, centred at height Y0 + 0.5 · sy.

The image is the piece **as stretched into the unit box**, the same way the game stretches the
mesh: it was rendered at the piece's modelled proportions (so lobes are round and lighting is
right) with non-square pixels. Drawn at the piece's modelled proportions (KIT.md "Modelled at",
e.g. a tower cap about 1 wide × 0.5–0.65 tall, an anvil 1.15 × 0.16) it looks as designed.

The volume fades to nothing before the cell edges (alpha at every cell edge is 0), so the cells
can be sampled with bilinear filtering without bleeding into each other much; inset UVs by a pixel
to be safe.

## Camera

Orthographic, horizontal, looking at the piece's **front**: from game **+Z toward -Z** (Blender's
Front view, -Y toward +Y). Image right = game **+X**, image up = game **+Y**. For directional
pieces (anvils: +Z is the upwind edge) the sprite shows the front face.

## Lights

One sun (strength 10, 1° wide, faintly warm white) and a dim blue sky (colour (0.42, 0.55, 0.80),
strength 0.35), the same for all four cells, so the cells match in brightness and can be
cross-faded by sun direction. Directions are where the light comes **from**, relative to the camera:

| Cell | Sun | Looks like |
|---|---|---|
| `lit` | 30° up, behind the camera, 30° to its left | Front-lit: bright white lobes, soft grey creases, little shadow (flattest) |
| `side` | 30° up, 90° to the camera's left | Left half bright, right half in blue-grey self-shadow; the most 3D-looking cell |
| `back` | 30° up, 150° round from the camera (behind the cloud, a little left) | Body dark blue-grey, a bright silver rim along the top and left edges (forward scattering through the thin fringe) |
| `high` | 75° up, behind the camera, 30° to its left | Tops bright, undersides and lower creases grey |

The colour is the cloud's own white under these lights; tint in game (sunset, storm darkness).

## Render

Cycles on the RTX 4070 (OptiX), 512 px per cell, 64 samples with denoising, volume bounces 12,
max bounces 16, volume guiding on, view transform Standard, film transparent. Principled Volume,
white, no absorption, anisotropy 0.75. Bake time ~20.5 min for all eight (40–60 s per tower cell, ~20 s per anvil or mammatus cell).

How the volume is made: the mesh is put back to its modelled proportions, OpenVDB makes a signed
distance grid from it, and the shader moves the surface with noise (Voronoi domes on domes for
towers' cauliflower; X-wise streaks and a smooth top for anvils; slow smooth swells for mammatus),
ramps density from that surface into an optically thick core, adds a faint thin veil outside it
(the silver lining) and eats the fringe into wisps with fine noise.

## Join pieces (rows that read as one cloud)

`anvil_join_1`, `anvil_join_2`, `base_join_1`, `base_join_2`, `shelf_join_1`, `shelf_join_2`, made by
`tools/blender/cloud_vapor_join_bake.py` (same sheet layout, cell framing, camera, lights and render
settings as above; 64 samples). They are for sections laid side by side (~30% overlap), so unlike
the pieces above they **do not taper in x**:

- The volume is an endless slab in x (it runs to |x| = 2 in the render), so the light at the box's
  x edges is the same as in its middle: no bright or dark end faces.
- Alpha is **1 across the whole box** (|x| ≤ 0.5) and fades smoothly to 0 over the margin
  (0.5 → 0.65, the cell's edge), so neighbours cross-fade in their overlap. Top and bottom fade to 0
  before the cell edges as before.
- Only the top and bottom are shaped; variation along x is slow (a few gentle swells per section)
  so repeats are not obvious.

| Piece | Built as | True proportions (length × depth × height) |
|---|---|---|
| `anvil_join_*` | flat slab, bright top with low billows, streaky fibrous underside, opaque | 1 × 0.8 × 0.22 (16 km section × 2.4 km at 621 studs/km across, 1 stud/m up) |
| `base_join_*` | dark slab, top fading up into the cloud above, lumpy ragged underside with hanging scud; albedo 0.17 below → 0.66 at the top, so it is dark slate (~0.11–0.13) even in the `lit` cell | 1 × 0.6 × 0.08 (between an 18 km × 0.6 km line section, 0.054, and a ~5 km supercell slab, 0.12) |
| `shelf_join_*` | seen from the FRONT (the nose toward the camera): three smooth light-grey laminar tiers (lip forward, face undercut, faint grooves along x), and below the nose (at ~0.4 of the box height) a dark lumpy underside hanging to the box bottom | 1 × 0.34 × 0.17 (a ~12.5 km segment, ~1.3 km nose-to-top, 4 km deep) |

The volume is built at those proportions and drawn into the square cell with non-square pixels, so
drawn at other proportions the lumps get squashed or stretched (a base at 0.054 has lumps ~1.5×
flatter, at 0.12 ~1.5× taller). In the unit-box image the fine fringe noise therefore looks like
tall vertical strands; squashed to the real proportions it is a fine ragged edge.

Also written: `<piece>_row.png`, the `lit` cell laid three in a row (sections 0.7 box widths apart)
over sky at the true proportions — a check of the seams; not for upload. `sheet_join.png`: the six
previews, halved, two to a row. Bake time: 9.3 min for all six (13–14 s per base cell, 21–27 s per
shelf cell, 25–34 s per anvil cell).
