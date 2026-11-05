# Supercell decay and mode change: research and code diagnosis (2026-11-03)

User report: "supercells decay strangely, with a skinny tower that looks nothing like what happens
(outflow dominant storm mode, squall line, etc)". In the lab, a dying supercell ends as a thin, tall
column under its anvil.

This note covers how real supercells die or change mode, why the lab draws a skinny tower, and
ranked fixes that follow the fields. Nothing in the code was changed.

---

## 1. What real supercells do at the end

### 1.1 The general rule: cloud outlives the updraft

The visible cloud is condensate, not the updraft. Once the updraft weakens, the cloud it has
already built does not shrink back into a narrow column. It stays where it is until it evaporates
or sublimates, or it spreads out and falls out.

- **Liquid cloud in the lower and middle tower.** In dry mid-level air it evaporates within minutes
  to tens of minutes, eroding from the edges. The towers lose their hard, crisp cauliflower edges
  and turn soft, ragged and "mushy".
- **Glaciated upper tower and anvil.** These are ice, which sublimates slowly. The upper tower
  goes fibrous and smooth, merges into the anvil, and the anvil spreads and persists for hours.
- **Orphan anvil.** In the textbook dissipating stage, downdrafts replace the updraft, light rain
  and weak outflow last a while, and "all that remains ... is often an orphan anvil". Stratiform
  rain falling from the anvil is common [NWS spotter guide; CSU AT540 notes].
- **What the eye sees.** A wide, soft, sloping mass with a big anvil and a widening rain area. A
  shelf or outflow base often runs along the gust front ahead of it. It is never a narrow column.

### 1.2 The decay pathways

| Pathway | Cause (fields) | How it looks from the ground | Time |
|---|---|---|---|
| **Outflow-dominant / gust-front undercut** | The cold pool is too strong for the low-level shear (RKW ratio c/Δu well above 1). The gust front outruns the updraft and cuts off warm inflow [NWS spotter guide; NWS WDTD QLCS course]. | The gust front races ahead. A shelf cloud or laminar outflow base forms along it. New towers go up along the shelf and lean back over the cold air. The old tower goes soft and its base rises and turns laminar. The hook, wall cloud and RFD clear slot fade. Rain spreads under the anvil behind. | 10-40 min from first surge to "outflow dominant". The storm may hang on as a gust-front-fed multicell for hours. |
| **Upscale growth into a bow echo or QLCS** | Several things favour it: neighbouring cold pools merge; storms stay on a linear forcing; the mean wind is nearly parallel to the boundary; the cloud-layer shear normal to the boundary is weak (Dial, Racy & Thompson 2010). Cell mergers set off rapid cold-pool production (Klimowski et al. 2004, in the NWS QLCS course). Third bow route: "the bowing rear flank downdraft ignites strong convection along its gust front, and the mesocyclone begins to morph into a line end vortex" (NWS QLCS course). | The RFD gust front bulges out and new towers fire along it. The storm's motion turns to the left of its supercell motion (NWS QLCS course, "supercell to bow echo motion"). A long shelf cloud forms with the rain shield behind it. Echo tops come down. The meso becomes a bookend or comma head. | 2-3 h from supercell to bowing MCS (Mulholland, Nesbitt & Trapp 2019). Dial et al. classify the mode about 3 h after initiation. The deepest cold pool gave the fastest transition. |
| **HP transition** | High precipitation efficiency (moist mid-levels, high PW). Weak anvil-level storm-relative wind keeps the rain near the updraft. The RFD becomes a persistent, rain-filled rear-flank feature (Moller et al. 1990/1994; Bluestein & Parks 1983 for LP). | The meso is wrapped in rain (a "bear's cage"), with a low, wide, dark base and a big shelf on the forward side. Often the step before a bow (the NWS course case of two HP supercells whose RFD erupted into a bow). | 30-90 min. |
| **Orphan anvil / updraft collapse** | Inflow CAPE is cut off (cold pool, stable air, end of forcing), or precipitation loading overwhelms the updraft. | The tower softens and glaciates. Its top flattens and the overshoot goes. The anvil detaches and keeps spreading downstream. Light stratiform rain and virga fall under it. Any remaining base is high and ragged. | Tower 15-30 min. Anvil 1-3+ h. |
| **LP shrinking** | Dry mid-levels and little moisture. LP storms have stronger shear, SRH and upper winds than HP (Bluestein & Parks 1983, via the UNCC thesis). | This is the one case where the tower really does get thinner, because the dry air evaporates its liquid cloud fast. It ends as a thin, corkscrewed, smooth-striated stalk or a decaying bell, with a long thin anvil left behind. Even then the anvil, not the stalk, is the last thing left. | 15-45 min. |
| **Nocturnal stabilisation** | A surface-based stable layer raises CIN. Supercells over stable layers have weaker low-level rotation, updrafts and downdrafts. Most still draw some near-surface air (Nowotarski, Markowski & Richardson 2011). Ziegler et al. 2010 moved a simulated supercell into a cooler, more stable boundary layer: it slowed and turned right with an upshear-propagating cold pool. | The storm turns elevated. Its base rises, the low-level meso fades, and the rain shield and lightning carry on. The visible tower (by lightning) stays wide. | 1-3 h, as the boundary layer cools. |
| **Moving off the instability axis** | The inflow CAPE falls along the track. | A gradual version of the orphan-anvil path: weaker tops, a softer tower, a spreading anvil and rain area. | Tens of minutes to hours. |

### 1.3 What the tower does in every pathway

- Its width does **not** fall with the updraft. The cloud mass already made stays there and spreads.
  It erodes from the edges (liquid) or flattens into the anvil (ice).
- Its texture goes from crisp to soft or fibrous, as liquid freezes and new turrets stop.
- Its top sinks only slowly toward the equilibrium level. The anvil stays at about the old
  equilibrium level and keeps spreading.
- Its base turns into a shelf or outflow base along the gust front, or rises and goes ragged.
- Its rain area widens and turns stratiform.

### Sources

- Markowski, P. & Y. Richardson, 2010: *Mesoscale Meteorology in Midlatitudes*, Wiley (ch. 8:
  supercells, mixed modes and cold pool / shear balance; ch. 9: mesoscale convective systems and
  RKW theory).
- Bluestein, H. B., 2013: *Severe Convective Storms and Tornadoes: Observations and Dynamics*,
  Springer (supercell evolution, LP/HP).
- Bluestein, H. B. & C. R. Parks, 1983, MWR (LP supercells). Moller, A. R. et al., 1990/1994
  (HP and classic supercells, the spectrum). Doswell, C. A., 1990 (supercells are not static).
  These are cited through
  [UNCC thesis (Sirico)](https://ninercommons.charlotte.edu/record/1681/files/Sirico_uncc_0694N_12403.pdf)
  and
  [Beatty et al. 2009 / NOAA repository](https://repository.library.noaa.gov/view/noaa/69850).
- Dial, G. L., J. P. Racy & R. L. Thompson, 2010: Short-term convective mode evolution along
  synoptic boundaries. *Wea. Forecasting*. See the
  [SPC preprint](https://origin-east-www-spc.woc.noaa.gov/publications/dial/modevolu.pdf) and the
  [WAF version](https://origin-west-www-spc.woc.noaa.gov/publications/dial/waf-mode.pdf). Findings:
  - When the 2-6/2-8 km mean wind is nearly parallel to the boundary, storms grow into lines
    within about 3 h.
  - A strong boundary-normal component of cloud-layer shear keeps storms discrete.
  - Stronger convergence gives more storms and more mergers.
  - Lines come mostly on cold fronts. Drylines and pre-frontal troughs mostly stay discrete.
- Rotunno, R., J. B. Klemp & M. L. Weisman, 1988 (RKW), JAS. Weisman, Klemp & Rotunno, 1988.
  Through the
  [NWS WDTD QLCS course](https://training.weather.gov/wdtd/courses/woc/documentation/severe/qlcs.pdf):
  - "If the cold pool becomes too dominant, it begins to outrun the deep updraft"; the updrafts
    "break up into a more cellular appearance".
  - Supercell-to-bow: "the bowing rear flank downdraft ignites strong convection along its gust
    front".
  - Echo tops fall as the bow forms.
  - The motion turns left as a supercell becomes a bow.
  - Klimowski, Hjelmfelt & Bunkers 2004: most bows come from merging small multicells.
- Thompson, R. L. et al., 2012: Convective modes for significant severe thunderstorms. Part II.
  *Wea. Forecasting* ([PDF](https://origin-east-www-spc.woc.noaa.gov/publications/thompson/waf-env.pdf))
  (mode climatology, supercell vs QLCS environments). Mead & Thompson 2011, EJSSM, on nocturnal
  significant tornadoes
  ([PDF](https://origin-east-www-spc.woc.noaa.gov/publications/mead/noctors.pdf)).
- Mulholland, J. P., S. W. Nesbitt & R. J. Trapp, 2019: A case study of terrain influences on
  upscale convective growth of a supercell. *MWR* 147, 4305-4324
  ([abstract](https://experts.illinois.edu/en/publications/a-case-study-of-terrain-influences-on-upscale-convective-growth-o/)):
  2-3 h from supercell to bowing MCS; the deepest cold pool gave the fastest transition; strong
  downdrafts behind the RFD gust front.
- Nowotarski, C. J., P. M. Markowski & Y. P. Richardson, 2011: The characteristics of numerically
  simulated supercell storms situated over statically stable boundary layers. *MWR* 139, 3139-3162
  ([PSU](https://pure.psu.edu/en/publications/the-characteristics-of-numerically-simulated-supercell-storms-sit/)).
- Ziegler, C. L., E. R. Mansell et al., 2010: Impact of spatially varying inversion strength on the
  evolution of a simulated supercell storm. 25th SLS
  ([abstract](https://ams.confex.com/ams/24SLS/webprogram/Paper141955.html)).
- [NWS spotter guide, thunderstorm life cycle](https://www.weather.gov/spotterguide/life). The
  dissipating stage: the gust front "cuts off the warm moist air"; light rain and weak outflow
  remain; a remnant anvil is left.
- [CSU AT540 notes](https://rams.atmos.colostate.edu/at540/fall03/fall03Pt8.pdf): the orphan anvil
  and stratiform rain from the anvil.
- Bunkers et al. 2006 (long-lived supercells, *Wea. Forecasting*) and COMET MetEd
  "Mesoscale Convective Systems: Squall Lines and Bow Echoes": background, not re-read for this
  note.

---

## 2. Code diagnosis

### 2.1 Root cause: the cloud is drawn as the current updraft

The billboards' cloud shape has no memory. It is recomputed every plan from the live updraft
W and Ru:

- `client/Render/CloudParts/StormShape.luau:34-41`, `sh.cloudR(z)`, sets the radius:
  `r = Ru(z) * sqrt(ln(W f(z) / 1.5))`, clamped to `0.35-2 Ru(z)`.
  - `Ru(z)` comes from `Storm.updraftRadiusAt` (`shared/Sim/Storm.luau:229-231`):
    `0.65-1.2 x s.Ru`.
  - So the cloud is "where the updraft still rises at 1.5 m/s". Both terms collapse as the
    updraft dies.
- `StormShape.luau:43-52`, the column: it runs from the base all the way to `colTop = min(visTop, el)`.
  - `el` and `top` come from the inflow parcel (`Storm.environment`, `Storm.luau:131,169-172`).
  - They do not change as W falls. `maturity = 1` once mature.
  - So the height is kept while the width falls: a skinny tower.
- The updraft radius is made to shrink when W is low. `Storm.luau:633-636`:
  `Rt = 1100 + 1700 rot + ...`, and `if s.W < 6 then Rt = min(Rt, 1800)`. `rot` collapses with
  `vmid`, which is tied to W at `Storm.luau:667`.
  - That is fine for an *updraft*, but the cloud is drawn from it.
- The tower is the same in both bodies: the card tower (`CardPlan.luau:236-330`) and the mesh
  body (`StormVolume.luau:226-269`). Both use `sh.cloudR`.

Worked numbers for the SC lifecycle (mid-tower, z ≈ 6 km):

| Stage | W (m/s) | Ru (m) | Cloud diameter | Height |
|---|---|---|---|---|
| Mature | 42 | 3000 | about 10 km | about 11 km |
| `t = 8400` | 10 | 2200 | about 5 km | about 11 km |
| `t = 9000` | 4 | 1800 | about 3 km | about 11 km |

At `t = 9000` the tower is about 4:1, tall to wide. That is the skinny tower.

### 2.2 What else follows the live updraft (and so vanishes with it)

- **Anvil root.** `StormShape.luau:57,68-77`. The anvil's root width is `rr = 1.05 x cloudR(el - 500)`,
  so the anvil pinches in to the skinny tower.
  - `anvilLen` itself persists: it only falls 3 m/s once W < 8 (`Storm.luau:790-793`) and
    4 m/s when dead (`Storm.luau:532`).
  - Its thickness is fixed at `0.2 (el - base)`.
  - Once dead, the anvil is carried at the storm's motion, not the upper wind.
- **Base deck.** `StormShape.luau:119`: `Rb ∝ 2.2 Ru(base) x (0.55 + 0.45 ramp(W, 3, 15))`. It
  shrinks with W, and no outflow or shelf base takes its place.
- **Rain, and with it the forward-flank cloud.**
  - `Storm.luau:797-806`: `precipRate ∝ W Ru²`. At W 4 / Ru 1800 that is about 3% of the
    mature rate.
  - The forward-flank cloud cards (`CardPlan.luau:400-540`, `CardPlan.rainAt`) come from the rain
    field. Once the old rain parcels have landed (about 20-30 min), the wide, dark lower body
    disappears too.
  - Nothing turns the tower's existing condensate into a stratiform shield.
- **Texture.** `crisp = ramp(W, 8, 35)` and the billow count `nB ∝ W/3` (`CardPlan.luau:225,300`).
  The softening is right in spirit, but it acts on an ever-narrower column.
- **Shelf.**
  - `StormCards.luau:1206-1209`: a shelf cloud is drawn along the storm's own gust front
    (`s.gustR`/`gustK`, rays every 30 s, `Storm.luau:567-610`). This is the right mechanism.
  - But it is gated `not s.dead`, and its strength is scaled by the dying updraft
    (`feed = 0.4 + 0.6 ramp(W, 5, 25)`).
  - The lift at a shelf comes from the gust front, not the updraft, so the shelf fades just
    when it should be strongest.
- **The lab SC scene's decay is scripted.**
  - `shared/VisualTests.luau:371-373` (and `life_*` keys at `506-509`) set
    `W 25 → 10 → 4` and `Ru 3000 → 2200 → 1800` by time.
  - The phase labels read "outflow-dominant, decaying" and "anvil orphaned", but no field does that.
  - `Storm.applyPin` forces `s.dead = false` (`Storm.luau:958`), so the remnant never fades.
  - This is painting under the no-hard-coding rule, and it is what drives the skinny end.
- **Game storms.** `Storm.followEngine` (`Storm.luau:1342-1343`) takes `W = clamp(updraftMs x 0.8, 5, 60)`
  and `Ru = clamp(radiusKm x 450, 1500, 7000)` from the engine. The same `cloudR` then draws a
  dying engine storm as the same skinny tower until the engine drops it.

### 2.3 Can storm modes change today? Partly, and the pieces exist

| Mechanism | Where | State |
|---|---|---|
| Cold pool as a field (deficit, spread as a density current, M/R moisture/RFD shares) | `Sim/ColdPool.luau` | Works. Fed by evaporation and melting from Precip parcels. |
| RKW at the updraft | `Storm.luau:618-624` (`s.rkw`, `balance`) | Weak. It samples the outflow speed at the updraft centre, about 0 under a supercell. The comment at `Storm.luau:573-575` says so. So outflow dominance hardly lowers W. |
| RKW at the gust front, forward arc | `Storm.luau:567-610` (`gustR`, `gustD`, `gustK`) | Computed every 30 s, but used **only** to draw the shelf. It does not change the storm's inflow, W or motion. |
| Inflow parcel through the pool | `Storm.inflowPoint` (`Storm.luau:107-116`, `0.9 Ru + 3 km` upstream), surface- vs elevated-parcel switch (`Storm.luau:125-131`, elevated CAPE x 0.75) | Partial. If the gust front runs out beyond the inflow point, the storm still feeds on warm air ahead of it. |
| New cells along gust fronts | `Sim/Initiation.luau` (lift from gust fronts and convergence against CIN) | Works in the free lab. It is off in the game (`EngineFollow.luau:40`) and during `labScene` pre-runs (`World.luau:788-797, 825-841`). |
| Lines and bows from gust-front contours | `Sim/Systems.luau` | Works. Contours of 30 km or more become systems, with segment RKW `r = c/du`, rear-inflow jet, bow, mesovortices and bookends. Cells near a segment ride it (`lineU/lineShare = 0.75 (1 - 0.7 rot)`, `Systems.luau:286-306`). So a supercell whose rotation dies already turns to the line's motion, which is the observed left turn. |
| Mergers | `World.luau:400-456` | Works. The small storm fades into the big one (`mergeF`), and the big one gets `mergeBoost` and takes the larger `anvilLen`. |
| HP vs classic vs LP | precipitation efficiency (`Storm.luau:799-801`, PW, rhMid, anvil-level SR wind), hook rain, RFD | Emerges from the fields. The lab scenes pin `rearShare`. |
| Nocturnal / off-axis decay | inflow-parcel CAPE and CIN from `env:profileAt`, `inhib` from `liftEnergy` (`Storm.luau:509-528, 613-617`) | W falls physically in a free storm. The look is still the skinny tower (2.1). |

So the dynamics can partly produce outflow dominance and upscale growth, but:
- the gust-front RKW never feeds back on the storm;
- the lab's SC scene pins W and Ru instead of letting them evolve;
- the renderer has no cloud memory, so every decay path looks like a shrinking column.

---

## 3. Ranked fixes (all field-driven, nothing pinned to a label)

### 1. Give the storm a cloud body with memory (biggest visual win)

**Files:** `Sim/Storm.luau`, next to the anvil block (about line 785); `Sim/Frames.luau`, to replicate
the new fields; `CloudParts/StormShape.luau` (`cloudR`, `levels`, about lines 34-52).

**Physics:** cloud is condensate.
- Carry a per-level cloud radius or mass `Rc[k]` (13 levels every 1 km is enough), separate from
  the updraft.
- **Growth:** detrainment from the updraft. `Rc` relaxes up toward today's `cloudR(W, Ru)` on the
  updraft's own timescale (about 5-10 min).
- **Loss:** evaporation from the edges. The rate scales with how dry the environment is (1 - RH)
  at that level, from `s.prof`, so the dry mid-levels of an LP storm erode in about 10-20 min and
  a moist HP environment in an hour or more.
- **Ice above the -20 to -40 C level** sublimates much more slowly (hours).
- **Spreading:** ice levels near the equilibrium level spread outward at the upper divergence.
- `StormShape.cloudR = max(live updraft cloud, Rc)`.

**Result:** the decaying tower keeps its width, erodes from the edges, and flattens into the anvil.
The LP case thins as it should, because dry air eats it.

### 2. Draw what the cloud is made of: crisp vs soft vs fibrous

**Files:** `CardPlan.luau:225, 260-330`; card choice per level.

**Physics:** a level's turrets stay crisp only while the updraft is still feeding it.
- Use a per-level "fresh" share, `W f(z) / (W f(z) + c)` against `Rc` memory, to mix in `lumpyFlat`.
- Remnant cloud above the glaciation level gets `wispFlat`, `softSheetFlat` or `striationFlat`.
- Remnant liquid cloud below it gets soft, ragged cards with more transparency at the edges.
- This replaces the single `crisp = ramp(W)`.

### 3. Feed the gust-front RKW back into the storm: outflow-dominant transition

**Files:** `Storm.luau`, the `gustR/gustK` block (567-610), `inflowPoint` (107), the updraft target (613-627).

**Physics:**
- **Inflow.** Where the forward-arc front leads the updraft (`gustR > 1.2 Ru`) with `gustK > 1`,
  the air reaching the updraft has come through the pool. Sample the inflow parcel just behind
  the front, so it is elevated or cold and has lower CAPE. Or take a lifted parcel from the
  pool-top level.
- **Balance.** Replace `balance` (624), which uses `s.rkw` at the updraft (about 0), with the
  front-arc RKW weighted by lead distance.
- **Discrete propagation.**
  - The updraft (s.x, s.y) drifts toward the leading front at a share of `c - Δu`. The tilt
    (`tiltX/Y`) leans back over the pool when RKW > 1, as RKW tilts a cold-pool-dominant
    updraft upshear.
  - The mid meso stays with the old column. `vmid` already decays as W falls.
- **Shelf.** In `StormCards.luau:1206-1209`, drop `not s.dead` and the `feed ∝ W` factor. Drive
  the shelf by the front's lift: gust-front speed relative to the inflow, times pool depth
  (`ColdPool.depthOf`), against the inflow LCL. Then the shelf grows as the supercell dies.
- **Base.** Move the base deck (`StormShape.luau:119`) onto the remembered cloud (fix 1) and onto
  the gust-front arc, to give an outflow base.

### 4. Turn the tower's water into the stratiform shield and orphan anvil

**Files:** `Storm.luau` (797-806), `Sim/Precip.luau` (ICE kind 3 already exists: detrained to the
anvil, falls about 1 m/s, sublimates).

**Physics:**
- **Collapse.** When W falls below what the condensate needs (loading against buoyancy), release
  the remembered column's condensate (from fix 1) as precipitation parcels over the remnant
  footprint. This is the collapse rain foot, and it also feeds the cold pool: a positive feedback
  toward outflow dominance.
- **Anvil ice.** Keep releasing ICE parcels from the anvil at the sublimation rate while
  `anvilLen > 0`, even after W is small. The forward-flank and rain-region cloud cards
  (`CardPlan.rainAt`, 400-540) then persist and widen with no extra rule.
- **Anvil shape.**
  - Make the anvil's root width its own state, grown by the time-integrated detrained mass flux
    (`W Ru²`) rather than `rootR` (`StormShape.luau:57,70`).
  - Let a dead storm's anvil drift with `upperU/V`, not `s.u/v` (`Storm.luau:528-536`).
  - Replace the `W > 8` growth gate (790) with growth ∝ mass flux.

### 5. Let the lab's SC decay come from the environment, not keys

**Files:** `shared/VisualTests.luau:368-373, 506-509`; `Storm.applyPin` (958).

**Physics:**
- After the second cycle, release the pin (`evolve` for W and Ru too, or stop the keys after
  `t = 6900`).
- Give the scene a field that ends the storm: one of
  - its track carrying it into a cooler, more stable boundary layer (as in Ziegler et al. 2010);
  - an evening `localHour`, so surface cooling raises CIN and the parcel goes elevated;
  - its own cold pool deepening until fix 3 cuts the inflow.
- Then W, Ru, vmid and vlow fall through `Storm.step`.
- Let `s.dead` happen (no forced `dead = false` once the keys end), so the remnant fades.
- Turn `initiation` on in the scene, so gust-front cells and mergers can grow it upscale.

### Further fixes (smaller, or follow from 1-5)

6. **Upscale growth by existing mechanisms.**
   - Already in place: cells on the outflow (Initiation), contours of 30 km or more (Systems) and
     `lineShare` turning a weakly rotating supercell to the line motion.
   - Needed:
     - Initiation on in lab scenes and in any game-side lab mirror.
     - Line-normal cloud-layer shear and mean-wind-to-boundary angle in `Initiation.run`'s lift
       or cell spacing, to follow Dial et al. Parallel flow means outflows merge sooner; that
       comes out of the cold-pool field itself once neighbouring cells exist.
     - The merge rule (`World.luau:409-421`, `0.6 (Ru + Ru)`) should use the cold-pool or
       cloud footprint (fix 1), not the updraft radius, so a dying supercell can merge with
       the line forming on its front.
7. **Updraft radius cap.** `Storm.luau:635`'s `if W < 6 then Rt = min(Rt, 1800)` is a threshold. Once
   the cloud has memory it no longer shows. Make it a continuous function of W (mass-flux
   continuity) when convenient.
8. **Game path.** `followEngine` (`Storm.luau:1342-1343`) clamps W to at least 5 and Ru to at least
   1500. With fix 1 the game's dying storms get the same remembered cloud. The engine's own
   anvil length feed (`Storm.luau:1306`) should seed the anvil state.
9. **Top.** The overshoot already falls with W (`overshoot = W / N`, `Storm.luau:169`). Let the
   remembered top relax down to the equilibrium level over 10-20 min, not instantly.

### Mechanisms to reuse

- **Gust-front arc** (`gustR/gustD/gustK`): RKW at the front, already computed.
- **Cold pool:** `ColdPool.speedOf`, `depthOf`, the M field (moist outflow lowers the LCL, for the
  shelf or outflow base), contours.
- **ShelfPlan:** the shelf cloud along a gust front, for single storms and lines.
- **Systems:** lines, bows, rear-inflow jet, mesovortices, bookends, `lineShare` motion.
- **Initiation:** cells on gust fronts against CIN.
- **World mergers:** `mergeF/mergeBoost`, anvil carry-over.
- **Precip:** ICE parcels sublimating in the anvil; the rain field drives the forward-flank cloud cards.
- **Precipitation loading:** `s.loading`, `loadF`; it already collapses W.
- **Elevated switch:** surface vs most-unstable parcel in `Storm.environment` (nocturnal and
  over-pool decay).
- **StormShape's `inCloud`/`sunLit`:** these work on any radius profile, so a remembered `Rc[k]`
  drops in without changing the lighting.
