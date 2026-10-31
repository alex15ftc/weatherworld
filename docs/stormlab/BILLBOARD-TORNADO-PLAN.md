# Billboard sprites in 3D and a cleaner tornado (2026-10-29)

Decision: billboards only, matching the reference games; the Luau lobe shader is off
(`LabConfig.LOBE_SHADER.enabled = false`, code kept). It had no per-frame cost (13 s one-off
background build), but held ~27 MB of EditableImages.

## What is known about BillboardGui sprites

- Each BillboardGui is its own GUI draw with its own overhead; unlike parts sharing one mesh id,
  they do not batch. Forum reports: big FPS drops with many billboards; staff: billboard
  rendering is not low impact. Keep counts bounded (our rule: ~200 a tornado) and use MaxDistance.
  Sources: devforum "Are billboard GUIs performance heavy?" (1836884), "Billboard GUI causing FPS
  lag" (3542255), "Practical limit for BillboardGuis" (3958385).
- Writing properties every frame costs ("constantly editing their content" hits performance):
  write only changes that show (StormCards / TornadoCards already do: half a pixel, 1/500 colour).
  Swapping Image ids is the costliest change: keep a sprite's texture fixed; animate position,
  size, rotation, colour, transparency.
- Transparent things are sorted by their centre, not per pixel (devforum 43275): big overlapping
  translucent cards swap order as the camera moves and pop. Many similar-sized smaller sprites
  sort more stably than a few huge ones, and soft-edged textures hide order swaps.
- ParticleEmitters batch (one draw per emitter) but Roblox stops drawing particles at ~800 studs
  (measured 2026-10-22), so they only suit near detail (dust, debris), not a funnel at chase range.
  (devforum "Clouds/Tornado VFX" 4343192: a particle tornado that "fades away after 1000 studs".)
- Lighting: billboards with LightInfluence 0 ignore scene lights; their shade is ours to set via
  ImageColor3. That is what "dot product shading" means below.

## The Discord recipe, mapped onto ours

| Recipe | Ours today (Render/TornadoCards) |
|---|---|
| billboards adorned at points, positions from the server, visuals on the client | same (Tornado/StateAdapter -> client cards) |
| sprites spin counter-clockwise round a tracker and move up and out | fixed rings of 6 cards + a centre card per height (26 heights); ring cards turn and slide up ~0.15 vc in their layer |
| a segmented upward track for curves | the curved axis from the state (same) |
| higher = bigger sprites | card size from the condensed radius (same idea) |
| dot-product shading | sun attenuated along the chord through the funnel (similar result, depends on depth not facing) |

What differs is the structure: we draw a stack of layers plus 16-gap "core slices" turned to the
axis's on-screen lean for a crisp edge. Nearly every 2026-10-29 fix was a layer artefact: ribs
(card tops and bottoms), sticks and crossed bars (slices on a bending axis), beads (gaps on a
tilted rope), domes and bands (summed opacity of overlapping layers).

## Plan: a spiral-stream funnel

1. Track: the axis polyline from the state (as now), with its radius r(z) = condensed radius.
2. Strands: S = 3-4 helical strands, M sprites each (e.g. 4 x 40 = 160) plus ~24 centre cards;
   dust and debris stay as they are. Total within the ~200 budget.
3. Each sprite has a phase s in [0, 1) up the track, advancing with time (rise rate from the
   flow, ~0.1-0.2 vc on the surface), and an angle th turning counter-clockwise (cyclonic) at
   the flow's speed at its radius (vt(r) / r from Vortex, as the rings now). Position = axis(s)
   + r(s) (cos th, sin th) + a small radial jitter. When s passes 1 it wraps to 0 (born at the
   foot, merges into the lowering at the top) with a fade at both ends: the stream never shows
   fixed layers, so no ribs or bands.
4. Size = ~1.6-2 r(s) (neighbours overlap into a solid column), growing with height like the
   recipe; aspect follows the track's lean as seen on screen only a little (round soft puffs with
   a firm-edged texture; no long slices, so no sticks or bars on a bent rope).
5. Shading per sprite (ImageColor3): outward normal n = radial direction from the axis (tilted a
   little up); lit = ambient + diffuse x max(0, n . sun) x sunlight reaching the tornado
   (SceneLight); darker toward the core (centre cards). Sprites carry the terminator round as
   they turn, so the rotation reads, and the funnel has one lit side and one shadow side.
6. Opacity per sprite from the condensation (as now: optical depth share), so a forming funnel
   or rope is thin and a wedge solid. Rain-wrap and haze tints stay as they are.
7. Stages and multi-vortex use the same stream: a rope is the stream on a thin, snaking track;
   sub-vortices are short streams on their own tracks; nothing stage-specific
   (memory: one tornado build).
8. Build as a new renderer next to TornadoCards with a key to switch, compare against
   docs/tornado-reference, then retire whichever loses.

Expected gains: no layer artefacts, visible rotation, a clean lit/shadow side, cheaper writes
(each sprite: position + colour + transparency; sizes and textures mostly fixed). Risk: the crisp
sides came from the core slices; the stream gets them from a firm-edged puff texture and the
centre cards' opacity instead, which must be checked on the stovepipe and cone references.

## Built (2026-10-29, first pass)

`Render/TornadoCards.luau`, style "spiral" (default, `LabConfig.TORNADO_STYLE`; key **T** switches
to "rings" and back). 4 strands x 36 smooth puffs at 0.55 rc round the axis, 1.15 rc wide, each
turning at the flow's speed at its radius and rising ~0.15 vc (wrap with a fade at foot and base),
lit by the dot product of its outward normal and the sun; 24 centre cards are crisp-sided slices
(~10 gaps tall, 5 where the axis leans) rising at half that, turned to the axis's lean on screen.
Same radius, density, light, rain, lowering colour, sub-vortices and condensation tags as the
rings (a 25-height lookup table up the funnel). 168 + 18 tags billboards.

Iterations (stovepipe, docs/stormlab/detail/spiral_vs_rings_*.png):
1. puff sheet sprites: no ribs, but blotchy, narrow and pale;
2. smooth puffs + 3-4-gap core slices: crisp but striped (slice ends);
3. ~10-gap slices: stripes gone;
4. density raised to the rings' (a stovepipe is opaque): dark, smooth, no layer artefacts.

Open: its sides are still a little softer than the rings' and its foot narrower; the lit/shadow
side is weak under a dark storm (sun mostly blocked) - check in sunlit scenes; ropes, wedges,
multi-vortex and forming funnels not yet looked at in this style.
