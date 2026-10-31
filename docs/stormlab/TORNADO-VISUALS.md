# Tornado visuals

This document maps the tornado visual implementation plan (`docs/stormlab/GUIDE-tornado-visuals.md`) onto the storm lab's code, and covers how to test it. The simulation stays authoritative throughout. Wind, damage, debris and lifecycle never read anything visual.

## Modules

| Plan module | Lab module | Notes |
|---|---|---|
| TornadoStateAdapter | `client/Tornado/StateAdapter` | Reads `Tornado.snapshot` (15 Hz). Extrapolates position between snapshots and eases corrections in. Eases fields, keeps the phase clock smooth, and sets the visual scale R from the condensation envelope. Profile weights are eased over 12 s of sim time. Computes rain obscuration and a stale-update grace period. |
| TornadoProfileLibrary | `client/Tornado/ProfileLibrary` | Rope, cone, stovepipe and wedge control points with a monotone-cubic interpolant. Families are blended continuously. Weights come from fields (aspect, decay, tilt, swirl), never from labels. |
| TornadoNoise | `shared/Sim/Noise` plus seeded sine waves | Deterministic and coherent; nothing is randomised per frame. |
| TornadoVisualController / Registry / LOD | `client/Render/TornadoVisuals` | One controller per tornado, created and destroyed with the adapter's entries. LOD 0-3, a mesh budget of 2 sets, debug overlays and counters. |
| Mesh generation | `client/Tornado/TubeMesh` | EditableMesh ring tubes with fixed bounds and per-vertex colour, alpha and UV in batches. Pooled and never destroyed (the memory budget is small). Built in a background task, because building yields. |
| LightningVisualController | `client/Render/Lightning` + `client/Tornado/FlashField` | Bolts plus a flash field: pulse trains per flash, with distance falloff and a soft cap. |
| Scene light | `client/Tornado/SceneLight` | Sun through the storms' cloud, sky light, night and the local flash. Used by the funnel, collar, wisps and dust, which are self-lit, and by the clouds at night. |
| TornadoVisualConfig | constants at the top of each module, plus `ctx.state.quality`, `ctx.state.debug` and `ctx.state.moonlight` | |

## How each phase is met

- **A (single funnel):**
  - A ring mesh of 40 rings × 40 segments. Shape is the blended profile × R.
  - The centreline is the physical axis (`Vortex.axisAt`: tilt, S-bend, travelling waves) plus a profile-dependent coherent wander.
  - The radius deforms at three coherent scales, turning at the flow's angular speed and rising with the updraft.
- **B (condensation):**
  - The visible funnel is the condensed tube: its radius is the condensation radius (capped by the profile envelope), where the cyclostrophic pressure deficit, including the near-ground jet, equals the pressure fall to the cloud base. The deficit reaches the ground (no surface factor: pressure is impressed through the surface layer). Opacity is the cloud optical depth of the chord the eye looks through: 1 - exp(-2 beta r |n.v|), beta = 0.075 / m (~0.5 g/m3 of 10 um droplets), so even a 10 m tube is mostly opaque.
  - Round the circumference it breaks up only where condensation is marginal (the condensed radius is small next to the core radius: near the tip), from coherent noise plus the moist inflow side.
  - Rain between the camera and the vortex fades its contrast into rain grey (a colour blend; opacity only drops to 0.6). Heavy rain round the vortex turns the veil into a wider rain curtain.
  - The funnel's opacity never feeds back into the physics (debug: "physics check").
- **C (multi-vortex):** sub-vortices are the physical ones (`Vortex.subvortices`, with stable ids 1-6). Each gets its own tube, visible where its own deficit plus the parent's at its orbit can condense air. Dust shows them because the wind field contains them.
- **D (night and lightning):**
  - Sky scales the ambient fills to a faint skyglow at night, with moonlight as a setting.
  - The funnel, collar, wisps and dust are self-lit from SceneLight, so they are nearly invisible between flashes.
  - Clouds switch to self-lit dark pieces at night.
  - Flashes light whatever is near them through the flash field. The scene-wide response is small and capped (ColorCorrection brightness ≤ 0.15, scaled by the flash light reaching the camera).
- **E (cloud-base connection and ground):**
  - A collar of soft cloud sprites round the funnel top, turning slower than the funnel. The wall cloud piece from Render/Clouds sits above it.
  - Dust comes from the wind field and is held down by wet ground (Render/TornadoDust), and can be wider than the funnel.
- **F (LOD):**

  | LOD | Distance | What's drawn |
  |---|---|---|
  | 0 | < 1.5 km | everything |
  | 1 | < 6 km | shells, tubes and collar, every other frame |
  | 2 | < 45 km, or over the mesh budget | sprite silhouette |
  | 3 | beyond | nothing |

  Heavy obscuration drops one level, but only past 3 km (close to a rain-wrapped funnel the veil is the look). Quality 0.5 removes the veil's density and the wisps first.

## Deterministic tests

Every scene starts dry and in daylight (2026-10-29). Two F4 toggles apply to any scene and carry over to the next one: **rain-wrap** rebuilds the scene with `VisualTests.RAIN_WRAP_SHARE` (0.7) of its rain released round the rear flank, and **night** sets the visual clock to `VisualTests.NIGHT_HOUR` (22:30) at once (off: the scene's own daytime hour).

Press **F4** in the lab for the test panel. Scenes live in `shared/VisualTests`. Each builds a pinned lab storm at a fixed site, with fixed seeds, 10 minutes of its rain, and its tornado run to a stage and held there (it keeps animating):

| Scene | What it checks |
|---|---|
| 1 Rope, daylight | rope weight, a thin contorted funnel, roping out |
| 2 Cone, partial condensation | condensation down to ~100 m, broken segments below |
| 3 Stovepipe, daylight | a near-uniform condensed column |
| 4 Wedge | wedge weight 1 (with rain-wrap on: the rain curtain veil, obscuration) |
| 5 Nearly uncondensed | EF2 winds with no condensation; dust shows the circulation |
| 6 Multi-vortex | 4-5 physical sub-vortices with independent visibility |
| 7, 8, 9, 0 Lightning | none, near IC, far CG, burst (best with night on) |
| - LOD dolly | the camera dollies geometrically from 300 m to 30 km |

The **debug views** are geometry, condensation heatmap, centreline + profile control points, sub-vortex ids + trails, ground radius, LOD readout, physics check, and flash markers.

**Counters:** client ms/fps, tornado LOD counts, meshes and ms, cloud parts and ms, dust, debris, active flashes, and visual instances.

Offline: `luau --codegen tools/stormlab/test_scenes.luau` prints each scene's tornado (vc, rc, swirl, condensation by height, nearby rain) and its profile weights.

## Funnel technique comparison (prototype)

The aim is to judge rendering approaches side by side before building any further. `client/Render/FunnelCompare` draws two alternatives to the mesh funnel (A). Both read the same smoothed state, the same condensation physics and the same scene light as A, so only the technique differs:

- **B: layered noise-textured ribbons.** Camera-facing Beams stacked up the axis, in three layers (streaky body, fibrous middle, soft haze) scrolling upward at different speeds. Width comes from the condensed radius; opacity from the cloud optical depth.
- **C: particle condensation.** Soft puffs fill the condensed tube band by band. They are locked to invisible parts that turn at the vortex's angular speed, so the puffs orbit with the flow. Roblox stops drawing particles ~800 studs out, so C is drawn scaled toward the camera beyond 700 studs.

**Toggle:** F4 panel "compare" button, or **C** while the panel is open.

| Mode | What you see |
|---|---|
| off | A only |
| A \| B \| C | B and C as copies either side of the real tornado (A), square to the view: B right, C left |
| B only | B at the real tornado, with the real dust and debris; A hidden |
| C only | C at the real tornado; A hidden |

There is no LOD, and only one tornado is drawn (the one nearest the focus). The panel's counters include the comparison's cost as `FunnelCompare` in the per-module ms.

**First comparison result** (stovepipe scene, daylight, 2026-10-25):

| Approach | Result |
|---|---|
| A (mesh) | The only one that reads as a solid condensation funnel: clean silhouette from cloud base to ground, dust at the foot. |
| B (ribbons) | Weakest. Thin dark strands with seams between segments. Sprite sheets tile as beads; the single smoke-column texture is too narrow to fill the body. It would need a purpose-made tileable noise texture. |
| C (particles) | Turbulent, lumpy, smoky detail and motion that A lacks, but no coherent edge. It reads as smoke rather than a condensed funnel. |

Suggested direction: a hybrid. A keeps the form; C-style particles add breakup at the edges, tip and base.

**Second round** (2026-10-25), against the user's target clip: a soft grey cone flaring into a broad soft lowering, no hard outline anywhere.
- **D, billboard volume (added).** About 30 heights × (a centre card plus a ring of 5 turning with the flow), soft round cards, about 180 BillboardGuis. Card size comes from the condensation radius *without* the profile cap, so the funnel flares into the lowering as the physics gives it (up to 4 core radii). Each card carries part of the optical depth, so the stack is opaque in the middle and soft at every edge. It is the closest to the target and costs ~1 ms (A: ~2.5 ms). Billboards draw at any distance.
- **B with the game's `funnelCore` / `funnelWisp` textures.** Still poor: stacked horizontal slabs with seams.
- **Modes now:** off → A | B | C → A | D → B only → C only → D only.

## Default funnel: billboard volume (`client/Render/TornadoCards`, 2026-10-25)

Option D became the default funnel style. The mesh (`Render/TornadoVisuals`) stays as the F4 "funnel: mesh" style and as A in the comparison. The technique matches what another Roblox storm developer described (~200-300 BillboardGuis, sized in studs from radius and height, client-side, sun dot-product shading, LOD, positions set directly).

- **Cards:** 32 heights × (centre + ring of 6) = 224 per tornado, at most 2 tornadoes (the nearest). The ring turns with the flow at its radius.
- **Size:** condensed radius up to 4 core radii (no envelope cap), so the funnel flares into the lowering. Where the column is narrower than the layer spacing, cards are drawn taller than wide (≥ 1.4 × spacing), so the tip stays continuous and streaky.
- **Shading:** sunlight left after the chord of funnel between the card and the sunward surface (exp(-0.02/m × path), longer when the sun is low), and less sky light deeper inside. Colour comes from SceneLight (storm shading, local flashes); rain between the camera and the funnel greys it.
- **LOD:** no work while the funnel is off screen; every other height beyond 12 km; size/opacity/colour at 1/4 frame rate (1/6 beyond 4 km), positions every frame.
- **Cost:** ~0.2 ms for 224 cards (TornadoCards module ~0.6 ms incl. writes) vs ~2.5 ms for the mesh.
- **Seen in Studio:** stovepipe (full height, flared), cone (soft cone tapering to a continuous tip ~450 m up, dust below).
- **Not done yet:** the mesh's debug overlays (LOD readout, centreline …) only work in mesh style; the multi-vortex sub-vortices aren't drawn as cards yet. The wedge scene camera (now 4 km) is still poorly framed: the storm's own tower pieces sit in front.
- **Teardrops removed (2026-10-25):** `Vortex.deficit` / `condensationRadius` no longer let the near-ground swirl jet deepen the pressure deficit (the jet stays in the wind field). Pressure in the thin surface layer is set by the swirl above it, so condensation now shrinks steadily toward the ground instead of reappearing at the ground under a gap. Cone: continuous to ~250 m. Stovepipe: continuous to the ground. Vortex tests pass.
