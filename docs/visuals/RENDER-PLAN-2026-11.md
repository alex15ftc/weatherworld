# Storm rendering: what we tried, what's wrong, what to build (2026-11-07)

Research for the user's question: billboards suit the wall cloud, inflow tail and tornado (the storm
lab got close); the storm body and the rain struggle when the camera turns; meshes were the
standard before. What can be done better, and are there tools or plugins that help?

Sources:
- the project's own history (memory notes, `docs/stormlab/STATUS.md`, `docs/cloudlab/STATUS.md`,
  `docs/stormlab/STORM-MESH-RESEARCH.md`, `docs/visuals-research/*`);
- a code read of every card, mesh and rain renderer;
- web research on Roblox up to RDC26 (Sept 2026), with links at the end.

## 1. The short answer

1. **Most of the camera-rotation trouble is caused by our own code, not by billboards themselves.**
   - The storm cards make view-based choices only at each re-plan (3-20 s apart):
     - which texture a card uses;
     - how tall it is drawn;
     - whether it exists at all.
   - Each choice is a yes/no switch: seen from below past 8.5°, under the deck, behind the base,
     on the silhouette, 40/320 px size bins, front/side/back sun bakes. Between re-plans they go
     stale, then flip at once.
   - Every lobe card's image is also rotated to the sun's direction on screen and re-aimed in
     batches after a 5° turn, so turning the camera spins the cloud.
   - Rain shafts swap texture frames as the camera moves (pool-slot bug, below).
   - All of this can be fixed.
2. **Billboards have three real limits:**
   - they always face the camera, so a flat sheet is a disc;
   - they are sorted by their centre, so big overlapping cards swap order;
   - they ignore Roblox lighting and fog.
   - A body made only of cards has to fight these everywhere. A body that is mostly hidden inside
     something opaque only fights them at its edge.
3. **Meshes don't depend on the view at all.** They failed on look, not on stability:
   - "dark rock", a black slab anvil, solid shells (Neon, harsh Roblox shading, hard silhouettes);
   - transparent meshes that can't be sorted;
   - EditableMesh memory (about 3 storms).
   - Two later projects solved the dark side: MeshView (SmoothPlastic, Roblox lighting, Highlight
     fill 0.55, gamma 0.7) and DeckView (soft discs under the base).
4. **Roblox still has no custom shaders, volumetric or regional clouds, or sort control** (RDC26,
   Sept 2026). EditableMesh/EditableImage are the only big new tools (still "beta", allowed in
   live games for verified owners). Raymarching into EditableImage has been tried by us (10-22)
   and by the community; it is too slow and can't be occluded properly.
5. **No plugin solves storm clouds.**
   - Useful tools are offline:
     - Blender, headless, already scripted here, for impostor atlases and puff and flipbook
       textures;
     - Houdini's Labs Impostor Texture node, for octahedral atlases;
     - EmberGen, a paid tool, for smoke and rain flipbooks.
   - We already have romcp / Open Cloud for uploads.

## 2. What to build

One rule throughout: **everything is placed in the world and changes smoothly; the camera may
change only size and opacity, every frame, never at re-plan.**

| Part | Method | Why |
|---|---|---|
| Tornado, dust, wall cloud, inflow tail, scud | Storm-lab billboards (TornadoCards, TornadoDust, WallStream, Scud), fed from engine frames through an adapter | User's verdict: these look best. Small objects, so sorting is local. |
| Storm body (tower, flanks, base) | **Opaque core + soft card shell.** A smooth opaque mesh (SmoothPlastic, Roblox-lit, Highlight fill) built from the frame's cloud columns, a little smaller than the cloud. Soft puffs sit only on and just outside its surface. | The core writes depth, so the cards never sort against each other through the body; only the edge puffs show. The mesh gives correct light and shadow for free. The puffs hide the mesh's hard silhouette (the "rock" look). |
| Shell puffs | View-correct cards: each puff is a 3-D blob. Every frame its on-screen width, height and turn are projected from its real extents (as `VolumeCards.luau` already does). Opacity comes from the chord through it. Images are round and symmetric, so they never need re-aiming. Shading goes in colour, not image rotation. | Removes the re-plan switches and the sun-angle spin. A flat base puff becomes a band from the side and a disc from below without any threshold. |
| Rain-free base overhead | Keep DeckView soft discs; the core mesh's underside gives the dark flat base | Both already worked. |
| Anvil | A few broad, flat, convex mesh plates with soft-alpha texture (SurfaceAppearance transparency), under 2048 studs each, plus edge puffs | Mostly seen from below; convex plates sort well. |
| Rain/hail shafts | Beams between attachments (FaceCamera, soft streak texture scrolling down, 2-3 per shaft), keyed to a fixed world rain cell, not to camera bins | Beams draw far, don't go edge-on with FaceCamera, and a world-keyed shaft can't jump. |
| Rain at the camera | ParticleEmitter on a part that follows the camera: VelocityParallel + Squash streaks, script `:Emit()`, plus Atmosphere density from the rain rate (already done) | Particles only draw ~800 studs, which is enough here. |
| Far storms (over ~25 km) | Later: one impostor card per storm from an atlas baked in Blender, picked by view angle, two cells crossfaded | Cheap. The far clip and fill rate stop mattering. |

Size: the core mesh is capped at 2048 studs a part. Storms are drawn at skyScaleAt (1 stud/m far),
so a 15 km tower is ~15000 studs. Either several parts, or the pulled-copy trick MeshView already
uses. Whether an EditableMesh part can exceed 2048 is untested.

## 3. Fixes worth doing even before the rebuild

- Rain shafts: the pool slot follows list order and skipped shafts shift it, so shafts swap
  texture frames and jump (`stormlab/client/Render/CloudParts/Shafts.luau` ~332-345). Key frames by
  bin.
- Stop rotating lobe images toward the sun on screen (`StormCards.luau` 535-544, 1063-1090).
- Turn each re-plan threshold into a per-frame continuous blend.

## 4. Experiments to run first (short, in a test place)

1. **Core + shell orbit test:** one frame's storm as an opaque smoothed core plus about 300 shell
   puffs; orbit 360° at 5 and 15 km and from under the base. Pass: no popping, no spin, no "rock".
2. **Beam shafts:** 20 shafts at 2-30 km while orbiting; compare with the current puff columns.
3. **Limits:**
   - can an EditableMesh MeshPart be larger than 2048 studs;
   - how far `:Emit()` particles draw;
   - the cost of 300 per-frame projected puffs.
4. **Look check** against reference photos with the visual-judge agent, from the five standard
   angles.

If 1 fails on the look of the core, the fallback is shell puffs only, with the view-correct card
rules. That still removes the camera spin and the re-plan pops.

### Results (2026-11-07, Studio 0.746, test place in the job folder; seed 2 21Z S0057 frame)

- **Mesh size: 2048 studs is a hard cap, scripted meshes included.** "Mesh extents size too large.
  Maximum is (2048, 2048, 2048)" for a 6000-stud EditableMesh. A near storm is ~11,000 studs across
  at the game's scale, so one mesh core is impossible; a core has to be many pieces.
- **Solid core under the puffs: fails on look.** I tried one opaque smooth ellipsoid inside each
  solid piece of cloud (285 blobs), three ways:
  - Roblox-lit: shiny balls, with sky reflections, showing through.
  - Flat fill through a Highlight: the Highlight draws over everything, the puffs included, so the
    storm became flat grey discs.
  - Unshaded Neon in each puff's own colour, deep inside only (157 blobs): hard-edged ovals still
    show.
  - Cause: each puff is only ~30% opaque, so anything solid behind it shows its outline. The body
    has to stay all-soft. Fallback (§4): view-correct shell puffs with no core.
- **Per-frame projected puffs are cheap:** 300 billboards re-sized from their 3-D shape every frame
  cost 0.21 ms (plugin Luau).
- **Beams draw far:** a 600-stud beam was still drawn at 20,000 studs (~54 km on the map).
- **Beam rain shafts work:** 368 beams (one per 2 km rain cell, FaceCamera, the rainShaft texture,
  25% opaque, grey) read as a rain curtain under the base and moved smoothly through a 6° orbit,
  with no pops.
  - To fix: it reads as one even wall; one bright streak where the texture lets sky through; give
    the rain rate's variation and a soft foot.
  - Note: a transparency sequence that starts fully clear at both ends drew nothing visible; keep
    the ends partly opaque.
- Not tested yet: how far `:Emit()` particles draw.

### Decisions and the first body change (2026-11-07)

- **No rain shafts** (the user). Rain stays as it is; the Beam shaft results above are kept only as
  a record.
- **The body stays all-soft** (the core failed). First change, in `PuffView:view` (called each
  render step by `client/EngineStorms`):
  - Each puff is drawn as the ellipsoid it stands for, from the sight line to it: its height on
    screen is the outline seen that way (a band from the side, a disc from below), and its opacity
    follows the chord through it (Beer-Lambert).
  - It depends only on where the camera is, so turning the camera can't change anything (checked: a
    40° turn in place changed 0 of 600 puffs).
  - Cost: 0.24 ms after a 20-stud move; 6 ms once on each new frame (plugin Luau, 600 puffs).
  - Seen: under the base, the gaps between base puffs fill into one continuous dark underside;
    side-on it is unchanged.
  - Not yet seen in a real play session: the game's own sky and light, and puffs swapping order
    while the camera moves.

## 5. Order of work

1. Done: the experiments; puffs drawn from their 3-D shape (PuffView:view).
2. Storm-lab tornado, wall cloud, tail, scud, dust and debris in engine mode (wired 2026-11-07):
   - No frame adapter needed: the server's lab sim already follows the engine (Sim/EngineFollow:
     the engine's storms and tornadoes, where and as strong as it says), so the lab renderers stay
     on in engine mode (client/WeatherClient), StormCards runs only for their light
     (ctx.state.cardsShadeOnly), and EngineStorms leaves out its own TornadoView and WallCloudView.
     Off switch: workspace StormNearLab = false.
   - Checked: they load and draw (864 billboards, 149 within 3000 studs of a test tornado).
   - Not yet judged by eye: in the test the scene under the storm was near black.
   - Scale (fixed 2026-11-07): the wall cloud, its tail and the scud are drawn across by
     WallCloudView's rule (LabConfig.radial / toWorldRadial): true scale within 3 core radii of a
     tornado under it, easing to the map's scale beyond, so they sit under the body's base. Widths
     take the scale across there; heights the vertical scale side-on, the across scale seen from
     beneath. The tornado stays at true scale (as TornadoView). In the lab both scales are equal, so
     nothing changes there. Effect measured: lab billboards within 3000 studs of the test tornado
     149 -> 370 (the lowering pulled in under the base).
   - Keys (fixed): EngineStorms' debug keys need LeftAlt held (Alt+T camera, which now frames the
     lab tornado, Alt+G layers, Alt+B body...); TornadoCards' T and NearVfx's B ignore LeftAlt.
   - Checked 2026-11-07 (user: spin "has the old issue", no visible wall cloud or tornado, too many
     MeshParts):
     - Spin: measured in play, the funnel turns at real speed (visual clock x1; 1.3 rad/s, a 4.8 s
       turn at a 45 m core and 38 m/s) - not the 8x sim clock of 2026-10-28.
     - The first test storm (seed 2, S0013) was a rain-wrapped squall-line EF0 (84 mph, 69 yd, low
       rotation 0.11, wall strength 0.19): no funnel to see. New test: seed 5, S0042, a semi-discrete
       supercell with a 117 mph / 256 yd tornado and a full wall cloud (tmp torserve3.mjs, port 3012).
     - Fixed: the lab tornado in engine mode settled below the engine's rating (13.7 m/s against
       37.5 on S0013): its own spin-up / decay factor was applied after the feedback to the engine's
       peak wind (Sim/Tornado). Now the engine's rating sets it; on S0042 the core reaches 38-40 m/s,
       condensed 40 m.
     - Seen from the east the lab wall cloud (dark, curtained) and a tilted cone funnel draw under
       the base as wanted. From the south a broad opaque brown dome hides the funnel: the lab's
       TornadoDust (found by hiding layers in turn), its dust tube and skirt for a funnel not
       condensed at the ground, ~1,500 studs wide and up to the 376 m base. Open: the user's call
       (the dust was tuned by hand in the lab). Hiding the engine deck also hid it - draw-order
       sorting, not the deck.
     - MeshParts: all storms' cloud meshes now share one budget (EngineStorms MESH_TOTAL 400, by
       each storm's view size, 24 to 350 a storm; workspace StormMeshTotal) - up to 6 storms had
       250-350 each. MeshView re-places its copies only when the camera or storm has moved enough to
       shift one by half a pixel (was every 0.25 studs: every frame while driving).
3. Storm body: turn the remaining fixed choices into smooth ones, check sort pops while moving,
   the far "slab" look.
4. Anvil, then far impostors. (No rain shafts.)

## Links

- EditableMesh/Image in live games: https://devforum.roblox.com/t/client-beta-in-experience-mesh-image-apis-now-available-in-published-experiences/3267293
- EditableMesh: https://create.roblox.com/docs/reference/engine/classes/EditableMesh.md
- EditableImage: https://create.roblox.com/docs/reference/engine/classes/EditableImage.md
- Sorting: https://devforum.roblox.com/t/semi-transparent-meshes-overlap-issue/2135260
- ParticleEmitter: https://create.roblox.com/docs/reference/engine/classes/ParticleEmitter.md
- Beam: https://create.roblox.com/docs/reference/engine/classes/Beam.md
- SurfaceAppearance: https://create.roblox.com/docs/reference/engine/classes/SurfaceAppearance.md
- RDC26: https://devforum.roblox.com/t/rdc26-what-we-announced/4865880
- Raymarched clouds (community): https://devforum.roblox.com/t/fully-raymarched-volumetric-clouds-in-roblox/4600251
- Particle clouds (community): https://devforum.roblox.com/t/3d-volumetric-clouds-no-decal-stacking/3267875
- Houdini impostor: https://www.sidefx.com/docs/houdini/nodes/out/labs--impostor_texture.html
