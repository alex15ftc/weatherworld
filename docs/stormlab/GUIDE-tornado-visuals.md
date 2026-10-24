# Roblox Tornado Visual Rendering Implementation Plan
## Scope: Funnel appearance, condensation, multivortex structure, and nighttime lightning

**Purpose:** Implement the visual side of tornadoes in Roblox as a modular system that can render varied funnel shapes, partially or completely uncondensed circulations, multivortex tornadoes, rain-wrapped tornadoes, and tornadoes revealed by lightning at night.

**Scope boundary:** This document covers tornado rendering and its interfaces with existing storm/atmosphere simulation. It does not repeat the broader tornado physics, storm/supercell simulation, radar, outlook, or weather-authority plans. Treat the existing simulation as the source of truth and consume its state through a defined interface.

---

## 1. Core design principles

1. **Keep physics separate from appearance.** The tornado's wind field, damage, and physical circulation must not depend on whether the funnel is visible.
2. **One renderer, many shapes.** Rope, cone, stovepipe, wedge, and transitional shapes should use the same rendering pipeline with different profile parameters.
3. **Visibility is a field, not a Boolean.** Condensation, rain obscuration, distance, and lighting should vary by location and time.
4. **Multivortex is a dynamic configuration.** Subvortices can form, move, intensify, fade, and dissipate without replacing the parent tornado.
5. **Darkness should conceal information naturally.** Nighttime tornadoes should not remain artificially bright. Lightning briefly reveals cloud, funnel, rain, and debris according to the flash's lighting conditions.
6. **Use stable, coherent animation.** Never independently randomize vertices every frame. Use deterministic noise and smoothly changing parameters to avoid flicker.
7. **Design for Roblox constraints.** Standard Roblox rendering does not expose a general-purpose custom volumetric ray-marching shader. Approximate volume with mesh geometry, textures, particles, and controlled lighting.
8. **Build a measurable prototype first.** Validate silhouette, motion, visibility, and performance before adding more visual layers.

---

## 2. System architecture

Implement the renderer as client-side visual components driven by replicated tornado state.

Suggested modules:

```text
ReplicatedStorage/
  TornadoVisuals/
    TornadoVisualConfig.lua
    TornadoVisualTypes.lua
    TornadoProfileLibrary.lua
    TornadoNoise.lua
    TornadoStateAdapter.lua

StarterPlayer/
  StarterPlayerScripts/
    TornadoVisualController.client.lua
    TornadoVisualRegistry.lua
    TornadoLODController.lua
    LightningVisualController.client.lua

  -- Runtime-created client visual objects:
  -- Main funnel geometry
  -- Condensation layers
  -- Wisp/filament emitters
  -- Subvortex visual instances
  -- Ground dust/debris visuals
```

Names are recommendations, not a requirement to mirror the project's current folder layout. Adapt to existing conventions rather than duplicating modules.

### Responsibilities

- `TornadoStateAdapter`: maps existing authoritative tornado data into a stable visual input schema.
- `TornadoProfileLibrary`: provides shape profiles and transition parameters.
- `TornadoNoise`: deterministic, smoothly varying deformation/noise helpers.
- `TornadoVisualController`: owns one tornado's visual lifecycle and updates its visual components.
- `TornadoVisualRegistry`: creates, updates, and destroys controllers as tornadoes enter or leave the client’s visual range.
- `TornadoLODController`: selects detail levels based on distance, visibility, and performance budget.
- `LightningVisualController`: coordinates short-lived lightning illumination and visual responses.
- `TornadoVisualConfig`: centralizes tunable parameters, material choices, limits, and debug options.

Do not create a second authoritative tornado simulation inside these visual modules.

---

## 3. Define the visual input contract

The renderer should consume a snapshot of physical state. Map these fields to the project's existing data; do not add duplicate authoritative values solely for rendering.

Example conceptual schema:

```lua
export type TornadoVisualState = {
    id: string,
    position: Vector3,
    velocity: Vector3,

    -- Shape and physical extent
    height: number,
    profile: string,
    radiusByHeight: {number}?,
    centerlineByHeight: {Vector3}?,

    -- Environmental/physical conditions
    circulationStrength: number,
    condensationByHeight: {number}?,
    relativeHumidityByHeight: {number}?,
    precipitationObscuration: number,
    debrisIntensity: number,

    -- Optional dynamic subvortices
    subvortices: {SubvortexVisualState}?,

    -- Lifecycle / state
    lifecycleWeight: number,
}
```

This is an interface proposal, not a mandate to change the simulation model. Where the existing model lacks a detailed field, start with a derived or configurable approximation and label it as such.

### State handling requirements

- Interpolate replicated state between updates for smooth movement.
- Use stable tornado IDs to preserve visual continuity.
- Use deterministic seeds per tornado and per visual layer.
- Smooth changes in profile, condensation, and intensity; avoid abrupt asset swaps.
- If state data temporarily stops updating, continue safe visual interpolation for a short grace period, then fade or clean up according to existing network policy.

---

## 4. Phase A — Build a single-funnel prototype

**Goal:** One tornado whose shape and animation are convincing at close, chase, and distant views.

### A1. Profile-based geometry

Create a reusable funnel mesh generator using horizontal rings or equivalent procedural surface construction.

Each profile defines normalized height and radius control points, for example:

```lua
local Profile = {
    -- Normalized height and normalized radius.
    -- Values here are illustrative, not physical measurements.
    {h = 0.00, r = 0.30},
    {h = 0.25, r = 0.22},
    {h = 0.60, r = 0.36},
    {h = 1.00, r = 0.90},
}
```

Implementation notes:

- Smoothly interpolate between control points; avoid angular changes at ring boundaries.
- Use a centerline curve so the funnel can lean or curve with height.
- Deform the radius with several coherent noise scales.
- Keep the main mesh's topology stable during animation where possible.
- Avoid obvious horizontal ring seams.
- Avoid using a perfectly uniform cone as the final shape.
- Allow the top to blend into a cloud-base lowering and the bottom to blend into ground circulation effects.

**Roblox implementation decision:** choose between an editable procedural mesh workflow supported by the project's toolchain, pre-authored mesh templates with controlled deformation, or a hybrid. Verify what can be updated at runtime in the target Roblox environment before committing. Do not assume arbitrary mesh vertex editing is available through ordinary `MeshPart` APIs.

### A2. Shape profile library

Create initial presets:

- `Rope`: narrow, strongly varying radius; pronounced centerline irregularity.
- `Cone`: generally tapers toward the ground; soft, irregular edges.
- `Stovepipe`: relatively consistent radius through the middle portion.
- `Wedge`: broad visible condensation region that can blend into the cloud base.
- `Transitional`: blends between profiles over time rather than switching instantly.

Profiles describe the *visible condensation envelope*, not tornado intensity or damage rating. Permit the shape to change over the tornado's lifetime.

### A3. Coherent deformation

Combine multiple scales:

- Low-frequency deformation for broad bends and bulges.
- Medium-frequency deformation for uneven condensation structure.
- Fine detail for subtle surface breakup.

Use deterministic noise with time as a smooth input. Avoid per-frame random offsets, high-frequency jitter, and identical repeated spirals.

A conceptual radius function is:

\[
r(h,\theta,t)=r_0(h)\,[1+aN(h,\theta,t)]
\]

where \(r_0\) is the profile radius and \(N\) is a coherent noise function. Clamp the output to safe minimum and maximum values so the mesh does not invert or collapse unexpectedly.

### Acceptance criteria

- The same renderer can display all four basic profile families.
- The centerline can curve smoothly.
- The shape changes without a visible hard swap.
- Animation is coherent rather than flickering.
- No obvious seams or regularly spaced rings are visible at intended chase distances.

---

## 5. Phase B — Condensation and uncondensed tornadoes

**Goal:** Make funnel visibility independent of the physical circulation.

### B1. Build a condensation visibility field

Compute visual opacity per height and around the funnel, rather than using one transparency value for the whole tornado.

Inputs may include:

- Existing thermodynamic data or a simplified condensation estimate.
- Height-dependent humidity/temperature where available.
- Pressure-related cooling or a simplified proxy if the physics system provides it.
- Rain and cloud obscuration.
- Distance and camera visibility.
- Illumination from sun, ambient light, and lightning.

Conceptual form:

\[
\alpha(h,\theta,t)=F(C(h,\theta,t),O,L,D)
\]

where \(C\) is condensation potential, \(O\) is precipitation/cloud obscuration, \(L\) is illumination, and \(D\) is viewing distance. Treat this as a rendering approximation, not a substitute for full cloud microphysics.

### B2. Visual states

Support continuous transitions among:

- **Condensed:** a mostly continuous but irregular funnel.
- **Partially condensed:** separated visible segments, wisps, and gaps.
- **Minimally condensed/uncondensed:** no continuous funnel; optional wisps and ground circulation remain visible if conditions permit.
- **Rain-wrapped:** precipitation obscures the vortex; do not simply make the funnel a uniformly dark solid.
- **Dissipating:** condensation fades and breaks apart while physical circulation may persist until the simulation says it ends.

### B3. Layered rendering

Use a controlled combination of:

1. Main deformed funnel surface for the overall silhouette.
2. Noise-based textures or texture layers to break up density.
3. A small number of curved wisps or tapered secondary elements.
4. Particle emitters for transient condensation fragments where they add value.
5. Separate dust/debris effects near the ground.

Do not rely on dozens of identical transparent cones. Test transparency sorting, overdraw, and camera-angle artifacts in Roblox Studio. Prefer fewer purposeful layers over many full-screen transparent surfaces.

### B4. Physical independence

- Condensation visibility must never set wind speed to zero.
- Funnel width must never define the damage footprint.
- A nearly invisible tornado must still affect nearby objects according to the authoritative wind field.
- Dust/debris visibility depends on surface material, moisture, and available loose material; do not guarantee a conspicuous dust cloud over every surface.
- Visual classification must not be used as a proxy for intensity.

### Acceptance criteria

- A tornado can have damaging winds with no continuous visible condensation funnel.
- Condensation can vary by height and around the circumference.
- Rain can conceal the vortex without deleting its physical effects.
- Visibility changes are smooth and respond to lighting and environment.
- The renderer never modifies authoritative physics or damage.

---

## 6. Phase C — Multivortex tornadoes

**Goal:** Render subvortices as dynamic structures embedded in a parent circulation, not as decorative miniature cones.

### C1. Subvortex state

Each subvortex visual instance should receive or derive:

- Stable ID.
- Position and velocity.
- Approximate radius/height.
- Angular movement around the parent.
- Lifetime or strength weight.
- Condensation visibility.
- Debris intensity.

Prefer the existing physics simulation's subvortex data if available. If the simulation does not model subvortices, create a clearly bounded visual-only approximation for prototyping; do not let a decorative visual approximation claim to represent physically accurate local wind speeds or damage.

### C2. Motion

- Move subvortices around the parent with varying angular velocities and radial distances.
- Add slow, coherent perturbations; avoid perfectly circular, synchronized paths.
- Allow subvortices to form and dissipate gradually.
- Keep each subvortex visually independent: one may be condensed, another visible mostly through dust, and another almost invisible.
- Do not require a fixed number or perfectly even spacing.

Conceptual orbital motion:

\[
\theta_i(t)=\theta_{i,0}+\omega_i t+\epsilon_i(t)
\]

The equation is only a trajectory scaffold. The physical wind field should come from the simulation, not from this visual path formula.

### C3. Rendering hierarchy

- Keep the parent circulation as the overall envelope.
- Add small, localized condensation columns or partial funnels only where useful.
- Use debris swirls and dust streaks to communicate low-level motion.
- Let subvortices pass in front of or behind parts of the parent visually where the rendering method allows it.
- Avoid placing every subvortex at ground level or making all of them equally visible.

### C4. Wind and damage interface

The renderer only displays subvortices. The physics system must calculate the combined parent/subvortex wind field if physical subvortices are supported. Do not infer damaging wind speeds from a visual mesh radius or particle density.

### Acceptance criteria

- Subvortices appear and disappear smoothly.
- Their motion is irregular but coherent.
- Different subvortices can have different visibility.
- The main funnel remains stable while subvortices change.
- Rendering never changes the underlying wind or damage model.

---

## 7. Phase D — Nighttime and lightning illumination

**Goal:** At night, tornado details should be revealed by flashes instead of remaining artificially visible.

### D1. Lighting states

Support:

- Daylight.
- Twilight/low ambient light.
- Dark night with little or no moonlight.
- Moonlit night.
- Brief lightning flash.
- Multiple lightning pulses with irregular spacing.

The tornado's visibility is the result of its material/opacity, ambient illumination, and flash illumination. Avoid baking a bright gray funnel into a texture that remains conspicuous in darkness.

### D2. Lightning event interface

Consume the existing lightning system's events where possible. A visual flash event should include:

```lua
{
    position = Vector3,
    intensity = 1,       -- normalized visual intensity
    radius = 1,          -- tuned in game-space units
    duration = 0.1,      -- illustrative starting point
    kind = "intracloud", -- or ground/other supported type
}
```

These are conceptual fields and illustrative values. Use the existing event schema if one exists.

### D3. Flash response

When a flash occurs:

- Briefly illuminate appropriate nearby terrain, clouds, rain, and tornado surfaces.
- Use distance falloff so a distant flash does not illuminate the entire map uniformly.
- For intracloud lightning, favor diffuse cloud illumination and silhouette reveal.
- For ground lightning, provide a stronger local illumination near the strike when appropriate.
- Allow rain curtains to catch the flash and partially obscure the tornado.
- Use short pulses and optional secondary pulses rather than a long, constant glow.
- Fade the flash response smoothly; do not abruptly switch the whole scene between two brightness values.

### D4. Roblox rendering strategy

Use real light instances where their range and cost are appropriate, combined with controlled local brightening of cloud/funnel visual layers when necessary. Test whether transparent materials respond convincingly to the chosen lighting setup. Do not assume a single point light can realistically illuminate an entire large storm.

Keep the global `Lighting` settings stable where possible. Avoid globally raising exposure for every flash; that tends to make the entire world look like daytime. Any local brightening workaround must be spatially limited and short-lived.

### Acceptance criteria

- In a dark test scene, the tornado can be nearly invisible between flashes.
- A nearby flash reveals the funnel, cloud base, rain, and debris in a spatially plausible way.
- Distant flashes produce weaker effects.
- Flash duration and fade do not create a lingering artificial glow.
- Several lightning events can overlap without causing a large global brightness spike.

---

## 8. Phase E — Cloud-base connection and ground effects

**Goal:** Prevent the funnel from looking like an object suspended between the cloud and ground.

### Cloud-base connection

- Create a localized lowering/condensation region under the storm base.
- Blend the funnel's upper geometry and condensation layers into that region.
- Use overlapping, irregular forms rather than a hard funnel-to-cloud attachment.
- Let the cloud base and funnel have related but non-identical motion.
- Ensure the top connection can be partly hidden by rain or darkness.

### Ground circulation

- Render dust, debris, and low-level swirl effects as a separate system.
- Drive their broad motion from the tornado's wind field or its existing velocity data.
- Vary appearance according to surface type and available loose material.
- Avoid a perfectly circular, uniform dust ring.
- Pool particles and reuse emitters.
- Keep debris effects bounded by the simulated circulation and local material availability.

### Acceptance criteria

- The funnel appears connected to the cloud base when visible.
- The ground circulation can be wider than the visible condensation funnel.
- Ground effects respond to surface/environment differences.
- No visible hard seam exists at the top or bottom of the funnel.

---

## 9. Phase F — Level of detail and performance

**Goal:** Preserve visual quality at chase distance without rendering every effect at maximum detail across the large map.

### Suggested levels

| Level | When to use | Visual content |
|---|---|---|
| LOD 0 — Close | Player near tornado | Full profile deformation, condensation detail, wisps, subvortices, debris |
| LOD 1 — Chase | Normal chase distance | Lower geometry detail, fewer wisps, simplified subvortices, primary dust/debris |
| LOD 2 — Distant | Storm visible across the plains | Simplified silhouette and broad condensation pattern |
| LOD 3 — Far | At or beyond visual relevance | Minimal representation or no local effect instances, according to project needs |

Use camera distance, storm visibility, and a global effect budget to select LOD. Distance to the tornado's center alone can be misleading because the cloud and rain region may be much larger than the vortex.

### Performance rules

- Reuse and pool particles, attachments, and effect instances.
- Avoid rebuilding all geometry every frame if only a subset of parameters changed.
- Update high-cost deformation at a controlled frequency and interpolate between updates.
- Use stable deterministic noise.
- Limit overlapping transparent layers and large particle counts.
- Use per-client rendering so every player does not require the server to replicate every visual particle.
- Profile on lower-end hardware and at least one crowded scenario with multiple tornadoes.
- Add a global quality setting that reduces secondary layers before degrading the main silhouette.

### Initial profiling targets

Set project-specific targets after measuring the current game baseline. As a first test, aim to keep the tornado visual system's added frame time small and consistent, with no obvious spikes when a tornado appears, transitions profile, or a lightning flash occurs. Record actual frame time, particle counts, active instances, and memory use rather than relying on subjective smoothness alone.

---

## 10. Debugging and development tools

Add a developer-only debug mode with toggles for:

- Main geometry only.
- Condensation field/opacity visualization.
- Centerline and profile control points.
- Subvortex trajectories and IDs.
- Ground-effect radius.
- Lightning event position/radius/intensity.
- Active LOD level.
- Visual instance and particle counts.
- Physics/visual separation check.

Include a test panel or deterministic scenario runner for:

1. Rope tornado in daylight.
2. Cone tornado with partial condensation.
3. Wide wedge with rain wrapping.
4. Nearly uncondensed circulation with visible ground dust.
5. Multivortex parent with several subvortices at different visibility levels.
6. Dark night with no lightning.
7. Dark night with one nearby intracloud flash.
8. Dark night with a distant ground flash.
9. Several closely spaced flashes.
10. Tornado moving between LOD levels.

Make these repeatable with fixed seeds so visual regressions can be compared after changes.

---

## 11. Implementation order and deliverables

### Milestone 1 — Renderer skeleton
- Define the state adapter and visual input schema.
- Add one client-side controller and lifecycle management.
- Create a basic profile-driven funnel.
- Add deterministic animation and cleanup.

**Exit gate:** one tornado can be created, updated, and removed without leaks or visible state jumps.

### Milestone 2 — Shape variety
- Add rope, cone, stovepipe, and wedge profiles.
- Add centerline bending and coherent deformation.
- Add smooth profile transitions.

**Exit gate:** all profiles use the same rendering pipeline and remain convincing from multiple angles.

### Milestone 3 — Condensation and rain obscuration
- Add height-dependent opacity.
- Add noise-based surface breakup and restrained wisps.
- Add partial, minimal, and rain-wrapped visibility states.
- Verify the physical tornado remains active when invisible.

**Exit gate:** funnel appearance changes without affecting physics or damage.

### Milestone 4 — Multivortex visuals
- Add subvortex visual instances and independent lifetimes.
- Add irregular trajectories and independent visibility.
- Integrate existing physical subvortex data if available.

**Exit gate:** subvortices evolve smoothly without looking like fixed decorative cones.

### Milestone 5 — Night and lightning
- Connect to existing lightning events.
- Add local flash illumination and fade.
- Tune cloud, funnel, rain, and debris response.
- Test dark intervals between flashes.

**Exit gate:** lightning reveals the tornado naturally without a global scene-brightness jump.

### Milestone 6 — Ground/cloud blending and LOD
- Improve the cloud-base connection.
- Add environment-sensitive ground circulation.
- Implement LOD, pooling, and performance counters.

**Exit gate:** the renderer remains stable with several active tornadoes and changing viewing distances.

### Milestone 7 — Visual polish and regression
- Compare against real reference footage across daylight, rain-wrapped, multivortex, and nighttime cases.
- Tune profiles and opacity curves.
- Test different graphics settings and camera angles.
- Fix transparency sorting and pop-in artifacts.

**Exit gate:** the system meets the acceptance criteria below on target devices.

---

## 12. Final acceptance checklist

- [ ] Rope, cone, stovepipe, wedge, and transitional profiles are supported.
- [ ] Shape can evolve over time without a model swap.
- [ ] Funnel deformation is smooth and coherent.
- [ ] Condensation is variable by height and around the vortex.
- [ ] Uncondensed tornadoes can remain physically damaging.
- [ ] Rain can obscure the tornado without deleting the circulation.
- [ ] Subvortices have independent trajectories, lifetimes, and visibility.
- [ ] Physical wind/damage remains separate from visual effects.
- [ ] Nighttime tornadoes can be nearly invisible between flashes.
- [ ] Lightning reveals the vortex locally and briefly.
- [ ] Cloud-base and ground effects blend into the funnel.
- [ ] LOD and pooling control performance.
- [ ] Debug scenarios are deterministic and repeatable.
- [ ] Visual objects are cleaned up correctly when tornadoes end or leave range.
- [ ] The implementation has been profiled with multiple tornadoes active.

---

## 13. Explicit non-goals

This plan does not prescribe a new tornado dynamics model, storm lifecycle simulation, supercell generation system, radar implementation, outlook system, or cross-server weather architecture. Those systems should remain the source of authoritative physical and environmental state. This plan is only the implementation roadmap for translating that state into convincing tornado visuals.

---

## 14. TornadoLab-specific integration plan and recommendations

This section adapts the generic visual plan to the current TornadoLab implementation described in the project handoff. TornadoLab already has a shared simulation, engine-derived scenario exports, tornado formation/tracking, a 3-D wind field, damage/debris/vehicle interaction, storm precipitation and cold-pool behavior, lightning, radar, and a map. **Do not rebuild those systems as part of this visual task.** Treat them as existing sources of truth and concentrate on rendering, integration, and verification.

The current reported baseline is promising: the supercell scenario produced a tornado during a Studio playtest, tracked it through an EF3 peak and rope-out, and reported no runtime errors. Treat that as a repeatable regression scenario, not as proof that every visual or physical edge case is complete. The stated 3–9 ms/frame server cost is a baseline for the tested configuration; client rendering cost must be measured separately.

### 14.1 First action: inspect the real implementation before changing architecture

Before coding, read `docs/stor/stormlab/STATUS.md`, the shared helper-agent interface document, and the existing visual scripts under `roblox/src/stormlab`. Identify:

- Which storm-cloud, sky/lighting, lightning, funnel, dust, rain, and hail renderers already exist.
- The actual state/event schemas and update cadence used by the shared interface.
- Which visual objects are server-created versus client-created.
- Whether any helper-agent code already implements profiles, texture animation, local flash lighting, or LOD.
- Which visual shortcomings are known, which have been fixed since the handoff, and which remain untested.

Do not introduce a second controller or competing state schema just because this plan uses suggested module names. Extend the existing implementation where possible. Keep the old project backup untouched; work in the active lab and use version control or a separate branch/backup before risky changes.

### 14.2 Establish a visual baseline before polishing

Capture repeatable screenshots or short clips from the same camera positions, time, scenario seed, and graphics settings. Use the two exported engine scenarios already available:

1. **Supercell scenario (seed 8181):** follow the naturally forming tornado from pre-genesis through organization, mature stage, and rope-out. Capture distant storm silhouette, mid-range cloud base, close funnel, ground circulation, and night/flash conditions if the scenario supports them.
2. **Squall-line scenario (seed 2112):** assess the line's cloud structure, cold-pool/gust-front presentation, precipitation curtains, and any naturally occurring rotation. Do not force a tornado merely to make the scenario pass; the exported engine case reportedly has no line tornado, so absence is not a defect by itself.

Add a deterministic visual-test mode or repeatable camera markers if the existing lab supports it. If simulation time is accelerated, verify that visual animation remains stable at each supported time speed and does not depend on real-time-only assumptions.

### 14.3 Recommended priority order

The current handoff says clouds look icy/puffy and the anvil does not darken the scene; the close funnel, radar, map, rain, hail, and lightning still need review. For the tornado-specific plan, prioritize in this order:

**Priority 1 — Audit and stabilize the storm/cloud visual foundation.**

- Fix the storm silhouette and cloud-base structure before adding tiny funnel detail; the tornado will never look integrated if it appears pasted onto a puffy cloud asset.
- Tune the anvil's shadow/ambient effect so the world becomes appropriately darker beneath it. Prefer a broad, restrained, spatially coherent shadow/lighting approximation over globally lowering brightness whenever a storm exists.
- Preserve variation in cloud scale and edge softness; avoid uniform icy highlights, repeated lobes, and a uniformly black underside.
- Verify cloud, precipitation, and lightning layers do not create obvious transparency sorting artifacts.

**Priority 2 — Build the main tornado silhouette and shape transitions.**

- Implement or refine the profile-driven funnel using the existing tornado state.
- Test rope, cone, stovepipe, wedge, leaning, and transitional shapes with deterministic profiles.
- Make the top merge naturally into the storm's localized lowering and the bottom into ground circulation.
- Validate from multiple camera angles and distances before layering in many wisps.

**Priority 3 — Add condensation variability and obscuration.**

- Make opacity vary by height and around the funnel using available environmental state or a clearly documented approximation.
- Support partially condensed, nearly uncondensed, and rain-wrapped appearances without changing the physical wind field.
- Verify the ground circulation remains appropriately visible when the funnel is not.

**Priority 4 — Multivortex presentation.**

- Connect to existing subvortex/wind-field data rather than inventing a parallel physical model.
- Give each subvortex independent visible condensation and ground effects.
- If the simulation's subvortices are physical, validate their visual positions against the shared field. If they are not yet represented in authoritative state, use a clearly marked visual prototype only and do not imply its detail changes damage.

**Priority 5 — Nighttime lightning reveal.**

- Integrate with the existing lightning event stream.
- Tune local illumination and short-lived visual response so the tornado can disappear between flashes.
- Test nearby intracloud flashes, distant flashes, ground strikes, and repeated pulses.
- Do not wait for audio IDs to be approved before implementing visual lightning; thunder audio is a separate dependency.

**Priority 6 — Performance, LOD, and polish.**

- Measure client frame time, transparent overdraw, active instances, particle counts, and memory with multiple storms and tornadoes.
- Implement or tune LOD only after the full-quality close-range look is acceptable.
- Profile at normal time and all supported accelerated time settings.

Radar and map review are valid separate lab tasks, but they should not block the tornado visual milestones unless their existing interface is needed for visual debugging.

### 14.4 Integration rules for the existing shared simulation

- The simulation remains authoritative for tornado position, motion, physical circulation, subvortex state (if present), debris-driving wind, and lifecycle.
- The visual layer consumes state and interpolates it locally. It must not change the simulation to make an effect look better.
- Reuse the current shared interface document and existing event payloads. Do not create competing definitions for lightning or tornado state.
- If rendering needs data not currently exported, add the smallest explicit field to the shared interface and document its units, coordinate frame, update rate, and whether it is authoritative or derived.
- Never use a storm label such as `supercell` or `squall line` as a shortcut for a tornado visual state. Render what the actual fields and events say.
- The renderer should handle missing or stale optional visual fields gracefully; it should not crash or produce NaN geometry.
- Keep server-side simulation and client-side visuals separately profiled. The current server timing does not establish that a transparent, particle-heavy client renderer will be inexpensive.

### 14.5 Required visual regression matrix

For every visual milestone, rerun a compact subset of this matrix and capture before/after images or clips:

| Test | Expected result |
|---|---|
| Supercell, daylight, distant view | Recognizable storm silhouette; anvil and updraft tower read as one storm system |
| Supercell, daylight, close base | Funnel blends into lowering; no hard seam or obvious cone primitive |
| Rope-out transition | Shape narrows/bends/dissipates smoothly without a sudden model pop |
| Partial/uncondensed tornado | Funnel may be hard to see while physical wind/damage remains active |
| Rain-wrapped tornado | Rain obscures the vortex spatially instead of making it a solid dark tube |
| Multivortex case | Subvortices move independently and do not look like evenly spaced decorative cones |
| Night with no flash | Funnel is appropriately difficult to see under low ambient illumination |
| Nearby intracloud flash | Cloud and funnel briefly reveal shape with localized, plausible illumination |
| Distant lightning | Weaker reveal than a nearby flash; no full-scene daylight pulse |
| Multiple active storms | Visual quality degrades gracefully under the chosen LOD/quality budget |
| Accelerated simulation | Geometry and opacity remain temporally coherent at each supported speed |
| Scenario reset/replay | No orphaned effects, duplicate controllers, or stale tornado visuals |

### 14.6 Specific technical cautions

- **Runtime mesh editing:** confirm the actual Roblox-supported mesh creation/deformation workflow before choosing a ring-mesh implementation. Do not assume ordinary `MeshPart` objects expose arbitrary vertex updates.
- **Transparency:** overlapping transparent surfaces may sort incorrectly. Test from above, below, and oblique angles. Use fewer, more purposeful layers rather than stacking many full-screen transparent shells.
- **Lightning:** a real point light alone may not illuminate a large storm volume. Combine local lighting with limited, spatially bounded visual brightening if needed, and ensure the effect decays quickly.
- **Anvil shadow:** standard Roblox lighting may not provide the exact broad cloud-shadow behavior desired. If a direct shadow is not feasible, use a carefully tuned approximation tied to the anvil footprint, sun direction, and storm position. Avoid a uniform global darkening effect.
- **Simulation speed:** separate physical simulation time from render frame time. Use the lab's simulated clock for evolving storm/tornado structure and real frame delta for smooth interpolation; document the choice for every animation channel.
- **No false test failures:** a scenario without a tornado should not fail merely because no tornado appeared. Validate against expected engine outcomes and the scenario's actual environmental forcing.

### 14.7 Definition of done for TornadoLab

The tornado visual task is ready for broader art iteration when:

- [ ] Existing tornado and storm state is consumed without duplicating simulation logic.
- [ ] Main funnel profiles and shape transitions are convincing at chase distance.
- [ ] Condensation visibility is independent from wind and damage.
- [ ] Multivortex visuals follow existing state and remain independently visible.
- [ ] Nighttime visibility is governed by ambient light and lightning rather than permanent funnel glow.
- [ ] The cloud base, anvil, funnel, rain, and ground circulation read as a coherent scene.
- [ ] The anvil's influence on scene lighting has been tuned and tested from multiple locations.
- [ ] The visual regression matrix passes for both exported scenarios where applicable.
- [ ] Client performance is measured independently from the reported server simulation cost.
- [ ] No runtime errors, orphaned visual instances, or major transparency artifacts appear during scenario reset, rope-out, or LOD transitions.

This addendum is deliberately an integration and prioritization layer over the existing plan. It does not ask for a new storm engine, tornado dynamics system, radar, map, or weather architecture.
