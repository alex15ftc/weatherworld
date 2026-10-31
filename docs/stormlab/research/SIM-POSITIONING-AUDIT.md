# Where the simulation puts each supercell and tornado feature (audit, 2026-10-30)

This is a read-only audit; no code was changed. It is meant to be compared against the real-world structure research.

## Coordinates

**Storm frame.** The storm moves toward **+x (forward)**.
- **Right** means right of motion, **left** means left of motion.
- Unless a row says otherwise, distances are in km from the **low-level mesocyclone (LLM)**. The LLM is the wall cloud and tornado point.
- Bearings are degrees clockwise from motion: 0 = front, +90 = right flank, 180 = rear, −90 = left flank. This matches `docs/stormlab/RESEARCH-SUPERCELL-LAYOUT.md`.

**What the game draws.** It draws the **Roblox lab's** geometry (`roblox/src/stormlab/shared/Sim` and `client/Render`).
- In the main game, `server/StormHost.luau` runs the same lab simulation. It only nudges each storm's position, motion, updraft and rotation toward the JS engine's storm (`Sim/EngineFollow.luau`, `Storm.followEngine` at `Storm.luau:1111-1123`).
- The JS engine's own geometry (section 4) drives the engine's radar, products and the older Roblox "look" feed. It does **not** shape the lab storms.

**Scale.**
- **Lab:** 1 stud = 0.28 m on every axis (`LabConfig.luau:17`).
- **Game:** horizontal map distances are squashed to 600 studs/mile, about 0.104 of true (`roblox/src/client/WeatherClient.luau:114-130`).
- **Each storm and tornado is drawn whole and unsquashed about its own centre.** The squash comes from `LabConfig.scaleAbout` (`:64-73`) and `World/Config.skyScaleAt` (`roblox/src/shared/World/Config.luau:56-69`). So every size and offset below is the true metre value in both places; only the distances *between* storms are squashed.

## 1. Measured layout of the current code (lab Supercell scenario)

Measured on 2026-10-30 by running the existing diagnostics against the working tree:
- `tools/stormlab/diag_structure.luau -a 20,30,45,60`, rotated into the storm frame;
- `diag_layout.luau`;
- `diag_wallcloud.luau`;
- `diag_hail.luau`.

The focus storm is C001: a mature right-mover, W 55-56 m/s, Ru 3.9-4.0 km, base 1470-1610 m, EL 11.6-11.7 km, motion 63-66° compass at 11-13 m/s.

The older 2026-10-26 run in `docs/stormlab/structure/structure.txt` was a different storm. Its pattern is similar but its distances are smaller.

### Plan view relative to the LLM

Forward is +, right is +, in km. Each cell gives the range over the t = 20 / 30 / 45 / 60 min frames.

| Feature | forward | right | bearing / dist (diag_layout) | Research range (RESEARCH-SUPERCELL-LAYOUT) |
|---|---|---|---|---|
| LLM / wall cloud / tornado point | 0 | 0 | — | — |
| Updraft at cloud base (centre of the rain-free base) | +0.6 … +2.0 | +1.2 … +2.3 | 46°, 2.4 km | +45…+100°, 1-4 km ✔ |
| Updraft axis at 5 km (BWER) | +1.6 … +2.9 | +1.0 … +2.0 | 27°, 3.3 km | −30…+30°, 2-6 km ✔ |
| Mid-level meso (5 km) | +1.1 … +2.5 | +1.3 … +2.4 | 38°, 3.1 km | −30…+30°, 2-6 km (a little right) |
| FFD centre (`ffdAt`) | +6.2 … +7.8 | −1.0 … 0 | 0°, 7.8 km | −60…+10°, 5-20 km ✔ |
| Low-level rain core (top 10% of rain) | — | — | **28°, 12.9 km** | −60…+10° (**right of the expected range**) |
| RFD centre (`rfdAt`) | −1.35 | +0.27 | 169°, 1.4 km | +150…+240°, 1-5 km ✔ |
| Nearest heavy low-level rain to the LLM | — | — | 1.5 km | tornado 5-15 km from the main core |
| Rain-free base deck | centre about 4.2 km right-front of the LLM; radius 6.3 km | | the LLM sits at 68% of the radius | RFB 8-20 km across; wall cloud on its rear edge nearest the rain |
| Largest surface hail | 6-9 km from the storm centre (direction not logged) | | max 4.0-4.2 cm at the surface, 4.5-4.6 cm aloft | hail core −100…−20°, 2-8 km |
| Anvil axis | 4-10° **left** of motion | | — | downshear in the upper storm-relative wind |
| Storm-relative wind | 500 m: 21 m/s toward 256-263° (inflow from the right-front); 1 km: 19 m/s toward 272-280°; 3-11 km: 8-14 m/s toward −10…+4° | | — | — |

**Occlusion moves the LLM.** It goes from the updraft's rear-left toward its left flank.
- At t = 45 (occl 0.93, lowAngle 1.82 rad), the LLM is 0.6 km behind and 2.3 km left of the updraft base.
- At t = 60 (after the reset, occl 0.18), it is 2.0 km behind and 1.2 km left.

### Wall cloud (diag_wallcloud: base / lowering / wall-cloud base, m above ground)

| Storm | base | lowering | wallBase | vlow (m/s) |
|---|---|---|---|---|
| C001 | 1417-1639 | 825-913 | 586-729 | 7-13 |
| C002 | 1114-1575 | 644-848 | 469-727 | 6.5-17 |

The lowerings are 55-58% of the base, so they sit right at the **0.6·base cap** (`Storm.luau:690`). The cap, not the physics, is setting the wall-cloud height.

## 2. The lab simulation (`roblox/src/stormlab/shared/Sim/`)

The numbers assume a mature right-mover with Ru ≈ 4 km, W ≈ 40-55 m/s and EL ≈ 12 km. Left-movers mirror every angle.

### 2.1 Motion, updraft, mesocyclones

| Feature | File:line | Formula / constants | Depends on | Typical |
|---|---|---|---|---|
| Bunkers vectors | `Thermo.luau:305-316` | 0-6 km mean ± 7.5 m/s, perpendicular to the shear between the 0-0.5 km and 5.5-6 km means | profile | — |
| Storm motion | `Storm.luau:137-138`, `581-596` | target = mean + rot·dev, with rot = ramp(vmid, 7, 17); relaxes over τ 600 s; `lineU/V` blends it toward a squall line's motion | vmid, profile | the deviation grows as the storm rotates |
| Storm motion, engine mode | `Storm.luau:1123` | u, v = engine motion | engine | — |
| Split | `Storm.luau:973-993` | age 900-3000 s, W > 18, shear06 > 18. The child starts 2.5 Ru to the left, with u + 0.3·leftU, W × 0.7, Ru × 0.8 | shear, W | the left-mover starts ~10 km left |
| Updraft centre | `s.x, s.y`; tilt `Storm.luau:186-202` | tilt = Σ (storm-relative wind / max(8, W·wprof))·250 m·(1 − 0.55 rot), capped at 0.8(z − base) | profile, W | ~1-1.5 km downshear at 5 km (measured) |
| Updraft radius, by height | `Storm.luau:216` | ru(z) = Ru(0.65 + 0.55·clamp(z/max(3000, EL), 0, 1.2)); Gaussian e-folding radius | Ru, EL | 2.6 km at the base, 4.8 km at the EL |
| Ru, own dynamics | `Storm.luau:574-578` | Rt = 1100 + 1700 rot + 700 ramp(shear, 10, 30) + 600 ramp(CAPE, 500, 3500); τ 900 s | rot, shear, CAPE | ≈4.1 km |
| Ru, engine mode | `Storm.luau:1036, 1079` | radiusKm × 450, clamped 1500-7000 | engine | — |
| W | `Storm.luau:558-568` | 0.85·Ru/(Ru + 1500)·√(2 CAPE)·inhibition·RKW·loading·(1 + 0.12 rot); engine mode 0.8 × updraftMs (`:1078`) | CAPE, CIN, cold pool | 40-56 m/s |
| W profile | `Storm.luau:156-184` | √(2∫B dz), 65 levels of 250 m | sounding | — |
| **Low meso position** | `Storm.lowMesoAt` `:238-244` | **0.6·Ru at a fixed bearing `lowAngle` = 2.75 rad (157.6° CCW from the heading)**: behind the updraft, a little left. Occlusion: lowAngle = 2.75 − 1.0·occl (`:655`) | Ru, occl | ≈2.2 km behind, 0.9 km left of the updraft (by formula). Measured: 0.6-2.0 behind, 1.2-2.3 left |
| Low meso radius | `windAt` `:453-475` | Rankine core R = 0.3 Ru (1.2 km) below 1.2 km; tapers as exp(−(r/3R)²), cut at 6R | Ru | core 1.2 km |
| Low meso strength | `:609-633` | √SRH01·clamp(stretch/0.02)·fLcl, with fLcl = clamp((2200 − LCL)/1400, 0.15, 1). Plus baroclinic 6·\|∇D\| (sampled 2 km ahead of the LLM), plus boundary 8·\|∇T_surface\|. The sum is × fCold × occlusionFactor × rot | SRH01, LCL, cold-pool gradient, boundaries | vlow 5-17 m/s |
| Low meso strength, engine mode | `:1072-1075` | vlow = 18·lowRotation; under an engine tornado it is **forced** to ≥ 8 + 0.06·mph | engine | — |
| Mid meso | `Storm.midMesoAt` `:246-251` | the tilted axis at z, plus a **fixed 0.15·Ru at −2.4 rad** (rear-right); Rankine R = 0.45 Ru = 1.8 km, blending in from 1.2 to 3.5 km; fades over 0.55-0.7·top | Ru, tilt | ≈ over the 5 km updraft |
| Mid meso strength | `:602` | Vm = 1.15·√SRH03·clamp(W/30, 0, 1.3), with SRH relative to the storm's own motion (`:143-144`) | SRH03, W | 25-28 m/s |
| Dynamic lift (low-level) | `:437-451` | centred 0.24·Ru from the LLM toward the inflow; radius 0.39 Ru; below 3.5 km; w = 0.6·min(\|vlow\|, 0.5W) | vlow | ~1 km right-front of the LLM |

### 2.2 Base, inflow, precipitation, downdrafts

| Feature | File:line | Formula / constants | Depends on | Typical |
|---|---|---|---|---|
| Inflow sounding point | `Storm.luau:104-113` | 0.9·Ru + 3000 m upstream along the 500 m storm-relative wind | sr wind | ≈6.6 km right-front |
| Cloud base | `Storm.luau:131` | clamp(parcel LCL, 150, 4000). Uses the surface-based parcel if its CAPE ≥ 0.6 × the most-unstable CAPE, else the most-unstable parcel | sounding | 1.1-1.6 km |
| Cloud base on a grid | `World.cloudBaseAt` `World.luau:153-197` | 2 km grid; the lowest storm base within 2.5·Ru + 0.3·anvilLen, else the environment LCL | — | — |
| Wall-cloud lowering | `Storm.luau:674-691` | mixed-parcel LCL. The inflow is mixed with forward-flank outflow (share 0.6·ramp(dF, 0.2, 2.5)·rot, the outflow wet-bulbed). lowering = clamp(125·spread − lclMix + vlow²/g, 0, **0.6·base**)·rot | LCL, cold-pool deficit, vlow | 640-910 m (at the cap) |
| Storm-relative inflow | `:548-549` | srU/V = environment 500 m wind − motion | profile | 21 m/s from the right-front |
| Low-level inflow wind | `:385-390` | the updraft acts as a line sink below the base: u_r = −wb·rb²/(2 r·base), tapered at 7 rb | W, ru | — |
| **FFD centre** | `Storm.ffdAt` `:254-274` | from the tilted axis at 5 km: 1.45·ru(5 km) along the 5 km storm-relative wind **rotated a fixed +0.3 rad (17°) left** | 5 km storm-relative wind, Ru | ≈5 km from the 5 km axis; 6-8 km ahead of the LLM |
| FFD downdraft | `:330-348`, strength `:637-640` | R = 0.9·Ru (3.6 km); ffd = clamp(rain/12, 0, 9) m/s; outflow peaks at r ≈ R, about 50 m up | rain | — |
| Precipitation release: main core | `emitPrecip` `:841-905` | released at heights from wprof, between base + 400 and 0.8·EL. Placed at downshear(z) + **0.3 rad ± N(0.4)**, r = ru·(1.1-1.8). Above 0.5·top: downshear ± 1.75 rad at 1.2-1.56 ru (the V-notch) | storm-relative wind at height | then advected in 3-D (`Precip.luau:105-118`). Fall speeds: rain 8 m/s, graupel 1 + 4D, hail 14√D, ice 0.8 |
| **Hook release** | `:857-889`, share `:941` | 15%·rot of the parcels, released at base + 300 to min(freezing − 200, base + 2000) **along a prescribed cyclonic spiral**. It starts at the FFD's rear edge (FFD − 0.55 Ru along the heading) at r0 = 0.6-1.6 Ru from the LLM; the tip is at back + 1.05 rad (right-rear), 0.4·Ru out; sweep ≤ 4.2 rad | Ru, FFD | tip ≈1.6 km right-rear of the LLM |
| Hail size | `:713-714`, `:947-954` | hailMax = clamp(0.7·((W·f(freezing + 3 km))/14)², 0, 15) cm·ramp(W, 15, 30). A parcel becomes hail with p = clamp((W − 12)/35, 0, 0.6); size hailMax·rand², min 0.5 cm | W, freezing level | 4-5 cm max (measured 4.0-4.6) |
| Hail core | — | **No placement of its own**: hail falls where the trajectories take it. Surface grid `hailSize` (1 km cells, fading over 600 s) | — | largest 6-9 km from the centre |
| **RFD centre** | `Storm.rfdAt` `:276-284` | **0.35·Ru at a fixed π + 0.2 rad** from the LLM (behind, slightly right) | Ru, heading | 1.4 km behind the LLM |
| RFD strength | `:641-645` | (0.3\|vlow\| + 0.12\|vmid\| + clamp(hookRain/20, 0, 4))·rot; downdraft R = 0.35 Ru; `rfdOutflow` sampled at 50 m (`:352-360`) | vlow, vmid, hook rain | — |
| Cold pool | `ColdPool.luau:30-40, 100-125` | deficit D on a 2 km grid; depth 350 + 190 D; front speed 0.75√(g·D/θ·h). Downdraft target = environment ddDeficit (`Thermo.luau:385-397`) × clamp(rain/30, 0.25, 1) | evaporation, melting, DCAPE-like ddDeficit | — |
| Gust fronts | `ColdPool.luau:173-180, 213, 261` | EDGE = clamp(\|∇D\|·4000/D_inside, 0, 1); contours of the smoothed D; lift at the head 0.8·c·edge·ζe^(1−ζ) | cold pool | **FFGF and RFGF are not separate objects** |
| Flanking line | `Initiation.luau:88-95` | **None.** New cells are blocked within 1.6·Ru + 5 km (≈11 km) of a storm with W > 15; the comment there says 1.3 Ru | — | — |
| Mergers | `World.luau:373-397` | merge at d < 0.6(Ru1 + Ru2) | — | — |
| Anvil direction and length | `Storm.luau:153-155, 693-703` | storm-relative wind at zu = clamp(EL − 1000, 6, 14 km). anvilLen += 0.8·\|sr upper\| per second while W > 8, up to 160 km; shrinks 3 m/s otherwise. Anvil ice released at EL − 1500 to EL (`:959-967`) | upper wind, W | 4-10° left of motion (measured) |
| Upper flow split | `:405-433` | flow splits round a cylinder Rc = 1.2 ru, for z = 0.5-1·top | — | — |
| Overshooting top | `Storm.luau:171-172` | top = min(16 km, EL + clamp(W/0.02, 300, 2500)) | W, EL | +2.25 km at W 45; +2.5 km at 55 |

### 2.3 Tornado (`Tornado.luau`, `Vortex.luau`, `World.parentOf`)

| Feature | File:line | Formula / constants | Depends on | Typical |
|---|---|---|---|---|
| Genesis | `Storm.luau:733-743`; trigger `World.luau:363` | G integrates (ζ·stretch/0.02²)·warmRFD·rfdHelps·fLcl + noise − 0.8, over τ 300 s; fires at G ≥ 1 and rot > 0.25 | vlow, stretching, RFD warmth, LCL | — |
| Spawn position | `World.parentOf` `:250-268` | **at the LLM**, led on by the storm's motion | — | 0 km from the LLM: inside the hook tip, 1.4 km in front of the RFD centre |
| Spawn position, engine mode | `EngineFollow.luau:93-96`; `Storm.luau:1111-1122` | at the engine tornado's position, and the updraft shifts so that `lowMesoAt` lands there | engine | — |
| Parent values | `World.parentOf` | rlow = 0.3·Ru; wLow = W·f(1000) + 0.5\|vmid\|; cloudBase = wallBase | — | rlow 1.2 km |
| Motion | `Tornado.luau:281-315` | follows the parent LLM, relaxing over 50 + 50·decay s; plus RFD outflow × wrap, with wrap = max(0.5·decay, ramp(occl, 0.4, 0.8)); plus a 0.25·rc wobble. Engine mode: the engine track plus an orbit round the meso (`:109-118`) | LLM, RFD outflow, occlusion | moves with the storm; drifts left-rear while occluding |
| Tilt | `Tornado.luau:188-199, 314` | top → (LLM − contact) with τ 20 s; decay starts at tilt > 1.0·cloudBase or occl ≥ 0.6 | LLM motion | 0 to ~cloudBase |
| Axis shape | `Vortex.axisAt :203-232`; amplitude `Tornado:347-351` | Hermite curve; S-bend (0.12 + 0.25·stretch)·0.3·cloudBase·(0.3 + 0.7·thin), plus 3 helical waves | stretching | — |
| Core radius rc | `Tornado.luau:220-235`; `Vortex.rcAt :197` | swirl S = 0.25·vlow·rlow/(2·wLow·350)/(0.5 + 0.5·O). rc = 0.05·rlow·(0.5 + 2.2 S)·(1 − 0.6·decay)·stretchK, clamped 15-900 m, growing 30% up to the base. Engine mode: rc = 0.25·yards·0.9144 | vlow, Ru, W | S ≈ 0.2 → rc ≈ 60 m |
| Core wind | `Tornado.luau:238` | vc = q·vlow·(rlow/rc)^0.4·pulse | vlow | 40-50 m/s |
| Sub-vortices | `Vortex.luau:135-146, 179-193` | count (S − 1)·10, up to 6; orbit at 0.6-0.9 rc; radius 0.12 rc | swirl | — |
| Condensation funnel | `Vortex.condensationRadius :398-426` | the radius where ρ·vc²·I(r/rc) = ρ·g·(zb − z); `funnelGround` is that radius at 5 m | vc, rc, cloudBase | physical. Lab scenes: cone 23 m at the ground and 196 m near the base; stovepipe 43-87 m (`docs/stormlab/STATUS.md:127`) |
| Cloud base for the tornado | `Tornado.luau:172` | relaxes to clamp(parent wallBase, 150, 2500) over 60 s | wallBase | 470-730 m |
| Debris top and loft | `Tornado.luau:387-388` | debrisTop = clamp(30·(peakWind − 25), 0, 3000) m; debrisLoft = ramp(peak, 30, 75)·soil·O | peak wind, soil | 1.35 km at 70 m/s |
| Radar debris ball | `Radar.luau:49-71` | R = clamp(2.5 rc + 0.25·top, 150, 1500); up to 1.3·top; 42 + 18d dBZ | rc, debrisTop | ~0.5 km |
| Cycling / occlusion | `Storm.luau:651-662, 763` | occl += dt·(rfd/10)·rot/2000, so rfd = 5 m/s gives a ≈67-min cycle. At occl = 1: vlow × 0.35, lowAngle reset to 2.75. occlusionFactor = (1 + 0.5 sin(π occl))·(1 − 0.7 ramp(occl, 0.8, 1)). Engine mode: occl comes from the engine | RFD strength | measured: occl 0.42 → 0.93 → 0.18 over 40 min |

**The new meso after a cycle** reappears at the same fixed bearing behind the updraft. It does not form 5-10 km right-front along the RFGF/FFGF junction.

### 2.4 Frame fields the renderer reads (`Frames.luau:28-38`, `Storm.snapshot :997-1016`, `Tornado.snapshot :407-417`)

| Object | Fields |
|---|---|
| Storm | x, y, lowX/Y, ffdX/Y, rfdX/Y (m); u, v, srU/V, upperU/V (m/s); W; Ru; base, el, top, freezing, lcl, lowering, wallBase (m); vmid, vlow; rot, occl; lowAngle (rad); ffd, rfd (m/s); rfdDeficit (K); anvilLen (m); anvilU/V (unit); precipRate (kg/s); hailMax (cm); cape; srh01/03; shear06; age |
| Profile | wprof (65 levels), tiltX/Y (m) |
| Tornado | x, y, rc, cloudBase, topX/Y, bendX/Y, wave, funnelGround, debrisTop (m); ut, vt, envU/V, vc, peakWind (m/s); swirl; inflow; O; decay; debrisLoft; ef; stage; orbit |
| Fields | cold pool on a 2 km grid (deficit, u, v, edge); precipitation in 1 km voxels (dBZ, hail share; surface rain and hail) |

## 3. The lab renderer (`roblox/src/stormlab/client/Render/`)

Abbreviations: SS = `CloudParts/StormShape.luau`, CP = `CloudParts/CardPlan.luau`, WS = `WallStream.luau`. Sizes are in metres; at 1 stud = 0.28 m, studs = m × 3.57.

| Feature | File:line | Formula / constants | Placement in the storm frame | Typical |
|---|---|---|---|---|
| Tower body | SS:34-41, CP:178-207 | r = ru·√max(.12, ln(max(1.05, W·f(z)/1.5))), clamped to 0.35-2 ru, on the tilted axis; visible top = base + (top − base)·maturity | the updraft axis, right-front of the LLM | r ≈ 4.7 km at 5 km |
| Billows / dome | CP:209-237 | nB = W/3 (≤ 14), at 0.3-0.95 H, 0.85 r | — | — |
| Overshooting top | CP:241-252 | wO = clamp(1.4 ru(EL), 1.2, 9 km)·(.5 + .5 ramp(over, 150, 1500))·ramp(W, 5, 15); 3 cards at EL + over·(.5, .7, .9); only when maturity ≥ 0.97 | over the EL tilt | ~5 km wide |
| Anvil | SS:56-81, CP:256-304 | root at cloudR(EL − 500); top EL + 250 − **0.006·along**; thickness clamp(0.2(EL − base), 1.1, 2 km)·(1 − 0.55 f); width 2·1.05·rootR + 0.55·along | downstream only: it starts one root radius upstream, so **no backsheared anvil** | 2 km thick at the root; ~65 km wide at 100 km out |
| Mammatus | CP:310-342 | m = ramp(precipRate, 1e5, 8e5)·ramp(age, 1200, 3600)·ramp(len, 15 k, 40 k); up to 4 patches at 0.12-0.57·len; hang 300 + 500 m | under the downstream anvil | — |
| **Rain-free base** | SS:113-125, CP:355-541 | Rb = clamp(2.2·ru(base), 1.5, 15 km)·(.55 + .45 ramp(W, 3, 15)); centred on the base axis, then **pushed 0.3·Rb·ramp(rot, .25, .6) away from the LLM**; thickness 380 + 0.02 Rb | centre ≈4.2 km right-front of the LLM | Rb ≈ 5.7-6.3 km; thick ≈ 490 m; LLM at 68% of the radius |
| Solid disc deck | `BaseDeck.luau:43-82, 150-181`; `LabConfig:171` | discs of 2000 studs (560 m), 60 m thick, within 0.75 Rb. `range = min(DECK.range 5500, LIMITS.partRange − 500)`: the comments call both metres, but check `partRange` (6500), which is used as studs elsewhere | under the base | — |
| Clear slot | `CloudParts/Util.luau:109-146` | a ring round the LLM at rr = max(400, \|RFD − LLM\|), width clamp(0.4 rr, 300, 1500)·(.6 + .4k). It starts 0.5 rad before the RFD bearing and spans 1.1 + 1.6·occl rad CCW; k = ramp(rfd, 1, 6)·(.4 + .6 ramp(rfdDeficit, .5, 4)) | rear of the LLM, wrapping through the right to the front as occlusion grows | radius ≈1.4 km, width 250-560 m, span 63-155° |
| Meso striations | CP:614-676 | tiers from base + 120 to base + 500 + 4500·ms; radius max(rT, 0.9 ru)·(1 + .45 ms(1 − zf)), clamped 1-12 km; ω = vmid/Rr | **round the tilted updraft, not the meso** | — |
| Inflow band / beaver tail | CP:567-603 | drawn when rot > 0.3 and sr500 > 6 m/s. From the **updraft base centre**, upstream along −sr500, offset 0.25·Rb toward the FFD side; starts at 0.85 Rb; length clamp(1.1 Rb + 300·sr, 3, 14 km)·(.6 + .4q); width 2.2·clamp(0.12 Rb, 600, 1400); at base − 90 + 60h | right-front, leaving the updraft (not along a modelled FFGF) | starts ~4-5 km out; 7-9 km long; ~1.3 km wide |
| Shelf cloud | `CloudParts/ShelfPlan.luau:67-117` | **squall-line systems only**; segment length fixed at 6200 m; nose max(150, base(.72 − .35q)) | none on a supercell's RFGF/FFGF | — |
| Flanking line | (comment only, CP:357) | **not drawn** | — | — |
| **Wall cloud** | CP:686-761 (cards); WS:347-397, 480-484, 533-607 (stream, the default since `LabConfig:224`) | centre = LLM, **pulled onto the tornado top when a tornado exists** (WS:381). R = 0.5·clamp(0.9 Ru, 1000, 3500)·(0.7 + 0.3q)·(1 − 0.35 occl), with q = ramp(lowering, 30, 400)·ramp(rot, .25, .6). Underside z = wallBase + D(r/R)⁴. Stream puffs orbit with the sim's Rankine vortex (WS:266-269) | at the LLM, on the rain-free base's rear edge | R ≈ 1.35-1.75 km (2.7-3.5 km across); 640-910 m below the base |
| Wall-cloud RFD erosion (horseshoe) | CP:736-738 `eaten()` | only in cards mode. **The default stream rim is symmetric noise**, so it has no RFD or occlusion asymmetry | — | — |
| Tail cloud | CP:816-841; WS:664-790 | from 0.9R toward the FFD; length min(0.8·\|FFD − LLM\|, **4 km**); at zb + D(0.35-0.6), rising to base − 40; stream-mode inflow speed clamp(0.6\|sr\|, 4, 15) m/s | forward (toward the FFD) | ≤4 km long, ~470 m thick |
| Scud | `Scud.luau:153-192`; `LabConfig:249` | spawns within max(1500, 1.4 Ru) of the LLM at r = R·rand^1.6; height base − (120 + 450·sat)·rand²; kept only where the wind field gives w > 0.2; then rides the wind | round the LLM | 90-320 m fragments, out to 5.6 km |
| Rain and hail shafts | `CloudParts/Shafts.luau:106-268, 253, 389` | from the replicated rain field: centroids of 1/2/4 km bins; from the ground to base + 150; slant from the storm-relative wind at base/2 against a fall speed of 7 + 8·hail; hail only whitens the colour | wherever the precipitation field puts rain | field-derived |
| Funnel | `TornadoCards.luau:318-319, 500-501, 1375-1387`; `Tornado/StateAdapter.luau:150-163` | drawn to 1.07 H + 30; radius capped at 3rc + min(5rc, 0.5·wallR − 3rc)·smooth(0.6H..H), so it flares into the wall cloud; condensation tags min(rcond(0.9H), 3rc) | at the LLM / tornado contact | — |
| Dust | `TornadoDust.luau:146-160` | spawn radius rc(0.3 + 3.2 rand^1.6) = 0.3-3.5 rc; puff size clamp(0.6 rc, 15, 160)·(0.6-1.2), growing 1.5-4.5 m/s over 8-22 s; pickup above 8 m/s × wetness | round the contact | ~200 m across for rc 60 m |
| Horizontal vortices | `DebrisCloud.luau:179-195` | only when peak ≥ 61 m/s; radius rc(1.3-2.8); length clamp(rc(1-3), 50, 500). **Angle −π/2 + rand·π/2 is a fixed compass arc (S→E)**, not tied to motion or the RFD | — | — |

## 4. The JS weather engine (`js/storms/`)

The engine's frame is x east, y south, in km. Since 2026-10-29 **the storm's position is the LLM**, and everything is offset from it. "Downwind" is always the **500 mb storm-relative wind**.

The worked example is a mature right-mover: w 40 m/s, rotating 1, SR500 54 km/h, LCL 1000 m, hail 2 in.

| Feature | File:line | Formula / constants | Typical (from the LLM) |
|---|---|---|---|
| Motion | `environmentSampling.js:4, 13, 146-168`; `StormEnvironmentCoupling.js:63-70` | mean wind from 3 levels (sfc .13, 850 .5, 500 .37) + 14.6 kt·rotating·(1 − linear) perpendicular to the (500 mb − sfc) shear. Plus Corfidi-like k 0.3-1 for lines, plus 0.1 + 0.25·linear of cold-pool propagation; relaxes over 0.7 − 0.2 rot h | 7.5 m/s right of the mean |
| Splits | `StormModeEngine.js:94-104` | age 0.6-3.2 h, shear ≥ 35 kt, CAPE ≥ 850; left share 1 − ramp(srh03, 25, 150) | — |
| Updraft centre | `StormGeometry.js:52-55` | tilt = clamp(SR500·5000 m/max(w, 10)/3600, 1, 5) km·asRotating, downwind | **1.9 km downwind** (in the SR500 direction, roughly ahead or ahead-left) |
| Updraft radius | `StormGeometry.js:51` | 2.5 + 0.1 w + 1.5·rotating km | **8 km** (large) |
| Base / top | `StormGeometry.js:62`; `StormAppearance.js:61` | base = LCL; top = clamp(7000 + 160 w, 7, 17.5 km) | 1.0 km / 13.4 km |
| Overshoot | `StormAppearance.js:100` | 1800·ramp(w, 25, 60) m | ~770 m |
| Low meso lobe | `StormStructureEngine.js:51` | radius clamp(0.4 U, 1.5, 4) km at (0, 0) | 3.2 km |
| Radar meso | `PrecipitationField.js:69, 131, 152, 337-343`; `RadarSimulator.js:593, 602-609` | Rankine; vmax 6 + 30·strength; leans 3500 m from the ground origin to the updraft; depth peak 4.5 km (σ 2.6 km); tightens below 1 km | the mid meso ≈ over the updraft |
| Rain-free base | `StormAppearance.js:106` | radius 1.3 U; **no position (centred on the updraft)** | 10 km radius |
| Wall cloud | `StormGeometry.js:64`; `StormAppearance.js:111-112` | at the origin; radius 1 + 3·lowFree km; lowering min(150 + 450 s, (0.15 + 0.3 s)·LCL) | radius 2.5-4.6 km; lowering 450 m |
| Tail cloud / inflow | `StormAppearance.js:80-86, 112-113` | tail bearing from the wall to the rain centre; inflow bands from the 850 mb storm-relative wind, length 10 + 40 s km, direction only | — |
| Inflow-notch lobe | `StormStructureEngine.js:84` | (+0.6 U forward, +0.55 U right) | +4.8 forward, +4.4 right |
| FFD / rain core | `StormGeometry.js:57-59, 66` | from the updraft: clamp(SR500·0.3 h, 3, 45) km·(0.3 + 0.7·org); along 8 + 26 rain + 10 linear, across 6 + 16 rain | **~18 km downwind**; 29 × 19 km |
| FFD radar lobe | `StormStructureEngine.js:67-72` | centre capped at 0.45·along | ~13 km out |
| Hail core | `StormGeometry.js:68` | 30% of the way from the updraft to the rain centre; radius 1.5 + 1.6·in km | ~6.7 km downwind, 4.7 km radius |
| Hail size | `StormHazards.js:41, 103-112` | 3.15 (w/60)^2.5 × rotation, lapse-rate and MUCAPE factors, minus melting; cap 5.5 in | 1-2.5 in at w 40-50 |
| RFD | `StormGeometry.js:70`; lobe `StormStructureEngine.js:79` | lobe at (−0.55 U, −0.3 U·side); strength coldPool·(0.4 + 0.6 rot) | 4.4 km behind, 2.4 km left |
| Clear slot | `StormAppearance.js:119` | a scalar only; **no geometry** | — |
| Gust front | `StormGeometry.js:71`; `StormEngine.js:140` | **one ring**: radius clamp(5 + 5·age + 24·cold, 5, 52) km; lead radius·(0.3 + 0.7·outflowDominance) | ~27 km at 2 h |
| Shelf | `StormAppearance.js:88, 122-125` | height 0.8·LCL; faces the motion | — |
| Hook echo | `PrecipitationField.js:281-343` | **emergent**: particles from one updraft source, carried by the storm-relative winds and the meso vortex; no RFD in the fallout | — |
| Hook lobe | `StormStructureEngine.js:81` | arc 1.2·mesoR at fixed angles 120 → 300 + 60·occl (descriptive; nothing reads it) | — |
| Flanking line | — | **none** | — |
| Anvil | `StormGeometry.js:73` | length clamp(SR500·1.4·min(age, 3 h), 15, 300) km; width 20 + 60·intensity; along SR500 (not 250 mb); top = cloud top − 1500 | 227 km, 68 km wide, 11.9 km |
| Echo top | `RadarSimulator.js:145, 160` | EL·(0.6 + 0.48·updraft), which **differs from the geometry top** | — |
| Tornado spawn | `TornadoEngine.js:237, 282-285`; `StormGeometry.js:85-89` | at the wall cloud = the origin | 0 km |
| Tornado motion | `TornadoEngine.js:117-138, 290-336` | storm velocity turned left 60°·occl and slowed 50%·occl, capped 0.4 U. Cyclonic orbit at 0.25(V − 65 mph) km/h·occl (radius ≥ 1 km); pulled back toward the wall at ≤ 30 km/h; ends beyond U | drifts left-rear, ≤ ~3 km |
| Tornado tilt | `StormAppearance.js:267-277` | (wall − ground point) + rope lean 0.8·base·decay to the right | tens of m to ~1 km |
| Core radius / width | `StormAppearance.js:258-260`; `TornadoEngine.js:180` | width 30 + 0.66(V − 65)^1.5 yd (25-1600); core halfWidth·29/V | 150 mph → ~550 yd, core ~80 m |
| Funnel | `StormAppearance.js:43, 262, 296-308` | Rankine; bottom = base − 2.6 V²/g; flare ≤ max(wall radius, 1.2 km) | — |
| Debris | `StormAppearance.js:279, 291`; `PrecipitationField.js:441-479` | look: radius halfWidth(1 + 0.6d), height 40 + 260d. Radar: lofted to clamp(900 + 60(V − 30), 800, 6000) m | — |
| Cycling | `StormRotation.js:125, 169-173, 209`; `TornadoEngine.js:286-288` | occlusion rises while a tornado is down (4.5 → 0.45 h); recovers in 0.15 h; the next meso is at the origin | — |
| Legacy painted field | `StormInternalField.js:44-66` (computed at `StormEngine.js:60, 145`; serialised at `WeatherAuthorityRuntime.js:635`) | a 32 × 32 Gaussian with **fixed km offsets** (FFD +12/−10, RFD −8/+9, a 10 km wrap ring); ignores StormGeometry | duplicate; still sent |

## 5. Lab sim against the conceptual model

| Topic | Lab now | Real (RESEARCH-SUPERCELL-LAYOUT) | Verdict |
|---|---|---|---|
| LLM relative to the updraft | rear-left, 1.5-2.5 km | rear (upshear) edge of the low-level updraft; the updraft is right-front of the LLM | ✔ |
| FFD | 6-8 km straight ahead of the LLM | −60…+10°, 5-20 km | ✔ |
| Low-level rain core | 28°, 13 km (right of front) | −60…+10° | ✘ too far right |
| Heavy rain near the LLM | 1.5 km | tornado 5-15 km from the main core | rain lies close to the LLM. That may be the hook, which belongs there, but check it |
| RFD | 169°, 1.4 km | +150…+240°, 1-5 km | ✔ (fixed geometry) |
| Hook tip | 0.4 Ru right-rear of the LLM | curls rear-left → rear → right-rear | ✔ but **prescribed** |
| Wall cloud size | 2.7-3.5 km across | 1.5-6 km | ✔ |
| Wall-cloud lowering | 640-910 m (at the 0.6·base cap) | typically a few hundred m | ✘ hits the cap |
| Rain-free base | radius ~6 km, LLM at 68% of the radius on its rear side | 8-20 km across, wall cloud on the rear edge nearest the rain | ✔ roughly |
| Flanking line | none | +150…+210°, 5-30 km | ✘ missing |
| RFGF / FFGF | not separate (cold-pool contours only) | meet at the LLM | ✘ no explicit occlusion point |
| New meso after occlusion | same fixed bearing behind the updraft | 5-10 km right-front along the RFGF | ✘ |
| Backsheared anvil | none | common on strong storms | ✘ |
| Anvil direction | upper storm-relative wind, 4-10° left of motion | downshear | ✔ |

## 6. Prescribed (painted) geometry versus the "looks come from fields" rule

The inputs are all field values; the issue is that these **positions are fixed offsets**, not results of the dynamics.

1. **LLM position**: 0.6·Ru at lowAngle 2.75 rad. The occlusion drift is a linear formula, `2.75 − occl` (`Storm.luau:238-244, 655`).
2. **Mid-meso offset**: 0.15·Ru at −2.4 rad (`:246-251`).
3. **RFD**: 0.35·Ru at π + 0.2 from the LLM (`:276-284`).
4. **FFD**: rotated +0.3 rad from the 5 km storm-relative wind (`:254-274`).
5. **Precipitation release angles and spreads**, and above all **the hook's emission spiral** (`:857-889`), the most painted item.
6. **Fixed-fraction sizes**:
   - downdraft radii;
   - wall-cloud R (from Ru);
   - rain-free base (2.2·ru and the 0.3·Rb shift);
   - beaver tail;
   - tail capped at 4 km;
   - anvil top sinking 0.006 m per m;
   - lowering cap 0.6·base and the `× rot` multiplier.
7. **Engine mode**: vlow is forced up under an engine tornado (`Storm.luau:1072-1075`).
8. **Renderer**:
   - horizontal-vortex arc fixed to compass S→E (`DebrisCloud.luau:187`);
   - striations centred on the updraft, not the meso;
   - stream-mode wall cloud has no RFD-side erosion;
   - shelf segment length fixed at 6200 m.
9. **JS engine**:
   - `StormInternalField.js` is a legacy painted field that is still serialised;
   - `StormStructureEngine` supercell lobes are fixed fractions of U, and nothing reads them;
   - cloud top comes from w alone, while the radar uses the EL;
   - one wind level (SR500) sets tilt, FFD, hail and anvil;
   - feature sizes are about 2× real: updraft 8 km radius, rain-free base 10 km radius.

## Reproduce

```
luau --codegen tools/stormlab/diag_structure.luau -a 20,30,45,60   # PT lines are km east/north of s.x,s.y
luau --codegen tools/stormlab/diag_layout.luau
luau --codegen tools/stormlab/diag_wallcloud.luau
luau --codegen tools/stormlab/diag_hail.luau
```

To get the storm frame: with h the unit motion vector, forward = d·h and right = dx·hy − dy·hx, where d is the offset from the LLM.
