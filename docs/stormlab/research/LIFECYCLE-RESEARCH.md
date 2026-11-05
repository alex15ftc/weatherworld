# Tornado lifecycle research (2026-10-31)

Background for the lifecycle scenes (`roblox/src/stormlab/shared/VisualTests.luau`, `life_*`).
Marked *(std)* = standard textbook values not re-verified; *(anecdotal)* = chaser accounts.

## Condensation physics (what the funnel shows)
- The funnel edge is roughly the isobar where the vortex pressure deficit equals the fall needed
  to condense inflow air: Δp_req(z) ≈ ρ g (z_LCL − z), ~11 hPa per 100 m below cloud base *(std)*.
  LCL 500 m → ~55 hPa at the ground; 1000 m → ~110 hPa; 1500 m → ~165 hPa.
- Available deficit ≈ ρ v_c² at the centre *(std)*: 50 m/s → ~29 hPa, 70 → ~56, 95 → ~104.
  Largest measured: ~100 hPa (Manchester SD 2003, Samaras probe).
- So with a ~1 km base only violent tornadoes condense to the ground; partial funnels over a
  debris whirl are normal. Significant-tornado LCLs: median ~780 m vs 1230 m non-tornadic
  (Rasmussen & Blanchard 1998); F2-F5 with ~500-800 m (NWS).
- Swirl ratio (lab): breakdown reaches the surface ~0.45, two-cell ~0.5, multiple vortices > ~1
  (Church et al. 1979). Low S: smooth laminar narrow tube; two-cell: broad, turbulent, hollow core.

## Genesis as seen
- Lowerings: wall cloud (rain-cooled moist outflow lowers the local LCL), rotating wall cloud,
  tail cloud, clear slot cut by the RFD; circulations often first at the slot's north edge
  (NWS spotter guide, weather.gov/spotterguide/tor_life). Rain-wrapped in HP storms.
- Touchdown modes: (1) funnel lowers to the ground as the deficit grows; (2) dust whirl at the
  ground first, condensation lowers from the base toward it (fills top-down, where Δp_req is
  least). Upward-growing funnels are unphysical except for moist RFD scud.
- Radar: only 52% of TVSs descend (Trapp et al. 1999); rapid-scan radar shows bottom-up or
  near-simultaneous spin-up (French et al. 2013). The VORTEX forms low; the CLOUD lowers.
- Goshen County 2009: RFD surge ~4 min before genesis; secondary RFD gust front feeds it.
- Landspouts: misocyclones on a boundary stretched by a growing cumulus; dust column first, then a
  thin smooth tube from a high (1.5-2.5 km) base, 3-15 min. QLCS: fast, brief, rain-wrapped.

## Types and transitions
| Type | Vortex | Driver |
|---|---|---|
| Dust whirl / uncondensed | deficit < Δp_req near ground | high LCL, dry, early or weak |
| Rope / tube | small rc, low S, one-cell, laminar, tilted | stretching at genesis or decay; RFD undercut |
| Cone | isobar tapers down | strengthening, mid LCL |
| Stovepipe | near-constant width | strong, low LCL, mature, vertical |
| Wedge | rc ≥ ~500 m and/or very low LCL; two-cell/multi-vortex sheath | high S, broad meso (El Reno 4.2 km) |
| Multi-vortex | 2-6 sub-vortices | S > ~1; El Reno subs 0-79 m/s translation, >115 m/s winds |
| Rain-wrapped | any, hidden by RFD curtain | occlusion, HP |

- Rope → cone → stovepipe → wedge: rising v_c and r_c, more convergence (S up), moister inflow.
- Wedge ↔ multi-vortex: S past ~1 breaks the sheath; satellites can merge into wedges.
- Rope-out: RFD wraps and undercuts, cuts off warm inflow; the base is carried with the RFD while
  the top stays with the meso (tilt, "scorpion tail"); stretching shrinks rc while the deficit
  falls; the tube contorts and breaks into segments where the deficit along the bent axis dips
  under Δp_req; the debris whirl persists 1-4 min after the funnel *(std)* (Rozel 2013 *(anecdotal)*).
- Classic stages: organizing → mature → shrinking → decay. Cyclic supercells repeat ~20-60 min.

## Uncondensed and tube looks (render cues)
- Stub or cone from the base (a bump to 2/3 down), a wider debris skirt at the ground, between
  them clear air with faint upward dust spirals or a translucent dust tube along the core annulus.
- Radar debris sits just outside the visible funnel (LaGrange 2009, Wakimoto et al. 2011; Dodge
  City 2016): debris annulus at r ≳ rc, condensation at r < r_condense.
- Opacity grows with the excess of deficit over Δp_req; near threshold: wispy, flickering edges.
- Laminar low-S tubes: crisp smooth edges, fine helical striations. Turbulent: ragged, lumpy.
- Colour: front-lit white/grey, backlit dark; debris darkens it from the bottom; rain-wrapped
  blue-grey, low contrast.

## Archetype timelines
- Classic (Goshen 2009, ~38 min): wall cloud + slot from T−15 min; 0-6 min genesis (dust whirl +
  lowering cone); 6-16 steady EF2 (62 m/s at 40 m); 16-34 shrinking to rope; whirl to ~38.
- Wedge / multi-vortex (El Reno 2013, 40 min; Bowdle 2010): cone → stovepipe → wedge in 10-15 min,
  20+ min wedge/multi-vortex, 5-10 min shrinking and rope-out.
- Brief rope: 2-6 min. Landspout: 3-15 min. QLCS: 1-5 min.

## Reference cases
Goshen County WY 2009; LaGrange WY 2009; El Reno OK 2013; Dodge City KS 2016; Rozel KS 2013;
Campo CO 2010; Bowdle SD 2010; Manchester SD 2003; Wray CO 2016; Pampa/Dimmitt 1995, Spencer 1998.

Sources: NWS spotter guide (weather.gov/spotterguide/tor_life); Trapp et al. 1999; French et al.
2013 MWR 141:4576; Wakimoto et al. 2011 MWR 139:2233; Wurman et al. 2014 BAMS; Church et al. 1979;
Lewellen (AMS 23SLS, 2010); Kosiba / Markowski et al. 2012 (Goshen); Rasmussen & Blanchard 1998;
NWS OUN El Reno event page.
