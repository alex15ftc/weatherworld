# Tornado shape changes and genesis looks: research mapped onto the lab (2026-11-03)

How real tornadoes change shape (rope, cone, stovepipe, wedge, multi-vortex and back), how the
different genesis types look in their first minutes, and which of this the lab's fields can already
produce. Everything is meant for the one tornado build: one state (vc, rc, swirl, cloud base, decay,
tilt, sub-vortices), one renderer (`client/Render/TornadoCards.luau`, style `smoke`), shapes coming out
of the fields. No code was changed for this note.

Companion notes, not repeated here: `LIFECYCLE-RESEARCH.md` (stage table, archetype timelines),
`TORNADO-STRUCTURE-RESEARCH.md` (wind profile, deficit, sizes), `docs/tornado-physics/README.md`.

Tags: **[D]** = derived here from the cited equations; **[U]** = commonly quoted, not confirmed in
a readable source; **[2]** = second-hand (Wikipedia, press, summary). Source numbers refer to the list at
the end. The AMS journal pages refused access, so several primary papers appear only through their
abstracts or conference preprints.

---

## Part 1. Research

### 1.1 The funnel is one surface, set by the pressure deficit against the LCL

- **The condensation surface.** Air drawn into the core cools as it expands and condenses once the
  local pressure has fallen to its own LCL pressure (Stull eq. 15.48 [1]). So the visible funnel is
  the surface where the vortex's pressure deficit equals the fall needed to reach the cloud base.
  The fall needed at height z is about ρg(h − z): roughly 1.1 hPa per 10 m below a cloud base at
  height h.
- **The Rankine model's consequences [1][D].**
  - Inside the core the deficit is Δp = ρvc²(1 − r²/2rc²); outside it is ρvc²rc²/2r².
  - Outside the core the funnel edge is where v(r) = √(2g(h − z)), so
    **r_f(z) = rc·vc / √(2g(h − z))**.
  - Inside the core, r_f = rc·√(2(1 − g(h − z)/vc²)).
  - The funnel reaches down only to **z = h − vc²/g**. Below that there is a dust or debris whirl and no funnel.
  - So one surface carries every shape:
    - a small rc·vc under a high base gives a rope or a funnel aloft;
    - a large rc·vc under a low base gives a wedge;
    - the radius at each height follows from vc, rc and h.
- **Wedge definition.** A funnel at least as wide at the ground as it is tall [25]. Whether a strong
  tornado is a wedge depends heavily on the cloud base and sub-cloud moisture, not only on intensity [26][2].
- **The funnel is not the core.**
  - Bassett NE 1999 [7]: in the shrinking stage the vortex stayed wide and intense while the
    condensation funnel narrowed a lot.
  - El Reno 2013 [34]: the funnel touched down about 80 s before radar genesis.
- **Debris and condensation are separate fields.** The radar debris annulus sits at or just outside
  the core, and Mulhall's debris disk (about 1.2 km) matched its core [10][6].
- **Two-celled cores.** A two-celled core's central downdraft brings drier air from aloft and can
  hollow out the funnel's centre [3].

### 1.2 Why tornadoes widen ("wedging out")

| Driver | Physics | Source |
|---|---|---|
| Rising swirl ratio S = r₀Γ/2Q | More angular momentum per unit of updraft flux. The core expands with S, and the flow goes one-celled → breakdown bubble aloft → two-celled to the ground → multiple vortices. | Rotunno 2013 [3], Davies-Jones 1973 (in [3]); thresholds ≈0.1-0.2 / 0.45 / ~1 [U] (Church et al. 1979) |
| Broader parent circulation | rc is 5-25% of the mesocyclone updraft radius. A wider low-level circulation gives a wider core. | Stull [1] |
| Lower LCL / moister inflow | The needed deficit ρg(h − z) shrinks, so the same vortex condenses farther out. | [1][D][26] |
| Merging of small circulations into the parent | Sub-vortices merge into one broad funnel. | NWS spotter guide [24] |
| Multi-vortex sheath | With high moisture each sub-vortex condenses inside a broad translucent bowl. | [10][13][D] |

**Measured sizes** (core radius rc; diameters converted to radii):
- **Spencer 1998:** rc 125 → 200 m over several minutes, then slowly smaller. rc grows with height, 120 → 250 m [8].
- **Mulhall 1999:** rc ≈ 600 m near the ground (1.2 km peak to peak), ≈ 875 m aloft. Sub-vortices 200-300 m across [10].
- **DOW median:** core diameter ≈ 300 m (2239 scans). Core size and peak intensity are weakly anti-correlated [15][2].
- **El Reno 2013:** formed 6:03 pm CDT as several sub-vortices under a large wall cloud. It reached 4.2 km
  wide at about 6:23-6:26, so about 20 min from genesis to record width [11][14]. The popular "widened in
  30 s" has no source [U].

### 1.3 Why they narrow: contraction, shrinking, rope-out

- **Contraction while intensifying.** Bassett: "the RMW contracted as the tornado intensified and
  increased as the tornado dissipated" [7]. Canadian TX 2015 (5.5 s volumes): intensity changes over less
  than 30 s came with rapid diameter changes, and during decay the diameter grew while ΔV fell [6].
- **Corner-flow collapse.**
  - A rapid shrink of the near-surface core, triggered by changes in the far-field inflow, gives a
    transient burst of intensification.
  - Near-surface swirl is up to about 2.5 times the swirl aloft near the critical corner-flow swirl
    S_c ≈ 1.1-1.2 (range 0.7-1.8) [3][4][5].
  - This is "tightening at touchdown".
- **Rope-out.**
  - The RFD undercuts the surface circulation, the tornado tilts into the shape of the RFD bulge, and
    the rope stage follows [24].
  - Decay often starts aloft in a tilt or stable layer (1.25-3 km) and spreads up and down within about a
    minute (Goshen, El Reno 2011, Canadian [6]).
- **Funnel narrowing without core narrowing.** The funnel can narrow while the vortex stays wide [7].
  By §1.1 this means vc falling or h rising: RFD air that is warmer and drier, or a rising base.
- **Shedding.** Small vortices are shed while the tornado weakens and may carry angular momentum away [6].
- **Timescales.**
  - Genesis to peak width: about 10-20 min (El Reno ≈ 20 min; Spencer, minutes).
  - Intensity and diameter swings: under 30 s to about 1 min (Canadian: ΔV > 40 → < 20 m/s in under 30 s) [6].
  - The funnel's bottom height scales with vc², so a vc drop lifts the funnel within seconds.
  - Shrinking and rope-out take about 5-20 min (Goshen: dissipation 2212-2230 [18-20]).

### 1.4 Cyclic behaviour

- **Occlusion period.** About 60 min in simulation; the first cycle takes about 2 h to organise [27].
  Observed cycles run 40-90 min (Burgess et al. 1982; already cited in Storm.luau).
- **Where the new circulation forms.** The new mesocyclone forms on the surging RFD gust front, to the
  right (typically south-east) of the old one [28][2]. NWS: watch for a new rain-free base south of the
  current tornado [24].
- **The old tornado keeps going for a while.** It goes on with the old, occluding circulation, so
  tornado families overlap: the old one ropes out while the new one forms.
- **McLean TX 1995: at least 5 tornadoes** [29].
  - Outflow-dominated mode: a new updraft forms at the edge of the outflow.
  - Inflow-dominated mode: new vortices form on the updraft's east side and mature as they migrate west.

### 1.5 Genesis types and how the first minutes look

| Type | Mechanism | First minutes, seen | Sources |
|---|---|---|---|
| Classic supercell, bottom-up (most rapid-scan cases) | Near-ground rotation first. The column becomes coherent upward within seconds to a minute. | Under a rotating wall cloud, with the clear slot and RFD surge minutes before: a dust/debris whirl at the ground, then condensation lowering from the base and "filling in" as the deficit grows. El Reno: ground circulation 90 s before the deep vortex, which grew through 3.5 km in < 20 s. | [6][18][24][33][34][35] |
| Supercell, descending / top-down (TVS from aloft) | Dynamic pipe effect. In WSR-88D data about 52% of TVSs descend [31][2], but the 88D undersamples low levels and rapid-scan data mostly show bottom-up or simultaneous development [32][6]. | A funnel lowers from the wall cloud before any ground whirl. Visually the same lowering funnel; the difference is the ground whirl's timing. | [30][31][32] |
| QLCS mesovortex | Leading-edge downdrafts tilt vortex lines into a couplet; the cyclonic member dominates over about 30 min. Mesovortices are 2-20 km across. | Brief and rain-wrapped. Often only a debris cloud or a short low funnel in the rain at the line's leading edge or a notch [U visual]. | [36] |
| Landspout / non-supercell | A misocyclone (1-3 km) on a convergence boundary is stretched by a fast-growing updraft, often before much rain. | A dust column at the ground first, then a thin smooth tube filling in from a high flat base. No wall cloud, no rotating updraft. Usually weak, rarely F2-F3. | [37][38][39][40] |
| Rain-wrapped HP | Any of the above inside the hook's precipitation. The secondary RFD wraps the young tornado. | A broad grey lowering behind rain curtains, low contrast. El Reno: translucent outer circulation, no full funnel. | [11][18] |
| Cyclic (second tornado) | A new low-level meso on the RFD gust front, right or south-east of the occluding one. | A new rotating lowering / rain-free base forms while the old tornado ropes out to its left-rear. | [24][27][28][29] |
| Wedge genesis | Not settled in the literature [U]. Both are seen: El Reno began as several sub-vortices under a big wall cloud and widened over about 20 min; Spencer widened from 125 to 200 m within minutes. | By §1.1 a broad, low-LCL vortex condenses wide at once: a big lowering that fills in to the ground. A narrow vortex that broadens widens from a cone. Both follow from rc and h at genesis. | [8][11][14][24][D] |
| Multi-vortex first | A broad, high-swirl circulation is unstable before it organises. | Several short dust whirls or small funnels orbiting under a broad lowering, later merging into one funnel or a wedge (El Reno). | [11][16][24] |

### 1.6 What stays continuous through a transition

- **The funnel stays one connected surface** from the base downward. Its radius at each height is the
  deficit-against-LCL isobar, and it flares into the base where the needed deficit falls to zero.
- **Lifting and filling in move the funnel's bottom** (h − vc²/g) while the ground circulation goes on as
  a debris whirl. The NWS counts the funnel as a tornado when a debris or dust whirl is under it [41];
  Doswell's definition does not need a funnel [42].
- **The debris cloud changes slowly.** It is set by the wind and the ground, not the funnel, and it
  outlives the funnel's lift.
- **Sub-vortices** are 40-300 m across, live a few to tens of seconds, travel at up to about 75 m/s, and
  those living longer than 15 s drift inward (El Reno [16]). They carry the peak winds, about 1.2-1.5 times
  the azimuthal mean [10]. In moist air each can condense inside a translucent sheath [D].

---

## Part 2. The lab's code against the research

### 2.1 Where the tornado state comes from

| Field | Rule (file: function) | Relaxation time |
|---|---|---|
| Parent supply | `World.parentOf`: rlow = 0.3·Ru, vlow = storm's low meso, wLow = W·f(1 km) + ½vmid, cloudBase = `s.wallBase` (base − lowering), occl, rfdDeficit. Line parent: rlow = ½ mesovortex rlow, cloudBase = 0.85 LCL. | Ru 900 s, vlow 360 s up / 240 s down |
| Swirl | `Tornado.swirlOf`: S = 0.25·vlow·rlow / (2·wLow·350) / (0.5 + 0.5·O), × (1 − 0.6·decay) | 90 s |
| Core radius | `Tornado.step`: rc = 0.05·rlow·(0.5 + 2.2·S)·(1 − 0.6·decay)·stretchK | 60 s |
| Core wind | vc = q·vlow·(rlow/rc)^0.4·pulse·(0.25 + 0.75·O)·(1 − d²)/(1 − 0.6·d) | 45 s up / 90 s down |
| Organisation / decay | O += dt/90 while fed; decay += dt/150 when cut (occl ≥ 0.6, cold RFD, vlow < 6, tilt > cloud base) | |
| Cloud base | `t.cloudBase` follows the parent's wall-cloud base | 60 s |
| Core moisture | `t.coreWet` = ground wetness at the contact; `Vortex.coreBase` = cloudBase·(1 − 0.7·coreWet) | 60 s |
| Funnel | `Vortex.condensationRadius`: I(r/rc) = g(h_core − z)/vc² on the Wood-White profile (fed → cut by decay). Hollow core (`hollowR`) from swirl 0.9-1.4 × O. rc grows 30% to the base (`rcAt`). | |
| Sub-vortices | `SubVortices.index` = ramp(S, 0.95, 1.5)·ramp(vc, 12, 30)·O·(1 − decay) | 1.5-5 s spawn |

**The shape as one dimensionless map [D].** The funnel's shape depends only on K = g·h_core/vc², and its
width on rc. The table below is a Python copy of `deficitIntegral` (fed profile).

| K = g·h/vc² | Funnel radius at ground / rc | at mid-height / rc | taper (mid / ground) |
|---|---|---|---|
| 0.5 | 2.24 | 4.03 | 1.8 |
| 1.0 | 1.19 | 2.24 | 1.9 |
| 1.5 | 0.71 | 1.57 | 2.2 |
| 1.8 | 0.45 | 1.32 | 2.9 |
| ≥ 2.06 | none (funnel aloft) | | |

What the table implies:
- **Width.** The funnel at the ground is never wider than about 2.2 rc unless vc > √(2g·h), e.g. 83 m/s
  under a 350 m base. A wedge (2·r_ground ≥ h) therefore needs rc ≳ 0.25-0.5·h. Measured scenes:
  - Round 37 wedge: rc 317 m under a 600 m base.
  - Round 36's "wedge": rc 175 m under a 350 m base; K = 1.95, ground funnel 51 m, a cone.
- **Taper.** Even at low K, the funnel's mid-height radius is 1.8 times its ground radius, plus the
  `rcAt` 30%.
  - The cut (decaying) profile, whose tail falls as R⁻¹, tapers less (1.5 at K = 0.5).
  - Rankine tapers by √2.
  - So **a parallel-sided stovepipe cannot come out of the isobar on the fed profile.** The "stovepipe"
    scenes are low-K cones.
  - Real stovepipes are close to cylinders over most of their height.

### 2.2 Transitions the fields can already produce

| Transition | How | Notes |
|---|---|---|
| Dust whirl → funnel lowering → cone | vc rises with O (90 s) and K falls through 2.06 | Matches bottom-up genesis (§1.5). The funnel fills in top-down by itself. |
| Funnel aloft / partial funnel over a debris whirl | K > 2.06 near the ground (high base, weaker vc), with the debris loft from peak wind | Matches §1.6. |
| Cone ↔ "stovepipe" | K changing with the vc pulse (±12% over 40 s, ±20% over 4 min) | Only taper changes; no parallel sides (§2.1). |
| Stovepipe → wedge | Only if the parent's rlow (0.3 Ru) and vlow/wLow grow: S and rc go up together | Ru relaxes over 900 s toward a target set by rotation, shear and CAPE, so a free storm hardly ever broadens mid-tornado. The lab does it with scripted keys (SC4). A lower wall-cloud base (`s.lowering`) also widens it. |
| Wedge ↔ multi-vortex | Swirl > 0.95-1.5 gives sub-vortices and a hollow core. Round 37 hides tubes inside the condensed radius. | Physical; matches §1.2. |
| Any → rope | Cut off (occl ≥ 0.6, cold RFD, tilt): decay narrows rc and swirl, the profile goes "cut", the RFD drags the contact (tilt, stretchK), waves grow | Good, but see 2.3(c). |
| Funnel lifts with the debris whirl lingering | vc's 90 s fall after the cut, so the funnel bottom h − vc²/g rises | Matches [6][24]. |
| Rain-wrapped look | Emerges from the precipitation field and the renderer's sight-line rain | Fine. |

### 2.3 What they can't produce, and why

1. **Wedging out in a free storm.**
   - rlow is tied to the updraft width (0.3·Ru, 15 min e-fold), not to the low-level circulation's own
     dynamics.
   - The swirl's depth scale is a constant 350 m.
   - Nothing makes the near-ground circulation broaden on its own: RFD surge, merging circulations, a
     moister and lower base. Real widening takes about 10-20 min (§1.3) and comes from the circulation
     and moisture, not the updraft.
2. **Wedge → stovepipe/cone while still strong** (contraction with intensification, corner-flow
   collapse). Only the vc pulse and supply changes narrow it. There is no near-ground contraction
   response to inflow changes, and rc's 60 s lag is slower than the observed under-30-s to 1-min swings [6].
3. **Shrinking by the wrong mechanism.**
   - The decay rule shrinks the core: rc·(1 − 0.6·decay) and S·(1 − 0.6·decay).
   - Observed [6][7]: the RMW widens as the tornado weakens, and the *funnel* narrows because vc falls
     (and the base rises). Tilt stretching (stretchK) is the physical narrowing for a rope.
   - The current rule gives the right silhouette but the wrong wind field. A dissipating tornado's
     damage and debris swath narrow instead of broadening and weakening.
4. **The RFD's air does not reach the funnel.**
   - rfdDeficit only scales strength (`warm`) and the cut-off.
   - The core's condensation level uses the wall-cloud base plus *ground wetness* (`coreWet`), a proxy
     for rain-cooled air.
   - Warm, dry RFD air wrapping in should raise the core's LCL. That lifts and narrows the funnel and
     is the real wedge → cone → rope driver. Moist RFD air should lower it ("fills in", wedges on
     moist days).
   - `ColdPool` already carries M (moisture) and R (rear-flank share) per cell, but the tornado doesn't
     read them.
5. **No overlapping cyclic tornadoes.**
   - `s.tornado` is cleared only when the old tornado *ends*, and `owner.G = 0` at genesis. G is only
     integrated while `s.tornado` is nil, so the next tornado can't form while the old one ropes out.
   - **Likely bug.** At the occlusion reset (`occl ≥ 1` → `lowAngle = 2.75`, `vlow ×0.35`), the low meso
     the old tornado follows (`World.parentOf` → `Storm.lowMesoAt`) jumps by 1 rad at 0.6 Ru (about
     1.5-2 km). Usually the old tornado has ended by then (cut at 0.6, decayed within minutes). One
     still alive would be pulled to the new meso, or re-fed: occl 0 clears `cutOff`.
6. **No landspouts / non-supercell genesis.**
   - The only parents are supercell low mesos and QLCS line mesovortices; bookends never make tornadoes.
   - `Boundaries.luau` and `Initiation.luau` have boundaries and growing cells, but nothing turns
     boundary vertical vorticity into a misocyclone parent.
7. **Multi-vortex-first genesis is suppressed.** `Tornado.new` says a wide, slow parent "starts as
   several small vortices round a broad centre". But `SubVortices.index` multiplies by O, and vc starts
   at 8 m/s (the ramp starts at 12 m/s), so sub-vortices appear only once the vortex has organised.
   By then the swirl has halved.
8. **rc's growth with height is fixed** at +30% to the base (`rcAt`).
   - Observed: Spencer 120 → 250 m; Canadian RMW 200 → 500 m between 100 and 500 m above ground;
     Mulhall 600 → 875 m. A low-swirl corner flow is narrow at the bottom and wide aloft; a high-swirl
     flow is more uniform [3][6].
   - The fixed rule removes a natural cone ↔ stovepipe lever.
9. **Genesis vortex starts.** It starts at the parent's broad, high-swirl size (good) and vc 8. The
   QLCS parent's base is 0.85 × LCL with no wall-cloud physics, and its rlow is ½ of a 2-4 km random
   width.

### 2.4 Genesis modes: present and missing

| Mode | Status |
|---|---|
| Supercell low meso (bottom-up look) | **Present.** `Storm.step` G integrator (stretching × warm RFD × RFD × LCL), `World.stepStormCells` → `startTornado`. The funnel fills in top-down by itself. |
| Top-down (descending) | Visually the same as bottom-up here: a lowering funnel. The ground whirl's timing would need the vortex to build downward. Not needed for the look. |
| QLCS mesovortex | **Present.** `Systems.luau` mesovortex G. No rain-wrapped specifics beyond the rain field. |
| Bookend vortex | Exists as a vortex, never makes tornadoes (fine: bookends are rarely tornadic). |
| Rain-wrapped HP | Emerges from rain. |
| Cyclic second tornado | **Partly present.** A new one is possible only after the old has ended (no overlap). |
| Multi-vortex first | **Gated off** by O in `SubVortices.index` (2.3.7). |
| Landspout / non-supercell | **Missing.** |
| Wedge from a broad lowering | **Present** when the parent is broad at genesis (`Tornado.new` rc from swirlOf(parent, 0)). |

---

## Part 3. Proposals (field-driven, continuous, ranked by value / effort)

Each proposal changes a field or a relation. None adds a type switch or a painted shape.

### P1. The core's condensation base from the air it takes in (high value, small-medium effort)
- **Where:**
  - `Sim/Tornado.luau` `Tornado.step`, which computes a new `t.coreBase`, or `coreLcl`, replacing the
    ground-wetness `coreWet`.
  - `Sim/Vortex.luau` `coreBase`, which reads it.
  - `World.parentOf` passes the RFD air.
- **Physics:**
  - The core ingests a mix of the environment's inflow (LCL), forward-flank outflow (the wall-cloud
    mix `Storm` already computes) and RFD air.
  - Take the RFD air's T and Td from `ColdPool` D and M at the contact. The rear share R and the wrap
    (occlusion, decay) set how much RFD air there is.
  - Then core LCL ≈ 125·(T_mix − Td_mix), less the wall cloud's dynamic lowering.
- **What it gives:**
  - Warm, dry RFD wrapping in raises the base: the funnel lifts and narrows (wedge → cone → rope, §1.3).
  - Moist outflow lowers it: the funnel fills in, and wedges come on moist days (§1.2).
- **Continuity:** continuous through mixing shares. It also removes the ground-wetness proxy.

### P2. Overlapping cyclic tornadoes, with the old one kept on its own circulation (high value, medium effort)
- **Where:**
  - `Sim/Storm.luau` occlusion block (`occl ≥ 1` reset) and the G integrator (`if own and not s.tornado`).
  - `Sim/World.luau` `parentOf`, `startTornado`, and the end-of-tornado release.
- **Physics:**
  - At the cut (occl ≥ 0.6) the old low-level circulation is detached and carried on as its own
    occluded parent. It keeps its position and spin and moves with the RFD and outflow, decaying.
  - The storm's G integrates again for the new circulation forming on the RFD gust front, to the right
    or south-east (§1.4).
  - That gives the rope-out of the old tornado and a new lowering forming nearby at the same time,
    what chasers watch for.
- **Fixes:** the low-meso jump at the occlusion reset (2.3.5).
- **Continuity:** the storm's occl and vlow stay continuous. Only *which circulation* a tornado follows
  changes, and it changes once, at the cut.

### P3. A low-level circulation with its own radius, plus faster near-ground contraction (high value, medium effort)
- **Where:** `Sim/Storm.luau` low-meso block (`Storm.step`, near `local Vl = ...`) gets a new `s.rlow`
  state, which `World.parentOf` uses instead of 0.3·Ru. `Tornado.step` gets the rc relaxation.
- **Physics:**
  - The low-level circulation contracts where convergence beneath it is strong: the RFD surge and
    mid-occlusion, `occlusionFactor`'s peak.
  - It broadens when its inflow weakens or it merges with neighbouring circulations, and as the base
    lowers.
  - With its own state (relaxing over about 5-10 min toward a convergence-set radius), wedging out
    takes the observed 10-20 min instead of following the updraft's 15-min e-fold.
- **Tornado core:** make rc's relaxation asymmetric. Contraction is fast (about 20 s,
  angular-momentum spin-up, corner-flow collapse [4][6]); expansion is slower (about 60 s).

### P4. A dissipating core widens; its funnel narrows (medium value, small effort)
- **Where:** `Tornado.step` (the `(1 − 0.6·decay)` factors on `S` and `rcT`, and the `vT` decay line).
- **Physics:**
  - When cut off, the near-ground circulation is no longer converged. The RMW expands while vc falls
    (Bassett, Canadian TX [6][7]).
  - The funnel then narrows from vc² falling (and P1's rising base), not from a shrinking core.
  - Keep `stretchK` (tilt stretching) as the narrowing for a tilted rope: stretching is physical.
- **Effects:**
  - Damage and debris paths of dying tornadoes broaden and weaken, as surveys show.
  - Ropes come only from tilted, stretched vortices.
- **Risk:** the rope silhouette. Check L1 and SC in Studio. The `wwCut` profile already keeps the
  funnel inside the core.

### P5. Funnel envelope along core trajectories, for real stovepipes (high visual value, medium effort, partly hypothesis)
- **Where:** `Sim/Vortex.luau`, a new `Vortex.funnelRadius(p, z)` wrapping `condensationRadius`. The
  renderer's single call (`TornadoCards.luau` ~l.922, `Vortex.condensationRadius(e, z, vk)`) and
  `Tornado.funnelGround` use it.
- **Physics [D]:**
  - Air that condenses low in a one-celled core rises in the core updraft at a near-constant radius and
    stays saturated until it mixes out.
  - So the visible edge at height z is the larger of the local isobar radius and the radius condensed
    below, carried up along the core streamline (Vortex's ψ): roughly r_vis(z) = max(r_f(z), r_f(z')
    for z' < z on the same streamline).
- **What it gives:**
  - Near-parallel sides (stovepipe) at low swirl.
  - The isobar shape where a two-celled core's downdraft dries the centre (`twoCell`, `hollowR`).
- **Status:** not confirmed in a primary source. Standard texts treat the funnel as the isobar [1].
  Treat it as a modelling hypothesis, and test it against the reference frames before adopting it.
- **Simpler variant:** make `rcAt`'s growth with height a function of swirl (P6).

### P6. Core radius with height from swirl (medium value, small effort)
- **Where:** `Sim/Vortex.luau` `rcAt`.
- **Physics:** a low-swirl corner flow is narrow at the bottom and wider aloft (Canadian: RMW ×2.5 from
  100 to 500 m; Spencer ×2). A high-swirl, two-celled flow is closer to uniform [3][6][8].
- **Proposed rule:** growth factor 1 + a(S)·z/h, with a falling from about 1.0 at S 0.2 to about 0.2 at
  S ≥ 1. Continuous in S.
- **What it gives:** cone-like tornadoes when young or at low swirl, and wedges/stovepipes when
  broadened.

### P7. Multi-vortex-first genesis (medium value, very small effort)
- **Where:** `Sim/SubVortices.luau` `SubVortices.index`.
- **Physics:** a broad, high-swirl young circulation is already unstable before it organises (El Reno
  began as several sub-vortices [11][16]).
- **Proposed rule:**
  - Drop the `O` factor. Keep the vc ramp, possibly from vc 8, since sub-vortices carry about 1.2-1.5
    times the mean wind.
  - Let `Vortex.hollowR` stay O-gated: the broad centre isn't two-celled yet.
- **What it gives:** wide parents start as several whirls that merge as the swirl falls with O. Narrow
  parents stay single.

### P8. Swirl depth from the inflow layer (medium value, small effort, check calibration)
- **Where:** `Tornado.swirlOf` (the constant 350 m).
- **Physics:** S = r₀Γ/2Q, with Q the flux through the inflow layer's depth.
  - A shallow inflow layer gives more swirl for the same circulation and updraft. Examples: a
    shallow stable layer, or a shallow RFD/outflow layer (`ColdPool.depthOf`).
  - So does a low base.
- **Proposed rule:** h_in = clamp(f(base, pool depth), 200, 600).
- **What it gives:** low-LCL, shallow-inflow days broaden into wedges.
- **Recalibration:** Round 35/37 settled scenes will need it.

### P9. Landspout parent (high value for variety, large effort)
- **Where:**
  - New misocyclone parents along boundaries in `Sim/Boundaries.luau` (horizontal shear across the
    boundary gives vertical vorticity, ΔV/2 at radius 0.5-1.5 km).
  - Stretched by a cell from `Sim/Initiation.luau` / `Storm` whose young updraft sits over it.
  - A G integrator like the mesovortex one (`Systems.luau` l.419) and a `World.parentOf` branch.
- **Physics [37][38]:** stretching of pre-existing vertical vorticity by a growing updraft, before
  rain. The base is the cell's own LCL (often high), wLow is the young cell's updraft at 1 km, and the
  parent dies once outflow undercuts it.
- **What it gives:** with no extra code in the tornado, a dust column then a thin smooth tube from a high
  flat base. The look follows from a small rlow and low swirl under a high h (§1.5).

### P10. Occlusion-surge contraction / corner-flow transient (low-medium value, small effort)
- **Where:** `Tornado.step` (`vT`) and `Vortex.params` (`jet`).
- **Physics:** near-surface swirl can reach about 2.5 times the swirl aloft near S_c ≈ 1.1-1.2 [4].
- **Proposed rule:** a jet term peaking at S ≈ 1.1 (currently falling monotonically from 0.25 at S 0.2
  to 0.13 at S 1.0) gives the strongest ground winds at the stovepipe-to-wedge transition.
- **What it gives:** fits "tightening at touchdown" and the El Reno spurts [33].

### Ranking summary

| # | Value | Effort | Main file / function |
|---|---|---|---|
| P1 core LCL from mixed inflow / RFD air | High | S-M | Tornado.step, Vortex.coreBase, World.parentOf |
| P2 overlapping cyclic tornadoes | High | M | Storm.step (occl reset, G), World.parentOf / startTornado |
| P3 own low-level circulation radius + fast contraction | High | M | Storm.step (low meso), World.parentOf, Tornado.step |
| P7 multi-vortex-first | Medium | XS | SubVortices.index |
| P6 rc(z) from swirl | Medium | S | Vortex.rcAt |
| P4 decaying core widens, funnel narrows | Medium | S | Tornado.step |
| P5 trajectory envelope (stovepipes) | High (visual) | M, hypothesis | new Vortex.funnelRadius, TornadoCards |
| P8 swirl inflow depth | Medium | S + recalibration | Tornado.swirlOf |
| P9 landspouts | High (variety) | L | Boundaries, Initiation, Systems-style G, World.parentOf |
| P10 corner-flow jet peak | Low-Med | S | Vortex.params, Tornado.step |

Suggested order:
1. P7 and P6, the quick shape levers.
2. P1, the biggest physical gap for wedge ↔ rope.
3. P2, which also fixes a likely bug.
4. P3.
5. P5 as a lab experiment.
6. P9 when variety work starts.

---

## Sources

1. Stull, *Practical Meteorology*, ch. 15.3: Rankine vortex; funnel pressure, eq. 15.48. https://geo.libretexts.org/Bookshelves/Meteorology_and_Climate_Science/Practical_Meteorology_(Stull)/15%3A_Thunderstorm_Hazards/15.03%3A_Section_4-
2. (unused)
3. Rotunno 2013, The Fluid Dynamics of Tornadoes, *Annu. Rev. Fluid Mech.* 45. https://www2.mmm.ucar.edu/people/rotunno/Papers/Rotunno2013_ARFM.pdf
4. Lewellen & Lewellen, On the limits to near-surface intensification of tornado vortices, 23rd SLS. https://ams.confex.com/ams/pdfpapers/115321.pdf
5. Fiedler 2009, Suction vortices and spiral breakdown. https://12characters.net/suction/Suction_vortices_and_spiral_breakdown_in_numerical.pdf
6. Griffin et al. 2019, *MWR* 147, Canadian TX tornado, AIR radar. https://arrc.ou.edu/~mahre/Griffin_et_al_2019
7. Bluestein et al. 2003, Bassett NE, Part II, *MWR* 131 (abstract). https://data.ucar.edu/dataset/mobile-doppler-radar-observations-of-a-tornado-in-a-supercell-near-bassett-nebraska-on-5-june-1
8. Spencer SD core radius, conference paper. https://ams.confex.com/ams/pdfpapers/103069.pdf
9. Alexander & Wurman 2005, Spencer Part I. https://farm.atmos.illinois.edu/contents/pubs_pdf/2005-Alexander_and_Wurman-The_30May1998_SpencerSD_storm-Part1-structural_evolution_and_environment_of_the_tornadoes.pdf
10. Wurman, Mulhall multiple-vortex preprint. https://ams.confex.com/ams/pdfpapers/21580.pdf
11. Wikipedia, 2013 El Reno tornado [2]. https://en.wikipedia.org/wiki/2013_El_Reno_tornado
12. (unused)
13. Wurman & Samaras, in-situ pressure vs DOW winds. https://ams.confex.com/ams/pdfpapers/82352.pdf
14. NWS Norman, 31 May 2013 event page. https://www.weather.gov/oun/events-20130531
15. Alexander & Wurman, DOW tornado climatology. https://ams.confex.com/ams/23SLS/techprogram/paper_115170.htm
16. Thiem (OU thesis), El Reno RaXPol sub-vortices. https://shareok.org/handle/11244/45410
17. Wurman et al. 2014, *BAMS* (abstract). https://bibliotheque.meteo.fr/pub/DOC00026573-the-role-multiple-vortex-tornado-structure-causing.html
18. Kosiba et al. 2013, Goshen County genesis, *MWR* 141. https://farm.atmos.illinois.edu/contents/pubs_pdf/2013-Kosiba_etal-Genesis_of_the_GoshenCountyWY_tornado_on_5June2009_during_VORTEX2.pdf
19. Goshen intensification, 27th SLS. https://ams.confex.com/ams/27SLS/webprogram/Paper256041.html
20. Goshen dissipation, 25th SLS. https://ams.confex.com/ams/25SLS/webprogram/Paper176231.html
21. (unused)
22. Wikipedia, 2004 Hallam tornado [2]. https://en.wikipedia.org/wiki/2004_Hallam_tornado
23. (unused)
24. NWS Spotter Guide, tornado life cycle. https://www.weather.gov/spotterguide/tor_life
25. NWS glossary, wedge. https://forecast.weather.gov/glossary.php?word=wedge
26. Fox Weather, tornado types [2]. https://foxweather.com/learn/5-different-types-of-tornadoes
27. Adlerman et al. 1999, *JAS* 56. https://experts.illinois.edu/en/publications/a-numerical-simulation-of-cyclic-mesocyclogenesis/
28. Cyclic tornadogenesis conceptual models (cites Burgess 1982). https://ams.confex.com/ams/Sept2000/webprogram/Paper15896.html
29. Dowell & Bluestein 2002, McLean TX. https://shareok.org/handle/11244/5902
30. Trapp & Davies-Jones 1997 (indexed abstract). https://acnpsearch.tweb-dev.unibo.it/singlejournalindex/2738475
31. Trapp et al. 1999, descending vs non-descending TVSs. https://www.nssl.noaa.gov/users/brooks/public_html/sls19/abstracts/trappetal.html
32. French et al. 2013, *MWR* 141. https://researchconnect.stonybrook.edu/en/publications/reexamining-the-vertical-development-of-tornadic-vortex-signature/
33. Bluestein et al. 2019, *MWR* 147, El Reno tornadogenesis. https://repository.library.noaa.gov/view/noaa/32207
34. Confirming bottom-up tornadogenesis in the 31 May 2013 El Reno tornado, 29th SLS. https://ams.confex.com/ams/29SLS/webprogram/Paper348256.html
35. OU METR4403 tornadogenesis lecture, 2025. https://twister.caps.ou.edu/METR4403/lectures_2025/Tornadogenesis.pdf
36. Trapp & Weisman 2003, Part II. https://origin-east-www-spc.woc.noaa.gov/misc/AbtDerechos/papers/TrappWeisman_2003.pdf
37. Wakimoto & Wilson 1989 (summaries). https://www.weather.gov/media/arx/research/Res11NST.pdf ; https://glossary.ametsoc.org/wiki/nonsupercell-tornado/
38. Szoke & Pietrycha, landspout life cycle (cites Brady & Szoke 1989). https://www.nssl.noaa.gov/users/brooks/public_html/sls19/abstracts/szokepietrycha.html
39. Wikipedia, Landspout [2]. https://en.wikipedia.org/wiki/Landspout
40. NWS Boulder, 20 May 2020 Weld County. https://www.weather.gov/bou/5-20-20_WeldCountyTornadoes
41. NWS spotter glossary (F). https://www.weather.gov/spotterguide/glossary_f
42. MetEd, tornado definition (Doswell 2001). https://www.meted.ucar.edu/norlat/cases/chadwick_papers/Definitions/Tornado-Chadwick.htm

Not read (access refused or file too large): Wurman & Kosiba 2013 *WAF*, Lewellen & Lewellen 2007
*JAS*, Church et al. 1979, Davies-Jones 1986/2015, Lee & Wilhelmson 1997, Houser et al. 2015 (full
text), Snyder & Bluestein 2014.
