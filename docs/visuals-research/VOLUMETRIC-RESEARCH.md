# Volumetric storms, tornadoes and precipitation in Roblox: research and recommendation

*2026-11-05. Based on the reference images in `docs/storm-reference` and `docs/tornado-reference` plus online research. I read no project code or notes and none of the project's past screenshots.*

## Summary

Roblox has no custom shaders, no volumetric fog and no per-pixel transparency sorting, and nothing on the public 2025–26 roadmap changes that. So a real volume renderer (Horizon / Nubis ray marching) cannot be built. The one public attempt, ray marching into an EditableImage, the author calls "awful performance-wise" at three small volumes.

What works is the approach Microsoft Flight Simulator 2004 used: **clusters of soft, pre-lit camera-facing sprites, lit on the CPU.** In Roblox the sprites are BillboardGuis, with Beams and a few EditableMesh sheets where a continuous surface is needed.

The recommendation is a three-band level-of-detail system driven entirely by the frame data:
- **Far** (beyond ~15 km): one or two impostor cards per storm, painted on the CPU from the column grid into a small EditableImage.
- **Mid** (~1.5–15 km): a few hundred billboard puffs per storm, one per merged cloud column. Each is tinted by a "sun-depth" pass that copies Beer's law. Rain curtains are scrolling Beams.
- **Near** (under ~1.5 km, the only range where ParticleEmitters render at all): a wall-cloud / base sheet from the 250 m nest, a tornado built from the 8-height spine, and camera-attached rain, with fog density set by the rain rate.

Severity, the look the owner likes, appears to be soft, large, low-contrast sprites with a dark, flat-shaded cloud ceiling and heavy distance haze, not detailed volumes. That is achievable.

---

## 1. What the references show

### Storm structure and lighting (real photos, `docs/storm-reference/real`)
- **The base is the darkest part of the storm, and it is flat.** The visible structure lives in a thin band near the ground, not in the tower. See `01_classic_supercell_a.jpg` (panorama: a near-black shelf/base, a green-grey core, a bright horizon under the base) and `03_hp_supercell_a.jpg` (a slate grey base over turquoise light from the core). A low, bright horizon strip under the base appears in almost every photo. Getting that contrast (dark ceiling, light slot below) is worth more than detail in the tower.
- **Towers are bright, hard-edged and cauliflower only at the sunlit top edge.** The shaded side is soft and featureless. See `02_lp_supercell_a.jpg` (a white crisp left flank, a smooth grey-blue body), `08_anvil_side_a.jpg` (a smooth, flat-bottomed anvil with fine fibrous edges) and `13_towering_cumulus_flanking_line_a.jpg`. Lighting decides where detail shows: detail only where light grazes the edge.
- **Striations and banding:** `12_mesocyclone_striations_a.jpg`, `07_shelf_cloud_a.jpg` and `tornado-reference/real/10_striations_a.jpg` show smooth, layered, curved bands (like a stack of plates), with a dark lowering beneath. These are smooth gradients, not puffs.
- **Wall clouds and lowerings:** `04_wall_cloud_a.jpg`, `04_wall_cloud_underside_c.jpg` and `06_clear_slot_tornado_b.jpg`.
  - A wall cloud is a blunt, darker, slightly ragged step below the base, often with a bright clear slot behind it.
  - Ragged scud fringes hang from its edges (`05_scud_fractus_c.jpg`).
  - The nest's low-base data maps straight onto this.
- **Inflow and the RFD clear slot:** `05_inflow_band_beaver_tail_a.jpg` and `06_clear_slot_a.jpg` show low-contrast grey on grey. These read almost entirely through value differences.
- **Mammatus:** `09_mammatus_a.jpg` shows smooth, rounded lobes with soft edges. A good test of "soft puffs", and a candidate for sprites on the anvil underside.
- **Colour:** grey-blue to slate in shade, and a green or turquoise cast under or behind heavy cores (`03_hp_supercell_a.jpg`, `03_hp_outflow_rain_c.jpg`). Warm horizon light under the base.

### Precipitation
- **Rain shafts are soft vertical gradients with streaky texture, darkest just under the base.** They fade toward the ground and sideways (`10_rain_shaft_a.jpg`).
- **Hail shafts are lighter, almost white, and sharply bounded** (`10_hail_shaft_d.jpg`: a pale column under a dark base). A hail rate can be shown simply as a lighter tint with sharper edges than rain.
- **Shafts in front of a bright background are dark. Shafts lit from behind by the sun glow silver-yellow** (`03_hp_outflow_rain_c.jpg`: left side glowing, right side murky). So the brightness of a shaft has to follow the sun-to-view angle.
- **Rain-wrapped tornadoes:** `11_rain_wrapped_tornado_a.jpg` shows a big base with the funnel only a darker grey stripe inside a grey curtain on the left. `11_rain_wrapped_tornado_b.jpg` shows a funnel seen through rain: low contrast, cyan-grey, edges blurred. **Rain wrap means lower contrast, not hiding the tornado.**
- **Virga:** `10_virga_c.jpg` shows wispy shafts that end above the ground.
- **Radar layout:** `radar/01_hook_bridgecreek-moore1999_ktlx_ref.jpg` and `C1_concept_classic-supercell_nws.gif`. Heavy rain and hail sit in the forward flank and wrap around the updraft in a hook; the rain-free base and wall cloud sit at the hook's tip. The column rain/hail grid already carries this, so rain shafts should be drawn from the grid, not placed by hand.

### Tornadoes (real, `docs/tornado-reference/real`)
- **The condensation funnel is smooth, and its edges are nearly laminar** (`01_cone_a.jpg`: a white, smooth tube that narrows, brightened by backlight). Stringy texture runs along it, slightly helical.
- **Debris cloud:** a separate, darker, wider, ragged, brown-grey skirt at the ground. It is often visible before the funnel reaches down (`01_cone_a.jpg` base, `08_debris_b.jpg`: a white rope funnel inside a brown dust column).
- **Wedges:** `02_wedge_a.jpg` is a dark mass as wide as the base, with no clear edge where cloud base meets funnel.
- **Rope-out:** `04_rope_a.jpg` is a thin, tilted, kinked tube. The spine needs more than 8 points of curvature, or smooth interpolation between them.
- **Multiple vortex:** `06_multivortex_a.jpg` shows narrow sub-funnels around a broader dust shroud.
- **Backlit:** `09_backlit_a.jpg` is a silhouette, black against an orange sky. The same geometry must be able to read white or black depending on light.

### Roblox games (`docs/tornado-reference/*.png` and `frames/*_sheet.jpg`)
- **The "twisted_*" frames in `storm-reference/frames` are not from the movie.** The HUD says "Severity Dev v0.1.3" (`twisted_t12.png`, `twisted_sheet.jpg`). They show a ground-level debris/inflow cloud, a soft white-grey wall moving under a flat dark slate ceiling. No visible puff edges; very soft alpha; strong haze.
- **`ref1_image.png`, `ref5_subs1.png`, `ref6_subs.png`, `ref4_ropeout.png`** (Roblox renders, apparently Severity or similar):
  - The funnel is a smooth, light grey body with a slightly noisy edge.
  - The wall cloud and base are large soft blobs with darker undersides.
  - Sub-vortices are thin chains of small dark puffs (`ref6_subs.png`) — clearly sprites on a curved path.
  - The rope-out shows a dark dust ball at the base (`ref4_ropeout.png`).
  - Everything is low frequency: big sprites with very soft alpha, overlapping heavily.
- **`ref3_spoiler_image.png`:** a sepia/brown, low-sun scene. The tone from colour grading and fog does much of the work.
- **`clip_mobile_severity_sheet.jpg`:** Severity on mobile. A large wedge drawn with soft sprites, then a full brown-out as the debris cloud passes (fog plus particles plus flying debris parts). So mobile runs this approach.
- **`clip_iOvAj0as2Z_sheet.jpg`, `clip_3JXLF0nN0n_sheet.jpg`:** the debris cloud of a large tornado is many big brown and blue-grey soft sprites rotating, with small debris parts. It reads as a volume because the sprites are large and overlap a lot, and the colour varies through them.
- **`clip_2026-02-28_10-32-59_sheet.jpg`, `10-44-44`, `10-58-06`, `15-42-21`:** close-up funnels are smooth gradient bodies with blurred edges, a dark base cloud and dust lobes at the ground. Detail is low; the shapes read as solid because the silhouette is smooth and the shading is consistent.

### Visual qualities to hit (checklist)
1. A dark, flat, wide base with a bright gap under it at the horizon.
2. Smooth, low-frequency bodies; crisp edges only where sunlit.
3. Shading that comes from the light: shadowed sides darker, a silver edge when backlit, a green cast through thick cores.
4. A separate wall-cloud step and scud fringes under the updraft.
5. A funnel as a smooth tube with faint helical texture, plus a separate wider, darker, browner debris skirt.
6. Rain as soft vertical gradients, darkest under the base; dark in front of light, silver when backlit; hail lighter and sharper.
7. Rain wrap means lowering contrast toward the fog colour, not hiding.
8. Inside rain: visibility drops to a few hundred metres, the world turns grey-blue, and streaks show near the camera.

---

## 2. Roblox options for volumetric clouds and tornadoes

Engine facts that set the limits (sources in §5):
- **Particles:** an emitter only emits or draws when the camera is within ~1,000 studs of its part. That is ~2.7 km horizontally at 0.37 studs/m, or ~280 m of true-scale height. Emitters are culled and depth-sorted per emitter, not per particle.
- **Transparency sorting:** per object, no order-independent transparency. Overlapping transparent layers cost overdraw and can sort wrongly.
- **Fog:** Atmosphere fog does not reliably apply to BillboardGuis, Beams or particles, and it differs between platforms. Distance fade and fog colour must be done in script.
- **EditableImage:** 1024² maximum; about one image upload per frame; a dynamic memory budget (calls can return nil). Usable in published games but still flagged beta, and the creator must be ID-verified.
- **EditableMesh:** 60k vertices and 20k triangles per mesh, vertex colour with alpha, fast batch calls.
- **BillboardGui:** roughly one draw call each. It caches its look until a property changes. MaxDistance culls it, but beyond 300+ billboards toggle `Enabled` yourself. No official cap; community systems run thousands at a 1–2 fps cost.
- **Clouds object:** one global sky layer. Useless for local storms except as a stormy-sky backdrop.
- **ViewportFrame:** no particles, no beams, ~70% more expensive. Not useful for impostors.

### Technique A: BillboardGui puff clusters (the workhorse)
- **How:** each puff is a BillboardGui with an ImageLabel showing a soft cloud sprite, sized in studs, with `LightInfluence = 0`. The script sets `ImageColor3` and `ImageTransparency` from its own lighting model.
- **Look:**
  - The Severity look, if the sprites are large (puff diameter ≈ 1.5–3× spacing) and very soft (radial falloff, little internal detail).
  - Cauliflower comes from small, sharp-textured puffs. Avoid it.
  - Use 8–16 sprite textures:
    - Soft round
    - Flat-bottom base puff
    - Stretched band for striations and anvil
    - Ragged fringe for scud
    - Streak for rain
  - Make 2–3 pre-lit variants of each (lit from above, backlit rim, lit from below). This fakes Unity's six-way lighting: pick the variant by sun angle, or cross-fade two stacked billboards.
- **Lighting (CPU), following MSFS 2004 and Harris & Lastra:**
  1. **Sun depth:** sort puffs along the sun direction and add up the density in front of each. Tint = exp(−k·Σ). Cores and the shaded side go dark. Update only when the frame or the sun changes.
  2. **Height ambient:** blend from a dark base colour at cloud base to a sky-lit colour at the top. This gives the dark flat base for free.
  3. **Forward scatter:** for puffs with low sun depth (edges), add a silver-lining boost as the sun-to-view angle gets small.
  4. **Rain darkening:** puffs over columns with high rain or hail rate absorb more (the HZD rule). Add a green tint when the sun is low and the depth is large.
  5. **Group shading:** shade clusters of 10–30 puffs as one unit, so per-puff work stays cheap.
- **Mapping from the frame:** for each 1 km column with cloud, place puffs from base to top of each of the two layers.
  - Near: one puff about every 500–1,000 m of height.
  - Mid: merge 2×2 columns.
  - Far: merge 4×4.
  - Puff size follows the column size in studs (370 studs per km horizontal). Vertical stretch follows the local height scale (3.57 → 1 studs/m).
  - Anvil snow means a flat stretched anvil sprite with low opacity.
  - Puffs should move toward their new positions over the few seconds between frames, not jump.
- **Cost:**
  - A 64×64 km storm with ~1,000 cloudy columns and a 10 km tower gives roughly 10k puffs at full detail. Too many. After merging, a mid-range storm is ~200–400 puffs, a near storm ~600–1,000 including the nest.
  - The cost is draw calls (~1 per billboard) plus overdraw. Overdraw is worst when the camera is inside or under a cloud. Fade puffs as they come near the camera, as MSFS did.
  - Practical totals: ~1,500–2,500 billboards on desktop, ~600–1,000 on mobile.
- **Limits:**
  - Per-billboard sorting can pop when two big puffs swap order. Soft alpha hides most of it.
  - Billboards do not take Atmosphere fog, so mix fog colour into the tint by distance.
  - No soft-particle depth fade where puffs meet the ground or buildings. Keep puffs above ground on the CPU.

### Technique B: ParticleEmitter clouds and flipbooks
- **How:** emitters on parts. Flipbooks up to 8×8 frames at up to 1024² (a pre-rendered smoke/cloud loop). `Squash`, orientation modes, `ZOffset`. Particle count = Rate × Lifetime.
- **Look:** the best motion: turbulent edges, swirl, debris, scud and rain. Real-time sprites move for free on the GPU.
- **Cost:** cheap per particle. Mobile quality settings cut counts automatically. One supercell from ~2,500 particles was reported to cook a GPU, mostly through overdraw.
- **Limits:**
  - **The 1,000-stud cutoff makes them a near-range tool only.** A tornado watched from 2 miles away (≈1,200 studs) loses all its particles. A storm-wide particle cloud is impossible.
  - Particles in flight cannot be re-coloured (changing emitter properties every frame is costly). The lighting model can't reach them, so tint per emitter.
- **Use for:** tornado edge turbulence and debris within ~1,000 studs; scud; near rain; dust inflow; hail bounce.

### Technique C: Beams
- **How:** a textured strip between two Attachments, curved by `CurveSize0/1`, with `FaceCamera`, a Width0/1 taper, a Transparency sequence and `TextureSpeed` for scrolling.
- **Look:**
  - Good for vertical rain curtains: a streak texture scrolling down, with transparency fading at the bottom.
  - Good for the smooth funnel tube: several FaceCamera beams down the spine with a helical streak texture scrolling upward.
  - Good for thin rope funnels and sub-vortex trails.
- **Cost:** low. One beam is one strip. Culling depends on the graphics level; wide beams survive farther.
- **Limits:** flat ribbons. Seen end-on (from directly below), a FaceCamera beam collapses, so add billboards for the view from under. No fog.

### Technique D: Transparent MeshParts and EditableMesh sheets
- **How:** a MeshPart with Transparency, or an EditableMesh grid whose vertices are moved in script and given vertex colour plus alpha.
- **Look:**
  - Great for continuous surfaces billboards do badly: a smooth, flat cloud base deck, striation bands, an anvil underside, and a rain-curtain "skirt" around the core.
  - A 64×64 vertex grid for the base (4,096 vertices) fits easily within the 60k limit. Its heights come from the base-height field, its alpha from cloud presence, and its colour from rain rate. The nest adds a 48×48 finer patch for the wall cloud.
  - The stacked "classic cloud mesh" supercell from the DevForum is this idea done by hand. It looks solid but stiff.
- **Cost:** a few draw calls per storm. Updating a few thousand vertices every few seconds is cheap.
- **Limits:**
  - Hard silhouettes unless the edge vertices fade to zero alpha.
  - Meshes sort as one object, so a billboard partly inside the sheet sorts wrongly.
  - Not confirmed: whether vertex-colour alpha blends smoothly on all quality levels (SurfaceAppearance alpha dithers at low quality). **Prototype first.**
  - EditableMesh needs the ID-verified owner setting and is subject to the memory budget.

### Technique E: EditableImage
- **As a ray-marched volume:** no. At most 1 image upload per frame, CPU per-pixel work and the memory budget rule it out (see the CS2-smoke DevForum post).
- **As a far impostor painter (good fit):**
  - For each far storm, every few seconds, project the column grid sideways along the view direction into a small image (e.g. 128×256 pixels).
  - For each pixel row (height) and column (horizontal), add up cloud presence along the line of sight. Alpha = 1 − exp(−k·depth); colour from height ambient plus a sun term.
  - That is ~32k pixels × ≤64 samples: a few milliseconds, spread over frames, on an Actor (parallel Luau).
  - Show it on 1 billboard per storm.
  - Memory: 128 KB per image; 30 far storms ≈ 4 MB. One upload per frame handles 30 storms in half a second.
  - Fully data-driven, and it shows real tower, anvil and rain-shaft silhouettes at 50 miles.
- **As a texture source:** paint the rain-shaft texture for a storm from its rain-rate field (bright and dark streak bands).

### Technique F: Atmosphere, Lighting and post-processing
- **Uses:**
  - Atmosphere `Density`/`Haze`/`Color` set from the rain rate and cloud overhead at the camera gives the "inside rain" world.
  - `ColorCorrection` and `Bloom` give the storm tint (sepia in `ref3_spoiler_image.png`, green-grey in the real HP photos).
  - Dimming `Lighting.Brightness` and ambient under the base gives the dark-underneath feeling. This is the biggest cheap effect.
- **Fog gap:** fog works on terrain and parts but not on billboards, beams or particles, so all storm sprites need script-side fog matching the Atmosphere settings.
- **Clouds object:** set `Cover` and `Density` high when the camera is under an anvil or base, so the global sky looks overcast past the storm sprites.

### Technique G: Highlight, ViewportFrame, SurfaceGui
- **Highlight:** 31 maximum and silhouette only. Not useful.
- **ViewportFrame:** no particles or beams, expensive. No.
- **SurfaceGui:** the same idea as an EditableMesh sheet, but flat. A possible cheap far ring around the horizon showing an anvil band.

### What other Roblox storm games appear to do
- **Twisted and Severity:** same developers (Willzuh / Siryzm).
  - **Twisted 1.18 changelog:** rain curtains that "fade as you approach" and "shroud visibility"; distinct LP/HP storms; tornadoes changing shape over their life; multivortex and wedge tornadoes; ground inflow particles; a new optimised rendering system with a draw-distance setting.
  - **Twisted 1.21:** tail clouds, debris clouds, darker cores, new rain-wrap, Rankine windfields.
  - Both game pages warn they run poorly on low-end devices.
  - No rendering write-up exists. From the footage (`clip_*_sheet.jpg`), Severity uses large, soft, overlapping sprites (billboards and/or particles), a flat dark ceiling, heavy fog and colour grading, and physical debris parts near the tornado.
- **Helicity and Tornado Alley Ultimate:** no public details. Helicity asks for high-end devices.
- **Community:**
  - A billboard cloud system ran ~15k clouds within 15k studs at a 1–2 fps cost.
  - A tornado particle thread confirms the 1,000-stud fade; its workaround is scripted `:Emit()` with its own LoD plus MeshParts at range.
  - buildthomas's Rain module: camera-relative emitters and attachments, raycast occlusion, splashes.

### Comparison

| Technique | Near look | Range | Mobile cost | Data fit | Verdict |
|---|---|---|---|---|---|
| Billboard puffs + CPU lighting | good (soft) | any (scripted fade) | moderate (draw calls, overdraw) | excellent (per column) | **main body** |
| Particles / flipbooks | best motion | ≤1,000 studs | low–moderate | good (rates from data) | near detail only |
| Beams | smooth tubes and curtains | quality-dependent | low | good (spine, rain columns) | funnel tube, rain |
| EditableMesh sheets | smooth surfaces | any | low | excellent (base grid) | base deck, wall cloud (prototype) |
| EditableImage impostor | n/a | far | low | excellent | **far storms** |
| Raymarched EditableImage | real volume | n/a | prohibitive | n/a | no |
| Stacked static meshes | stiff | any | low | poor | no |
| Clouds / Atmosphere | backdrop | global | free | camera-local only | mood and fog |

---

## 3. Precipitation options

Visibility from physics (Koschmieder: visibility ≈ 3.9/β; β_rain ≈ 0.16·R^0.74 per km, R in mm/h; older fits give about half these distances):

| Rain rate | Visibility |
|---|---|
| 10 mm/h | ~3–4 km |
| 50 mm/h | ~1–1.4 km |
| 100 mm/h | ~0.6–0.8 km |

Cloud is ~100× more opaque than rain. So from outside, a shaft is a see-through grey curtain readable 20–30 km away. From inside a heavy core, the view closes to under 1 km.

**1. Far shafts (beyond ~15 km):**
- Baked into the EditableImage impostor: rain-rate columns add a vertical gradient below the base, hail columns a lighter, sharper band.
- Or 1–3 tall billboard cards per storm with a soft shaft texture, width from the extent of the rain area, tinted by sun-to-view angle (dark in front of light, silver when backlit).
- Cost: negligible.

**2. Mid curtains (~1.5–15 km):**
- Group rain columns into blobs (e.g. connected regions above 5 mm/h at 2×2 km).
- For each blob, 2–6 FaceCamera Beams from base height to the ground: width from blob size, a scrolling streak texture (`TextureSpeed`), a transparency sequence fading at the bottom, and opacity from rain rate.
- Virga: if the model ever reports rain that evaporates before the ground, fade out above the ground.
- Hail: a second, whiter, narrower beam set where hail rate is high.
- Billboard "curtain puffs" (vertical soft streak sprites) can fill gaps.
- Cost: ~20–60 beams per storm.
- A beam seen from below or inside collapses, so fade curtains out as the camera enters the blob and hand over to the near layer. Twisted's "fade as you approach" suggests they do this.

**3. Near and inside rain (camera within a rain column):**
- **Streaks:** a camera-attached part with 1–2 ParticleEmitters (VelocityParallel streaks, rate from local rain rate, tilted by wind).
  - Budget ~300–800 visible particles on desktop, ~150–300 on mobile.
  - Raycast up to switch it off under roofs.
  - Alternative: a camera-attached double cone or box mesh with scrolling streak Textures (the Wang & Wade 2004 technique). Constant cost; fine for heavy rain beyond the nearest streaks.
- **Wall of rain:** a ring of 6–12 large soft billboards or beams ~150–400 m out from the camera, opacity from rain rate. This makes the visible "you are in a curtain" edge.
- **Fog:** Atmosphere Density and Haze from rain rate using the table above. Colour grey-blue, or brown in the debris field. Apply the same fade to every storm billboard in script. This is the single most important effect inside rain (see `clip_mobile_severity_sheet.jpg`, where the brown-out is mostly fog).
- **Splashes:** a ground emitter near the camera with a short-life splash flipbook. Wet-ground tint by changing terrain or material colour if wanted.
- **Hail:**
  - Small white or ice MeshParts or particles with gravity and a bounce look: a ParticleEmitter with Acceleration plus a ground-hit splash.
  - Size from hail rate, ~50–200 particles nearby.
  - Plus the lighter fog tint and a sound.
- **Lightning backlight:** brief brightness boosts on the billboard tints of the core (`12_mesocyclone_striations_a.jpg`).

**4. Rain-wrapped tornadoes:**
- No special asset needed. Fog and contrast should come from the rain between the camera and the tornado.
- For each tornado layer, compute the rain path between camera and tornado: sample the column rain grid along the line and add up β.
- Mix the funnel's tint toward the local fog colour by 1 − exp(−τ), and fade its transparency.
- With dense rain in the hook this makes the cyan-grey ghost in `11_rain_wrapped_tornado_b.jpg` and the stripe in `_a.jpg`.
- Cost: one 20-sample line integral per tornado per frame.

---

## 4. Recommendation

### Bands

Bands are set by horizontal distance from the camera to the storm's footprint (studs at 0.37 studs/m):

| | Near: < ~1,000 studs (~2.7 km) to the feature | Mid: ~1,000–40,000 studs (~3–100 km horizontal)\* | Far: beyond the mid cut-off |
|---|---|---|---|
| **Cloud body** | Billboard puffs at full column detail plus nest; near-camera fade | Billboard puffs, merged 2×2 columns (4×4 at the outer edge), CPU sun-depth lighting | 1 EditableImage impostor per storm (128×256), repainted every few seconds; optional anvil card |
| **Base / wall cloud** | EditableMesh base sheet from the 1 km base heights + nest patch (wall cloud, lowerings); scud particles | Base sheet (coarser) or a flat row of base puffs | In the impostor |
| **Tornado** | Spine-driven billboard rings + beams + particles (below) | Spine beams + ~50–100 billboards, no particles | In the impostor as a thin dark line (or 1 beam) |
| **Precip** | Camera rain emitters, curtain ring, splashes, hail, Atmosphere fog | Beam curtains per rain blob, hail beams | Baked into the impostor |

\* Choose the mid/far cut-off by profiling. Roughly 15–25 km from the camera fits the point where the heights ease to 1 stud/m. Beyond that, a storm 10 km tall spans only a few hundred pixels.

### Tornado build (data to visuals)
- **Spine:** use the 8 lean offsets as control points. Interpolate with a Catmull-Rom spline to 24–40 points so the rope-out kinks stay smooth.
- **Funnel body:**
  - At each spine point, place a ring of 4–8 soft billboards. Ring radius = funnel radius at that height (from the record). Billboard size ≈ 1.5× ring spacing so the tube reads as smooth.
  - Run 2–4 FaceCamera Beams down the spine, width = 2× radius, with a helical streak texture scrolling upward.
  - Below the funnel tip there is no condensation; the spine continues only as debris and dust.
- **Debris cloud:**
  - A ring of large, brown-grey, low billboards: radius = core radius × 1.5–3, height scaled by wind speed / EF.
  - Plus particles within 1,000 studs: dirt flipbook spiralling outward and up, and small debris chunks.
  - Colour from ground type.
- **Sub-vortices:** when the width or EF suggests a multiple vortex (or if the model sends a flag), add 2–5 thin chains of small dark puffs orbiting at ~0.5–0.8 of the core radius, period ~10–20 s (DOW observations). This looks like `ref6_subs.png`.
- **Wall cloud / funnel join:** the nest's pressure drop and low base thicken the base sheet into a lowering above the spine top, so the funnel grows from it.
- **Lighting:** the same sun-depth and fog rules as the cloud, so a backlit funnel reads black (`09_backlit_a.jpg`) and a front-lit one white (`01_cone_a.jpg`) with no special case.
- **Budget per tornado:** near ~300–500 billboards, 4–8 beams and ~500–1,500 particles; mid ~80 billboards and 4 beams; far, part of the impostor.

### Budgets (starting points to measure, not promises)

| | Desktop | Mobile |
|---|---|---|
| Storm billboards, total | 2,000 | 800 |
| Beams | 300 | 120 |
| Visible particles | 3,000 | 1,000 |
| EditableImage impostors | 30 × 128×256 | 12 × 64×128 |
| EditableMesh base sheets | 2–3 (≤5k vertices each) | 1 |
| Lighting script | ≤2 ms/frame (spread over frames; Actors for the sun-depth pass) | ≤1.5 ms/frame |

**Network:** none of this needs anything beyond the existing frame. All placement, lighting and fades are client-side from the column grid and the tornado record. Smooth positions between frames on the client (tween toward new targets over the frame interval).

### Quick prototypes worth testing first (in this order)
1. **Billboard puff storm with CPU sun-depth lighting.** One recorded frame, mid range. Compare against `01_classic_supercell_a.jpg` and `twisted_t12.png`. Measure frame time and draw calls on a phone at 300, 600 and 1,200 billboards.
2. **EditableMesh base sheet** with vertex alpha from the 1 km base field plus the nest. Check that alpha blends smoothly at low quality and that it sorts acceptably against billboards. This decides whether the "dark flat base" comes from a mesh or from puffs.
3. **EditableImage far impostor** painted from the columns. Time the painting on an Actor; check the silhouette at 30–80 km.
4. **Spine tornado:** billboard rings plus beams, from a recorded tornado record through a rope-out. Check orbit left/right, far and from under.
5. **Rain:** beam curtains from rain blobs, a camera emitter, and fog from rain rate, plus the rain-wrap line integral. Drive through a hook.

### Open questions
- Does EditableMesh vertex-colour alpha blend (not dither) on all quality levels and on mobile? Does the ID-verification/beta status of EditableMesh/EditableImage fit the release plan? If not, the base sheet falls back to puffs and the far impostor to pre-made atlas cards chosen by size and type.
- What are the real BillboardGui counts and overdraw costs on the target phones? (No official figures; must be measured.)
- How should script fog for billboards match Atmosphere exactly? (Roblox's fog formula is not documented; fit it by eye or by measurement.)
- **Owner preference conflict:** a standing rule says storm/tornado visuals are billboards only, with no particle clouds. This report recommends particles only for near detail (tornado edges and debris, scud, near rain, hail) inside the 1,000-stud range. Confirm whether that is acceptable; if not, the same roles go to scripted billboards at a higher cost.
- Should the cloud model send a per-column optical depth or water content (not only base/top)? Better lighting and impostors would follow. It is worth a few bytes per column. Other data worth asking for: a virga flag, a multiple-vortex hint and a ground type for debris colour. The engine's gust-front geometry and cold-pool strength (listed in docs/research/SHARED-FINDINGS.md by the engine-model coupling job) could place shelf clouds and outflow dust without painting them.
- Puff sprite textures: make them in-house (Blender renders of soft volumes, lit from 3 directions) or source them? They decide most of the "Severity look".

---

## 5. Sources

**Roblox engine**
- EditableImage/EditableMesh client beta in published games: https://devforum.roblox.com/t/client-beta-in-experience-mesh-image-apis-now-available-in-published-experiences/3267293 (one-update-per-frame limit: …/3267293/313)
- EditableMesh/Image improvements, memory budget: https://devforum.roblox.com/t/editablemesh-and-editableimage-improvements/3818624
- Memory budget reports: https://devforum.roblox.com/t/failed-to-create-empty-editableimage-that-was-requested-due-to-reaching-memory-budget-limits-error/3490799 · https://devforum.roblox.com/t/reducing-memory-consumption-of-editableimage-once-static/3639609 · https://devforum.roblox.com/t/editable-mesh-memory-budget-reached/3469104
- EditableImage API: https://create.roblox.com/docs/reference/engine/classes/EditableImage
- EditableMesh API: https://create.roblox.com/docs/en-us/reference/engine/classes/EditableMesh.md
- Volumetric smoke via EditableImage (performance): https://devforum.roblox.com/t/first-fully-volumetric-smoke-system-in-roblox-using-editableimages/4558740
- ParticleEmitter: https://create.roblox.com/docs/reference/engine/classes/ParticleEmitter.md · flipbooks: https://create.roblox.com/docs/reference/engine/enums/ParticleFlipbookLayout.md · https://create.roblox.com/docs/effects/particle-emitters · https://devforum.roblox.com/t/particles’-flipbook-release/2029388
- Particle 1,000-stud range: https://devforum.roblox.com/t/increase-particle-emitters-view-distance/49984 · https://devforum.roblox.com/t/cloudstornado-vfx/4343192
- Particle quality scaling: https://devforum.roblox.com/t/how-to-improve-performance-on-particle-effects/503741 · https://devforum.roblox.com/t/how-to-optimize-vfx-and-retain-quality-at-low-graphics/2804870
- Beam: https://create.roblox.com/docs/reference/engine/classes/Beam.md · beam culling: https://devforum.roblox.com/t/beams-disappear-based-on-user-optimization-level/3782634
- BillboardGui: https://create.roblox.com/docs/reference/engine/classes/BillboardGui.md · many billboards: https://devforum.roblox.com/t/how-to-render-hundreds-of-billboards-without-lag/4025769 · https://devforum.roblox.com/t/billboards-continue-to-update-and-render-whilst-out-of-range/2743567 · https://devforum.roblox.com/t/whats-the-practical-limit-for-billboardguis-how-many-can-there-be-in-a-scene-before-i-have-to-worry/3958385
- ViewportFrame limits: https://devforum.roblox.com/t/particles-in-viewport-frames/272318/20 · https://devforum.roblox.com/t/beams-not-appearing-in-viewports/2168115 · https://devforum.roblox.com/t/a-comparison-of-client-memory-and-cpugpu-time-with-workspace-and-viewportframe/1900605
- Atmosphere: https://create.roblox.com/docs/environment/atmosphere · fog not applied to GUIs/beams: https://devforum.roblox.com/t/surfaceguis-billboardguis-are-improperly-affected-by-the-fog-from-the-atmosphere-instance/2249235 · https://devforum.roblox.com/t/beams-doesnt-blend-properly-with-atmospherefog/2880398 · https://devforum.roblox.com/t/ignoreatmosphere-property-for-beams-and-particle-emitters/958039
- Clouds: https://create.roblox.com/docs/environment/clouds · https://devforum.roblox.com/t/dynamic-skies-are-getting-cloudy/869476
- Unified Lighting: https://devforum.roblox.com/t/let-there-be-unified-light-unified-lighting-is-fully-live/3401512
- Highlight: https://create.roblox.com/docs/reference/engine/classes/Highlight
- Transparency sorting: https://devforum.roblox.com/t/transparent-mesh-messing-up-part-z-index/22607 · https://devforum.roblox.com/t/transparency-modes-for-textures-to-fix-depth-problems/103069 · SurfaceAppearance alpha: https://devforum.roblox.com/t/inconsistent-surfaceappearance-alpha-on-lower-graphics-settings/1326592
- Streaming: https://create.roblox.com/docs/workspace/streaming · RenderFidelity: https://create.roblox.com/docs/en-us/reference/engine/enums/RenderFidelity.md · draw distance: https://devforum.roblox.com/t/remove-arbitrary-draw-distance-limit/484282
- Performance guidance: https://create.roblox.com/docs/performance-optimization/improve
- Volumika (community volumetrics): https://dphfox.itch.io/volumika

**Roblox storm games and community**
- Twisted 1.18 changelog: https://devforum.roblox.com/t/twisted-118-change-log/1988107 · 1.21: https://devforum.roblox.com/t/twisted-beta-121-changelog/2956061
- Severity: https://www.roblox.com/games/103597332801951 · https://bloxinformer.com/upcoming-roblox-games/severity/
- Helicity: https://www.roblox.com/games/17759606919/Helicity · Tornado Alley Ultimate: https://www.rolimons.com/group/4404391
- Community clouds: https://devforum.roblox.com/t/how-can-i-make-a-supercell-thunderstorm/4744736 · https://devforum.roblox.com/t/realistic-clouds/2229650 · https://devforum.roblox.com/t/realistic-cloud-system-with-minimal-lag/2320769 · https://devforum.roblox.com/t/would-these-clouds-lag-some-mobile-devices/515282 · https://devforum.roblox.com/t/3d-custom-dynamic-clouds-extension-for-3d-atmosphere/3826006
- Community tornadoes: https://devforum.roblox.com/t/feedback-for-a-tornado/3501654 · https://devforum.roblox.com/t/make-a-billboard-gui-tornado/3492541 · https://devforum.roblox.com/t/how-do-you-think-this-effect-was-made/279045
- Rain module (buildthomas): https://devforum.roblox.com/t/rain-module-plugin/157190

**Real-time cloud techniques**
- Horizon Zero Dawn clouds (2015): https://www.guerrilla-games.com/read/the-real-time-volumetric-cloudscapes-of-horizon-zero-dawn · https://www.slideshare.net/guerrillagames/the-realtime-volumetric-cloudscapes-of-horizon-zero-dawn
- Nubis 2017: https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine · Nubis Evolved 2022: https://www.guerrilla-games.com/read/nubis-evolved · Nubis Cubed 2023: https://www.guerrilla-games.com/read/nubis-cubed
- Frostbite sky/clouds (Hillaire 2016): https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf
- Harris & Lastra 2001: https://diglib.eg.org/handle/10.2312/8851 · Harris GDC 2002: https://aurora.cs.uaf.edu/~olawlor/academic/thesis/ref/RTCloudsForGames_HarrisGDC2002.pdf
- Wang, MSFS 2004 cloud rendering: https://www.sambuz.com/doc/realistic-and-fast-realistic-and-fast-cloud-rendering-in-document-938167
- Soft particles (NVIDIA 2007): https://developer.download.nvidia.com/whitepapers/2007/SDK10/SoftParticles_hi.pdf
- Six-way lighting: https://unity.com/blog/engine-platform/realistic-smoke-with-6-way-lighting-in-vfx-graph
- Octahedral impostors: https://unpkg.com/@woosh/meep-engine@2.124.2/src/engine/graphics/impostors/octahedral/README.md
- RDR2 graphics study: https://imgeself.github.io/posts/2020-06-19-graphics-study-rdr2 · Forza Horizon 5 skies: https://www.videogameschronicle.com/news/forza-horizon-5s-art-team-explains-how-it-got-the-skies-to-look-so-realistic

**Tornado VFX**
- Twisters (ILM, 2024): https://beforesandafters.com/2025/05/16/twisters-what-went-into-a-storm · https://blog.siggraph.org/2024/12/the-special-and-visual-effects-behind-twisters.html/
- Twister (1996): https://www.theringer.com/movies/2020/5/7/21249788/twister-special-effects-history-tornado-cgi
- Game tornadoes: https://forums.unrealengine.com/t/i-am-struggling-to-make-a-tornado-in-ue5/2319207 · https://matthewburgess.squarespace.com/dev-blog/3/4/2022/ue5-tornado · https://80.lv/articles/creating-a-tornado-in-unity/

**Rain rendering**
- Tatarchuk, ToyShop rain (2006): https://advances.realtimerendering.com/s2006/Chapter3-Artist-Directable_Real-Time_Rain_Rendering_in_City_Environments.pdf
- Wang & Wade rain/snow cone (2004): https://history.siggraph.org/?p=93028
- GPU rain: https://classes.cs.uchicago.edu/archive/2022/fall/23700-1/papers/gpu-rain.pdf
- Garg & Nayar rain streaks: https://history.siggraph.org/?p=113590

**Physics of the look**
- Cloud optical depth: https://glossary.ametsoc.org/wiki/cloud-optical-depth/
- Mie scattering and silver lining: https://arxiv.org/pdf/1709.05418 · https://www.atoptics.co.uk/blog/opod-optics-galore/
- Green thunderstorms: https://glossary.ametsoc.org/wiki/green-thunderstorm/ · https://scicolloq.gsfc.nasa.gov/Bohren.htm
- Hail shafts: https://www.weather.gov/media/dmx/Spotter/SpotterReferenceGuide.pdf · https://en.wikipedia.org/wiki/Precipitation_shaft
- Condensation funnel: https://www.britannica.com/science/tornado/The-tornado-core-and-the-condensation-funnel · https://origin-east-www-spc.woc.noaa.gov/faq/tornado/nofunnel.htm
- Multiple-vortex structure (Wurman 2002): https://farm.atmos.illinois.edu/contents/pubs_pdf/2002-Wurman-The_multiple-vortex_structure_of_a_tornado.pdf
- Rain-wrapped tornadoes: https://www.livescience.com/30284-what-is-a-rain-wrapped-tornado-110331.html
- Visibility (Koschmieder, NOAA code): https://www.nco.ncep.noaa.gov/pmb/codes/nwprod/hrrr.v4.1.19/sorc/hrrr_wrfpost.fd/CALVIS_GSD.f · rain-rate fits: https://journals.pan.pl//Content/87334/PDF/13.pdf
