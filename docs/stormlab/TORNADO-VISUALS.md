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

Press **F4** in the lab for the test panel. Scenes live in `shared/VisualTests`. Each builds a pinned lab storm at a fixed site, with fixed seeds, 10 minutes of its rain, and its tornado run to a stage and held there (it keeps animating):

| Scene | What it checks |
|---|---|
| 1 Rope, daylight | rope weight, a thin contorted funnel, roping out |
| 2 Cone, partial condensation | condensation down to ~100 m, broken segments below |
| 3 Stovepipe, daylight | a near-uniform condensed column |
| 4 Wedge, rain-wrapped | wedge weight 1, the rain curtain veil, obscuration |
| 5 Nearly uncondensed | EF2 winds with no condensation; dust shows the circulation |
| 6 Multi-vortex | 4-5 physical sub-vortices with independent visibility |
| 7, 8, 9, 0 Night | none, near IC, far CG, burst; uses the visual clock override (22:30) |
| - LOD dolly | the camera dollies geometrically from 300 m to 30 km |

The **debug views** are geometry, condensation heatmap, centreline + profile control points, sub-vortex ids + trails, ground radius, LOD readout, physics check, and flash markers.

**Counters:** client ms/fps, tornado LOD counts, meshes and ms, cloud parts and ms, dust, debris, active flashes, and visual instances.

Offline: `luau --codegen tools/stormlab/test_scenes.luau` prints each scene's tornado (vc, rc, swirl, condensation by height, nearby rain) and its profile weights.
