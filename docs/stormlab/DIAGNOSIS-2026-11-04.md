# Storm Lab diagnosis, 2026-11-04: thin, half-condensed tornadoes and missing physics

This was measured on every live tornado every 5 min in 2-hour Supercell and SquallLine runs: vc, rc, base, the core's condensation level, the axis deficit, the deficit needed to condense to the ground, and the funnel radius at five heights.

## Why every tornado is a needle or half-condensed

1. **The core radius never changes with strength.**
   - On the Supercell day rc is 46-77 m for vc anywhere from 25 to 70 m/s.
   - The formula is `rc = 0.05 · rlow · (0.5 + 2.2 S)` (Tornado.luau:310-317), and rlow ≈ 0.3 Ru with Ru ≈ 3900 m on every storm.
   - So a 70 m/s tornado has the same 130 m core as a 35 m/s one. Real EF3+ cores are 100-500+ m.
   - vc is `vlow · (rlow/rc)^0.4`, a fitted stand-in for angular momentum (Tornado.luau:337).
2. **Even touching down, the funnel is narrower than the core.**
   - At the ground the funnel is 0.1-0.76 rc wide. Halfway up it is about 1 rc, and at the base 3.5-4.4 rc (the renderer caps it at 3 rc).
   - That is a cone tapering to a point.
   - Why: the deficit peaks on the axis. To condense, surface air needs ρ·g·(base − z) of pressure fall: 65-78 hPa for bases of 800-1000 m. The axis only just reaches that at vc ≈ 60 m/s.
   - A funnel at least rc wide at the ground needs an axis deficit of about 1.5× that, which means vc ≳ 75 m/s at this core size.
3. **Weak and medium tornadoes never condense below a few hundred metres.**
   - T02 and T03 (25-36 m/s) have 13-28 hPa against 60-75 hPa needed, so their funnels stop 350-460 m up.
4. **The core air's condensation level is ramps, not traced air.**
   - Only coreWet and the pool share lower it: 0.25 + 0.65·wrapK, a 0.7 factor and Td + 0.35·M·d (Tornado.luau:200-225; Environment.luau:261).
   - Real low funnels come from moist, rain-cooled inflow and RFD air with a low LCL. Its θ and q should come from where it came from.
5. **What else is missing on the funnel itself:**
   - No vertical structure from dynamics. vc is uniform with height, rc is +30% at a fixed rate, and the hollow eye and the jet are fitted.
   - No friction layer.
   - No debris or dust cloud that sets the visible width.

## Physics inventory (summary)

The full table is in the session report; the ranked missing pieces are below. **[F]** means it shapes the funnel.

1. **[F]** No vorticity dynamics. vmid and vlow are √SRH closures with no tilting, stretching or baroclinic generation.
2. **[F]** No corner flow. rc, vc and the swirl are closures, not functions of the parent's circulation Γ, the updraft flux Q and the inflow depth.
3. No dynamic pressure field. Right-moving is Bunkers × rot, and the split is scripted.
4. The updraft has no entrainment or condensate loading. The width comes from ramps.
5. **[F]** The tornado's vertical structure is painted.
6. **[F]** The core air's θ and q are ramps, not traced.
7. **[F]** The RFD and FFD are kinematic, with gains, bearings and a fixed 1.5 km origin. There is no buoyancy and no −∂p′/∂z.
8. The cold pool is a 2-D slab. There is no mesohigh, no vertical structure and no baroclinic vorticity.
9. The microphysics is bulk. Rain falls at a constant 8 m/s, evaporation is linear, and the efficiency is fitted.
10. Genesis is a threshold counter, with GENESIS_NEED 0.8. Dust and debris use fixed thresholds.

Underneath all ten, every state relaxes toward a diagnosed target with a hand-set time constant. Nothing is prognostic.

**Worth keeping:**
- the anelastic streamfunction columns;
- the cyclostrophic deficit from the vortex's own wind, and the hydrostatic funnel test;
- the Klemp–Wilhelmson descent model;
- the latent-heat cold-pool source and the density-current front speed;
- the fall-out radius;
- the debris drag;
- the Markowski CIN share.
