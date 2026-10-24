# Tornado look references (saved 2026-10-22)

The target for the particle tornado (`roblox/src/shared/Tornado`). All five are Roblox scenes
(Severity and Severity-like builds), so this look is reachable with Roblox particles.

| File | What it shows |
|---|---|
| `ref1_image.png` | Mature cone, close, from the ground. **The Phase 1 target.** |
| `ref2_image2.png` | Forming: smooth lowered base, thin rope whirls (chains of small puffs) touching down. |
| `clip_3JXLF0nN0n.mp4` | Rain-wrapped wedge behind a stop sign: dark blue-black sub-vortex blobs inside a lighter grey body. |
| `clip_iOvAj0as2Z.mp4` | Debris cloud turning brown over dirt / houses, dark spinning sub-vortices, hundreds of boards and shingles, brown ground scour. |
| `clip_mobile_severity.mov` | Severity dev build on mobile: houses come apart panel by panel, roof sheets fly past, inside it is brown dust haze. |
| `ref3_spoiler_image.png` | Sepia late-afternoon cone from a car window: dark funnel under a huge dark, lumpy base. |
| `clip_2026-02-28_10-32-59.mp4` | Warm-grey funnel low to the ground with dark debris puffs either side of the contact. |
| `clip_2026-02-28_10-37-29.mp4` | Near-white funnel under a blue-grey base; dark rotating debris cloud at the foot. |
| `clip_2026-02-28_10-44-44.mp4` | Huge dark wedge filling the frame against a pale sky. |
| `clip_2026-02-28_10-58-06.mp4` | Green-tinted storm light: wedge in a teal sky. |
| `clip_2026-02-28_11-01-22.mp4` | Dark slate cone, ragged soft edges, narrow contact with tiny sub-vortices. |
| `clip_2026-02-28_11-04-14.mp4` | White funnel bending out of a blue-grey base, dark debris cloud at the ground. |
| `clip_2026-02-21_01-17-48.mp4` | Overcast light: soft grey funnel darkening toward the ground, dark base with a ragged lower edge, tree line for scale. |
| `lab_cone_2026-10-22.png` | Our lab's closest frame so far (for comparison). |

`frames/*_sheet.jpg`: evenly spaced frames from each clip.

## What makes the look

- **Lighting is a normal bright day.** Roblox's default blue sky and sun, mild haze toward the
  horizon. The smoke is lit grey-white with blue-grey shade, never black. No overcast deck.
- **Smoke is huge, soft and nearly featureless.** Particles have almost no internal texture: a
  soft round blob with a slightly lumpy edge. Realism comes from heavy layering of many big,
  semi-transparent particles, not from detail in each.
- **Silhouette:** smooth, slightly darker at the edges (limb darkening), lighter in the middle;
  the base edge near the ground is fairly crisp; the top flares out into a wide lowered cloud
  base of the same material with ragged, darker wisps hanging from its underside.
- **Scale:** the funnel is enormous next to houses (a cone is several houses wide at the
  ground and flares to many times that).
- **Contrast inside:** sub-vortices are separate darker, bluer blobs; debris dust is a brown
  tint that takes over the lower funnel when it hits dirt and buildings.
- **Ropes:** thin chains of small dark puffs.
- **Close up:** the camera is swallowed by a flat brown-grey haze with flying panels.

## From the second batch (2026-10-22)

- **The cloud base underside is lumpy and ragged**, darker than the funnel, with soft cauliflower
  bumps along its lower edge; not a smooth ceiling.
- **Contrast between funnel and base varies with light**: a bright white funnel under a blue-grey
  base, or a dark funnel against a pale sky. The storm light (sepia, green, slate) tints everything.
- **Funnel edges are soft with fine fuzz**; the contact is narrow and often hidden in a dark,
  rotating debris cloud (Phase 4).

## Motion research (2026-10-22)

How real funnels move, and what the lab's `Config.motion` / `State` (kink, pulse, bottom, wobble) are tuned from. Numbers marked (est.) are read from chaser footage, not published.

- **The funnel is an isobar:** the visible edge is where the pressure deficit brings air to its condensation level. It lowers and lifts as the core deepens or weakens (tens of seconds to minutes), often leaving a partial funnel over a spinning debris cloud. `state.bottom` + a straight taper to a point (`motion.tipLength`).
- **Rankine radius:** outside the core `r(z) = R·V / sqrt(2g(z_LCL − z))`, which gives the flare toward cloud base. A wedge is a large R with a deep deficit; a rope is a small R and weak V. The presets could later come from this.
- **Kinks (est.):**
  - Mature funnels: a few % of the height, wavelength about the height, climbing the funnel in 15–30 s.
  - Ropes: 5–15% of the height, short wavelengths, faster, with a loose foot.
  - Wavelength ratios of about 1 : 0.62 : 0.41, so the pattern never repeats. In the lab: `motion.waves`, `state.kink`, `motion.ropeFootSway`.
- **Breathing:** ±5–10% of the width on a 10–40 s period (`state.pulse`, `motion.breathePeriod`).
- **Rotation:** visible period ≈ 2πr/v. About 6 s for a 100 m funnel at 50 m/s, about 25 s for a 500 m wedge. Faster where narrow (v ∝ 1/r outside the core).
- **Tilt:** most tornadoes are strongly tilted (10–30°) and the tilt changes. The ground point is pushed by the rear-flank outflow while the top follows the mesocyclone. Rope-outs stretch and go near-horizontal.
- **Rope-out:** the funnel narrows, contorts and lifts over 1–5 min (est.).
- **Sub-vortices:**
  - 2–6, about 250 m apart, orbiting at about the peak wind, mostly lasting seconds. They appear when the core goes two-celled.
  - To add later: thin puff chains orbiting at 0.6–0.9 r, with the core thinned.
- **VFX practice** (Into the Storm, Twisters, Houdini):
  - The tornado is split into layers (core, shell, ground layer, tendrils, parent storm), built on an animated curve, with noise layered on top.
  - Rotation reads from trackable features crossing the silhouette.
  - The volume has to be filled all round the axis, so it holds up from above.
  - Debris rises low in the inflow corner, spirals out to 1.5–3× the base radius, then falls out.
- **Sources:** Wurman 2002 (multiple-vortex), El Reno 2011/2013 AMS papers, Okstate condensation-isobar paper, Stull's *Practical Meteorology* ch. 15, Mahre et al. 2018 (tilt), the WMO Cloud Atlas, fxguide (Into the Storm), the SIGGRAPH blog and beforesandafters (Twisters), and the SideFX tornado tutorial.

Lab frames: `lab_motion_rope_t0/t8.png` (the same rope 8 s apart), `lab_life_1..4_*.png` (the lifecycle demo), `lab_angle_trunk_side/above.png`.

## How Severity draws it: diagnosis (2026-10-22)

Frames in `frames/diag/` (consecutive frames, half-second differences, edge zooms). Tools: `tools/lookmetrics/metrics.py`.

- **Ref1-type funnels: camera-facing ribbons (Beams), not particles.**
  - The edges are long, straight soft ramps (4% of the width).
  - There is a darker band just inside each edge (11%), and faint lengthwise streaks.
  - The surface has almost no fine texture (high-pass 0.0009).
  - The thin dark tendril on Ref1's right is a tapered curved line, which is a Beam signature.
  - A chain of round particles can't make those edges.
  - A stack of camera-facing Beams with a cross-section texture can, and does: `BeamFunnel.luau` prototype, B in the lab, edge 0.069 against puffs' 0.084, core colour within about 10.
- **Wedges and debris clouds (clip_iOvAj): big particles.**
  - Half-second differences change in round lobes with fibrous detail inside.
  - Nothing changes between consecutive 1/60 s frames: slow, large, long-lived particles with realistic smoke textures.
  - No sort flicker.
  - Debris is real 3D parts.
- **Ropes (ref2, 03-30 clip):**
  - Chains of same-size dots evenly spaced along smooth curves suggest a Beam with a repeating puff texture.
  - The smooth rope tube in 03-30 also fits stacked beams.
- **Lineage:** Severity is Willzuh's game (co-creator of Twisted).
  - Twisted went from cone meshes (≤1.16) to "81 tornado meshes" (1.17), then a "dynamic tornado system" with "mesh optimizations" (1.20).
  - No public statement about Severity's rendering was found.
- **EditableImage:**
  - A Beam accepts an EditableImage as `TextureContent` (`SourceType` Object) but draws it as flat colour, with no alpha and no shading (tested in Studio 0.743).
  - Live shading needs another carrier: MeshPart / EditableMesh ribbons (which do show EditableImages), or swapping pre-uploaded texture frames on the beams.
  - `FunnelImpostor.luau` has the drawing code (sun shading, turning streaks, backlit rim), ready for that.

## What we build instead (2026-10-22)

- **Funnel body: `RibbonFunnel` on `Ribbon.luau`.**
  - One EditableMesh ribbon, turned to the camera at every vertex. Unlike Beams, it has no joints at bends.
  - Per-vertex colour and alpha, recomputed every frame, give the soft edge, the darker band just inside it, wrap-lit sun shading, and the backlit rim and dark middle.
  - The foot is sunk below the ground. The top fades into the cloud base, and fades faster where the radius flares.
  - A live EditableImage on the MeshPart carries faint helical streaks that turn at the air's speed (Beams can't show EditableImages; MeshParts can).
  - Ref1, front-lit: edge 0.039 vs 0.044, inner darkening 0.119 vs 0.107, contrast 0.227 vs 0.247.
- **Sub-vortices:** thin dark ribbons, with their part placed nearer the camera so it sorts in front of the funnel.
- **Per-look detail:** puff surface detail stays on for rough looks (wedges, trunk, sepia) and is off for smooth ones (Ref1, white cone, ropes).
- **Dust: `DustView`.**
  - 80 tracers are picked up where the ground wind exceeds 22 m/s, carried by the wind field with a little lag (heavier grit is flung out) and lofted by turbulent vertical gusts (0.25 × the local wind, over 2 s).
  - Each tracer leaves a trail of soft puffs.
  - Tuned offline with `tools/windfield/dust.luau`: a Ref1-type skirt within 0.5–1.2 core radii, mostly under 75 m; a rope's 20–40 m bush at 2–4 core radii; a wedge's dust reaching about 200 m.
- **Colour from the scene:** built (`ribbonFunnel.colour = "scene"`: one cloud colour, darker when optically thick). It waits on the lab's looks carrying their tint in the lighting rather than in painted particle colours.

## Matching real photos (2026-10-23)

The looks above were tuned to Severity screenshots. Compared with the real photos in `real/`, the lab was missing:

1. **The storm overhead.** In every real photo a dark, low base fills the top of the frame, with a bright clear slot on the horizon under its edge. The lab had a blue sky.
2. **A real taper.** Real cones (01_cone_a/b, 07_funnel_b) are concave horns: about 1/20 as wide at the ground as the base is high, widening about 8x into the cloud. Ref1-style funnels are fat tubes (1/2) under a mushroom cap.
3. **Scale cues.** Real photos almost always have a tree line, power poles or a road.
4. **The contact.** The funnel narrows into a low dust spray much wider than the funnel itself.

Built:

- `Shape.PRESETS.horn` (packed at index 26 of `State.pack`).
- The **Storm** sky: low evening sun, bright warm haze, Roblox clouds off.
- `CloudBase.ceiling` reworked:
  - `backing` makes the top layer a solid colour.
  - `snapTile` makes the tiles seamless.
  - `roundCorners` and `gridYaw` (turned to face the lab camera) hide the corners.
  - `detailExtent` limits how far the lower layers reach.
- Lab scenery: shelterbelt tree rows in a square 1,100 studs out, plus two gravel roads with poles.
- The **Real cone** look (`faceSun`: the camera is placed opposite the sun).

Frame: `lab_real_cone_2026-10-23.png` (before: `lab_ref1_before_2026-10-23.png`).

Still open:

- The funnel top ends in a pale soft bulb (collar/puff layer) instead of a lowered collar.
- The ceiling is flat and its edge is a polygon. Real bases are lumpier, lighter toward their edge, and hazier with distance.
- The dust comes and goes, and should be a lower, wider, grainier spray.
- A dark floating sliver at the left horizon (probably the near tree row seen side-on).
- No real-photo looks yet for the wedge, rope, backlit and rain-wrapped types.

## Condensation funnel and the storm built round the tornado (2026-10-23, later)

**The funnel.** The ribbon looked plastic: smooth vertex shading with a bright rim line and an edge as clean as a tube's. Its texture (`RibbonFunnel.drawCondensation`) is now condensation:

- tileable cloud noise, sampled along a helix that climbs at `riseSpeed` (22 studs/s) and turns with the air: the condensed air streams up the funnel
- soft lumps (`patches`) on top of the helical bands
- a ragged edge drawn into the texture's **alpha** (`fringe`, `fringeSoft`), whose tufts climb and turn with the rest. This works: MeshPart EditableImage alpha does cut the mesh.
- the rim and the dark band inside the edge are weaker (`rim` 0.22, `dark` 0.05)

**Dynamic pipe** (AMS glossary: the vortex builds downward from aloft). The lifecycle demo's funnel now lowers from the base in surges (it reaches, pulls back a little, reaches again) while its cloud keeps rising.

**The storm, built the lab's way.** This replaces the old storm mode: key N is shelved, the lab server no longer loads the CloudKit meshes, and the leftover game `Client`/`Server` scripts in TornadoLab.rbxl are disabled.

- `StormBase.luau`: the base as a grid of EditableMesh tiles, shaped and coloured by one field in the storm's frame. It sags into a wall cloud with turning striations, rises and lightens toward a ragged, rounded edge, darkens over the rain core, and has a bright clear slot behind the wall cloud. The middle tiles are opaque, so the funnel disappears up into the wall cloud.
- `RainCurtains.luau`: camera-facing parts with the rain-shaft texture scrolling down. A cluster sits in the rain core ahead-left of the storm's motion, and thin curtains wrap round the far side of the wall cloud.

**Gotchas found**

- The TornadoLab place file had leftover copies of the game's `Client` and `Server` scripts that Rojo doesn't manage. Every lab playtest ran the whole game, including its `SkyLight`, which **overrode the lab's lighting**: lab skies were never what LabConfig said. The `Client` and `Server` scripts are now disabled. As a result, the Storm sky's 19:12 clock showed night; it is now 17:24.
- The EditableMesh budget is small, and destroyed meshes don't hand theirs back within a Studio session. After many rebuilds, even one new mesh fails. Ribbons are now pooled (`Ribbon.destroy` parks them) and storm tiles are built once and rewritten in place. A Studio restart clears the leak.

### StormBase: the budget (measured after a Studio restart)

- A fresh client built exactly **6** EditableMesh tiles of about 300 vertices each, then every later create failed. The budget is really only a handful of meshes, and phones have less.
- StormBase now uses **2 meshes**:
  - the middle tile (the wall cloud: heights and vertex colours, recoloured as it turns)
  - one flat quad shared by all 35 outer MeshParts. Each outer part has its own 32×32 EditableImage, holding the field's colour and the alpha for the ragged edge.
- The outer tiles are 2,042 studs apart and 2,048 wide, so neighbours overlap and no sky shows between them. Alternate tiles sit 0.5 studs higher.
- Tiles with no fading edge are opaque, so they hide the funnel above the wall cloud and the tops of the rain curtains.

### Rain curtains

- Each curtain runs from under the ground to 200 studs up inside the base, so neither hard end shows.
- Curtains within 900–1,600 studs of the camera fade out: up close they read as flat sheets.

### The Real cone look

- `sunOffset` 30 puts the low sun beside the funnel. Straight behind it, the sun glared through the thin foot like a flame.
- Frame: `lab_storm_base_2026-10-23.png`.

### Still open

- A thin bright straight line and a long straight edge, probably where curtain tops meet faded edge tiles, or at the middle tile's border.
- The wall cloud reads as a plateau with straight-ish sides.
- No near rain or scud yet.

## Wisps: how Severity does it (2026-10-23)

Studied from ref1, ref3 (4K), iov_14, and the base clip (`docs/storm-reference/clip_twisted_Oi47tIcTvK.mp4`).

**1. Fibrous textures.** Every cloud edge in Severity frays into curling strands: wall cloud undersides, scud, wedge flanks, ref3's base lip. Inside each puff the detail is fine and fibrous; outside it the texture fades smoothly to nothing. That is a smoke sprite with filament detail in its alpha: a dense middle eroding into strands at the edge. Severity probably bakes it from a smoke simulation. Roblox's own `smoke_main` is the same idea at 128 px. Our sheets (`smoke_flipbook.py` soft/flat) were deliberately featureless round blobs, which is why our clouds read blurry and round.

**2. Big, faint, many.** The particles are large and low-opacity (about 0.1–0.35) and overlap many deep:
- the middle reads solid
- each edge is built from many overlapping fibrous fringes, so it is wispy everywhere
- different masses (brown dust, blue-grey cloud) blend with no hard edges

**3. Long-lived and slow.** Frame-to-frame change in the base clip is 0.2/255 on average; over half a second it is 4/255. The particles live for many seconds and drift, turn, grow and flip slowly. The wisps morph; they do not scroll.

**4. One flat colour per layer, little lighting.** Contrast comes from what is behind (dark scud against bright rain), not from shading inside a puff.

**5. The funnel (Ref1).** The body is nearly featureless: a smooth gradient with a soft, darker band at the edge, faint strings, and the odd thin tendril. Wedges are particle masses with vertical fibrous streaks (iov_14). Our condensation texture was too strong (patches 0.2), which read as stark blotches. Now `patches` is 0.06, `streaks` 0.02, and the edge fringe is narrower and crisper (0.07 / 0.05).

**Built**

- `tools/smoke/wisp_flipbook.py`:
  - fine ridged noise (1 − |n|) along the zero-crossings of a smooth noise field, domain-warped by a flow field into curling strands, then softened
  - the puff's edge erodes into the strands, inside a faint mist
  - 4×4 white sheets with the shape in the alpha only (no draw-order flicker)
  - `wispy` (139989680557727): a puff with a torn fibrous fringe
  - `strands` (120187806290235): a tall streaky column
  - Single frames are saved as `wisp_texture_*.png`.
- Funnel: a new puff layer `wisps`, using the strands texture on a shell at the funnel's edge. It is big (0.7 of the width), faint (0.2), lives 5 s, rises with the funnel and drifts out. It is always on, even with the smooth ribbon.
- Real cone base: CloudBase cells are back on, with no sheet or ceiling. They are wispy lumps hanging from the wall cloud's underside, plus wispy scud.

**Gotcha (again).** Studio requested the new texture 1–2 minutes after upload ("Asset content representation is being generated") and cached the failure for the session. Wait about 10 minutes after an upload before Play, or restart Studio.

### Wisps in game (WispSprites.luau)

Particles can't carry wisps at chasing distances. At the lab camera (720 studs), all funnel particles have already handed over to sprites, and the wall cloud is about 940 studs away (the particle limit is about 800). So the wisps are pooled **BillboardGui** sprites (`WispSprites.luau`, `Config.wisps`). They draw at any distance and are still hidden behind nearer geometry. Each one fades in, turns slowly, steps through its flipbook at 1.5 frames a second, drifts and fades out.

- **funnel:** 48 strand sprites on a shell 0.85–1.1 × the radius. They climb at the condensation's speed and turn at 0.6 × the air's rate. Ones behind the funnel fade. Shade 0.85: unlit sprites read brighter than the lit ribbon.
- **wall:** 40 wispy sprites around the wall cloud's rim, 0.6–1.2 × its radius. They are darker than the cloud (0.78), because wisps show by contrast. They hang wholly below the underside: a sprite cutting into the mesh shows a straight edge.
- The ribbon's backlit rim is down to 0.08; at 0.22 it drew a glass-tube outline.

Frame: `lab_wisps_2026-10-23.png`.

### Smooth motion (2026-10-23)

Anything updated on a timer slower than the frame rate steps visibly. Fixed:

- **Funnel texture.** It was redrawn 20 times a second, so its turn and climb stepped. Now the condensation tile is drawn **once** (128×256: once round the funnel × one vertical noise period). Every frame, its UVs are moved per vertex: u = (asin(column) + spin + twist) / 2π, v = (height − rise) / period. `Ribbon.setUVs` does this with one BatchSetValues call on the UV ids, which works. The ragged edge moved into per-vertex alpha (`Ribbon.place` alphaMul), also every frame. Spin and rise wrap by whole tiles, so nothing jumps.
- **Wisp sprites.** An ImageLabel can't blend flipbook frames, so frame switches popped. Each sprite now has two images, this frame and the next, cross-faded smoothly.
- **Dust and sub-vortex strands.** Their flipbook mode was Random, which jumps between frames. Now Loop with a random start and FlipbookBlendFrames.
- **Wall cloud bands.** Recoloured every frame instead of 8 times a second (a few hundred vertices: cheap).

### Straight-line artifacts in the storm base

- **The thin bright line was a tile seam.** Bilinear filtering at a tile's texture edge wraps round to the far side of the image. The outer tiles' UVs now run from half a texel in from each edge, and the field is sampled so the edge texels sit exactly on the tile edges.
- **The hard diagonal edge was a rain curtain's top**, showing where the base above it is see-through. A part's Texture can't fade at its ends, so the curtains are now **Beams**:
  - they fade in at the ground and out into the base
  - FaceCamera
  - the texture scrolls down with TextureSpeed
  - they use `rain_shaft_beam.png`, the shaft turned 90° (87922397061431)
  - Beams only failed right next to the camera; these are kilometres away, and closer ones fade out.

### Base-edge wisps

WispSprites `edge`: 60 wispy puffs, 600–1,400 studs across, hanging along the base's outer edge. Each finds the edge in its direction by a binary search on `StormBase.field`'s alpha. They are darker than the base there, against the bright slot.

Checked in Studio (`lab_edge_wisps_2026-10-23.png`):
- The tile seam is gone.
- The base-edge wisps show along the lip against the slot.
- No new errors.
- Smoothness can't be judged from captures: Studio renders at ~15 fps while unfocused, so it has to be watched live.
- The beam rain texture (87922397061431) was still "being generated" 10 minutes after upload. The failure is cached for that session, so the rain beams draw nothing until Studio restarts.

## Dust, base and wall cloud (2026-10-23, after user feedback)

The feedback: the dust didn't match the references, the base looked too solid, and the wall cloud was hard to see.

**Dust.** In the references (Severity clips 10-37-29 / 11-04-14, real/01_cone_a/b) the dust is a dense, dark cloud hugging the foot. It is 2–6 funnel widths across, darker than the funnel, wraps round it in front and behind, and has frayed edges. Ours was a few pale, round tracer puffs drifting off sideways. Now it is WispSprites `dust`:
- 80 wispy sprites in a disc 5 × the ground radius across (at least 110 studs)
- they swirl at half the air's angular speed, spread 4 studs/s and rise 5 studs/s
- grey-brown (74, 71, 64)
- they fade when the funnel lifts

The particle debris and the DustView tracers are off for the Real cone.

**Draw order.** See-through things are sorted by their part's position. The ribbon's part now sits `sortBack` (4 × the ground radius) behind the foot, away from the camera, so dust in front draws over it. Side effects, both fixed:
- funnel wisps behind or on the face of the funnel now fade (they are kept to the silhouette)
- the puff carriers' far stand-in sprites only show where the ribbon hands over (they drew a pale glow on its face)

The particle `wisps` puff layer is off; WispSprites replaces it.

**Base.**
- Texels are now 64 per tile (32 studs).
- There is a third lump scale (85 studs), and `lumpShade` is 0.26.
- **Thin patches** over the outer part: `thin` 0.55 from 0.4 of the way to the edge, at a 900-stud scale. The sky glows through, so the base reads as layers, not a plate.
- WispSprites `scud`: 36 ragged wisps under the base between 0.9 and 4.5 km out, drifting in toward the wall cloud.

**Wall cloud.** It was slightly *lighter* than the base, which is why it was hard to see. Now:
- colour (34, 39, 45), darker than the base
- drop 0.28 × the base height, plateau 0.7: an abrupt lowering
- ragged rim scallops (`ragged` 0.1)
- striations 0.22, turning at 0.05 rad/s
- clear-slot collar strength 0.8

**Rain curtains, take 3.**
- Textured Beams this far out didn't draw at all in Studio 0.744; untextured ones did.
- SurfaceGui + CanvasGroup + UIGradient drew only slices.
- What works: each curtain is a **stack of 5 camera-facing textured parts**, fainter going up (`steps`), so it fades out toward the base with no hard top edge. The streaks are vertical, so the pieces join without a seam.

Frame: `lab_dust_wall_2026-10-23.png`.
