# TornadoLab: what still needs improving (review 2026-10-23)

This review was done after removing the puff funnel. The funnel is now the ribbon alone, and the ribbon no longer hands over to puffs when seen along its axis or from inside it.

Frames: `review_front` (the Real cone view), `review_side90`, `review_side180` (orbiting), and `review_forming` (lifecycle, forming stage).

Compared with the real photos (`real/`) and the Severity references, worst first:

## Funnel

1. **The top ends in a flat rim.**
   - From every side but the front, the ribbon's top shows as a hard, flat ellipse cut against the dark wall cloud (side90, side180).
   - Real funnels widen and dissolve up into the wall cloud.
   - Fix: flare and fade the ribbon's top into the base, or extend it up inside the opaque wall-cloud tile so the cut is hidden.
2. **It still reads as a smooth, pale tube from the sun side.**
   - Front-lit, it is evenly lit blue-grey with almost no variation and is brighter than everything under the storm.
   - In the photos, a funnel under the base is dimmer and in the base's shadow; it is bright only where sunlight reaches it through the clear slot.
   - Fix: light it from the scene (the built-in "scene" colour mode, with the storm's shadow), and add stronger condensation texture banding near the edges.
3. **The shape is too even.** At this size the horn preset reads as a column: almost no taper or flare. Check the `horn` profile at this width, and the lean and bends.
4. **The view from inside or underneath is now empty.** The puff body used to stand in there. If chasers can drive under it, this needs a replacement: a ribbon cross-section or a ring of strand sprites.

## Storm base

5. **Straight edges and facets.** The middle tile's square border and the wall cloud's plateau edge show as straight lines and flat facets from the side (a long diagonal in side90).
   - Fix: denser grid with a rounded fade at the tile's edge, more noise on the plateau rim, and soft shading on the wall cloud's sides.
6. **It's one smooth sheet.** There's no visible structure: no striated bands spiralling into the wall cloud, no tail cloud, no inflow bands, no lumpy (mammatus-like) underside, and the outer base is flat.
7. **Wall-cloud motion.** The bands turn, but the wall cloud doesn't visibly rotate as a whole, and nothing rises into it (scud being drawn in).

## Rain

8. **Grid-tiled texture.** The stacked rain pieces show a plaid / square tiling pattern up close (side90, right). They need a better, non-repeating shaft texture or random offsets per piece, and softer side edges.
9. **No precipitation near the funnel / rain-wrap**, and no curtains drifting.

## Debris and dust

10. **Small, and one colour.** It's at the contact now, but small for an EF4 and evenly brown.
    - Needs a dark ground-hugging ring of debris wider than the funnel, with lighter dust above (the two populations by colour).
    - The brown is too saturated against a grey scene.
11. **Debris pieces.** Severity and the photos show visible flying chunks (boards, shingles) orbiting at the edge of the debris cloud. There are none (removed earlier on request: needs a decision).
12. **Ground marks.** The scour track (ScourView) isn't visible in these views.

## Scene

13. **Ground.** A flat green plane with no texture, crop rows, tall grass or roads near the camera, so there's no sense of distance at ground level.
14. **Atmosphere under the storm.** No rain haze or murk between the camera and the tornado; it's crisp at 700 studs.
15. **Lighting is flat.** No god rays through the slot, and the sun glare is a flat white disc.

## Behaviour (not visual)

16. **The debris cloud doesn't react to the ground under the tornado.** The lab's ground is uniform; in the game, `Config.ground` must come from the land (soil, crops, towns, water) and recent rain.
17. **Swirl ratio and forward speed are lab sliders only.** The engine computes swirl (`StormAppearance.js`) but the feed doesn't send it, nor the tornado's motion, to the client.
18. **Performance not measured since the storm, wisps and debris were added.** About 250 BillboardGuis and 2 EditableMeshes are now updated every frame. A pass on phone settings is due.

## Done (2026-10-23)

- **No flying debris pieces for now** (the user's decision).
- **1. Flat rim: fixed.** The ribbon now ends at the storm base's own underside over the funnel's top (`StormBase.field` at (0, 0); `meetAbove`), fading out before it. The shape's flare is mapped to that height (radius at t / meet), so the funnel widens up into the wall cloud and dissolves into it. Frames: `fix_rim_light_*.png`.
- **2. Tube lighting: fixed for the Real cone** (`ribbonFunnel.colour = "scene"`). Each level traces a ray toward the sun to the cloud-base height and reads the storm base's cover there. Light = `underLight` (0.55) + `sunLight` (0.75) × (1 − cover). Under solid base the funnel is dim slate; where the ray escapes (slot, edge) it is sunlit. Other looks still use their painted colours.

## Glare through the tornado (user screenshot, 2026-10-23)

**Symptom:** a white streak or glow on the funnel when looking toward the sun.

**Cause:** the storm base's tiles had `CastShadow = false`, so Roblox lit everything under the storm with the full (HDR) sun. Looking toward a low sun, every upward-facing surface glared round the sun's position: the funnel and the base's underside (whose mesh normals point up), and the ground. That's why an opaque core didn't help.

**Fixes:**
- **Main fix:** StormBase tiles cast shadows (`stormBase.castShadow`). The ground and the tornado under the storm are now shaded, as in reality.
- **Supporting changes:**
  - Storm sky `Atmosphere.Glare` 0 (no sun halo under an overcast base).
  - Funnel ribbon and base on `CloudMatte` (fully rough).
  - The funnel's scene light only adds direct sun on the side facing the sun (`sunFacing`).
  - An opaque inner core (`ribbonFunnel.core`) blocks anything bright behind the soft ribbon.

**Flipbooks:** considered and rejected. Particles and beams are also drawn see-through, and they would bring back the 800-stud cutoff, sorting flicker and the lack of bending.

Frames: `glare_before_2026-10-23.png`, `fix_glare_towardsun_2026-10-23.png`.

## "Doesn't look like clouds": impostor clouds (2026-10-23)

**Texture bake: no visible gain.** Real Cycles volume renders as textures on the base tiles and the funnel strip (`tools/blender/storm_volume_bake.py`) made no difference the user could see. The problem is shape, not texture.

**Impostor clouds** (`tools/blender/base_puff.py`):
- 16 volumetric puffs rendered from below with storm lighting.
- WispSprites `deck`: 320 BillboardGui sprites hugging the base's underside. Placement, height and colour come from StormBase.field.
- They are flat (aspect 0.6), only their bellies hang below the underside (`sink` 0.15), and they blend at opacity 0.65 with gain 1.9.
- The mesh is flattened to a backing (`meshRelief` 0). The middle tile is treated as an outer tile, all tiles render in the same pass, and `thin` is 0.
- From the side (`impostor_side_2026-10-23.png`), the base reads as lumpy, layered cloud.

**Base edge bug fixed:** the base's edge, stretched toward the rain core (5200 × 1.5), ran past the tile grid (7000 studs), so the base ended at the grid's square border. It is now capped at 0.92 × extent.

**Still open:** a V of straight lines from the funnel's top toward both horizons in the front view (`impostor_front_2026-10-23.png`). Ruled out:
- the rain curtains
- base shadows
- the clear slot
- a tile mismatch
- a height step

Probably the near edge of the camera-side tiles, or the CloudBase particle cells. Next: hide layers one by one with a debug key.
