# Physical volume storms (2026-11-03)

The user's ask: "Let's make the entire storm physics based with card usage, so nothing is spoofed. This will require a full
physics lifecycle for the supercell, mesocyclone, wall cloud, and tornado. Transitions should be seamless and physics
driven. Billboards will be used for the volume (volumetric)."

## Where we are

**The sim** already has most of the physics:
- A full 3-D wind (`World.windAt`): environment, cold pool, updraft with inflow and outflow, a Rankine meso, FFD/RFD, the
  tornado's Wood-White vortex.
- A per-level cloud memory (`Storm.stepCloud`): cloud water that grows, erodes and falls out.
- Real condensation maths for the wall cloud (mixed-air LCL + vlow²/g) and the funnel (cyclostrophic deficit against the
  core's condensation level).

Some lifecycle steps are still rules:
- Occlusion progresses on a timer (`occl += dt rfd rot / 2000`) and resets at 1.
- The low meso sits at a fixed bearing and distance (`lowMesoAt`: 0.6 Ru at `lowAngle = 2.75 - occl`).
- Tower maturity is an age clock.
- A tornado is cut off when its parent's `occl` reaches 0.6.

**The drawing** is almost all hand-shaped: each storm part is its own module with fixed card counts, layouts, aspect
caps and presence ramps. Examples:
- The wall cloud's underside is a quartic, `zb + D (r/R)^4`.
- The funnel and the wall cloud meet through a capped dip and a fade.
- Funnel cards are turned to the axis as it appears on screen, with fixed width-to-height ratios.

The seams between parts (a funnel top that tilts and doesn't meet the wall cloud, lowerings that switch on, cards that
pop) are seams between modules, not between physical things.

## The design

### 1. One cloud field (`shared/Sim/CloudField.luau`)

There is one function, `CloudField.at(world, x, y, z)`, which returns the cloud's extinction σ (1/m) and what it is
(liquid, ice, how fresh). Every visible cloud is where this field is non-zero:

| Part | Physics | Built from |
|---|---|---|
| Updraft tower, overshoot | Parcel condensate from the inflow's moist adiabat, diluted by entrainment toward the edge | `wprof`, `liveCloudR`, `cmQf` |
| Remnant cloud | What the updraft built and hasn't evaporated or fallen out | cloud memory `cmR/cmQ` |
| Anvil | Ice detrained at the EL, carried by the upper wind, sublimating | anvil length and parcels (`Precip` anvil ice) |
| Base, wall cloud, funnel, scud | Air is cloud where it is above its own condensation level, and that level is lowered by the local pressure deficit | see below |

**The low cloud.** The air at (x, y) condenses at
`zc(x, y, z) = LCL(air at x,y) - p'(x, y, z) / (ρ g)`.
- `LCL(air)` comes from the inflow mixed with rain-cooled outflow: the cold pool's deficit D and moistness M at that
  point. This is the same mixing the wall cloud already uses, but per point instead of one value per storm.
- `p'` is the sum of the pressure deficits:
  - the low meso's (cyclostrophic: ρ v² times a profile integral, as `Vortex.deficit`);
  - the tornado's (`Vortex.deficit`);
  - the updraft's dynamic low.
- Rising air above `zc` carries condensate `q ≈ Γ (z - zc)` (adiabatic liquid water, ~2 g/kg per km). So a cloud is thin
  at its underside and thickens upward, and its edge is soft by physics.

That makes the base, the wall cloud and the funnel **one surface**. The funnel is that surface pulled down by the
tornado's deficit and the wall cloud by the meso's. They are connected by construction, and a funnel narrowing into a
rope or a wall cloud rising after occlusion is just that surface moving.

### 2. A physical lifecycle (sim)

The lifecycle is driven by the cold pool and the wind field, not timers.
- **Low meso position:** where the RFD and FFD gust fronts meet (the occlusion point), found from the cold pool's edge
  field. It drifts rearward as the RFD outflow wraps round it.
- **Occlusion:** how far the low meso sits inside cold outflow (the deficit under it against the warm inflow's), not a
  clock. The circulation is cut off when its inflow is rain-cooled air it can't lift. The `liftable` balance in
  `Storm.step` is already that test.
- **Cycle:** a new low meso forms at the new occlusion point once the old one sits in the cold pool. The old one carries
  on with its own deficit (as the detached circulation does since Round 40).
- **Tornado:** genesis, intensification and decay keep their circulation and stretching drivers. The cut-off comes from
  the occlusion measure above instead of `occl >= 0.6`.
- **Tower growth:** the top rises with the parcel's own ascent (`cloudTop` at 0.5 W) and the cloud memory. The age clock
  in `towerTop` goes.

### 3. Volume cards (client)

Cards sample the field; they don't draw parts.
- **Particles.** Each card is a cloud parcel: it moves with `windAt`, lives while σ > 0 where it is, and fades as σ falls
  there. It is seeded where the field has cloud and no card covers it. Nothing is switched on or off. A wall cloud forms
  where the surface dips, because that's where parcels condense. A rope-out is the funnel's parcels evaporating.
- **Nested volumes.** Three resolutions share the budget:
  - the storm: spacing ~300-800 m;
  - the low meso and wall cloud: ~40-120 m;
  - the tornado: down to ~rc/3, following its axis.
  Where a finer volume covers a place, the coarser one's cards there fade by a weight that ramps across a border zone,
  so there are no seams.
- **Opacity is Beer-Lambert.** A card standing for a slab of depth Δ has opacity 1 − e^(−σΔ). Stacked cards along any
  sight line then give the true transmittance e^(−∫σ ds), so there are no hand-tuned opacity caps.
- **Shape from the flow.** A card is the on-screen ellipse of its patch of cloud:
  - turned to the projected flow, and stretched along it by the local strain (striations, inflow bands, funnel banding);
  - sized by the local thickness scale ℓ = σ / |∇σ| and the sample spacing.
  This is the same rule for a skirt seen from below or a band seen from the side, so nothing tilts with the camera.
- **Light from the same field.** The sun and sky are marched through a coarse cached σ grid per storm. Today's lighting
  is marched through hand-shaped volumes (`SceneLight`).

### 4. Cost

- **The σ grid:** a per-storm cache (~48×48×24 at ~600 m) plus fine grids for the meso and tornado, rebuilt in time
  slices over a few seconds. It is used for seeding, lighting and the ℓ scale.
- **Particles:** about 1,500 a storm plus about 500 a tornado, the current budgets. Each one's step is one `windAt` and
  one σ lookup, staggered over frames.
- These need measuring before rollout. The old renderer stays behind a key until the new one is judged better.

## Phases

1. **Cloud field + offline viewer.** Write `CloudField` and an offline ray-marched viewer (plain Luau, PPM out) to check
   the base, wall cloud and funnel from several angles and through a lifecycle, without Studio.
2. **Lifecycle physics in the sim.** Meso position and occlusion from the gust fronts; the cut-off from the occlusion
   measure; tower growth from the parcel. Check tornado and cycle counts with the regression suite, so engine-facing
   numbers don't drift.
3. **Volume cards, low cloud first.** Tornado, wall cloud and base (the current complaint), behind a toggle key. Studio
   check from several angles.
4. **Volume cards for the tower, anvil and forward flank;** light from the σ grid.
5. **Retire the old part modules** once the new look is judged better in the reference shots (`SHOTS.md`).
