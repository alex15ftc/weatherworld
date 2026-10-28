# Storm lab: status (2026-10-24)

The TornadoLab place has been rebuilt from scratch around `GUIDE-maximum-realism.md`, covering both of its parts. `roblox/tornadolab.project.json` now serves the new lab. The previous lab is kept unchanged as `roblox/tornadolab-old.project.json` (copy it back over `tornadolab.project.json` to restore). Interfaces are in `ARCHITECTURE.md`.

## Guide coverage

| Guide section | Where |
|---|---|
| 1-2 Wind field: Rankine/Wood–White, inflow, updraft, translation, tilt/curved axis, sub-vortices, temporal variability | `Sim/Vortex` |
| 3 Funnel: ring mesh r(z,θ,t), layered shells, condensation from pressure deficit, morphologies from swirl | `Sim/Vortex`, `client/Render/Funnel` |
| 3-4 Ground dust / debris cloud | `client/Render/TornadoDust` |
| 4 Debris: drag on relative wind, classes, inertia, tumbling | `Sim/Debris`, `server/ServerDebris`, `client/Render/DebrisView` |
| 5 Damage: q = ½ρV², component resistances (EF DOD), accumulation, staged destruction; vehicles | `Sim/Damage`, `server/Town`, `server/Vehicles` |
| 6 Lifecycle: genesis potential, organisation, pulses, occlusion, rope-out, dissipation | `Sim/Storm`, `Sim/Tornado` |
| 7 Sub-vortices as real wind maxima | `Sim/Vortex` |
| 8 Server-authoritative state, client rendering, compact replication, interpolation, deterministic seeds, LOD | `server/init`, `client/*`, `Sim/ClientWorld` |
| 9 Stage-1 wind vectors | `client/Render/WindViz` (J) |
| 10 Environment from engine soundings (CAPE, CIN, LCL, shear, SRH, PW…) | `Sim/Thermo`, `Sim/Environment`, `scripts/export-lab-scenario.mjs` |
| 11 Supercells: updraft, mesocyclones, FFD/RFD, wall cloud, precipitation field, classic/HP/LP | `Sim/Storm`, `Sim/Precip`, `Sim/ColdPool` |
| 12 Squall lines: gust front from the cold pool, c ≈ √(g′h), RKW balance, rear-inflow jet, bows, mesovortices, bookends | `Sim/Systems`, `Sim/ColdPool`, `Sim/Initiation` |
| 13 Boundaries and interactions: detection, mergers, splits, outflow undercutting | `Sim/Boundaries`, `Sim/World` |
| 14 Cloud rendering: cloud-kit pieces placed from the fields; anvil from upper winds; shelf clouds; rain shafts | `client/Render/Clouds` (+ `CloudParts/`) |
| 15 Lightning, thunder, rain, hail, visibility, lighting | `Sim/Lightning`, `client/Render/Lightning`, `NearPrecip`, `Sky` |
| 16 Radar: reflectivity, radial velocity, correlation coefficient (with debris signature) | `Sim/Radar`, `client/UI/Radar` (R), `client/UI/Map` (M) |

## Verified

**Offline** (plain Luau, `tools/stormlab/*.luau`):
- **Thermodynamics** agrees with the engine's own diagnostics to ~1-3% (CAPE, LCL, SRH, shear, PW).
- **Vortex:**
  - Exact mass conservation for a straight axis.
  - Peak at the core radius.
  - One- and two-celled regimes.
  - Central deficit 2.06 ρ vc².
  - A weak vortex shows a funnel aloft only.
  - About 1.2 µs per sample.
- **Supercell scenario (seed 8181):**
  - The focus storm reaches a 46 m/s updraft and a 25-28 m/s mid-level mesocyclone, with low-level rotation cycling through occlusions.
  - A tornado forms 43-52 simulated minutes in, as an EF3-EF4, and lives about 15-45 minutes. The engine's tornado came at 60 min, at 141-209 mph.
- **Squall-line scenario (seed 2112):**
  - The cold pool holds 5-7 K.
  - Cells form continuously along the gust front, and the discrete supercell ahead of the line is undercut and dies, as in the engine.
  - No mesovortices form: line-normal shear is weak here, and the engine had no QLCS tornado either.
- **Client mirror** reproduces the server's wind to within 0.05 m/s.

**In Studio** (one playtest, 2026-10-24):
- The server spins up 600 s in 2.3-4.8 s and builds a 189-structure town with 10 vehicles.
- The client starts 13 modules with no runtime errors.
- Tornado T01 formed from C001 at t = 3137 s, peaked at EF3 and roped out after a 10.8 km path. 93 debris pieces and dust were flying.
- The server costs 4-9 ms/frame at 60x.

## Known gaps and next steps

1. **Cloud look:** it is crude. Towers are stacked puffs, the anvil underside is too white and glacier-like, and bases are thin dark discs. Next: shading of undersides, darker storm light, tower proportions. All renderer code lives in `client/Render/Clouds` and `CloudParts/`.
2. **Sky darkening:** the scene doesn't darken much under the anvil yet (`client/Render/Sky`).
3. **Not yet seen up close in Studio:** (funnel and dust now seen; see the Studio pass below) radar, map, rain, hail, lightning and damage. Each is type-checked, and the radar and map were tested headlessly.
4. **Thunder and rain sounds:** they need approved sound ids in `LabConfig.SOUNDS` (silent until then).
5. **Rain rates:** surface rates peak at ~25-55 mm/h, low for supercell cores. Precipitation parcels are coarse (~1.5e5 kg each).
6. **Initiation:** the rates are tuned by eye. The supercell day grows from 4 storms to ~10-18 in an hour.
7. **QLCS tornadoes:** this pathway is built but untriggered in the exported line case. Export a line scenario with stronger line-normal shear to exercise it.
8. **Server cost:** spikes up to ~30 ms on some frames at high time scales (the cold-pool advection and environment step don't yield inside).

## Tornado visual plan: Studio pass (2026-10-24)

Seen in Studio (F4 panel, scenes 2 and 3 run): scenes build in 2-4 s with no errors, and the client runs at ~17-19 ms/frame with one tornado at LOD0 (meshes ~2.7 ms). Fixes from this pass:

- **Funnel invisible by day:** the shells used a lit material whose up-pointing normals mirrored the bright sky. They are now always self-lit (Neon), with the scene light compensated.
- **Rain obscuration counted twice:** it both cut opacity by up to 88% and blended colour toward rain grey, so the sky showed through a condensed funnel. Now it is mostly the colour blend (opacity × 0.6-1.0).
- **Wedge at 1.5 km drawn as a sprite:** heavy rain dropped it a LOD level. That now applies only past 3 km.
- **Cloud deck hung ~230 m below the storm's cloud base** (`CloudParts/StormPlan` base piece). Its underside now sits at the base, with lumps ~0.1 thick below.
- **Dust:** lighter (it scatters sky light), max opacity 0.55. Non-rain scenes have `rearShare 0.05` so the camera isn't standing in the hook's rain.
- **Debug:** the LOD readout shows R, rc, fade, and per-ring condensation/alpha. The counters show rain at the camera and the camera position.

Open:
- Scenes 1, 4-10 (rope, uncondensed, multi-vortex, night + flashes, LOD dolly) are not yet captured in Studio after these fixes.
- In Studio the wedge scene read R 113 m / wedge 0.25, while offline gives R 539 m / wedge 1.0. Check what the client mirror's snapshot carries for `rc` and the condensation fields.
- Roblox reserves the keys `1` and `Shift+1`: use the panel buttons or the keypad.

## Funnel and performance pass (2026-10-24, later)

**Why funnels looked short and wide at the bottom:** the cloud renderer's far-draw pulled oversize pieces toward the camera to fit Roblox's 2048-stud part limit. A 14 km storm base was drawn ~600 m from the camera at 175-267 m height, in front of a tornado 1.6 km away, hiding everything above ~9°. Fixes (`CloudParts/Util`, `Clouds`):
- Oversize pieces are pulled in no nearer than `Util.NEAR_MIN` (2.5 km). Nearer ones keep their place and get a capped footprint (`Util.capSize`).
- Near pieces are split first (nearest-first order, their own budget `SPLIT_CAP` 90, depth 6).
- `CloudCapped` attribute = what still gets capped (debug).

**Funnel:**
- The core is drawn as the condensed tube (condensation radius) with optical-depth opacity, instead of the full envelope with opacity from the condensed share. Narrow condensed tubes used to be invisible.
- `Vortex.deficit` / `condensationRadius` no longer zero the deficit in the bottom metres. Stovepipe and LOD scenes now condense to the ground; the cone reaches ~100 m.

**Scenes:** labels renumbered to match their keys (3 = stovepipe, 4 = wedge, ... 0 = night burst, - = LOD). The earlier "wedge R mismatch" was key 3 running the stovepipe.

**Performance** (stovepipe/cone scene, LOD0, Studio; F4 counters now show per-module ms as `ClientModuleMs`):

| Module | Before | After |
|---|---|---|
| Clouds | 2.8 ms | 1.5 ms |
| DebrisView | 1.9 ms | 0.9 ms |
| TornadoVisuals | ~2.7 ms | ~2.5 ms |
| All lab scripts | 9.6 ms | 7.5-7.8 ms |

- Clouds: unmoved pieces are no longer re-sent to the engine.
- Debris: resting pieces check the wind every 4th frame and aren't re-moved.
- Tornado shells: azimuth-only work per column, no per-vertex allocations.
- Dust: size/fade/colour on alternate frames.
- `--!native` on the hot client modules.

The ~30 ms Studio frame is mostly the engine plus the in-process server, not lab scripts.

**Still open:**
- The cloud base overhead is ragged, with bright tower sides through gaps (a near base piece still capped at ~5 km).
- Multi-vortex: no visible funnel or sub-vortex tubes (condenses only above ~200 m).
- Night flash reveal not verified on screen (flashes end before a capture lands).
- Rope (1), uncondensed (5) and LOD dolly (-) not captured this pass.
- Dust is ~2 ms at ~270 puffs.

## Billboard storms, step 1 (2026-10-25)

The user asked for the whole storm in the billboard method. The default cloud style is now cards (`client/Render/StormCards`, layout in `CloudParts/CardPlan`, shape rules shared in `CloudParts/StormShape`); F4 "clouds: kit" switches back to the cloud-kit meshes.

- **What is cards:** tower rings up the tilted updraft + billows + top/overshooting dome, the anvil slab (two soft layers), the base (two dense dark layers), the wall cloud (its own anchor turning at the low-level rotation), and the tail cloud. The kit still draws mammatus; shelf clouds and rain shafts are unchanged.
- **Physical rules:** card sizes from the updraft radius profile, the anvil from anvilLen and the upper-wind direction, the base from Ru(base). No card reaches below the cloud base (the condensation level). Light = albedo × (sky × what the card faces + direct sun × what reaches its sunward surface through the storm, marched) + haze; near lightning recolours cards. 4 × 4 sheets show one frame per card.
- **Cost:** ~560-620 cards for 2-4 storms; StormCards ~1.8-2.3 ms/frame. Mostly re-plan frames (sun march per card); anchors move with one BulkMoveTo.
- **Seen:** from ~15 km a soft tower over a dark base. Under the storm: a dark layered lumpy base, a flat wall cloud lowering, the funnel below, rain shafts, a bright horizon gap.
- **Next:** check the anvil at a distance; spread re-plan work over frames; mammatus, shelf clouds and rain shafts as cards; LOD for many storms; night and flash check.

### Round 2 (2026-10-25)
- **Tornado scenes:** the cone and stovepipe now condense to the ground. Their cloud bases were too high for their vortex strength (full condensation needs a base under ~2.06 vc²/g). Cone: base 670 / lowering 150 → 23 m radius at the ground, 196 m near the 520 m base. Stovepipe: narrower, stronger mesocyclone (Ru 2600, vlow 30, base 750) → vc 66, rc 51, radius 43-87 m up to 250 m, flaring above 400 m. A violent, tube-like column. The scene labels match.
- **Storm cards:** lumpier, lighter base (more sky light, less squashed cards); a scud fringe under the base, denser toward the lowering; scud circling the wall cloud on its turning anchor; a raggeder tail cloud; a greyer tower (less contrast). The kit now only draws mammatus.
- **Server:** scenario spin-up and lab scenes yield between chunks (`world.yield`). On a slow machine the synchronous spin-up hit Roblox's script timeout.
- **Cost:** lightning now recolours only (no re-layout), at ~15 Hz, and only storms within 30 km of a flash; it was ~19 ms/frame during constant lightning. A new plan is written over several frames (~200 cards/frame).

### Round 3 (2026-10-25): smooth storms + open items
- **Smooth motion:**
  - `StormCards` draws each storm at a smoothed track: it glides with s.u, s.v and eases (~2 s) toward each snapshot. The kit's remaining pieces follow it (`ctx.stormTrack`).
  - Cards have stable keys (CardPlan `cardKey`: texture + rounded position). A re-plan updates the same card in place; new cards fade in and dropped ones fade out (1.2 s), so re-plans no longer reshuffle.
  - Debug attribute `StormCardsPlan`: kept / new / dropped on the last re-plan.
- **Mammatus as cards:** pouch fields under a mature, productive anvil (the StormPlan rule).
- **Shelf clouds as cards:** squall-line systems are planned by `ShelfPlan` and converted to cards (`CardPlan.fromPieces`), drifting with the line. The kit draws no storm or shelf pieces in the cards style (only rain shafts stay separate).
- **Multi-vortex:** `TornadoCards` draws each sub-vortex as a thin orbiting column of cards. It is visible where its deficit plus the parent's at its orbit condenses air (the mesh's rule).
- **Stovepipe bulge:** the funnel flare is capped at 3 core radii (was 4).
- **Wedge scene camera:** 3.5 km, yaw -110 (the storm's towers were in front from yaw 200).
- **Not seen in Studio yet:** Studio stopped rendering frames during the check (window minimized or in the background).

### Round 3 checked in Studio (2026-10-25)
- **Re-plans are smooth:** kept 261 / new 9 / dropped 9 and kept 44 / 0 / 0 on consecutive re-plans; new and dropped cards fade.
- **Tower from ~18 km:** soft, spreading at the top. Fixed: the single `softFlat` image has no clear edges, so big or squashed cards (tower centre, anvil, mammatus) showed as grey rectangles. All storm cards now use the clear-edged 4x4 sheet frames (`softSheetFlat`).
- **Stovepipe (3):** a clean tube with a smaller flare into a lumpy, ragged base.
- **Wedge (4):** a broad rain-wrapped mass under the base from 3.5 km.
- **Multi-vortex (6):** still reads only as a dark rain-wrapped area; the sub-vortex columns are not distinguishable. The base was lowered to 500 m (from 900) so they condense lower; still weak. Open.
- **Night (8):** dark base with a faint skyglow and the funnel's silhouette; not shown lit by a flash (flashes end before a capture lands). Open.
- **Cost:** StormCards 0.06-2.2 ms (re-plan frames), 770-1440 cards for 2-4 storms.

### Visual review pass (2026-10-25)
Looked at a supercell from ~18 km, tilted up at the anvil, and from under the base (stovepipe scene).
- **Tower shading:** cards carry the outward normal of the cloud surface they stand for (CardPlan). StormCards lights them by wrapped sun·normal on top of the storm's self-shadow, sees less sky on down-facing surfaces, and adds forward scatter on edges seen toward the sun (silver lining). The tower now has a lit side and a shaded side instead of a flat pale blob.
- **Rain shafts:** opacity is the optical depth of a chord through the rain (0.33 R^0.66 per km, as the funnel obscuration), not a capped log curve, so heavy cores are opaque curtains. Shafts are now billboards: the curtain fades in below the cloud and frays toward the ground (UIGradient), and is capped by a dark lumpy card of the rain cloud it falls from. Forward-flank rain no longer falls out of clear sky; the base reads as a broad deck.
- **Anvil:** three overlapping layers (lit top, body, shaded underside), nearly opaque at the root and thinning downstream; it reads as a dense spreading anvil in the normal chase view.
- **Mammatus:** jittered, overlapping lumpy pouches coloured like the anvil underside (they were a grid of dark dots).
- **Base:** both layers shaded as down-facing, so it is less blotchy.
- **Camera:** PageUp / PageDown tilt the chase view (anvils, tower tops).
- **Still to improve:** mammatus still slightly patterned from a distance; rain curtain streaks show a barcode pattern up close; tower edges are soft rather than crisp cauliflower.

### Motion, rain and hail pass (2026-10-25)
- **Cloud motion** (`CardPlan` motion specs, animated each frame by `StormCards` for storms within 40 km, in sim time; each card loops with fades at both ends):
  - Scud under the base and round the wall cloud, and the tail cloud, are drawn toward the lowering by the inflow (½ the low-level rotation, 4-20 m/s), swirl about it, and are lifted toward the base, accelerating.
  - Billows and a rising tower's top boil upward at ~0.12 W and spread.
- **Funnel condensation tags** (`TornadoCards`, within 6 km): ragged fragments under the base spiral in at ~0.35 vc, round at ~0.4 vc, and rise from ~0.55 H into the funnel's top.
- **Funnel top:** fades out by the cloud base (it is inside the cloud). It no longer shows as a dark bulb against the base.
- **Rain as lost visibility:**
  - Billboards ignore the Atmosphere, so storm cards, rain shafts and the funnel are fogged by the rain between the camera and them: a march through the surface rain field, extinction 0.33 R^0.66 per km. All use one rain-fog grey.
  - Near-camera streak sheets cut to a faint hint (max opacity 0.06, was 0.27).
- **Rain curtains:** a soft stretched puff (no streak texture, no barcode), fading in below a lumpy rain-cloud cap.
- **Hail:** it exists; the supercell lays 360-490 km² of ≥ 0.5 cm surface hail, up to ~2.6 cm, 2-9 km from the updraft, but only inside that swath. New F4 → Camera → "go to hail core" puts the camera in the biggest hail (seen: 2.5 cm stones falling and bouncing, extinction 3.3/km). Hail shafts are paler from a distance.
- Diagnostic: `tools/stormlab/diag_hail.luau`.
- **Funnel surface motion:** the funnel's ring cards slide up through their layer at ~0.15 vc and loop with a fade (the centre cards hold its density). TornadoCards is now ~1.2 ms (per-frame opacity writes).
- **Hail density:** the emitter rate is now 150-450 stones/s (was 60-200).
- **Texture review vs reference photos:** `docs/stormlab/TEXTURE-REVIEW.md` (findings and a proposed order; not implemented).

## Texture pass, steps 1-2 (2026-10-25)

- **Shading inside cards:** every storm card has a UIGradient. The card's colour is its sunward side; the gradient holds the shadow-to-lit ratio (lit for the first 45 %, the card's own light at 75 %, shadow at the edge), turned toward the sun as seen on screen (it is re-aimed when the camera turns more than 3°). Ratios are cached and shared, and lightning rewrites only the colour.
- **Base deck:** seen from outside, a few big soft-sheet cards in two opaque layers. From under it (within 1.7 Rb), a grid of medium cards, because a big billboard seen from below stands up as a far wall instead of a ceiling. A ragged rim, a loose grid of shaded lumps hanging under it, and scud with a wide spread of sizes, stretched along the inflow.
- **Rain fog per card:** a storm's fog is measured to its centre; each card now takes it in proportion to its own distance and the share of the path below the cloud base (overhead cloud is no longer washed out).
- **Funnel top:** ring cards flatten toward the cloud base (down to 0.45 of their width), so the funnel spreads into a skirt instead of ending in a round bulb.
- **Cost:** StormCards ~0.5 ms between re-plans (was ~2 ms before the pass); kept cards refresh their colour only, with full shading every 6th re-plan.

## Texture pass, colour + steps 3/5 code (2026-10-25)

- **Light colour:** storm-card diffuse light turns blue-slate with depth in the storm's shadow (1 - lit: multiple scattering through big drops absorbs a little red); sunlight is cream, warmer at a low sun. The funnel uses the same colours.
- **Rain-fog colour from the light where the rain is:** it was the open-sky grey (from the sun's elevation), which washed the whole base pale under a storm. It is now sampled from the scene light at the camera (overcast sky and the storm's shadow) 4 times a second, and shared by the storm cards and the rain shafts. Under the storm the base now reads as a dark slate deck, with the bright gap at the horizon.
- **Regression check:** far view, cone, stovepipe, wedge and night scenes all render with no errors. The rain-wrapped wedge is very faint at 3.5 km.
- **Rain shafts:** they slant with the wind relative to the storm (sampled halfway down at re-bin) across the line of sight, against the fall speed (7 m/s, hail up to 15). They use `curtainFlat` once it is uploaded (fallback: the soft puff + gradient).
- **Mesocyclone striations:** 3-4 stacked rings of `striationFlat` cards round the updraft just above the base, turning at vmid / R (a "spin" motion), shown where rot and vmid are strong. Off until the texture is uploaded.
- **New sheets:** `tools/smoke/storm_sheets.py` writes `roblox/assets/clouds/curtain_sheet.png` and `striation_sheet.png` (+ previews). Not uploaded yet; the ids go in `LabConfig.TEXTURES.curtainFlat` / `striationFlat`.
- **Uploaded and seen in Studio (2026-10-25):** `curtainFlat` = rbxassetid://79610318303479 and `striationFlat` = rbxassetid://114024701514552 (ATGuardian). The first uploads (82242042419843, 97897910741889) were decal ids that do not load in an ImageLabel and are unused. In the stovepipe scene: fibrous rain curtains slanting with the storm-relative wind beside the funnel, banded striations round the updraft, no errors. The striation rings move ~5 times a second (they turn ~0.5 deg/s); a fog-colour change alone rewrites colours, not shading. StormCards 0.3 ms (StormCardsParts attribute: jobs / fades / fog / motion).

## Wall cloud, debris cloud, horizontal vortices, optimization (2026-10-25)

Research: `docs/stormlab/RESEARCH-WALLCLOUD-HV.md` (wall cloud, scud, horizontal vortices, debris cloud, with equations and sources).

- **Wall cloud:**
  - Sim (`Storm.luau`): the lowering adds the low-level mesocyclone's pressure deficit, v²/g, to the forward-flank mixing term.
  - Cards (`CardPlan` wall section):
    - **Body:** smooth, opaque, 1-3.5 km across, with a flat underside rising steeply to the base (zb + D (r/R)⁴), and a few lumps underneath.
    - **Turning layer:** banding (striation cards) and condensation filaments spiralling in.
    - **Scud:** 100-600 m below the base, 20-300 m across, rising in.
    - **Rear-flank side:** a ragged fringe, fixed to the storm.
    - **Tail cloud:** streams in from the forward flank.
  - Base scud far from the lowering is now rare: scud needs near-saturated outflow air.
- **Contrast:**
  - Card normals lean toward the camera, so tower cloud seen from below through gaps shows its shadowed underside.
  - Rain shafts take their light from the scene light at the shaft (the storm's shadow), not open daylight.
  - The pre-shaded `basePuffs` texture is no longer used under the base: it made black ovals.
- **Debris cloud (`Render/DebrisCloud`, new):**
  - **Skirt:** a ring of dirt cards from ~1.15 rc out to rc·v_max/25 (1.5-3.2 rc). Height 12 (v_max − 25) m, capped by the sim's debrisTop. Cards orbit at v(r)/r, climb at ~30°, and each streak is turned to its motion on screen.
  - **Horizontal vortices on EF3+:** 1-3 at a time in the south-to-east arc at 1.3-2.8 rc, orbiting counter-clockwise, their leading end drawn in and lifted ~200 m. Each is a white condensation tube when (v/2)² ≥ g · cloud base / 4, otherwise a dust roll.
- **Flying dirt (`TornadoDust`):** tornado pickups are streaked grains, stretched along their screen velocity and centrifuged out at w_t v²/(g r) with w_t = 2 m/s. Outflow dust stays soft.
- **Optimization:**
  - TornadoDust: light cached at 4 Hz, wind sampled for a quarter of the puffs per frame, colours every 8th frame. 2-4 ms → 0.7 ms.
  - TornadoCards: centre light cached at 4 Hz, per-row light at 2 Hz, lightning flashes read fresh.
  - DebrisView: flying pieces beyond 800 m step every other frame.
  - StormCards: the striation rings move at ~5 Hz; a fog-colour change rewrites colours only. The `StormCardsParts` attribute shows the cost breakdown.
- **New sheets, not uploaded:** `debriscloud_sheet.png` and `dirtspray_sheet.png` (`tools/smoke/storm_sheets.py --only ...`). Until uploaded, the code falls back to shredFlat / wispFlat (`LabConfig.TEXTURES.debrisCloudFlat`, `dirtSprayFlat`).

## Dust at the foot, tufts and scud (2026-10-25, after user feedback)

Feedback: the dust was a cloud, streaky, and circled the funnel all the way up; clouds and tornadoes had too few tufts and scud. References: the Severity clips (10-37-29, 11-04-14), ref2, the real scud, wall cloud underside and clear-slot photos.

- **Dust (`Render/DebrisCloud`):** the rotating skirt is gone. Dirt is now short-lived bursts at the foot:
  - kicked up at 0.8-1.6 rc and thrown outward at 0.08 v + 0-4 m/s
  - up to an apex of 4 (v_peak − 20) m, clamped to 30-300 m, settling within 3-8 s
  - swirl only near the ground: it decays as exp(−z/40 m) and exp(−age/2 s)
  - drawn as grainy clumps (`dirtGrainFlat`)
- **Flung grains (`TornadoDust`):** fewer; coarse sand (w_t 6 m/s) centrifuged out low, not carried up the core; small grainy clumps, no streaks.
- **Horizontal vortices:** dust rolls use the grain texture.
- **Scud and tufts** (`fractusFlat`: torn, ragged pieces with fibrous ends; falls back to shred/wisp):
  - a ring of ~30 tufts hanging 50-300 m under the deck's edge
  - wall-cloud scud ×2.5 (60), 20-300 m across
  - fractus on the rear-flank fringe, tail cloud and base scud
  - funnel: a ragged collar of 12 tufts where it meets the cloud, 8 tags torn off its upper third rising into the cloud, and the existing condensation tags (light cached)
- **Sheets:** `tools/smoke/storm_sheets.py --only dirtgrain,fractus` writes `roblox/assets/clouds/dirtgrain_sheet.png` and `fractus_sheet.png`, not uploaded yet. The streak and debris-cloud sheets from the round before are dropped.
- **Studio (fallback textures):** dust stays low, no errors; DebrisCloud 0.5 ms; all scripts 7.2 ms.

## Dust reverted, scud rebuilt from the photos (2026-10-25, second feedback)

Feedback: the burst dust was worse than the original swirl; the original only looked too cloudy. The scud had no variety and used features the references don't show.

- **Dust:**
  - `TornadoDust` is back to its original swirling pickup round the funnel's foot; only the optimizations stay.
  - The tornado puffs switch to the grainy `dirtGrainFlat` sheet once it is uploaded, and keep `softFlat` until then.
  - The DebrisCloud bursts are removed; DebrisCloud now draws only the horizontal vortices.
- **Removed (not in the references):** the ring of tufts round the deck's rim, the funnel collar and the tags torn off its upper third.
- **Scud as clusters** (`cluster()` in `CardPlan`): 3-6 graded pieces breaking off a cloud's lower edge. The biggest overlaps the edge, the smaller ones hang lower and trail downstream, with varied size, tone and spacing. Three forms:
  - **rise:** cumuliform lumps (04_wall_cloud_b), on the wall-cloud rim facing the forward-flank inflow, drawn in and up
  - **rag:** tatters (05_inflow_region_b), toward the rear flank, under the deck's edge on the forward-flank (outflow) side, and at the tail cloud's frayed end
  - **streak:** fibrous streamers (04_wall_cloud_underside_c), round the rest of the turning rim
- **Optimization:**
  - The plan's sun march is memoised on a 300 m grid: a re-plan is 1.2-2.4 ms (`StormCardsPlanMs`).
  - Gradient re-aims are spread at 250 cards/frame.
  - Lightning recolours are queued at 300 cards/frame, and a card is recoloured only when its own flash light changed by more than 0.02. This was the big cost: ~3.9 ms → mean 1.8 ms during flashes.
  - `StormCardsParts` shows a running mean and the parts.

## Horizontal vortices as wind, lightning ball, inflow band (2026-10-25, third feedback)

- **"Caterpillar" orbiting the tornado:** it was the horizontal vortices drawn as a chain of cards.
  - They are no longer drawn. Render/DebrisCloud keeps their motion and publishes them as wind (`ctx.hvField`).
  - TornadoDust adds each tube's Rankine swirl round its axis (an arc at r0, height zc, inside its arc, within 5 core radii) to the wind its dust relaxes to.
  - Turning sense: from the inflow jet (fastest lowest): in under the tube, out over it, so dust rises on the side toward the tornado.
  - The wind-driven dust rolls over there; nothing else changes.
- **Lightning ball:** the in-cloud "glow" was a Neon sphere at each strike, now removed. The cloud round the channel is already lit by the flash field (storm cards and funnel).
- **Inflow band (beaver tail):** new; it did not exist in the billboard storm.
  - Physics: moist inflow riding over the forward-flank outflow boundary reaches its condensation level.
  - Shape: a smooth flat band at the base, from the updraft upstream along the storm-relative 500 m inflow (now in the storm snapshot: `srU`, `srV`), set toward the forward-flank side.
  - Length 1.1 Rb + 300 s · |inflow| (3-14 km); turbulent near the updraft, laminar and thinning outward; drifting in.
  - Shown when the storm rotates (rot > 0.3) and the inflow is > 6 m/s.
  - Seen faintly from the far view.
- **Uploaded and seen in Studio (2026-10-25):**
  - `dirtGrainFlat` = rbxassetid://118568148658026: the swirling tornado dust now reads as grainy dirt.
  - `fractusFlat` = rbxassetid://73789623374463: ragged scud clusters.
  - No load warnings in the stovepipe or cone scenes.

## Rain as visibility, cheap (2026-10-25)

What Twisted does (devforum changelogs 1.17, 1.18, 1.19.1, 1.21.2 beta; no technical write-up exists):
- rain curtains that shroud visibility and fade as you approach
- rain intensity by HP/LP and lighter in hail cores; shafts by hail density
- dense rain round tornadoes; atmosphere colouring
- no drop or screen effects mentioned

Changes:
- **Shafts** cross-fade as you drive in (fully drawn from ~3 km past their edge, gone within 300 m of it) instead of switching off at 0.6 w + 800 m.
- **Short range:** the Atmosphere fog from the rain's extinction (0.33 R^0.66 /km, NearPrecip → Sky) was checked. Heavy rain at 100 mm/h needs density 0.44 (~600 m visibility), well under the 0.9 cap (~30 m), so no change.
- **Near-camera rain sheets off** (`MAX_SHEET_OPACITY = 0`; their ~90-part BulkMoveTo is skipped).
- **Splashes** only from 8 mm/h (full at 20 mm/h). Hail is unchanged.
- **Funnel rain wrap:** TornadoCards counts ~0.3 km of the rain wrapped round the vortex (the adapter's `e.wrap`, heaviest rain within 1.5 km) as in the line of sight. The 1 km grid misses a close hook. The funnel's greying is capped at 0.8.
- **Studio:** cone and wedge, no errors. The rain-wrapped wedge stays hidden at 3.5 km in heavy rain: the rain grey under the storm is close to the funnel's own grey. It was already very faint before these changes.

## Radar: finer field, patchy clear air (2026-10-25, in progress)

- **Diagnostic (`tools/stormlab/diag_radar_fine.luau`):** only ~600 parcels lay below 1.5 km round the supercell, so at 500 m the field was shot noise (the radar's red speckle). The hook release (a crescent round the low meso, 0.25 rot of the rain) is in the physics but drowned.
- **Parcels:** mass 1.5e5 → 6e4 kg (2.5x the parcels, same rain mass), cap 12000 → 24000, release cap 60 → 150 per step. Cost (`tools/stormlab/time_parcels.luau`, at raised priority): 11.6 → 17.8 ms per sim second; spin-up 6.7 → 10 s.
- **Fine field (`Precip.binFine`):** 500 m x 500 m cells, 0-8 km, windows +-16 km round up to four strong storms. It is appended to the precip message, and `Precip.sample` reads it inside the windows.
- **Clear air (`Radar.gate`):**
  - insect echo is patchy (a ~7 km fBm field drifting scan to scan), -10..0 dBZ with gaps, fading out by ~78 km; fine lines on gust fronts unchanged
  - display: < 0 dBZ near-black grey, 0-5 dBZ dim grey
- **Studio:** the first test, with 5x parcels, ended with the TornadoLab Studio window gone (crash handler running). The cause is not confirmed; scaled back to 2.5x with more yields in the fine binning. Not yet seen in Studio.
- **Seen in Studio (after the reopen):** starts cleanly at 2.5x (14,600 parcels); server 0.18 ms/frame; no errors from client or server.
  - Radar: clear-air echo is patchy and dim; the supercell shows more structure and less speckle, with a curved low-reflectivity notch on its SW side.
  - Not yet a clear hook appendage. Edges are still blocky at 500 m.
  - VEL / SRV not checked: clicks on the radar's product buttons did not register through the test input.
- **Then:**
  - **Fine field smoothed:** [1 2 1]/4 across x and y on the masses, ~750 m with the cell sharing.
  - **Hook rain released low:** the hook share (0.25 rot) is now released 300 m - 2 km above the base, for the rear-flank downdraft carrying it down fast. Before, it came from the mid levels and smeared out over minutes of fall.
  - **Offline (`diag_radar_fine`):** a distinct pendant of low-level rain 5-8 km SSW of the core with a weaker gap between them.
  - **Studio:** heavier echo curls round a weak hole at the low meso on the storm's W-SW side (hook and notch starting to read), smoother edges, no errors, server 0.17 ms/frame.
  - The emission's random sequence changed, so scenario storms evolve a little differently than before.
- **Hook vs couplet (user: "they don't line up"):**
  - **Offline (diag with an L marker):** the hook rain fell ON the low meso. It was released 0.18-0.6 Ru from it, which filled the notch after the radar smoothing, on an arc reaching into the inflow side.
  - **Fix:** the crescent is now 0.35-0.9 Ru (inner ~1.3 km) and from back−1.4 to back+1.6 rad, wrapping cyclonically N → rear → S and leaving the meso and its inflow side as the rain-free notch.
  - Held test-scene tornadoes now still follow their parent's low meso.
- **Debris signature:** radius 2.5 rc + 0.25 debrisTop, 150-1500 m. It was 2.5 rc, narrower than the beam (Bodine et al. 2013: ~1-2 km for strong tornadoes).
- **Radar default site:** 25 km SW of the focus (was 62 km; the beam is ~400 m wide there, so a meso and a tornado shear show).
- **Keys while the radar is open:** V next product, N site near focus, Z next zoom.
- **Studio (cone scene, radar 25 km):** REF hook wraps W → S with the tornado at its inner tip beside the notch; the SRV couplet sits on the tornado; CC shows a low-CC debris signature there. No errors.

## Supercell layout corrected (2026-10-25)

Research: `docs/stormlab/RESEARCH-SUPERCELL-LAYOUT.md`. Measured with `tools/stormlab/diag_layout.luau` (each feature's bearing from motion and distance from the low-level meso).

- **Before:** the low meso (and so the wall cloud and tornado) sat on the updraft's right-rear (bearing −115 deg).
  - The updraft and the low-level rain core were then both front-left of it; heavy low rain lay 0.3 km from it.
  - The wall cloud sat a third of the way out on the rain-free base.
- **Now:**
  - **Low meso:** on the updraft's rear (upshear) edge, a little left (lowAngle 2.75 rad, 0.6 Ru), at the occlusion point. Occlusion drifts it to the left-rear (2.75 − 1.0 occl).
  - **RFD:** directly behind the low meso, a little right.
  - **Hook arc:** from the low meso's left through its rear to its right-rear, so it stops short of the inflow notch.
  - **Hook share** 0.25 → 0.15 rot: the hook is weaker than the core.
  - **Rain-free base deck** shifted 0.3 Rb away from the low meso, so the wall cloud sits on its rear edge.
- **Measured (expected):**
  - updraft at the base +47 deg, 2.3 km (+45..+100, 1-4)
  - BWER +21 deg (−30..+30)
  - FFD −5 deg, 9.5 km (−60..+10, 5-20)
  - RFD 169 deg (rear)
  - low-level rain core −62 deg, 3.8 km (5-20; a little close)
  - wall cloud at 69% of the deck radius
- **Studio (cone scene):**
  - Radar: the tornado at the storm's rear edge with the core ahead (ENE) and weaker echo curling round it; the SRV couplet on it.
  - Ground: tornado / wall cloud on the left, the rain core to the right, as from the SE.
  - No errors.

## Supercell lifecycle on radar (2026-10-25)

References:
- `docs/storm-reference/radar/` (23 images: Moore, Bridge Creek, Joplin, Tuscaloosa, Mayfield, Rolling Fork, Greensburg, HP example, conceptual diagrams; `SOURCES.md`)
- `docs/stormlab/RESEARCH-SUPERCELL-LIFECYCLE.md` (stages, times, sizes, values)

Tool: `tools/stormlab/render_radar.luau -a <min> <every>` followed by `radar_frames.py` renders the lab's own 0.5 deg REF + SRV of the focus storm through its life, offline (~1 min for 2 h).

What the frames showed and the fixes:
- **Echoes faded after ~1 h with the updraft still strong:** the parcel field hit its cap and new rain could not be released. Cap 24000 → 32000, and parcels get heavier steeply past half full, so the cap is never reached.
- **Compact round echo (~10 km), no forward flank:** graupel/snow aggregates fell at 5-7 m/s, so they melted near the updraft. Now 1.0 + 4 size m/s (~1.5-3, Locatelli & Hobbs 1974). They drift far downstream before melting: a 20-30 km forward-flank region.
- **Hook inside the core:** the hook rain is now an inward cyclonic spiral, from 1.4 Ru at the core's rear-left round the rear to its tip 0.4 Ru right-rear of the meso. The result is a classic comma / hook appendage with the meso inside the curl.
- **Occlusion cycle ~33 min:** now ~50 min (occl rate / 2000; research 40-90).
- **Studio:** the server runs (0.09 ms/frame, 15.6k parcels) with no errors. The early storm shows a forward flank and the start of a curl.
- **Still open:** occlusion has no echo signature yet; the decay stage is not checked; the tornado's timing relative to the hook (10-30 min after it forms) is not checked.

## Condensation detail: lit lobe cards (2026-10-25)

Cumuliform storm cards now draw lit lobe sheets baked in Cycles: light from the frame's top, the card turned to the sun, and amb + sun-mask ImageLabels inside one BillboardGui. The tower shows crisp cauliflower lobes and self-shadow instead of soft blobs. The tornado is trimmed to 200 billboards (26 heights). Details, costs and open items: `CONDENSATION-DETAIL.md` ("Implemented").

## Billboards only, tornado blending, dynamic scud (2026-10-25)

- **Billboards only.** These were removed: the cloud-kit mesh clouds (`Render/Clouds.luau`, `CloudParts/StormPlan.luau`), the mesh funnel (`Render/TornadoVisuals.luau`, `Tornado/TubeMesh.luau`), the funnel comparison (`Render/FunnelCompare.luau`), the F4 compare/funnel/clouds style buttons, the C compare key and the mesh-only debug views. The server no longer loads the cloud kit, and the lab project files no longer map `ReplicatedStorage.Shared`; the main game's copy is untouched. Pieces the billboards needed were moved:
  - the tornado state (`ctx.tornadoAdapter`) is created and updated by `client/init`;
  - rain shafts have their own `Render/RainShafts.luau`;
  - shelf planning uses a fixed list of piece names instead of the kit.
- **Start-up timeout fixed.** `World.new` analyses the environment in chunks with yields (`opts.yield`); all at once, it hit the script timeout when Studio was throttled.
- **Soft lobe sheets v3:** firmer edges (feather 1.6), clearer billows (contrast 0.45) and fine rim wisps (`lobe_post.py --wisps`). Ids are in `LabConfig.LOBES`.
- **Tornado blends into the lowering.** StormCards publishes the colour its wall-cloud underside cards were shaded with (`ctx.stormBase[stormId]`). The funnel's cards lerp toward it from 0.4 to 0.95 of the cloud base (the same cloud) and use the soft lobe texture there; the condensation fragments take 75 % of it. This is the fix for the pale stub seen hanging under a dark base.
- **Dynamic scud** (`Render/Scud.luau`, `LabConfig.SCUD`): fragments form where `World.windAt` lifts nearly saturated air. Saturation comes from surface rain, and it sets how far below the base a parcel condenses. The fragments ride the wind, condense while rising, evaporate when sinking and merge at the base. They are stretched and turned along the on-screen wind, and lit like the lowering with rain fog. CardPlan's scripted moving scud clusters are off while it runs (`CardPlan.dynamicScud`); the hanging fringe and tail cloud stay.
- **Checked:** type-check clean for the whole lab; the server loads and runs with no errors.
- **Not yet seen on screen:** the tornado blend and the scud. Studio stopped rendering frames in the background, so the client's updates didn't run during the check.
- **Sync with the main game:** `docs/stormlab/SYNC-PLAN.md`.

## Game scale, uneven ground, light rain (2026-10-26)

- **Scale:** `LabConfig.SCALE = 1 / 0.28` (about 3.57) studs per metre, the same on every axis: Roblox's standard 1 stud = 0.28 m, the game's scale (was 0.3 until 2026-10-26). Everything is computed in metres; studs appear only at Roblox through `toWorld` / `fromWorld` / `studs` / `metres`. The rules are in `SCALE-RULES.md`.
  - Converted: every renderer, the camera, the UI, the town, vehicles, debris, NearPrecip's per-stud extinction and Sky's.
  - Gravity is 9.81 × SCALE studs/s². With `SCALE = 1` the maths is the old maths.
  - `LIMITS` (`farDraw` etc.) stay Roblox stud limits.
- **Ground:** `LabConfig.groundAt(x, y)` (the main game replaces it with its terrain).
  - The lab has Terrain hills up to 35 m round the town (`GROUND.relief`; `server/Terrain` builds them with WriteVoxels, ~2.1 M voxels in ~4 s, and rebuilds them when the town moves). The town sits on a flat 900 m pad, and the hills fade to flat by 9 km.
  - Follow the ground: the tornado (bottom on the ground, top at the cloud base), dust, debris (heights above the datum), shaft feet, splashes, scud, wind arrows, vehicles, the town, the camera's minimum height.
  - Stay at their altitude: clouds.
- **Light rain:** `precipLite` (~12 KB, 5 % of the full volume) every 10 s; the full volume every 60 s for the radar (`RATES.precipFullEvery`, 0 = never). `test_frames.luau` passes.
- **Seen in Studio at 0.3:**
  - storm cards, an EF4 cone with its dust on the ground blending into the lowering, shafts, and 139 scud fragments;
  - Terrain built at load and rebuilt after "Town ahead";
  - no errors; lab scripts 4.5 ms.
- **Not done:** a run at `SCALE = 1` in Studio (the code reduces to the old maths, but this hasn't been looked at on screen).

## Scud, wall clouds, tails, supercell structure (2026-10-26)

- **Scud (`Render/Scud`)** reads as part of the cloud:
  - Drift: the wind without the tornado's vortex, averaged over ~6 s.
  - Condensing / evaporating: over tens of seconds.
  - Shape: soft wisps drawn out along the drift, half transparent, level with the base, with only an eased tilt of at most 18° (no spinning).
  - Placement: born at the base's underside, mostly round the lowering.
  - Colour: the lowering's own.
- **Wall cloud lowering (`Storm.update`)** uses wet-bulb mixing. Forward-flank outflow is cooled by the cold pool's deficit along its wet-bulb line and moistened toward saturation. The updraft ingests up to 60 % of it, with rotation, and the lowering is the inflow LCL minus the mixture's LCL, plus v²/g.
  - Sample: the strongest outflow on the path from the forward-flank core to the low-level meso.
  - Effect: moist, low-LCL air gives low wall clouds; outflow-poor storms get little.
  - Lab Supercell (`tools/stormlab/diag_wallcloud.luau`): lowerings 150–475 m for the storms with outflow (was ~20–150 m).
- **Tails (`CardPlan`):** the tail cloud shows whenever there is a wall cloud (q > 0.1, was 0.3, which almost never happened). The beaver tail starts at the base deck's edge and sits 30–90 m below the base, so it shows against the sky.
- **Supercell structure** (`tools/stormlab/diag_structure.luau`, `structure_png.py`; images in `docs/stormlab/structure/` (before) and `structure/after/`):
  - The 0.5° radar used to show a ring of 50–59 dBZ round the low meso, the maximum at its right-front where the inflow notch belongs, and almost no echo above 6 km.
  - Fixes:
    1. the mesocyclone's winds outside its core fall as 1/r (was r^-0.6), confined by exp(-(r/3R)²) to 6 R (was 8 R / 12 R), so rain no longer orbits the storm;
    2. rain falls out downshear and 0.3 rad to the left (spread 0.4, was 0.9);
    3. graupel and hail are released up to 0.8 EL (max 11 km, was 0.65 EL / 8 km);
    4. `ffdAt` = where that rain falls (the 5 km storm-relative wind + 0.3 rad, 1.45 Ru(5 km)).
  - Now: a forward-flank core left-front of the low meso, a hook curling round its rear, the inflow side clear, echo aloft overhanging downstream, and a weak echo region over the updraft at 5 km.
  - Still missing: a hook joined to the core's right-rear corner (it is slightly detached); an upper-level V-notch (no flow split round the updraft); a stronger low-level updraft and forward-flank gust front.
- **Seen in Studio:** no errors, scripts 3.1 ms. The wall cloud reads as −187 m on the panel, and from under the base the scud shows as soft wisps. The new wall cloud and tails have not been judged on screen.

## Supercell structure, round 2 (2026-10-26)

Images: `docs/stormlab/structure/after2/` (compare with `structure/` and `structure/after/`).

- **Hook joined to the core:** the hook's precipitation spiral starts at the forward-flank core's rear edge and curls cyclonically round the low meso to its tip at the meso's right-rear (it used to start 1.4 Ru from the meso, detached).
- **Upper-level V-notch / "flying eagle":**
  - Above half the storm top, the storm-relative wind at each height splits round the updraft core: potential flow round a cylinder of 1.2 Ru(z) (`Storm.windAt`).
  - The mesocyclone fades out by 0.55–0.7 of the top (it was felt up to 0.8–1.0 top and turned the whole anvil-level flow one way).
  - High-level hail and graupel leave the updraft round its downstream half on both flanks.
  - Result: the 8 km CAPPI shows a horseshoe/V of echo opening toward the updraft, and the 5 km CAPPI a C round the weak-echo region.
- **Low-level updraft:** dynamic lift under the low-level mesocyclone (its low pressure; Klemp & Rotunno), centred on its inflow side, 0–3.5 km, up to 0.6 · min(vlow, W/2). The peak w at 1 km is 9.3 m/s (was 2.4).
- **Forward-flank gust front:** rain-driven downdrafts get a base speed of 1.2 m/s from 5 mm/h (evaporation and melting through the column) on top of 0.12 m/s per mm/h (`ColdPool.downdrafts`).
  - Before, the forward flank's pool took ~20 min to form while the storm moved ~20 km.
  - The pool under the forward flank is now 1.9–2.9 K (was 1.3–2.4), and its 1 K edge runs east along the north side of the inflow.
- **Tools:** `tools/stormlab/diag_ffd.luau` (pool, rain and downdraft deficit along the forward flank) and `diag_wallcloud.luau`.
- **Known:** the sim's surface rain rate peaks at ~20 mm/h under 55–60 dBZ cores (a 1 km-grid average, low for such echo). It is left as is.
