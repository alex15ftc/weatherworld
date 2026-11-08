# Storm and tornado rendering: architecture (2026-11-07)

How the game turns the engine's storms into what players see, what was wrong with it, and what
this round changed. Display only throughout: nothing here feeds back into the engine, the radar or
damage.

## 1. The pipeline as found

```
engine storm (js/storms)  ──►  StormStructure.buildStormFrame  (display only, per storm, ~0.3 s)
                                 64x64 box at 1 km: two cloud runs a column (100 m steps), rain, hail
                                 48x48 nest at 250 m round the low-level mesocyclone: base, pressure drop
                                 tornado block: Rankine core R, drop P, wall-cloud base Bt, tip, lean levels
                                 drift block: storm-relative wind summed with height (rain slant)
          │  FrameCodec.clientFrame (near: full planes + nest; far: 2x2 blocks, no nest), zstd
          ▼
server/LiveStorms ─► client/LiveStorms ─► client/EngineStorms
                                             PuffView / MeshView  cloud body (quadtree leaves of 1 km columns)
                                             TornadoView           funnel + dust
                                             RainView, DeckView    rain curtains, overhead base
```

Fields reaching the client: cloud runs (base/top x2), rain, hail, anvil snow, the nest's base and
drop, the tornado's vortex, the rain drift. Not reaching it: wind (other than what the vortex and
drift imply), vertical velocity, temperature, humidity, hydrometeor profiles aloft.

## 2. Problems found

| Problem seen | Cause |
|---|---|
| Tornado reads as a hollow helical scaffold | TornadoView stacked rings of 8 puffs at half the radius, all spinning at the ring's angular speed: a regular lattice turning, so it read as a ribbon helix, and the axis was empty |
| Fragmented / smoky funnel | each ring's opacity was a fixed function of width; no density across the funnel, so edges were as solid as the core |
| Funnel floats in clear air, doesn't meet the wall cloud | (a) the drawn low-level mesocyclone stayed on the storm's position while the engine's tornado can sit ~3 km off it (occlusion); the funnel's lean levels then ran 3 km sideways over 700 m of height. (b) The 250 m nest (which holds the lowered base: the wall cloud) was never drawn in the game, so the funnel met the 1 km body's blocky base or nothing |
| No physical basis for multiple vortices | nothing in the frame said how strong the updraught over the tornado is, so the swirl ratio couldn't be formed |
| Dust stuck to the funnel | dust rings sat on the funnel's axis and turned with it |
| Per-frame cost | — (the new model is costed below) |

Kept as is (they work and were judged before): PuffView/MeshView body layout and light, RainView,
DeckView, the haze and rain-light rules, FrameView's anchor.

## 3. What changed

### Engine frame (display only, `js/storms/StormStructure.js`)
- **Mesocyclone on the tornado.** While a tornado is down, the drawn low-level mesocyclone (its
  drop, its swirl, the 0-1 km spin) is centred on the tornado: a tornado forms inside its parent
  circulation. The tornado's position is still the engine's. The funnel on seed 2 21Z S0057 went
  from a 3.3 km lean to upright.
- **Tornado core counts as cloudy in the nest.** The tornado's core is rising air, so the nest
  cells over it get a cloud base (and its lowering) even where the 1 km column round them is
  clear.
- **Updraught block** (`FrameCodec.UPDRAUGHT`, full flags bit 4, client flags bit 5, 29 bytes): the
  strongest rise in the 3 km over the wall cloud's base above the tornado (or the low-level
  mesocyclone), the core's centre-line speed at cloud base, the core's centre at 1 and 5 km, and
  its radius. Readers that don't know it stop before it.

### `VisualAtmosphere.luau` (new, shared, pure)
One model of the air near a tornado that every tornado-scale view samples:
- **Condensation:** air in the vortex condenses at its condensation level lowered by the drop,
  `zc(r) = Bt − p(r)/(ρg)`; above it, adiabatic liquid water `q_l = Γ_l (z − zc)` (Γ_l 2 g/kg/km),
  extinction `β = 3 ρ q_l / (2 ρ_w r_e)` (r_e 10 µm). Optical depth along chords gives opacity, so a
  funnel is dense in its core and see-through at its edge, and ropes are faint threads.
- **Swirl ratio** `S = R V / (r0 w)` (Davies-Jones' r0Γ/2Q with Γ = 2πRV, Q = πr0²w). Laboratory
  regimes (Ward 1972; Church et al. 1979): breakdown aloft from 0.2, turbulent by 0.6, two
  subvortices from 0.8, one more every 0.35, up to six. Count and strength are continuous in S.
- **Subvortices:** Rankine cores on the parent's radius of maximum wind, orbiting at half its
  angular speed there, each adding its drop to the parent's (whose drop loses up to 40% to them).
- **Flow** for advection: Rankine swirl, surface-layer inflow, core rise.
- **Dust radius:** where the ground-relative wind (swirl + motion) passes 15 m/s, levelling off
  smoothly toward 3.5 core radii (the 1/r Rankine tail put a wedge's dust 4.5 km out).
- **Noise:** seeded, C2-continuous value noise and fBm (same on every client).
- **Wall cloud:** bilinear lowered base from the nest; mesocyclone from the tornado block (or fitted
  from the nest's drop without one).
- **Easing:** the drawn vortex follows the frame's with time constants (3-6 s), so frames never jump.

### `TornadoView.luau` (rewritten)
Four layers, all from VisualAtmosphere:
1. **Body:** slices up the axis (spacing 0.55 of the local radius), one axis-centred puff each,
   2.3 radii wide, overlapping its neighbours; opacity from the chord optical depth through the
   axis. Large-scale curvature and bulges are coherent noise carried up by the core's rise, their
   amplitude growing with turbulence (from S). The tip thins over its lowest 12%, ragged by noise.
2. **Structure:** 150 flow tracers at random radii inside the volume; each integrates the swirl
   and rise at its own radius every step, and carries a clump density fixed at its birth from noise
   at its birthplace (neighbours share bands; differential rotation wraps them). No rings, so no
   regular helix. Lit brighter on the side toward open sky.
3. **Subvortices** (only when S says): their own condensation where their drop plus the parent's
   reaches the need; tilted forward with height by the orbit's turn while the air rises.
4. **Dust:** its own tracers spiralling in at the ground, lofted and spreading aloft, round a
   ground point that lags the vortex by 2.5 s; depth-tested half into the ground.

Profile (condensation radius + optical depth at 4 chord offsets per slice) rebuilt every 0.2 s;
motion every frame.

### `WallCloudView.luau` (new)
The nest's lowered base drawn as soft puffs where it hangs ≥60 m below the storm's base (the
nest's upper-quartile base), carried round the mesocyclone at its Rankine angular speed by
tracers that re-sample the field where they are (so the cloud elements turn while the wall cloud
stays where the pressure field puts it). Across, the true scale near the funnel (to 3 core radii),
easing to the map scale outward, so the funnel's top and the wall cloud meet at the same size and
the outer lowering meets the body.

### `EngineStorms.luau`
Creates the wall cloud view per storm, places it every step, passes lightning to the tornado and
wall cloud. Debug camera layer key G gains "wall cloud hidden" and "only tornado and wall cloud".

## 4. Parameters

All live-tunable through workspace attributes, no code edits:
- `VA_<key>`: VisualAtmosphere.CONFIG (physics constants and laboratory fits).
- `TV_<key>`: TornadoView.CONFIG (budgets, slice spacing, widths, large-scale amplitude, tip rag,
  structure size/opacity, dust, LOD).
- `WC_<key>`: WallCloudView.CONFIG (tracers, reach, minimum lowering, scale blend, opacity).

## 5. Approximations (marked APPROX in code)

- The swirl-ratio regime table and subvortex size (6% of their spacing), strength (half the
  parent's swirl) and orbit (half its angular speed) are laboratory/observational fits.
- Inflow (half the swirl below 120 m) and core rise (0.6 of the updraught) are corner-flow shapes,
  not solved.
- Dust lofting (12% of the swirl) and spreading aloft (35%) are shapes; no surface type is in the
  frame, so all ground is treated as dry loose soil.
- Spin is taken as cyclonic (the frame carries no sign).
- The updraught for S is the display frame's parcel profile (not the engine's updraught field).

## 6. Performance (measured)

- Offline (lune, one core): the tornado's profile costs 1.6 ms every 0.2 s; motion 0.33 ms a step
  (0.46 ms a frame at 60 fps), against 2.2 ms a step before the profile was cached.
- Budgets: tornado ≤340 billboards (body ≤44, structure ≤150 scaled by on-screen size, subvortices,
  dust ≤84), wall cloud ≤160. The structure and dust budgets fall with the funnel's size on screen
  (full at ≥260 px tall), faded per tracer, not switched.
- Studio (edit mode, plugin context, a standalone test place built from this repo: real seed 2
  21Z S0057 frame plus three vortices set in it): no runtime errors; TornadoView.place 1.9-2.1 ms a
  step at the minimum detail level (Studio's viewport was 1x1, not rendering), WallCloudView ~40
  puffs. Plugin Luau is slower than the lune timing; the profile rebuild was then slowed to every
  0.4 s with 6-point chords. Swirl ratios: real EF0 0.04, rope 0.01, cone 0.07 (all single,
  laminar), 1.3 km wedge with a 12 m/s updraught 1.12 (fully turbulent, ~2.9 subvortices).
- Not yet seen: no picture of the new look could be taken (the window grab returns Studio's 3-D
  viewport black and the plugin's screenshot permission is off), so nothing visual is judged yet.

## 7. Not done / next

- **Parent storm volume (brief §4):** the body is still PuffView's 1 km leaves. Next: sample the
  body from a continuous density (bilinear runs + the same noise), rotate the near-base pieces with
  the mesocyclone, a flanking line from the updraught block's lean, and a tower silhouette.
- Fine edge wisps (layer slot left in TornadoView.CONFIG) — after the large scales are judged.
- Far LOD: frames without a nest draw no wall cloud; far tornadoes use the same view at a lower
  budget (no impostor yet).
- Spin sign and surface type in the frame; the subvortex fits checked against DOW cases.
