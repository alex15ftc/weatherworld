# Storm, cloud and precipitation visuals: plan (2026-10-22)

Goal: every storm feature a chaser sees (scud, wall clouds, mesocyclones, inflow bands, shelf clouds, anvils, overshooting tops, mammatus, rain and hail shafts, rain-wrap) and eventually any cloud type. Each is drawn from the weather engine's fields, at the realism the tornado reached, and checked against reference images the same way.

Engine inventory (what exists, what is sent, what Roblox draws today): section 5.

## 1. Principles carried over from the tornado work

1. **Fields, not paint.** Every shape, colour and motion comes from engine numbers (updraft speed, base and top heights, wind profile, dBZ, hail size, inflow direction). Looks are only lab presets of those numbers.
2. **The reference images decide.** For every feature: collect references, capture ours at matched framing (U/Y shot harness), measure with `tools/lookmetrics`, and grade blind.
3. **Pick the technique by scale.**

   | Distance | Technique |
   |---|---|
   | Under ~800 studs (the particle draw limit) | Particle puffs for soft, ragged detail |
   | Beyond that | Meshes |
   | Large smooth forms at any distance | EditableMesh shells with per-vertex shading (the Ribbon approach) |
   | Live textures | EditableImage on MeshParts. Beams can't show EditableImages. |
   | Things carried by the air | Wind-driven tracers, like `DustView` |

   Storms span kilometres, so most of a storm is mesh. Particles are only the near-field detail.
4. **One wind field.** Scud, inflow fractus, dust, rain-wrap and hail fall all follow the storm's wind: tornado `WindField` near the vortex, plus a storm-scale field (inflow, rear-flank downdraft, outflow) from the engine.
5. **Light from the scene.** One cloud albedo, lit by the sky and the sun. Colour grading (sepia, green, blue-grey) comes from sun elevation, haze and the storm's shadow, never from per-look painted colours. This also unlocks the tornado ribbon's "scene" colour mode.

## 1b. What the references say (details: `docs/storm-reference/NOTES.md`)

- **One lighting model, two looks.** Sunlit cloud is bright with hard cauliflower edges and deep self-shadow. Anything under the storm is dark, soft and sky-lit. That makes Phase 8 (light) a prerequisite for everything else.
- **Many storm forms are laminar, not lumpy.** Striated mesocyclones, shelf tiers and long flat bases need banded, smooth meshes (Ribbon-like). Lumps belong to tower tops and flanking lines.
- **The highest-contrast features:** the clear slot (a bright cut in the dark base), the bright rain or hail core behind dark scud, and the sunlit anvil above the dark base. Getting these contrasts right will matter more than detail.

## 2. Toolkit to build once and reuse

| Tool | What it is | Used for |
|---|---|---|
| `CloudMesh` | An EditableMesh shell around a field-defined volume: displaced by noise for lobes, per-vertex shading (sun, wrap lighting, self-shadow from height and thickness, backlit rim), alpha from depth at the edges, fixed bounds (2048-stud mesh limit, so split big forms into tiles). It generalises `Ribbon`. | Tower, anvil, overshooting top, rain-free base, shelf, wall cloud |
| `PuffCluster` | Locked particle puffs on mesh-surface anchors, faded by distance (hands over to the mesh beyond about 600 studs) | Ragged edges, cauliflower detail, scud |
| `Tracers` | `DustView` generalised: picked up where a field allows, carried by the wind, with lag and turbulent lift | Scud and inflow fractus rising into the wall cloud, dust in the outflow, rain-wrap curtains turning round the meso |
| `Shafts` | Curtain meshes (soft vertical sheets, camera-facing per column like the ribbon) with opacity from the dBZ column and tilt from fall speed and wind; a scrolling EditableImage texture for the falling streaks | Rain and hail shafts, virga, rain-wrap |
| `NearPrecip` | Particle rain streaks around the camera (rate from rain rate, tilt from surface wind), splashes, wet-ground surfaces, sound; hailstones as small parts or particles sized by hail size, with bounces, sound and damage | Precipitation at the player |
| `Impostor` | An optional billboard snapshot for very far storms, if mesh counts get heavy | Storms near the horizon |

## 3. Phases (in the A+ planner as phases 7-12)

### Phase 7: references and a storm lab
- **References** (user plus research), per feature:

  | Feature | References wanted |
  |---|---|
  | Supercell structure | LP, classic and HP; from 5, 20 and 60 km |
  | Cloud base | Wall cloud, tail cloud, scud rising, clear slot |
  | Inflow | Inflow bands, beaver tail |
  | Gust front | Shelf cloud, multi-tier shelf, whale's mouth |
  | Upper storm | Anvil from the side and from below, backsheared anvil, overshooting top, mammatus at sunset |
  | Precipitation | Rain shafts, hail shafts (green and white), rain-wrapped tornado, virga, gustnado |

  Severity and Twisted footage plus real chaser photos.
- **One lab place:** TornadoLab grows into the storm lab (the user's call, 2026-10-23). It gets a storm mode that plays the engine's StormReplay frames, alongside the tornado looks, with the same free camera, shot harness and metrics. Matched framings are set per reference.

### Phase 8: sky and light
- Colour grading from the sky state: sun elevation, haze and moisture from the `sky` grid, and the storm's shadow (SkyLight already estimates it). The looks lose their painted colours.
- Done when sepia, green and blue-grey scenes come out of the lighting alone, and the tornado ribbon runs in "scene" colour mode.

### Phase 9: storm silhouette
- **Tower:** a CloudMesh from `updraft{radiusKm, baseM, topM, speedMs}`. Cauliflower lobes are noise displacement scaled by updraft speed, and the tower tilts with the wind profile, which the engine must send.
- **Overshooting top** from `overshootM`.
- **Anvil** from `anvil{lengthKm, widthKm, bearingDeg, topM}`: a flat top, a sharp upwind edge, thinning and fraying downwind, and a backsheared edge for strong updrafts.
- **Mammatus:** pouch displacement on the anvil's underside from `mammatus`.
- **Flanking line:** towers stepping down along the inflow side.
- Done when matched-framing grades against the supercell-structure references reach A.

### Phase 10: cloud-base features
- **Rain-free base** (`base`, `rainFree`).
- **Wall cloud** (`wallCloud`): a lowered disc with a ragged edge. Rotation in rad/s comes from mesocyclone strength via the wind model. Tail cloud along `tailBearingDeg`.
- **Inflow bands** (`inflowBands{fromDeg,count,lengthKm}`) and a beaver tail along the inflow.
- **Scud:** tracers picked up in the moist inflow below cloud base, carried by the storm's inflow and updraft into the wall cloud, rising and condensing.
- **Clear slot** (`rearFlank.clearSlot`): a cut in the base wrapping round the wall cloud.
- **Shelf cloud** (`shelf`, `gustFront`): a CloudMesh wedge along the gust front, with tiers, a scud-laden underside and a whale's mouth behind it.
- Done when they match the base-feature references from the ground, 2–10 km out, and the motion looks right in timelapse.

### Phase 11: precipitation from dBZ and hail size
- **Engine:** send a storm-relative precipitation grid with each storm: low-level dBZ, drop size, snow share and hail size (MESH) on about 32×32 cells at 1 km, plus the freezing level.
- **Rain rate** from dBZ with Z = 300·R^1.4 (convective), giving mm/h. Hail size comes from the hail field and MESH.
- **Shafts:** curtain opacity from the dBZ of each column. Fall-streak tilt comes from fall speed and wind, so rain-wrap curls round the meso. Hail shafts are whiter, or green-tinged where hail is large.
- **At the player:**
  - rain streak density and size from rain rate and drop size
  - splashes, wet-ground darkening and reflectance
  - visibility via Atmosphere density from rain rate
  - sound
  - hail by size class (pea, quarter, golf ball, baseball, larger): bounce, sound, damage to players and vehicles via `WindPhysics.impactDamage`
- Done when shafts match the references, rain at the player scales with dBZ, and hail size matches the engine's.

### Phase 12: every other cloud
- A general cloud field from the sky grid and humidity profile (low/mid/high cover, LCL, moisture layers):
  - fair-weather cumulus
  - towering cumulus
  - stratus and fog
  - altocumulus
  - cirrus
  - outflow-boundary arcs
- The same toolkit throughout, with impostors for far cloud fields.
- Done when each cloud type passes against its references.

## 4. What the engine needs to send (add to the game feed)

| Need | Engine source |
|---|---|
| Precipitation grid per storm (dBZ, drop size, snow share, hail) | `js/radar/PrecipitationField.js` (already computed; 0.4–2.5 km, 10 levels) |
| MESH, echo tops, VIL | Radar mosaic (`RadarSimulator.js`) |
| Freezing level, −20 °C level, EL | Radar scene (`RadarSimulator.js:141-159`) |
| Wind profile / shear (tower tilt, anvil, fall-streak tilt) | `storm.environment` winds (surface, 850, 500 mb) |
| Mesocyclone position and radius; hook arc; inflow notch | `StormStructureEngine` lobes |
| `lifecycle.phase`, age | `Storm.js` |
| Engine-placed lightning | Lightning products (3-D placement is not used today) |

## 5. Engine inventory (2026-10-22)

**Sent every 25 s, per storm:**
- `updraft{radiusKm, baseM, topM, overshootM, rotation, striation, speedMs}`
- `base{radiusKm, rainFree}`
- `wallCloud{radiusKm, loweringM, rotation, strength, tail, tailBearingDeg}`
- `inflowBands{strength, fromDeg, count, lengthKm}`
- `rain{alongKm, acrossKm, bearingDeg, intensity, wrap}`
- `hail{radiusKm, sizeInches}`
- `rearFlank{wrap, strength, clearSlot, downdraftMs}`
- `gustFront{radiusKm, leadKm, strength, gustMph}`
- `shelf{strength, facingDeg, heightM, tiers, detached, halfArcDeg}`
- `line{share, halfLengthKm, axisBearingDeg, bow}`
- `anvil{lengthKm, widthKm, bearingDeg, topM, mammatus}`
- `lightningPerMin`, `tornado`, `funnelAloft`
- Plus `sky` (a cover/temperature/wind grid of about 20 mi cells, and the sun).

**Not sent:**
- The 3-D precipitation field
- dBZ, MESH, VIL and echo-top mosaics
- Freezing level and EL
- Wind profile
- Structure lobes
- Lifecycle phase
- Engine-placed lightning

**Not computed:**
- Surface rain rate
- Hail count or size distribution at the ground
- Shapes for the wall cloud, shelf curve, inflow bands, clear slot and bounded weak echo region (BWER)
- Cloud types at storm scale

**Roblox today (`client/StormView.luau`):**
- Sphere blobs, rods, and camera-facing Beam puffs for the tower, base, anvil (with 6 mammatus blobs), wall cloud (with orbiting scud), inflow bands and shelf.
- Vertical Beam rain curtains (with rain-wrap) and 2 hail curtains.
- One sparkle particle emitter for rain at the camera; no hailstones, splashes or wet ground.
- Random lightning bolts.
- `SkyLight` sets the sun, Atmosphere haze and storm shading.
- A ray-marched cloud prototype exists but is off.
- Unused fields: `base.rainFree`, `rearFlank.*`, `spectrum`, `line.bow`.

## 6. Progress

**2026-10-23: storm mode, and the first storm shells**
- **Storm mode in TornadoLab:** key N (`roblox/src/lab/client/StormStage.luau`).
  - Plays the engine's storm replay (seed 8181, `src/worlddata/StormReplay`) through the game's own `StormView` and `SkyLight`.
  - Puts the replay's tornado touchdown at the lab's origin. This uses `Config.VIEW_ORIGIN_KM`, read from the ReplicatedStorage attribute `ViewOriginMiles`.
  - Keys: `,` `.` step frames; `/` sets speed; `;` `'` shift the time of day; U/Y step the storm shots (`Shots.STORM`, 9 framings from 40 km to under the base).
- **`StormView.start(feed?)`** takes a frame source (the lab's), and `StormView.setRunning` switches it on and off. The game's behaviour is unchanged.
- **`CloudShell`** (`shared/Weather/CloudShell.luau`): a closed shell built as an EditableMesh.
  - **Scaled copy:** drawn at camera + (P − camera)·k, which looks identical from the camera. This gets around both the 2048-stud part limit and Roblox not drawing parts tens of km away. One k per storm keeps its parts in the right depth order.
  - **Opaque:** any vertex alpha below 1, including the hidden sliver that fixes the mesh's size, sends the whole mesh to the see-through pass. There its own faces aren't depth-sorted.
  - **Winding:** (a, c, b) with rows × columns pointing outward. Checked with the Workspace attribute `CloudShellNormals`, which colours faces by normal.
  - **Shading:**
    - Every face shares one normal, turned toward the sun each frame, so Roblox's own lighting is constant.
    - Vertex colours carry the actual shading: sun with wrap, sky light by upness, bounce from below, the anvil's shadow, darker creases between lobes, a silver edge, and haze over the true distance.
- **`StormMesh`** (`client/StormMesh.luau`) shapes, from the feed fields:
  - **tower:** cauliflower lobes scaled by updraught speed, a lean, and a dome over the top.
  - **anvil:** flat top, rooted over the tower, spreading downwind, mammatus, fibre streaks.
  - **base:** a lens with the wall cloud lowered out of it.
  - Settings are in `Config.STORM_MESH`. It replaces the blob tower, base, anvil and wall cloud for the nearest storm.
- **Captures:** `captures/2026-10-23_*.png`.
  - **old renderer:** at 20 km only a disc showed; at 40 km nothing did.
  - **under the base:** a dark slate deck over a bright horizon, close to the Severity clip.
  - **from the west at 5 pm:** a sunlit white cauliflower tower under a dark anvil.
- **Limits found:**
  - **Memory:** EditableMeshes share a memory budget, so `storms = 1` for now. The lab's hidden tornado meshes count against it too.
  - **Speed:** Studio runs at 2–13 fps in storm mode; it hasn't been profiled.

**Next (Phase 9 continued):**
- **Base:** a dark underside that doesn't show a sunlit rim; the wall cloud seen from 3–8 km.
- **Soft edges:** a see-through fringe shell around each opaque core.
- **Anvil:** a crisp sunlit top edge and fraying downwind; an overshooting top that reads.
- **Detail:** finer lobes on the top third.
- **Budget:** release the tornado-lab meshes in storm mode, so two or three storms can have shells.
- **Grading:** matched framings against `01_classic_supercell_b`, `13_towering_cumulus_b` and `08_anvil_side_a`, then a grade.

**2026-10-23 (later): soft edges, self-lit shells, and puffs against shells**
- **Soft edges:** each shell has a see-through fringe, a copy pushed slightly outward that fades to nothing edge-on.
- **Self-lit:** shells are Neon now. Roblox's scene light (SkyLight's exposure, a low sun) had been flattening the vertex shading.
- **Base:** shaded by the tower and anvil above it; ragged outline at two scales; lumps underneath.
- **Shell pool:** sets of shells are reused from storm to storm. Destroying and rebuilding them ran out the EditableMesh budget.
- **Which storm gets shells:** the nearest storm that's in view.
- **Puff style (user's question: use the tornado's particles instead?):** key I in storm mode switches to it (`Config.STORM_MESH.style`).
  - Same shapes and light; puffs on a coarse grid of each body's surface.
  - The whole storm is shrunk into particle range (~650 studs), since particles don't draw past ~800.
  - **Result** (`captures/2026-10-23_05_shells_vs_puffs_40km.jpg`): at 40 km, puffs read as a soft smoke blob. They lose the tower's lobes, the flat anvil and the thin base, the forms the reference photos are built on. The shells keep that structure but look solid.
- **Direction:** a hybrid.
  - Shells give the structure at a distance.
  - Particles give everything soft: the base underside, scud, the wall cloud, rain curtains, and the anvil's fraying edge.
  - Particles also add surface puffs over a shell as the camera nears it, where puffs are small enough to look like cloud detail.
  - Default stays "shells".

**2026-10-23 (evening): the hybrid, measured against references**
- **Hybrid** (`Config.STORM_MESH.style = "hybrid"`, the default):
  - **Shells** carry the structure (tower, anvil, base).
  - **Particles** carry the soft parts, all at the storm's one scale so the depth order holds:
    - detail puffs over the tower
    - frayed anvil sides
    - the base's lumpy underside
    - scud that turns round the wall cloud and rises into it
    - rain shafts from the feed's rain ellipse, whiter with hail
  - Puffs fade out as the camera comes into them.
- **Reference shots** (`Shots.STORM` S1 and S2, each with frame, time of day and framing):
  - **S1:** `real/01_classic_supercell_b`, structure at about 50 km, 5 pm, low sun behind-left.
  - **S2:** `real/12_mesocyclone_striations_c`, under the base's edge, from the inflow side.
- **Metric:** `tools/lookmetrics/storm_metrics.py` + `storm_shots.json`.
  - Compares regions (sky, lit, shade, base) for brightness, colour and texture, against the photo.
  - Ratios: lit/sky, shade/lit, base/lit, warmth, sky blue, texture, exposure.
  - Writes side-by-side sheets to `tools/lookmetrics/out/`; captures are in `tools/lookmetrics/captures/storm/`.
- **What the comparison changed:**
  - **Tower lobes:** noise in real km (round bubbles, not vertical drapes); smooth plateau noise in the mesh (billowing noise aliased into shards); gentle mesh swell (0.35); the fine cauliflower from the detail puffs.
  - **Anvil:** knuckles on its young part; twice the rows.
  - **Base:** lumps use the smooth noise; higher resolution.
  - **Light:**
    - a low sun dimmed through boundary-layer haze on the lower storm
    - a warmer sun below elevation 0.9
    - no wrap lighting
    - less sky fill
    - light from below (ground and horizon) set by daylight alone, not by sky level as well (undersides had come out black)
    - base albedo 0.7
  - **SkyLight (game-wide):** storm darkening of exposure 0.4 → 0.1; sky-light floor under a storm 0.15 → 0.4 (under a base the scene was about 4× darker than the photos).
- **Comparison sheet:** `captures/2026-10-23_06_hybrid_vs_references.jpg`.
  - **S1:** the tower now reads as a cumulonimbus.
  - **S2:** from black to a lit, lumpy storm underside.
- **Gaps still open:**
  - **S1 framing:** the storm should fill the frame like the photo.
  - **S1 anvil:** too thin and smooth; it should be a billowing mass.
  - **S1 shade and warmth:** the shaded side is still too bright (0.86 vs 0.48), and the lit cloud lacks warmth.
  - **S1 sky:** too pale and bright. That's the Roblox sky, Phase 8.
  - **S2 base:** facets visible up close. It needs a smooth laminar base (layered tiers, striation bands) and overcast light.
  - **Metric:** regions hand-placed per capture, which makes round-to-round numbers noisy. Next: automatic regions (cloud mask from sky colour; horizon line).

**2026-10-23 (night): smooth motion, rounds 8-10**
- **Smooth motion:**
  - **Cause:** shapes and puffs were rebuilt every 0.5 s at the storm's current position and held still in between, so storms stepped.
  - **Fix, part 1:** shells and puffs are now drawn moved by how far the storm has gone since the last rebuild (`shapedFrom` / `moved` in StormMesh; `CloudShell.draw(..., offset)`).
  - **Fix, part 2:** the anvil-knuckle and base-lump noise is now tied to the storm instead of fixed map positions. Before, the pattern slid through the storm at each rebuild.
- **Automatic metric regions** (`storm_shots.json` `auto`):
  - sky = blue pixels above the horizon; cloud = the rest
  - lit / shade / base = the cloud's brightest 15%, its 25–45% band, its darkest 15%
  - added measures: cover (how much of the frame is cloud) and texture
  - S2 ignores sky ratios (its photo has almost no sky)
- **Shape and light:**
  - **Lobes:** round in studs, not km. The world is drawn about 1.6× taller than wide, so km-round lobes showed as tall drapes.
  - **Anvil:** 2400 m thick, with knuckles over its upwind half and detail puffs on its top.
  - **Base:** striation tiers and bands from `updraft.striation` and `rotation`.
  - **Light from below:** reaches only downward faces (`(1 - skyShare)^2`).
  - **Haze:** uses SkyLight's weather-derived visibility, warmer when lit by a low sun.
  - **Highlights:** scaled past white as a whole (clamping each channel washed warm light out to white).
  - **Rain shafts:** darker and denser.
  - **S1 framing:** 13 km, field of view 66.
- **Scores** (0 = same look; regions found automatically):
  - **S1:** 0.76 → 0.83 (round 7) → **0.57**. Lit-cloud to sky fell from 4.9 to 4.5 only because the camera got closer.
  - **S2:** 0.56 → 0.42 → **0.30**.
- **Sheet:** `captures/2026-10-23_07_round10_vs_references.jpg`.
- **Remaining gaps:**
  - **S1:**
    - the sky is too pale and bright (lit/sky 1.5 vs 4.5; sky blue 0.5 vs 1.05). That's the Roblox sky, Phase 8, and the biggest single difference.
    - the base and rain are too light (0.49 vs 0.14 of the lit cloud).
    - the mesh's lower tower is still faceted.
  - **S2:** the anvil underside overhead is faceted. It needs a smooth, rounded underside or particle cover.

**2026-10-23 (late): performance and rain**
- **Measured** (lab panel line "storm cost", from `StormMesh.stats`), at the S1 framing:

  | | Before | After |
  |---|---|---|
  | Script per frame | 10.8 ms | 0.3 ms |
  | Shading per frame | 7.9 ms | 0.0–0.6 ms |
  | Rebuild spike | 16–23 ms every 0.5 s | ~3 ms slice |
  | Particle puffs | 748 | 417 |

- **What changed:**
  - **Shading:** shells are re-coloured only when the sun or the camera's view of them changes (1% of distance), at most one shell a frame (`shadesPerFrame`).
  - **Rebuilds:** every 3 s instead of 0.5 s; one body at a time, made in a coroutine over several frames with about 2 ms per frame (`shapeBudgetMs`, `pace()`). Motion between rebuilds stays smooth through the storm-motion offset.
  - **Scale steps:** the shared scale k changes in 5% steps. Any k looks the same from the camera, and a changed k moves every vertex.
  - **Fewer detail puffs.**
- **Rain without smoke particles:**
  - **Shafts:** streaked Beams (`CLOUD_ART.rain`, the Blender rain-curtain texture), one per column across the feed's rain ellipse, scrolling down, drawn at the storm's scale (`drawRain` in StormMesh). The old curtains, scud and inflow bands are off for storms drawn by the hybrid.
  - **At the camera:** two rings of camera-facing streak sheets (12 Beams) in place of the sparkle particle emitter. Workspace attribute `ForceRain` (0–1) tests it.
  - **Open:** up close the streaks are too fine to see. Needs a bolder near-rain streak texture (Blender, like `tools/blender/rain_curtain.py`), splashes, and hail.
- **Open:** a grey haze hangs round the storm from the rain side. Not identified yet: rain shafts, detail puffs or the shelf cloud's old puffs.

**2026-10-23 (late 2): the haze found, rain textures**
- **Layer switch** in storm mode: key `=` hides one layer at a time (old renderer, shells, cloud puffs, rain shafts, camera rain).
- **The grey haze** round the storm was the base's underside puffs. With 18 round a base 10 km wide, each was ~6 km and hung to the ground. Now 30 round, capped at 0.9 km (tower puffs at 1.8 km).
- **Rain shafts were nearly invisible:**
  - opacity was intensity × a texture that is mostly empty between fine streaks; from 20 km they showed as specks
  - new texture `tools/rain/rain_shaft.py`: a soft column with faint streaks, `CLOUD_ART.rainShaft = rbxassetid://86246653635299`
  - opacity = 0.25 + 0.65 × intensity
  - Workspace attribute `DebugShafts` paints them red to find them
- **Near rain:** new bold-streak texture `tools/rain/near_rain.py`, `CLOUD_ART.nearRain = rbxassetid://105774957466433`, on the camera rain rings.
- **Both new textures** were "being generated" in this Studio session, so they need a Studio restart to show. Not yet seen in-game.
- **2026-10-23 (after a Studio restart):**
  - **Distant shafts** with `rain_shaft` draw as soft streaked grey columns under the base.
  - **Rain at the camera** is now camera-facing textured Parts (a `Texture` with near_rain, OffsetStudsV scrolled at the fall speed). Beams round the camera never drew in Studio 0.744, even plain red ones with valid attachments; textured parts draw.

**2026-10-23 (late 3): stepping, performance, precipitation from radar**
- **Smooth motion:**
  - **Shell scale:** each shell's scale changes continuously; the part is resized, and the mesh vertices are written once per shape at the largest scale.
  - **Scud:** follows its path every frame, and its fade-in and fade-out follow the clock.
  - **Detailed-storm choice:** has hysteresis, so swapping which storm is drawn in detail no longer pops.
- **Performance:**
  - **Cause:** the old blob renderer's other storms (hundreds of puffs) were redrawn every frame, costing ~70 ms a frame and running at 6 fps.
  - **Fix:** they're now redrawn every 0.3 s, staggered, and at once when the view turns more than about 10°. Storms within 4 miles still redraw every frame (`Config.STORM_OLD_CLOUDS`).
  - **Result:** storm renderer 1–8 ms a frame; lab 40–60 fps, up from 6–20.
  - The lab panel and an output line `[Perf]` show storm cost, renderer total, the old renderer and sky light.
- **Precipitation from radar:**
  - **Feed:** each storm now carries `precip` (20×20 cells of 2 km, low-level dBZ, MESH hail inches, snow share, maxDbz, freezingLevelM), built by `js/radar/StormPrecipGrid.js`. The seed 8181 replay is regenerated: storm S0007, 35 frames.
  - **Shafts:** placed over the strongest cells (≥ 35 dBZ, up to 40), denser with dBZ, whiter with hail.
  - **At the player:** rain rate from dBZ (Z = 300·R^1.4) and hail size from MESH under the camera (`shared/Weather/Precip.luau`).
  - **Ground effects:** hailstone sprites falling at their fall speed and bouncing, splashes on the ground (`tools/rain/splash_hail.py`). Workspace attributes `ForceRain` and `ForceHail` test them.
  - **Rain direction:** the rain round the camera was scrolling up. Measured, then fixed: OffsetStudsV must decrease for rain to fall.
- **Open:** MESH runs below the engine's own hail size (0.6–0.9 in vs 1.5 in); see the engine's MESH.
- **Lifecycle and storm types plan:** `docs/storm-visuals/LIFECYCLE-AND-TYPES.md`.

**2026-10-23 (late 4): storm visuals round 11, lifecycle, lines**
- **Visuals** (`captures/2026-10-23_08_round11.jpg`):
  - **Approach:** the meshes are now a smooth core (tower lobes 0.35 → 0.1; steep lobes had made shards). The cauliflower is carried by about 2,100 detail puffs: tower 26×40, anvil 30×24 over the young two thirds and the sides, and the base underside and rim.
  - **Fringe:** pushed out 0.012 (at 0.04 its normals crossed in the creases).
  - **Base:** a lens (squareness 1), 450 m thick, albedo 0.45.
  - **Anvil:** billows over its whole length; streaks 0.35.
  - **Light:** ground light 0.42.
  - **Sky:** SkyLight's clear-air haze lowered (0.5 + 3·RH⁴ → 0.15 + 1.2·RH⁴; game-wide).
  - **Shots:** set a local clock time (`localHour`) instead of an hour shift, since replays start at different times.
- **Precipitation, less invasive:** camera rain opacity at most 0.27 (was 0.8), grey, finer streaks; hail and splash rates down, smaller sprites.
- **Lifecycle** (engine `life` block, orphan anvils, merge/split ids; see the engine agent's notes in `js/storms/StormAppearance.js` `stormLife`). Client side (`StormMesh` `lifeOf`, `Config.STORM_MESH.life`):
  - **towering:** bigger lobes, and the anvil only a small cap until it has grown.
  - **decay:** the tower slims and smooths, its puffs fray.
  - **fade** (orphan anvil): tower and base gone; the anvil thins, its solid core hidden past fade 0.5, its puffs fading out.
- **Lines** (`lineStretch`):
  - Once `line.share` passes 0.3, the tower and base are stretched along `line.axisBearingDeg` to `halfLengthKm` (the lobes stay round), and the middle bows ahead with `line.bow`.
  - The line replay (seed 2112, QLCS → MCS) is in the lab on key 0. Shots "line ahead of the shelf" and "line under the shelf" aim from the storm's own `shelf.facingDeg`.
  - Capture: `captures/2026-10-23_09_line_ahead_of_shelf.png`.
- **Open:**
  - A shelf-cloud body (the wedge along the gust front with tiers) in StormMesh; lines still lack it.
  - The anvil underside band is still smooth.
  - The old renderer's rain curtains for distant storms look like sheets.
  - Type looks (LP / HP / pulse / multicell) beyond what the fields already give.
  - The lifecycle visuals haven't been watched through a whole storm life.

### 2026-10-23 (later): shelf body, line fixes, modular question
- Shelf cloud shell added (StormMesh shelfShape, Config STORM_MESH.shelf): wedge along the gust front from the feed's shelf/gustFront, soft tiers, lumpy dark underside, under-anvil/tower light. Old renderer's shelf off for meshed storms.
- Fixed: the reshape turn stalled forever on a body that is not shown (no shelf; orphan anvil's tower/base).
- Fixed: shards along squall lines. Base and shelf lumps were finer than the row/column spacing once stretched 100+ km; lump size is now at least 3 spacings. Top/bottom seam at the shelf nose closed.
- Distant curtains (old renderer) use the soft rainShaft texture.
- Line view still reads as one dark slab. User suggests modular cloud pieces (a kit reused across storms) instead of unique per-storm meshes; proposal in the chat, awaiting a decision.

### 2026-10-23 (later still): cloud kit (modular storms), user's call
- The user asked for modular cloud pieces and chose "do both": we make the pieces now, and their
  friend can replace them later. See KIT.md.
- **Pieces:** `tools/blender/cloud_kit.py` makes 13 of them: tower caps and bodies, anvil, base,
  shelf, wall cloud and mammatus. Each is about 3k vertices with AO baked in. They are stored as
  Luau data (CloudKit/Pieces) and uploaded as one Model, asset 111990332715428
  (`cloud_kit_glb.py`). Contact sheet: `roblox/assets/cloudkit/previews/sheet.png`.
- **Assembly:** `client/StormKit.luau` builds every storm in view from the feed:
  - tower: body pieces about as tall as wide, a cap on top, leaning downwind
  - anvil: sections spreading downwind (along the whole line for a line storm)
  - base: slabs, plus the wall cloud
  - shelf: segments along a line's leading edge, or an arc ahead of a cell
  - line: a row of towers along the axis, bowing
  - mammatus
  - life: young towers get a big cap and a small anvil; decaying ones slim and fray; an orphan
    leaves only the anvil
  Settings: `Config.STORM_KIT`.
- **Drawing:** all storms share one scale (copies drawn at 0.06 along the view rays), so their
  depth order is preserved. Pieces use Roblox's own lighting (SmoothPlastic, real normals) with
  AO from vertex colour.
- **StormMesh** now draws only the scud and rain shafts. The old renderer skips cloud bodies for
  kit storms but still draws distant rain.
- **Performance:** about 60 fps with around 230 pieces in the lab, at roughly 0.2 ms a storm.
  Three problems were found and fixed:
  - Transparent anvil edges cost a lot to draw (15 fps), so the anvils are now solid.
  - Pieces built at runtime ran out of EditableMesh memory, hence the upload.
  - Uploaded parts in Workspace cost physics time (15 fps), so they now sit under the camera.
- **Shelf placement:** it was drawn at the engine's gustFront.leadKm, about 31 km out. It now sits
  at the leading edge plus `detached` × at most 8 km.
- Captures: `captures/2026-10-23_10_kit_supercell.png`, `_11_kit_line_towers.png`,
  `_12_kit_line_ahead.png`.
- **Open:**
  - No distance haze. Making far pieces transparent looks glassy; another method is needed.
  - The base reads as a flat saucer.
  - The wall cloud is weak.
  - The anvil underside is too bright.
  - Pieces pop when a layout's piece count changes.
  - Fading during the life cycle uses transparency (glassy).
  - Particle detail (cauliflower puffs) over the pieces is off for now.
  - The kit has not been seen in the game place yet (only the lab).

### 2026-10-23 (evening): kit haze, darker bases, grow-in
- **Distance haze: Roblox's own Atmosphere does it now.**
  - Each piece's draw scale grows with its real distance. Up to 15 km it stays at 0.06; from there it rises over 40 km to 0.14 (`STORM_KIT.farScale/farFromKm/farOverKm`).
  - Far pieces are therefore drawn far enough out for the weather-driven Atmosphere to haze them.
  - The drawn distance still increases steadily with the real distance, so depth order holds. The view is unchanged, since every piece moves along its own view rays.
  - A storm 40 km away now takes on a blue tint.
  - Why not 0.14 everywhere: near storms at that scale (huge pieces overhead) cost 4× the frame time.
- **Approaches that didn't work:**
  - Transparency looks glassy.
  - SurfaceAppearance emissive glow needs an emissive mask, which only plugins can set; scripts can't. romcp's apply can't write Content values, and Rojo 7.4.4 doesn't know the property.
  - A glb with an emissive texture imports with a broken texture reference (asset "3"). It was uploaded as 105566471254866 and is now unused.
- **Base, wall cloud and shelf** albedos were lowered to 0.2, 0.16 and 0.55. The base's brightness ratio to the lit tower is now 0.30 (photo 0.14).
  - S1 score: 0.855 → 0.658 for the kit; the old renderer scored 0.54.
  - The rest of the gap is the game's sky, ambient and warmth (sky too bright, shadow side too bright, too cold) and the framing.
- **Tower pieces** no longer get the anvil-shadow tint. It was crude and darkened the whole tower; Roblox's lighting already shades by sun direction.
- **Large bases** are split 2×2 so no piece exceeds the part-size limit. Any piece still too big is drawn nearer, and the lab counts these.
- **Pieces new to a layout** grow in over 1.5 s.
- **Unexplained:** the lab sometimes drops to 15 fps regardless of settings. The kit's CPU cost stays under 0.4 ms, and the same view runs at 60 in another session. Possibly Studio throttling itself; watch for it in the game.
- Captures: `_13_kit_S1_haze`, `_14_kit_S1_darkbase`, `_15_kit_line_west`, `_16_kit_haze_40km`.

### 2026-10-23 (late): wall cloud, detail puffs tried
- **Wall cloud visible.** The base slab hung 60% of its 600 m below the cloud base, which swallowed a 417 m lowering. It now hangs 20% (`STORM_KIT.base.hang`). From 3 km the tornado comes out of a dark lowering, with the rain curtain and a bright gap beside it (`captures/2026-10-23_17_kit_wallcloud_3km.png`).
- **The wall cloud turns slowly**, at `wall.rotation` × `wall.spin` rad/s, applied each frame.
- **Detail puffs on the kit pieces: tried and off** (`STORM_KIT.detailOn`). `CloudKit.samples` and `surface` plus `StormKit.puffPoints` feed StormMesh's puff system. But the puffs are coloured by CloudShell's light model, and over Roblox-lit pieces they came out as grey and orange dots and cost about 20 fps. To revisit, they need Roblox's light (LightInfluence) and many small puffs.
- **Lab:** the `=` layer cycle now includes "cloud kit" (parts under the camera).
- **Known risk, not yet seen:** a kit piece really behind the tornado is drawn nearer than the tornado, which is at true scale, and could hide it. The 8 km shot had no tornado in frame even with the kit hidden, so it is unconfirmed. Fixing it means drawing the tornado in the same scaled space, or using small base slabs near the tornado at full scale.
- **Game place not tested.** Only the lab's Rojo project is served here; the game needs default.project.json served and the place open in Studio.

### 2026-10-23 (night): baked vapor sprites, and volumetric-cloud research
- **Puffy pieces are now baked Cycles volumes.** Tower caps, tower bodies and mammatus use `tools/blender/cloud_vapor_bake.py`, with 4 lights per sheet. Anvils, bases and shelves use the joinable bakes from `cloud_vapor_join_bake.py`. They are drawn as camera-facing SurfaceGui images sized to the box's projected extent (StormKit `drawVapor`), and blended lit/side/back/high by the sun's direction.
  - Bases, shelves and anvils switch to the mesh when the camera is under their footprint.
  - Base and shelf images are capped at 2.5× their thickness, because seen from below the base became a dark curtain down to the horizon.
- **Score:** S1 0.62, with texture matching the photo.
- **Open:** the 2×2 base still reads as two dark bands, and frame rate is about 48–55 fps.
- **Research on real-time volumetric clouds in Roblox** (summary in the chat):
  - All community systems raymarch on the CPU into EditableImages: kotjeczek's raymarched clouds, his volumetric smoke, and Ro-Volumetrics (MIT, slices).
  - They run at low resolution with checkerboarding and temporal blending. Every author calls performance poor, and there is no GPU path and no custom shaders.
  - Our own CloudVolume prototype (2026-10-22) reached the same verdict.
  - The custom shaders feature request is still only a request.

### 2026-10-23 (night, later): live-relit vapor (light grid)
- **Bake:** `tools/blender/cloud_relight_bake.py --grid 1` renders each tower piece (caps 1–3, bodies 1–2) at 256².
  - Sun positions: 8 azimuths at 15° and 50° elevation, plus overhead, plus a sky-only render and alpha.
  - Stored sqrt-encoded and premultiplied in `CloudKit/Relight/<piece>.luau`, about 1.66 MB each.
  - A first 6-axis version lost the crease shadows (error 0.09–0.13); it is backed up in `assets/cloudkit/relight/axis_backup`.
  - Grid accuracy against fresh renders: 0.03–0.055 on the lit shot and 0.033–0.050 at an off-grid sun (A110 E35). The noise floor is about 0.016.
- **Runtime:** `client/VaporRelight.luau` blends the 4 nearest grid renders plus sky per pixel into an EditableImage per storm piece, and converts to sRGB.
  - Redraws happen only when the light's angle to the view changes, within 4 ms a frame, with at most 16 images, for storms within 45 km.
  - Anything else uses the baked 4-light sheets.
  - Settings: `Config.STORM_KIT.vapor.relight`.
- **Lab:** images are created and drawn with no errors, and the relit tower matches the baked look.
  - Redraw cost is not measured yet; the test was cut short when another Studio window opened.
  - The lab overlay now shows "relit: N images, redraws/s, ms".
- **Likely cause of the recurring 15 fps:** Studio throttles the lab window while another Studio window has focus. Measure frame rate with the lab window focused.
- **To watch:** about 8 MB of Luau data replicated to every client. If load time suffers, move the grids to uploaded images, either decoded from texture pixels or stored as multiple image assets.
- **Measured (lab window focused):** 60 fps. One relit 256² redraw takes 1.1 ms (`--!native`), so the 4 ms budget covers about 3–4 a frame and all 16 refresh within about 5 frames while the sun moves.
- **Dusk (19:48):** the relit tower turns warm tan against the dark sky. It may be a touch bright for after sunset.
- **15 fps theory holds:** 60 fps with the lab focused; 15 fps earlier while another Studio window was active.
- Captures: `_19_relit_dusk`, `_20_relit_1734`.
- **Grids moved to uploaded images.** `tools/blender/relight_pack.py` packs the 19 channels into one 1024×512 RGB PNG per piece (about 470 KB). It is uploaded, listed in `Config...relight.packs`, and read back with `CreateEditableImageAsync` + `ReadPixelsBuffer`.
  - The round trip is lossless: 0 of 1,245,184 bytes differ.
  - The Luau grids moved to `roblox/assets/cloudkit/relight/luau`, so about 8 MB less ships with the place. The packer reads from there, or from new bakes in `src/.../Relight`.
- **After sunset,** direct sun on the relit pieces fades out between sun.y −0.01 and +0.07, leaving sky light only. The tower is a dim blue-grey silhouette at dusk (`captures/2026-10-23_21_relit_dusk_skyonly.png`). Meshes and the non-relit anvil still glow tan.
- **All puffy pieces are relit live.**
  - Anvils, shelves and mammatus were grid-baked (shelf/anvil use the join bake's shapes; game names anvil_N, shelf_N) at the shared scale 6.185769. About 0.2–0.5% of samples clip, all in the low backlit rim (r0a180).
  - Accuracy: anvils and shelves 0.006–0.010 at the lit sun and 0.022–0.030 off-grid. Shelves run about 11% dark between rings; a third ring at ~30° would fix that if their tiers matter.
  - Packed (290–420 KB each), uploaded and read back; the Luau copies are in `assets/cloudkit/relight/luau`.
  - Lab: 4 relit images at 60 fps; redraws take 1.1–3.9 ms. At dusk the near anvil goes sky-lit grey too.
  - Still warm at dusk: anvil sections beyond the 45 km relight range (fixed sheets).

### 2026-10-23 (late): game place fix, matte, scud and wisps
- **"Character doesn't load" in the game was the user place's Workspace attribute `WatchTornado = true`.** It holds the camera as Scriptable on the nearest tornado; with none in view, the camera froze facing away.
  - Set to false, and `StartMiles` cleared (it was "162.6,7.8").
  - StormView now hands the camera back (Custom) when the attribute is off or there's no tornado.
  - Still in the place: `WeatherFeedUrl` points at a dead cloudflared tunnel (HTTP 502).
- **Matte:** `MaterialService.CloudMatte` (MaterialVariant, SmoothPlastic base, white RoughnessMap 95712331838936) is used by all kit meshes, so there is no specular shine.
  - Added to both Rojo projects. A running `rojo serve` needs a restart to pick up new services; it was created in Place1 directly meanwhile.
- **Scud and wisps:** `client/StormWisps.luau`, settings in `STORM_KIT.wisp`, bakes from `tools/blender/cloud_wisp_bake.py` in `roblox/assets/cloudkit/wisp`.
  - 6 scud fractus and 3 tileable fringe strips, each with diffuse and backlit cells, uploaded.
  - Fringe rings the base rim (or both line edges), its solid top tucked into the base.
  - Scud forms below the base round the wall cloud and inflow side, rising, drawn in and swirled, fading on its own cycle.
  - Tinted grey 0.12 (fringe) and 0.3 (scud); white scud read as scratches.
  - Capture: `captures/2026-10-23_23_game_wisps_matte.png` (game place).
- **Tower cluster (StormKit layout, `STORM_KIT.tower.cluster`):** each tower adds about 5 smaller cap domes round its top (more when towering) and 2 domes bulging from each body segment. A tower now reads as many overlapping cauliflower lobes rather than 2–4 smooth pieces. No new bakes are needed, and the relit images are shared per piece type, so the extra cost is a few dozen sprite parts per storm.
  - Capture from about 10 km out in the game place: `captures/2026-10-23_24_game_tower_cluster.png`.
  - Still to do: the base still reads as a flat dark disc from a distance, and the tower is narrow for its height.
