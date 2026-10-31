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

## Sync with the game + realism review (2026-10-29)

See `REALISM-REVIEW-2026-10-29.md`.
- **Fixed:** since 2026-10-28 every scenario storm was engine-driven with its first state frozen (no own motion, rotation, occlusion or genesis). `Storm.fromEngine(e, follow)` / `World.new(data, { followEngine })` make it opt-in.
- **Storms: engine (default) / own:** `Sim/EngineFollow.luau` (moved out of the game's `server/StormHost`, which now uses it) drives the lab's storms from the scenario's `polls` exactly as the game does. F4 button, `LabConfig.DEFAULT_STORMS`, Workspace attribute `StormLabStorms`.
- **Scenarios re-exported** from the current engine via `js/game/LabWindow.js` (Supercell: seed 8181, tornado on S0008 at 22:25 UTC; SquallLine: seed 2112, S0068). Old files in git history.
- **Test:** `luau tools/stormlab/test_engine_follow.luau -a Supercell 45`.
- Not yet seen in Studio.

## Ground gaps + funnel scale fix (2026-10-29)

- **Funnel drawn at six scales (fixed).** Since 2026-10-28 `Render/TornadoCards` named the tornado's draw scale `k`, and the ring loop `for k = 0, RING` shadowed it: the centre card was drawn at scale 0 (size 0, on the ground) and ring card i at i studs/m instead of ~3.57, so the funnel was six mismatched copies. The scale is now `ks`. The main game uses the same renderer. Seen in Studio after the fix: cone, stovepipe and wedge scenes draw one coherent funnel.
- **Farmland tiles left gaps (fixed).** `GROUND.tile` was 2048 m = 7314 studs, but a Part is at most 2048 studs a side, so each tile was clamped and ~5000 studs of nothing lay between them. Tiles are now 512 m (`Render/Ground` caps them at 2048 studs and covers `LIMITS.partRange`). The town's ground plate and roads (1800 / 1600 / 900 m) were clamped the same way; `Town` now splits big flat parts (`tiled`).
- **Terrain (server/Terrain) rebuilt:** chunks of 64 columns, nearest the town first, 6 ms a frame. Each chunk lays a solid sheet just under the datum (top -0.08 m: under the town plate, over the tiles, which moved to -0.3 m) so near-empty voxels can no longer leave holes, fills the solid part of its hills with FillBlock and writes voxels only for the layers its surface crosses (heights on a 4-column grid, interpolated). A rebuild clears each chunk's own box, then erases what is left of the old area outside the new one; `Terrain:Clear()` on the full area hit the script timeout and froze "Town ahead". The town no longer waits for the terrain. First full build: 66 M hill voxels in ~4 min, in the background.
- F4 panel: "go to town" (camera 1.5 km off the town).

## Funnel top and edges (2026-10-29)

- **Top bulb removed.** The drawn radius was capped at 3 core radii all the way up, so the flare stopped widening and the stack of wide round cards read as a dark ball under the base. Now the cap widens toward the base (3 -> 8 core radii over the top 40%: the condensed radius runs away there), the flare cards get much flatter (height down to 0.2 of width), thin by up to half toward the base, and fade only at 0.9-1.02 H, so the funnel hangs from the base and spreads into the lowering.
- **Defined edge.** The centre card holds a second ImageLabel, `sliceFlat` (a horizontal slice of a column: crisp sides 0.86 of the frame wide, gaussian top and bottom), sized to the condensed diameter and 16 layer gaps tall at up to 0.5 opacity, so several faint slices blend at every point and the edge follows the taper without steps (8 gaps / 0.95 opacity drew steps). Its weight `def` = smooth(0.2, 0.5, condensed radius / core radius) x (1 - smooth(0.5 H, 0.85 H, z)): crisp where well condensed, soft at a marginal tip (rope) and where the funnel becomes the lowering; the soft puffs step back where it is crisp. Still ~200 billboards.
- Seen in Studio: stovepipe (no bulb, smooth crisp sides), cone (defined cone flaring into a broad lowering), rope (soft stub). Wedge not rechecked.

## Round 1 checks (2026-10-29)

- New F4 toggle **camera: close** films any scene from 600 m (with the rain-wrap and night toggles).
- Cone from 600 m: crisp funnel, dust moves; the funnel itself shows no spin or striations.
- Multi-vortex (rc ~330 m): one flat grey wall from 1.5 km and from 600 m; no sub-vortices visible.
- Town hills: smooth, no holes. The town's 1800 m ground plate rendered as a darker square whose corners stuck into the hills (a ragged "quarry" rim); the plate is now only built when the lab has no hills (the terrain sheet is the ground).
- Frame rate 11-40 fps in Studio while the lab's scripts take < 1 ms; cause not found (the profiler had no frames).

## Round 2: tornado look (2026-10-29)

Checked against docs/tornado-reference (NOTES.md, frame sheets) and docs/storm-reference/real: funnels are smooth and nearly featureless; spin reads from features crossing the silhouette (debris-cloud blobs, sub-vortices, edge wisps). So **no striped/scrolling funnel texture**.

- Wedge: the flare toward the cloud base is kept within half the lowering's reach (StormCards now publishes `stormBase[id].r`, the wall layer's radius); it spread to ~3.8 km and drew one dark wall. Ring puffs stay inside a crisp edge (size x (1 - 0.25 def)). The scene's wedge is squat (cloud base ~350 m): from 3.5 km it is a dark band under the lowering, low contrast against it (round 3, light/contrast).
- Multi-vortex: the parent thins where the core is two-celled (`thin` from subCount and twoCell: density x (1 - 0.7 thin), no crisp edge); sub-vortices are darker, bluer and also show low down where their wind (0.6 vc + own) beats the dust pickup. Seen: a dark sub-vortex column moving across a translucent parent.
- Dust: tornado puffs ~2x bigger, ~half the spawn rate, 0.7x opacity, the wisp sheet instead of the dirt-grain sheet, wider than tall near the ground. Reads as a faint skirt, not a ring of balls. The lab has no ground-type map, so no per-ground dust colour yet.
- Night: storm cards reshade when the sky/sun light changes (night toggle was day-grey until the next re-plan). Rain shafts still stay light at night.
- Ground: Terrain heights measured from the true datum (the rounded one put the sheet up to 0.56 m low); client farmland tiles wholly inside the terrain area sink 2 m. At ground level the town's surroundings are continuous; from ~1 km up the pad still shows tile patches (likely terrain LOD dropping the thin sheet).

## Round 3: light, flat deck, clear slot, wedge edges, perf (2026-10-29)
- Perf (wedge scene, "perf sweep" button in F4): 25.7 ms/frame (39 fps) with every layer on, 22.3 ms
  with every layer off - the storm layers cost ~3.4 ms; the rest is Studio, the in-process server,
  terrain and the engine. Scripts 2.3 ms in all (StormCards 0.6, TornadoDust 0.5, TornadoCards 0.4,
  Scud 0.2, RainShafts 0.2, Lightning 0.1). Turning clouds off saves 1.4 ms, dust 0.6, funnel 0.1.
  Scene builds drop to 2-11 fps while the server rebuilds the terrain (TerrainBuilding attribute).
- Light (3a): backlit rain brightens toward the sun (Shafts), backlit scud darkens (Scud), the base
  is darker from below (StormCards sky term by the card normal).
- Clear slot (3c): Util.slotParams / slotAt - a band behind the RFD round the low, from the RFD's
  strength and the occlusion; deck, rim and lump cards thin in it, frayed wisps along its lips.
- Flat deck (3b): BaseDeck.luau built (2048-stud tiles, SurfaceGui on the bottom face split into
  4x4 cells - UIGradient does nothing on these images - MaxDistance 0) but **OFF**
  (LabConfig.DECK.enabled = false): Roblox sorts see-through GUIs per object, so a tile nearer than
  a billboard draws over all of it (lowering, scud, funnel top) with straight outlines.
- Wedge edges: the veil was mostly cloud, not rain. Down-facing deck/lump billboards were drawn at
  full height (a 4.6 km card ~2.5 km tall) and hung to the ground in front of the funnel. CardPlan
  now foreshortens them (seenH: cw sin e + t cos e from the camera). Also: condensation tags sized
  to the core, not the envelope; the multi-vortex "shell" thinning only inside 0.7 core radii; rain
  shafts at the field's 1 km columns within 4 km of a tornado, 1.1 km wide. Result: dark wedge with
  a clear edge against lit rain; the edge against the dark rear-flank side is still soft.
- Follow-up (same day): the funnel's albedo now falls with its debris load (Sim/Tornado
  debrisLoft/debrisTop: soil mixed into the condensation, most near the ground), so a debris-laden
  wedge is the dark mass the references show. Foreshortened base cards also can't drop below the
  sight line to their own far edge (a lump near overhead still hung to the ground). Result: dark
  wedge with both edges clear. Still open: the base lumps (lumpyFlat, "under" lobe sheets) read as
  bright ovals under the base - the baked under-lobe texture looks lit; and lumps ~4.5 km wide are
  drawn at their centre's distance, so the far half of one can sit in front of a funnel.
  Clear slot not yet checked visually.

## Round 4: rope, multi-vortex, funnel card heights (2026-10-29)

Done (engine):
- Tornado contact is pushed by the parent storm's rear-flank outflow (`Storm.rfdOutflow`, used in
  `Tornado.step`; the parent summary from `World.parentOf` now carries `storm`). Ropes and dying
  tornadoes now lean (tilt 55 m -> 90-120 m as decay grows; mature ones 110-170 m).
- Dissipating core wind = circulation / narrowing radius (`vT ... / (1 - 0.45 decay)`), so a
  roping-out funnel stays condensed longer.
- Rope waves: three travelling waves 1 : 0.62 : 0.41 and a loose foot (`Vortex.axisAt`).
- Sub-vortices: orbit 0.6-0.9 rc (was 0.9 +- 0.12) and a helix (one core radius of height per
  radian) in both the drawn tubes and the wind field.
- Scenes: rope_day vlow 38, run 165 (a real rope-out, not a weak funnel); multivortex base 700
  (cloud base 550: the parent condenses only aloft), camera 2.6 km.

Done (renderer, TornadoCards):
- Cards spaced along the curved axis (segment length) and tall cards lie along the axis as seen;
  the crisp core slice turns with the lean. Narrow tubes (rc < 60 m) keep a crisp edge.
- Sub-vortex tubes: crisp slice texture, ~0.24 rc wide, rotated along their helix, heights spaced
  ~1.5 tube widths.
- Two-celled parent = hollow shell (centre card x0.05, ring x0.1 at full thinning).
- Card height limited by the taper below it (`hangMax`), opacity raised to keep the sight-line
  depth (`kOv`). Wide flare slices used to hang to the ground as an opaque dome.
- StormCards: a card leaving the sky-only lobe bake no longer keeps "amb" as its pass (nil image
  error every frame -> 11 fps).
- F4 counter shows "N subs op x".

Seen in Studio: rope leans, kinks and tapers (still a soft half-condensed funnel at decay 0.44);
multi-vortex is now a broad funnel aloft over a narrower base with sky beside it.

Open:
- Sub-vortex tubes still not clearly visible in the multivortex scene (18 drawn at 0.8 opacity).
- Wedge sides still soft from the 2.6 km scene camera; bright patches under the base remain.
- Not started: wall cloud size/occlusion/ragged RFD side, mothership striations, storm
  life-cycle looks (LP/HP, weakening, orphan anvil), lifecycle test scenes.

## Round 5 (2026-10-29): one tornado, aged by its storm

Asked for: every tornado built the same way, its look only from its life stage, the stage from
the storm's evolution. Research (NWS spotter guide "tornado life cycle"; UCI ESS 124 lecture 19):
organizing (dust whirl, funnel partway) -> mature (widest, near vertical) -> shrinking -> rope
(the RFD undercuts and tilts it; thin, snake-like, still damaging) -> gone.

Done (engine):
- A lab storm can evolve (`pin.evolve`, `pin.occl` = where its occlusion cycle starts):
  `World.labScene` then runs the world itself (storm, rain, cold pool, tornado) for `run` s and
  pins what it reached for the hold. Pre-run stays frozen. `Storm.occlusionFactor` shared.
- Tornado cut off once its parent has occluded (occl >= 0.8, the point where the storm's own
  low meso is cut off) - it used to fade in place for ~10 min as a "mature" EF0.
- Stretching: tilt lengthens the vortex, core narrows as 1/sqrt(length) (`stretchK`); the spin-up
  comes through vT's (rlow/rc)^0.4 (dividing vT too fed a 115 m/s runaway).
- Dissipating circulation spent late: x (1 - decay^2) - ropes stay spun up and condensed.
- Outer flow spins down first when cut off: `Vortex.profile` / `deficitIntegral` blend the fed
  Wood-White profile (R^-0.6 outside) toward a free vortex (R^-1) with decay. Ropes condense no
  wider than ~1.5 core radii (was ~3).
- Rope scene = a life stage: rope_day storm evolves from occl 0.15; its tornado forms, peaks
  (~70 m/s, 2.5 min), the RFD tilts it past twice the cloud base, held at ~4 min (decay 0.7).
  vlowLater scripted cut removed from it.

Done (renderer, all funnels by the same rules):
- Removed the rope-only rules (narrow-tube puff fade, narrow-tube crispness): they also changed
  the cone's foot.
- Cards on a piece of axis pointing at the camera are shortened by the share that shows (long
  dark sticks); flattened cards stay level (starburst at the funnel top); lean not capped at 75.
- Core slices turned and sized by the chord of the span they cover, at least 4 gaps (local lean
  fanned them into bars across a rope; 2-gap slices banded a bend).

Seen in Studio: rope = smooth tilted condensed tube to the ground; stovepipe and cone smooth, no
spikes where they meet the lowering, no banding.

Open: multi-vortex scene still its own environment (wide circulation) - sub-vortices come from the
swirl ratio, so a tornado that widens at its peak goes multi-vortex by itself; not yet shown as a
life stage. Wall cloud, mothership, storm life-cycle looks still to do.

## Round 6 (2026-10-29): banding, rope, tornadogenesis

Asked for: no banding on the stovepipe/cone/rope, no translucent sheath on the rope, less rope
tilt, different kinds of tornadogenesis (research), the open items.

Done:
- Banding: each core slice's opacity is its share of a 16-slice stack (`card.coreN`, its span in
  layer gaps): slices shortened on a bend no longer pale (TornadoCards). Seen: stovepipe smooth.
- Rope tilt: the foot is pushed by the RFD outflow only as far as it has wrapped round the vortex
  (`wrap` = occlusion 0.4-0.8, or half the decay) and follow 50 + 50 decay (was 2000 decay^3);
  the rope stage starts at 1 cloud-base height of tilt (was 2.2). Max lean ~0.5-1.8 H, was 3.3 H.
- Rope from the storm: cut off at occlusion 0.6 (was 0.8); once cut off the tornado keeps the
  circulation it had (`t.cut`) instead of following its weakening parent, so it narrows into a
  strong thin rope rather than fading as a weak "mature" vortex. Stage named by narrowing
  (shrinking < 0.3 decay, rope < 0.85, dissipating). rope_day: base 700 (200 m condensed a wide
  translucent cone - the "sheath"), occl 0.5, run 300: rope ~16-60 m condensed round a 33 m core.
- Genesis: a new tornado starts as its parent's circulation (`Tornado.swirlOf(parent, O)`: swirl
  x2 before it organises, contracting as O -> 1; core from that swirl), not a fixed 40 m vortex.
  Four live scenes (keypad . / * +, pinned storms, not held), each only different fields:
  G1 thin funnel lowers (narrow, base 650): funnel hangs from the base at 1 min, ground at 1.5-2;
  G2 broad bowl lowers (wide, base 750 / wall 500): bowl at the base, wedge to the ground ~2 min;
  G3 ground whirl, then condenses (base 1100): dust only ~1 min, partial, ground at ~5.5 min;
  G4 several vortices draw together (wide, slow): swirl 1.7 -> <1 at ~3.5 min.
  Seen in Studio: G1 (good), G2 (wedge soft-edged against the grey), G4 (no separate whirls seen).
- Dust: sub-vortices lift their own narrow dust columns (TornadoDust) - not yet visible under
  the broad skirt.

Research: debris whirl usually before the condensation reaches the ground; funnel from within
and under the wall cloud; wall cloud contracts and lowers before genesis (VORTEX2); top-down vs
non-descending genesis both observed (rapid-scan radar).

Open (unchanged or partly): sub-vortex visibility (dust skirt hides them), wedge contrast, wall
cloud shape/occlusion, mothership striations, storm life-cycle looks, bright base lumps, clear slot.

## Round 7 (2026-10-29): forming funnel, mothership, wall cloud

- Forming funnel (TornadoCards): soft ring cards now reach at least 3 layer gaps (`hs >= 3 segL`,
  was 1.4) and keep their aspect (`kOv`), so they overlap instead of stacking into horizontal ribs;
  ring envelope 0.7 + 0.3 sin^0.7 (was 0.35 + 0.65); core slices sized rc (1.35 - 0.45 def), inside
  the crisp edge (past it they scalloped it); dark "tag" specks min 15 m, aspect 0.45, opacity <= 0.4.
  Seen in Studio (G1, orbit view, 1:13): smooth taper, no ribs or specks.
- Mothership (CardPlan striations): one field `ms` = rotation x mesocyclone strength x how little
  rain veils the updraft (`1 - ramp(efficiency, 0.35, 0.7)`: LP / dry mid-levels). With it the
  banded zone deepens (0.5 -> 5 km above the base), gains tiers (+5), flares toward the base (bell,
  +45%), alternate tiers stand proud (stacked-plate lips), each tier is a flattened shaded lens
  (soft lobe: lit lip, dark underside) with the fibre banding below it, and the tower's lobes in the
  zone go smooth (laminar). Ring cards on the silhouette (seen side-on) are narrowed and faded:
  face-on billboards there stuck out as smeared streaks. HP storms (high efficiency) keep a short,
  faint banded zone.
- Wall cloud: shrinks with occlusion (x 1 - 0.35 occl); the rim facing the RFD is eaten (pulled in,
  thinner, torn `shredFlat`, foot lifted) - some always, more as it occludes: a horseshoe open
  toward the clear slot.
- Scene M (keypad Enter): `mothership`, an LP storm (pinned air mass `rhMid` 0.12, `pw` 16 ->
  efficiency 0.39). Pins can now set `rhMid` / `pw` (Storm.environment). Seen in Studio: a flared
  stack of shaded plates from 14 km. Its weak low-level spin (vlow 9) still makes an EF0.
- Main game scale: all of this is in sim metres relative to the storm's own size; the game draws
  each storm whole at Config.skyScaleAt about its centre, so proportions carry over. Not yet seen
  in the main game.

Sources: [NWS spotter guide - supercells](https://www.weather.gov/spotterguide/supercell2),
[NWS storm spotter's dictionary](https://www.weather.gov/media/fwd/skywarn/StormSpottersDictionary.pdf),
[StormTrack: typical vs mothership supercell](https://stormtrack.org/threads/typical-supercell-vs-mothership-supercell.4842/),
[StormTrack: horizontal striations](https://stormtrack.org/threads/horizontal-striations-on-storms.12457),
[COMET: low-precipitation supercells](https://courses.comet.ucar.edu/pluginfile.php/3757/mod_imscp/content/1/low_precipitation_lp.html),
[DTN: three types of supercells](https://www.dtn.com/there-are-three-types-of-supercells-can-you-name-them/),
[Wall cloud (Wikipedia)](https://en.wikipedia.org/wiki/Wall_cloud).

### Round 7b (same day)

- The base is part of the storm's shadow: StormShape now carries the rain-free base deck
  (`sh.deck`, the geometry CardPlan draws) and `sunLit` adds the sun ray's path through its slab
  (e-folding 250 m; open where the clear slot cuts it). Before, anything under the base near its
  edge counted as fully sunlit: the wall cloud drew paler than the base above it and the
  hanging lumps glowed.
- Hanging lumps under the base, seen from below toward the sun, use the sky-only bake (no
  backlit rim: the sun behind them is behind the base). Their tone is now near the deck's
  (alpha 0.25-0.4, albedo 0.98-1.04 of it): seen in Studio they read as the base's own soft
  structure, not a grid of dark or glowing ovals.
- Scenes can set `noTornado` (storm-structure views; the camera focuses the storm). New scene
  W (keypad =): `wall_cloud`, occlusion 0.5, no tornado, from the south-east at 4.5 km. M is now
  tornado-free too. A scripted shot keeps its distance whatever it focuses (it was reset to
  18 km on a storm).
- Seen in Studio: W shows a dark continuous base, rain shafts, a lowered ragged area with the
  sunlit, torn edge of the clear slot beside it; M's plates hold, lower ones shaded by the base.

Open: the wall cloud is still not a crisp, distinct lowering at chase range (it merges with the
base's far underside); sub-vortex visibility; storm decay looks; plate card cost (up to ~8 tiers
x 14 x 2 cards on an LP storm, not profiled).

## Round 8 (2026-10-29): near-field VFX clouds (prototype)

User asked for clouds made another way ("maybe vfx?"). Roblox draws no particles past ~800 studs
(measured 2026-10-22), ~220 m at the standard scale, so particles can't carry a storm; the user
chose the hybrid: VFX up close, cards beyond.
- `Render/NearVfx.luau`: every 2 s it lists the cloud billboards (StormCards, TornadoCards, Scud,
  TornadoDust folders only); every 0.2 s the nearest within reach (card centre + half its size
  < 720 studs), up to 64. Each gets a pooled box-volume ParticleEmitter: the looping 4x4 smoke
  flipbook (`TEXTURES.smokeLoop`, uploaded 2026-10-22), facing the camera, locked to its card,
  tinted the card's colour, per-puff opacity set so the stack matches the card. Hand-off weight
  1 inside 520 studs, 0 at 720: the card's transparency is scaled by (1 - k) after the
  renderers write it (`post`, called last by init.client). `LabConfig.NEAR_VFX`.
- Keys: B toggles it; I / O zoom the chase camera in / out (as the mouse wheel).
- Seen in Studio (cone, camera ~100 m): 35 cards -> ~770 particles. The funnel reads darker and
  more textured than the cards; some straight, boxy edges; ~2.4 ms a frame. First pass had the
  stack ~2x too opaque (dust became a brown wall) - fixed by counting the real overlap.
- Open: the boxy edges (flipbook frame bleed or half-faded cards), cost, a scene that starts close.
- Shelved 2026-10-29 (user: "shelve vfx, lets use billboards and shaders"): `NEAR_VFX.enabled = false`,
  code kept (B still toggles it).

## Round 9 (2026-10-29): clouds carried by the wind field

User: clouds and storms should "behave via physics". The moving cards (scud, tail cloud, inflow
filaments, rising billows: CardPlan `c.mv` "in"/"up") no longer follow scripted pull/rise/swirl
loops: `Render/CloudParts/Flow.luau` traces each through the client's copy of the server wind
field (`ctx.cw:windAt`, no tornado), storm-relative; in the wall layer at its turning angle with
the solid turn taken out. One loop = born at its planned spot, carried for P s (the time the
air takes to move it its travel), then faded and reborn; P kept per card so re-traces don't jump.
Opacity follows the parcel: lifted -> condenses (x1.25 max below the base), sunk -> evaporates
(gone within ~120 m below the base, ~250 m in cloud), scud lifted through the base merges into it.
Traces are queued as plans are written and run 0.6 ms a frame at most (attribute
`StormCardsFlow`). `LabConfig.CLOUD_FLOW = false` restores the scripted loops. The mesocyclone
"spin" rings are unchanged.
- Seen in Studio (wall_cloud scene): 610 traced, ~0.15 ms a frame, the scud under the wall cloud
  drifts and the base stays whole. Not yet judged in motion by the user.
- Next (user chose "live-lit cloud sprites"): a Luau pixel shader relighting cloud textures into
  EditableImages from density + depth for the sun and view; needs density/depth bakes per texture.

## Round 10 (2026-10-29): the lobe "shader" (light computed in Luau)

Roblox has no custom GPU shaders, so `Render/CloudParts/LobeShader.luau` computes the light inside
the cumuliform cards in Luau and writes it into EditableImages, replacing the three fixed Blender
bakes (front / side / back) with sheets for 5 sun tilts (`LabConfig.LOBE_SHADER.bins`). Each lobe
is the Blender bake's sphere-cluster shape seen as front + back depth per pixel; per pixel a march
toward the sun through the soft-edged body (self-shadowing; through the body when back lit),
Beer-Lambert + multiple-scattering tail, Henyey-Greenstein phase (silver lining), soft facing term,
sky light less in creases. Toned to the old sheets' mean (0.88), contrast 0.6 of the light's own
variation (the storm-scale light stays in the card colour). The card is still turned so the
sheet's top faces the sun on screen. Built once in the background (~3 ms a frame, 13 s), cards
keep the bakes until ready; attribute `LobeShader`. Prototype (numpy, previews):
`tools/lobe_shader_proto.py`.
- Seen in Studio (Supercell scene, default view): the tower now shows distinct rounded billows lit
  on top and shaded beneath, against the old flat haze (`docs/stormlab/detail/lobe_shader_ab.png`).
- Open: ~27 MB of EditableImages (watch on low-end devices); the near sheets (256 px lobes) not
  yet checked up close; maybe more bins or an in-between blend; tuning MEAN / CONTRAST / SIGMA.

## Round 11 (2026-10-29): billboards only; spiral-stream tornado

User: the references use billboards only - shaders off (`LOBE_SHADER.enabled = false`). Researched
BillboardGui sprites and a Discord recipe (sprites spiralling up round a tracker, bigger higher up,
dot-product shading); write-up and build notes in docs/stormlab/BILLBOARD-TORNADO-PLAN.md. Built
the funnel as a spiral stream (default; T switches to the old rings for comparison).

## Round 12 (2026-10-29): wall cloud + tail as a puff stream (Render/WallStream)

Reference: a user-supplied recording of a billboard-only wall cloud + tail
(docs/stormlab/detail/wallstream_reference.png): dense round puffs with a feathery rim, heavily
overlapped (solid lobes), a constant-width tail tube with a rounded tip, the tail wrapping into a
turning wall cloud. Built `Render/WallStream.luau` (default; key **Y** switches back to the old
cards, `LabConfig.WALL_STYLE`):
- body: 64 puffs circling the low-level meso at the sim's own Rankine speed at their radius
  (core 0.3 Ru, vlow): shear, not a rigid plate; core puffs also roll (seen from below);
- tail: 48 puffs on a path traced from the FFD side with the storm-relative inflow speed in and
  the same vortex turning it - straight far out, wrapping round the wall cloud close in, rising
  and merging into the base; born at the tip, so the tail feeds the wall cloud;
- new texture `featherFlat` (tools/feather_puff.py, roblox/assets/clouds/feather_puff.png);
- light, haze, rain fog and the storm's smoothed centre are StormCards' own (ctx.stormShade);
  CardPlan drops its wall body/banding/filaments/tail when the stream is on (scud stays).
112 billboards, ~0.2 ms a storm (nearest 2). First tail was a thin saw-toothed ribbon: thicker
(max(1.3 D, 0.3 R)), ~4x overlap, per-puff size/turn jitter fixed it (wallstream_v1.png).
Also: spiral tornado opacity raised (user: it read translucent).
Open: not yet seen from the ground at a distance (the lab's chase camera sits under the base);
lowering depth comes from the sim (wall cloud -150..-350 m), so the body is flatter than the
reference's cartoon bulb.

### Round 12b: wall cloud joined to the tornado; isolate view (key U)
- Key **U** (Render/WallStream): only the wall cloud, its scud and the tornado - the parent storm's
  body (StormCards main layer re-planned empty) and rain hidden; U again restores them.
- With a tornado under it (its parentId, else the nearest within 1.2 R) the wall cloud turns about
  the funnel's top (the low-level circulation is centred on the tornado) and its middle hangs in a
  bowl round the funnel (up to ~150 m + 0.1 H lower), so the funnel flares into a lowering.
- WallStream publishes the lowering's reach and underside colour (ctx.wallStreamBase ->
  ctx.stormBase): TornadoCards keeps its flare inside it and takes its light at the top (the old
  measurement read the cards the stream replaced, so the funnel had fallen back to 1.5 km / no colour).
- Fixes found in the isolated view: body opacity no longer x q (pale blotches), puffs 0.5 R wide and
  no taller than the underside-to-base gap (they stuck up past the base as splashes), flattened
  puffs lie level (random turns drew spokes).
Images: detail/wall_tornado_isolated_near.png, _far.png. Open: the sim's wall cloud is ~2 km wide
but 150 m deep, so isolated it reads as a flat lowering, not the reference's bulb.

### Round 12c: wisps, depth, and the wall cloud from below (untested in Studio)
- Textures: tools/smooth_puff.py (smoothPuffFlat, no grain - the feather puff read as sandpaper)
  and tools/wisp_sheet.py (wispSheetFlat, 2x2 fibrous wisps). Wisps lie along the flow on screen
  (wall cloud's outer body, tail, tornado strands) instead of round sprites turning on the spot.
- Wall cloud depth: body runs from the underside to base + 0.4 R; bowl round a funnel up to 300 m.
- From below (detail/wall_from_below_before.png, old code): a ring of blobs with sky through the
  middle and gaps, a uniform tube of a tail, flat grey. Added: an underside disc (10 level discs
  drawn foreshortened by the viewing angle, darker in the middle, turning with the flow), body
  filled to the middle, tail as a flat band ~2.5x wider than deep tapering to its tip.
- Key P: free-camera views of the wall cloud from the ground (rim, under the middle straight up,
  2 R out, 0.5 R steeply up).
- Tested 2026-10-30 (keys U, P): from below the wall cloud is now solid (no hole). Straight up it
  was a featureless dark ball (detail/wall_below_up_before.png); the underside pieces are now
  wisp bands along the turn (screen angle of the flow's tangent from beneath, level side-on),
  patchy +-15% in light, 16 of them: curved bands swirl round the middle (wall_below_up_after.png).
  Wisp sheet re-made softer and broader (the fine fibres read as fur up close): asset
  132403693605015. From 2 R out (wall_below_far_after.png) a few sky gaps remain in the body.

### Round 12d (2026-10-30): wall cloud from the photos, tornado toggle, motion research
- Key L / F4 "tornado" button: rebuild the scene with or without a tornado (server testScene
  `tornado` flag; added tornadoes held mature).
- Wall cloud body rebuilt from docs/storm-reference/real/04_*: a step below the base only, solid
  round core over the full step depth + level streaked tiers round it (one `band` helper: level
  discs drawn foreshortened by the viewing angle); isolate mode draws a base deck (NC 24); tail
  alternates round puffs and wisps. Images: detail/wall_tiers_under_storm.png, _with_tornado.png.
- Still wrong: tiers read as stacked plates; storm base too light round it; isolate deck is
  blobs; with a tornado the bowl (dip up to 300 m) hides the funnel's condensed top.
- Motion research: RESEARCH-ROTATION-MOTION.md (turn periods, scud ascent, tail flow, funnel
  pattern speed, collar, sub-vortices, rendering rules).

## Round 12e (2026-10-30): wall cloud + inflow as one volume (isolate view, key U)

Following the user's notes (one density/velocity model drawn through billboards):
- Body: one filled volume between the underside and the base; outline = coherent noise turning
  with the circulation; 20 big inside pieces, 45 medium outline lumps (soft edge-free puff,
  softFlat, 1.4x larger), 25 small fringe wisps rising ~3 m/s. Shaded as one volume (volShade:
  side vs underside normal, darker with depth; sides ~2x the underside, as photos).
- Tail: slices 3 across (a soft lump on top, two feathered wisps lower = flat underside), wide
  far out narrowing into the wall cloud, denser at the join. Was a single file of puffs (beads).
- Solid base discs (BaseDeck) ON in full scenes; gain 1.7; base cards beside them still too light.
- Images: detail/wall_iso_hardpuffs_before.png, detail/wall_iso_softvolume_after.png.
- Open: from directly below it is one featureless dark disc; no sunlit side yet.

## Round 12f (2026-10-30): wall cloud drawn as the tornado is (user: tornado visuals are fine, the wall cloud adopts them)

- Body = TornadoCards' spiral-stream logic: fibre wisps lying along the flow on screen (turn +
  rise), a rising stream with fades at both ends (no fixed pieces), opacity 1-exp(-density),
  big soft (softFlat) pieces for the dense middle; volume/sun shading as before.
- Motion from the user's notes: noise-shaped outline turning with the circulation; slower than
  the tornado (low-meso profile, inner faster); outline wisps rise 1.5 m/s, fringe 3 m/s;
  coherent turbulence (math.noise radius/height wobble); within ~4 rc of the funnel top, low
  down, the turn blends into the tornado's own (Vortex.profile about its top core radius).
- Image: detail/wall_iso_flowwisps_tornado.png (isolate U + tornado L, far side view).
- Open: outline still reads a little like brush strokes; the EF2 test funnel is mostly
  uncondensed so only its dust shows under the wall cloud.

## Round 13 (2026-10-30): tornado body rebuilt as three layers (style "volume", key T: rings)

The density-sampled body (336 faint soft puffs scattered through the funnel, each at most
~0.2 x the column's optical depth, no core) read as fragmented, wispy smoke near and far: their
projected images barely overlapped and nothing set a minimum opacity where the air is condensed.
Now `Render/TornadoCards` draws the same engine radius, wind and lifecycle as three layers, 200 cards:
- **Body (40):** crisp-sided `sliceFlat` slices at fixed heights up the axis, each 16 gaps tall
  and at least as tall as wide (halved on a bend, >= 4 gaps), so every point is covered by many
  (7 gaps cut to ~2 by a taper rule drew each slice's soft ends as stripes). One target opacity per height, A = max(1 - exp(-2 beta rc), 0.92) x condensed share
  (smooth 0.08-0.3 of rc/core radius) x top fade x sight x (fades over zAt 0.55-0.92, where the
  envelope takes over, as the rings' core) x (1 - 0.85 two-cell shell), shared out as
  1 - (1 - A)^(1/overlap). Lit as the column's middle (sun spent crossing it); half-lit drew a pale
  column with the shadowed puffs as dark spots.
- **Envelope (120):** soft puffs ~0.85 rc wide at 0.74-0.96 rc riding the flow (turn at omega(z), rise 0.15 vc).
  Lumps (radius +-16%, size, opacity, light) come from one noise field read at each puff's carried
  angle and height label, so neighbours bulge together and the bulges travel round. Opacity
  <= 0.7; shows from a lower condensed share than the body, so a marginal tip stays ragged.
- **Wisps (40):** `wispSheetFlat` streaks just outside the surface, turned along the on-screen flow
  (turn + 1.6x rise), fading in and out as they climb; faint (<= 0.35), none in the flare.
Seen in Studio (stovepipe, close camera 600 m): one continuous dark funnel, softly lumpy, rising
into the lowering; no stripes, spots or gaps. Cone scene: currently condensed only as a short stub
under the base in both styles (scene state, not the renderer).
Open: the wall cloud (WallStream) is a huge near-opaque dark mass with long dark spikes round its
rim (present in both funnel styles) and swallows the funnel top: next, separately.

### Round 13b (2026-10-30): open items
- **Body translucent (fixed):** the slice texture's density is a bell ~0.16 of its frame tall
  (smoke_flipbook.py --slice), but the overlap count assumed half the frame, so each slice was ~3x
  too faint. Overlap now 0.16 x drawn height / on-screen gap; the body's target opacity is cut by
  rain only x(0.85 + 0.15 sight) (rain greys its colour instead), cap 0.985.
- **Wedge a faint smudge (fixed):** the two-celled shell thinned the body by a flat x(1 - 0.85 thin)
  (A 0.52). Now by the optical depth of the condensed ring round the dry middle (~0.7 core radii):
  a wedge's ~160 m ring is opaque (A 0.98). Slices are no longer forced as tall as wide (a wide
  slice's lower bell hung over the narrower funnel and blurred the sides); envelope puffs reach
  ~1.15 rc (was ~1.4).
- **Rope drawn as blocks (fixed):** slices stopped halving at 8 gaps, so on a wavy rope they were
  straight sticks across the waves. Now down to 2 gaps; a slice under 6 gaps uses the soft round
  puff (the bell can't overlap enough there; cropping the slice drew hard-edged tiles).
  Seen: one continuous snaking rope from the wall cloud to its dust.
- **Wall cloud spikes (fixed, WallStream):** medium flow wisps kept full length where the flow
  points at the camera, so the rise turned them into long steep dark streaks round the rim. Length
  now follows the on-screen share of the flow; tilt limited to +-18 deg side-on (free from beneath).
- **Wall cloud swallowing the funnel (fixed):** the lowering's bowl round a funnel hung up to 300 m
  (half a 600 m funnel) over rDip >= 6 core radii. Now <= min(0.3 depth, 0.12 H, 100 m) over
  max(0.2 R, 3 rc).
- **Wall cloud too opaque (eased):** per-piece density 3 / 2+1.5d / 1.1 -> 1.8 / 1.1+1.2d / 0.7.
- **Cone scene stub (fixed):** cone_partial vlow 20 -> 27: condensed 28 m at the ground to ~590 m
  under the base (was nothing below ~250 m of 520).
- Wall cloud fringe wisps shorter and plumper (0.13-0.23 R, 0.6 thick): they drew a sawtooth from below.
- F4 counters (TornadoCards attribute) now show the body at two heights (A, overlap, sizes, shell).
- Seen in Studio: stovepipe solid with a defined edge, emerging below the wall cloud; cone condensed
  to the ground flaring into the lowering; rope continuous; wedge a dark mass under the lowering.
- Still open (not from this work): multi-vortex sub-vortices barely visible in both funnel styles
  (sub-vortex columns op ~0.3, behind the dust skirt); wall cloud's level wisps read as horizontal
  brush strokes; BaseDeck discs' hard edges and light colour (from 2026-10-29).

## Round 13c (2026-10-30): ground contact, multi-vortex, dust, rope tube

User asks: stovepipe wider at ground, cone condensed to ground, cards pinwheeling off the side,
wedge too soft, multi-vortex = bowl + erratic sub-vortices round a clear centre, wall brush
strokes, dust/wind field too large, rope like a caterpillar, sub-vortices only when multi-vortex,
a sub-vortex-like opaque "tube" look for ropes.

- **Stovepipe scene** vlow 30 -> 36: condensed 53 m wide at the ground (was a point above ~20 m).
- **Body condensed share** by the condensed radius itself (smooth 0.3-2 m), not rc/core: a cone's
  25 m tip and a rope's few-metre foot count as cloud.
- **Body opacity:** no longer cut for rain (rain greys the colour; cutting alpha too counted it
  twice: a rain-wrapped rope drew pale and see-through); floor 0.95.
- **Rope tube:** where body slices are short (bends: under 6 gaps) each is the slice cropped to
  the middle of its bell (|v| < 0.12, mean density 0.61) laid along the axis: crisp walls, soft
  ends - the sub-vortex tube look. Round puffs there drew a caterpillar. Where the funnel widens
  fast over a slice (the flare) it is a soft puff (crisp slices stacked into tiles there).
- **Wisps:** on the surface (0.9-0.98 rc), shortened where the flow points at the camera and only
  on the side facing it - they pinwheeled off the funnel's edge.
- **Envelope:** puffs on the funnel's sides fade (x0.25 at the limb): they blurred the wedge's edge.
- **Wall cloud:** medium outline lumps are soft round puffs (level fibre wisps read as brush
  strokes); underside bands fade when seen from the side (edge-on they were level streaks).
- **Wind field (Sim/Vortex.sample):** the tornado's own swirl + inflow hand over to the storm's
  beyond 3 rc (exp(-((R-3)/2.5)^2)); kept to 60 rc an EF2's dust-lifting wind reached ~9 km.
  Pressure deficit / condensation and peakWind (<= 1.2 rc) unchanged.
- **Dust:** puffs spread at 1.5-4.5 m/s (turbulence), not a share of their size per second (a
  160 m puff swelled to ~1 km and hid the tornado).
- **Sub-vortices** only above swirl 1.0 (the multi-vortex stage label; DEBRIS-CLOUD.md), count
  (S - 1) x 10: a cone (S 0.79) had a stray one orbiting it. Paths more erratic (+0.45 rad wander
  at t/6, orbit radius jitter at t/2.5). Tubes cropped as above (the full slice drew dashes); below
  the condensation shown by dust lifted to their updraft's height (max(100, 1.5 rc)), standing out
  by the (speed/V)^3 pickup contrast against the skirt, soil-grey.
- Seen in Studio: multi-vortex = dark bowl, 3+ curving tubes to the ground, low skirt, clear
  middle; wedge a dark wedge with defined sides; stovepipe column with broad ground contact;
  cone condensed to the ground, no orbiting tube; rope a continuous opaque tube to its dust.
- Open: hard horizontal stripes in the storm base / wall cloud above the funnels (StormCards /
  WallStream, not the funnel); BaseDeck disc edges (from 2026-10-29).

## Round 13d (2026-10-30): opaque rope, sub-vortex depth, tube scene, sharper funnel edges

User asks: rope still translucent; multi-vortex sub-vortices should rise from the ground and not reach
the bowl; a tube tornado like the old cone sub-vortex (opaque); sharper cone/stovepipe/wedge edges;
blue (wisp) cards streaking off the side.

- **Whole body as tube pieces** (TornadoCards): every body slice is now a cropped-slice piece
  (|v| < 0.2 of sliceFlat, so its ends are Gaussian), ~5 gaps long, spanning 2.5 gaps of sim rows
  (was 16, which averaged the taper and blurred the edge). Neighbours of different widths blend into a
  smooth taper: no steps (cone/tube, seen close) and no visible bands. Puffs only where the radius
  jumps (> 0.35 rc between ends: flare).
- **Opacity**: overlap count uses the cropped piece's density (mBar 0.39) and the rain factor is no
  longer applied twice; floor 0.95 where condensed. Rope is a solid dark tube (rain in front still greys it).
- **Envelope pulled in** (0.45-0.65 rc, puffs turned edge-on fade out) so it no longer softens the edge.
- **Wisps** (the blue debug cards that streaked off the side): only on the near face (facing > 0.55),
  length capped at min(0.9 rc + 15, 1.2 rc x facing), opacity <= 0.35.
- **Sub-vortex depth** (engine Vortex.subDepth = max(60, 2.5 h)): the sub-vortex wind decays with
  exp(-z/depth); their dust columns fade with exp(-(z/depth)^2) and a visibility threshold, so they
  stand from the ground and end ragged ~1/3 of the way to the base, under the bowl (photo research:
  0.2-0.35 of cloud base). Seen in Studio.
- **Tube scene** (key K with the panel open): Ru 1500, vlow 30, base 700 -> rc 39 m, swirl 0.46, no
  sub-vortices, condensed ~50 m wide at the ground, ~80 m at 150 m. Narrow columns to the ground come
  out EF4 in this model.
- Engine changes (subDepth, subCount from swirl 1.0, outer taper beyond 3 rc) also apply to main-game storms.
- Still open: BaseDeck disc edges; hard stripes in the storm base (StormCards/WallStream).
- **Reverted (user, same day):** the edge-sharpening body change (2.5-gap tube pieces everywhere,
  Gaussian ends, longer overlap, envelope pulled in to 0.45-0.65 rc) drew bands across every condensed
  funnel. Body is back to 16-gap slices (halved to follow bends), tube pieces only on short rope bends
  (crop 0.12, 2.2 gaps), envelope 0.6-0.84 rc. Kept: rope opacity (mBar 0.45, no double rain), wisp
  limits, sub-vortex depth, tube scene (key K). Edges are as soft as before Round 13d; sharpening them
  needs another method that doesn't band.

### Round 13e (2026-10-30): sharper funnel edges without bands; wall cloud + tail diagnosis

- **Why the edge was soft** (colour-coded cards: body red, envelope green, wisps blue): the body
  slices themselves. The "puff or crisp slice" test (radius change > 0.35 rc) was judged over each
  slice's whole 16-gap span, so on any tapering cone/stovepipe nearly every slice counted as "widening
  fast" and was drawn as a soft round puff. Now judged over the part of the slice that shows (its bell,
  +-0.09 of the span): cone and stovepipe sides are crisp slices, only the flare into the lowering is
  puffs. No short pieces, so no bands. Envelope puffs pulled in to 0.45-0.65 rc (size 0.5-0.68 rc) so
  they stay inside the edge. Seen in Studio: stovepipe, cone, tube crisp, no banding.
- **Wall cloud + inflow tail diagnosis** (WallStream colour-coded: large inside pieces magenta, outline
  lumps cyan, small fringe wisps yellow, tail orange, underside bands white; scene W, isolate U, P views):
  1. The wall cloud reads as a loose cluster, not one lowered block: sky shows between the cyan
     outline lumps on top, and the magenta core is an irregular blob inside them.
  2. Fringe wisps (yellow) float detached above and around it like confetti: placed at 0.9-1.15 of
     the rim radius, i.e. outside the body.
  3. From below, a big flat white underside disc fills the middle and the underside bands radiate
     as long pinwheel blades; from the side (2 R out, 14 deg up) the bands still show as horizontal
     light strokes across the body.
  4. Tail: same-size round puffs in a straight double row at the wall cloud's bottom level - a string
     of beads with gaps at the far end; no taper, no visible wrap into the wall cloud, and on the
     full-storm view the elongated puffs all lean the same way (hatched look).
  5. At the scene distance (4.5 km) the wall cloud is small and washed out under the storm base.
  6. Isolate-only base deck discs float beside/below it with sky between - the wall cloud doesn't hang
     from a base.

### Round 13f (2026-10-30): tornado seen from beneath; wall cloud + tail fixes (not joined to the base yet)

- **Stripes looking up a funnel** (TornadoCards): seen end-on a body slice is a thin bar (its bell
  over a >= 1.4-gap card), and 40 bars of different widths stacked drew stripes. Where the slice is
  seen end-on (proj < ~0.6, endOn = 1 - smooth(0.45, 0.8, proj)) it is a round soft puff as tall as it
  is wide - the funnel's cross-section, a disc. Seen from beneath and at 60 deg up: smooth, no stripes.
  The hard horizontal steps still visible looking up are the storm base (StormCards), an open item.
- **Wall cloud** (WallStream): dense middle out to 0.72 of the rim (was 0.55); outline lumps on the rim
  (0.62-0.86, were 0.7-0.95), denser (1.5 + 1.2 depth), fading only in the last 8% of their rise and
  stopping at 0.88 of the depth (no sky between them, no bumps standing up past the top); fringe wisps
  on the rim (0.8-0.98, were 0.9-1.15 - floating outside). Underside streaks half as long, opacity 0.6,
  darker, gone sooner side-on (no pinwheel blades). Seen: one solid mass side-on, solid dark disc from
  beneath with faint curved streaks.
- **Tail**: puff sizes vary 0.7-1.3, ~2.8 gaps long (overlap), thickness and width taper to the far
  tip, side wisps hug the core (offsets roughly halved, thicker), each puff its own lean (+-15 deg plus
  noise). Seen: continuous core tapering to the tip; the last change (length no longer tapered, so the
  tip doesn't break into beads) is not yet seen in Studio.
- Not done (user: later): joining the wall cloud to the cloud base.

### Round 13g (2026-10-30): banding removed; wall cloud drawn like the funnel's junction

- **Survey key X** (WallStream): 16 camera views round the focused wall cloud and any tornado under it
  (4 directions x 3 R out / 1.2 R out / 0.4 R under the rim / 2 R out at half the wall's height),
  printed to the output. Run in real colours and colour-coded (stovepipe scene).
- **The bands were the flat overhead deck** (BaseDeck): its solid discs write depth, so every billboard
  reaching up through them - the funnel's top, the wall cloud, the storm's cards - was cut along a
  straight level line, and the discs' few heights drew parallel bands. No discs now within
  1.15 R (+ a disc radius) of a wall cloud; the lowering covers that patch from below.
- **Fine stripes in the funnel body near the ground / at some angles**: spans shortened at the ground,
  the top or on bends made a slice's bell thinner than the gap between slices. Crisp slices now keep
  hc >= 13 dz proj (bell >= ~1.2 gaps as seen).
- **Wall cloud like the junction** (user: the texture where the funnel meets the wall cloud is the
  look): every body piece, the tail and the middle underside disc use softFlat (the fringe and tail
  sides were fibre wisps - chips); outline lumps bigger (0.6-0.95 R) and fainter (0.9 + 1.2 depth) so
  they pile up and blend; fringe opacity 0.45. Tail puffs up to 3.5x as long as thick, flatter when
  seen side-on, turned along the path only as far as it shows across the screen (end-on they stood up
  as spikes).
- Seen in real colours from 1.2 R, mid-height 2 R, east 1.2 R and 0.4 R under the rim: no cuts or bands,
  the wall cloud one soft dark mass running into the funnel. Not re-surveyed: rope and tube scenes.
- Still open: the wall cloud not joined to the base (user: later); behind it the storm's lighter cards
  show through the deck's hole.

### Round 13h (2026-10-30): last funnel banding, denser tail, softer underside

- **Shift+X** (WallStream): elevation sweep - the funnel's middle from the ground at 15-80 deg up,
  one step per press, printed. The user's leftover banding was at ~35 deg up, low in the funnel
  against bright sky.
- **Cause:** not colour, not the rain behind (both ruled out: flat grey body, forced-opaque body),
  and every slice there was a normal crisp slice (printed). With slices ~13 gaps tall only ~2
  covered each point, so the residual see-through varied once per slice - ~2 grey levels against
  the sky. Crisp slices now >= 18 dz proj (measured row ripple 2.1 -> 0.3 grey levels). Also: tube
  pieces cropped to |v| < 0.2 (cut at 0.7%, was 0.12 = a hard 17% edge per piece; mBar 0.4) and at
  least 5.5 gaps; round puffs at least 4 gaps.
- **Tail:** the puff spacing was counted over all 80 puffs, but 5 share each cross-section, so
  each lane's puffs were ~0.7 spacings long - rows of dots. Spacing is now per lane; puffs 2.6 lane
  spacings long (up to 6 tT, 6x thick); tube thicker (1.5 D / 0.35 R); opacities 1 / 0.95 / 0.7.
  Reads as one continuous band from below and side-on.
- **Underside:** the 15 streak cards are soft puffs (were fibre wisps darkened 30% extra - the long
  high-contrast cards seen from below), 0.6 wide, 0.45 opacity, darkened like the disc.
- Still open: through the deck's hole over the wall cloud, the storm's own flat oval base cards
  show from below (isolated, the wall cloud alone is smooth). Goes with joining the wall cloud to
  the base.
- **Opaque funnel** (user: still translucent). Each crisp slice's opacity was shared as
  (1 - A)^(1/nOv), which ignores how the bells overlap: the stack let through ~2.5x the intended
  light (3.6% of the sky where 1.5% was meant). Now each slice's opacity is solved (12-step
  bisection over its ~10 neighbours' bells) so the stack lets through exactly 1 - A midway between
  slices, and the cap is 0.997. Measured on the stovepipe: the funnel is 46/51/57 at every height
  whatever is behind it (before: 54-60 / 62-68 / 68-79, tinted by the sky). Tube pieces and puffs
  (ropes, the flare) keep the shared formula; partial condensation still thins A, by design.
- **Rope: see-through and banded** (user). Two fixes. (1) The opacity solve now covers every body
  piece - crisp slice, tube piece (|v| < 0.2 of the bell) and round puff (softFlat's measured
  column) - via `stackAlpha(kind, height in gaps, 1 - A)`. (2) The gap between pieces was taken as
  dz x proj, ignoring the axis leaning: where a rope runs sideways the next piece is several dz
  away on screen, so pieces were sized and faded for a far smaller gap - light bands across the
  bend. Now `gapS` = the chord's on-screen length per metre of height x dz, used for every minimum
  length and the opacity solve. Tube pieces at least 7 gaps, puffs 5. Rope scene: solid and dark,
  no bands, far and close.
- Seen in the rope's close view: a straight level cut through the storm's grey cards away from
  the wall cloud - the overhead deck discs again (outside the hole). Not the tornado; open.
- **Rope bends: jagged corners** (user: the big cards poke out of the rope where it bends).
  - Slices are spread evenly along the funnel's *length* (arc-length table of the axis, 48 samples),
    not its height: a sideways run gets as many pieces as an upright one. Upright funnels unchanged.
  - Bend test tightened: a piece may sag 0.2 core radii off the curve (was 0.33), down to 1-gap
    pieces (was 2); a soft tube piece is no longer than 1.8x the span that passed.
  - New texture `capsuleFlat` (tools/smoke/capsule.py, rbxassetid://122340939095171): crisp sides
    0.86 wide, elliptical round ends. Opaque rope pieces (A >= 0.97, hysteresis 0.95) use it whole -
    round joins, so pieces meeting at an angle stay inside the tube - and are at least 3.2 gaps long
    (shorter, only their round ends overlapped: a row of beads). Fading pieces keep the |v| < 0.2
    bell crop (solid pieces stacked see-through double up where they overlap: stripes).
  - A condensed funnel's floor raised 0.95 -> 0.995 (the user wants it solid).
  - Rope scene, far and close: solid, smooth curves, no corners or bands. Left: a faint ribbed edge
    near the top where the rope fades into the cloud (still see-through there, so soft pieces).

## Round 13i - "gas" tornado style (2026-10-30)

User: the cards looked like solid objects, not condensed gas; build a version with cloud-like
billboards that matches the references, with no visible banding.

- New style `gas`, now the default (`LabConfig.TORNADO_STYLE`). **T** cycles gas -> volume -> rings
  and prints the style to the output.
- Body = 200 soft cloud puffs (164 body + 36 faint surface tatters). There are no crisp slices,
  capsules or fixed rows. Puffs are spread along the funnel by arc length (a golden-ratio
  sequence, so a leaning rope gets as many as an upright stovepipe) and across it (an R2
  sequence). They all rise with the surface flow and each turns at the flow speed at its height.
  Nothing sits at fixed heights, so there is no periodic stacking to band.
- Body puffs sit inside 0.42 rc and are about 2.1 rc wide, so their soft edges meet at about rc.
  At 0.55 rc and 1.6 rc wide each puff bulged the outline (cauliflower).
- Opacity per puff: the funnel's target A (the same condensed floor, two-celled thinning and life
  as volume) is shared among the puffs that cover a point. That count comes from their area over
  (2 rc x the arc spacing x on-screen foreshortening), with GAS_K = 1.8 for random overlap.
- Shading is even (sun by the outward normal, a little darker inside). Per-puff brightness spread
  made light blotches.
- Texture: `gasPuffSheet` (rbxassetid://95569256182807), a 2x2 sheet of soft puffs with broad
  billowy edges and only broad inner variation (a grainy sheet drew a blotchy column before).
  Generator: `tools/smoke/gas_puff.py`. Each puff keeps one frame for life (no image swaps).
- Seen in Studio: stovepipe (25 degrees up), rope and cone. All are soft-edged and opaque, with
  no bands; the rope bends smoothly.
- Not yet checked: the full X / Shift+X surveys, close range, night lighting, and frame cost
  against volume.

## Round 13j - open-items pass (2026-10-30)

Gas tornado checks:
- Elevation sweep on the stovepipe at 35 degrees (the old banding angle): ripple 0.27 grey levels even
  with the contrast pushed hard, so no bands. 58 and 74 degrees are smooth too.
- Close view under the rim: soft, with no square card edges.
- Night (new **F6** key = the panel's night setting): a soft dark silhouette. A lightning flash was
  not caught; it uses the same colour path as daylight.
- Frame cost (script time): gas 0.58 ms vs volume 0.88 ms, both 200 cards.
- Fix: the 36 surface tatters showed as light dots where the funnel flares into the dark lowering.
  They now fade out with the flare, and their shade is capped at the body's.

Overhead deck (BaseDeck + CardPlan):
- The discs now only cover the steep patch over the camera: out to `DECK.steep` (1.7) times the
  base's height, about 30 degrees up, where billboards stand up as walls. Out to the full 5.5 km
  range they showed as hard-edged flat plates from outside the base.
- The patch's outer grid step is soft edge discs: see-through parts with an unlit SurfaceGui on the
  underside showing `deckEdge` (rbxassetid://115445826136912, `tools/smoke/deck_edge.py`). They
  sit lowest, so the soft edge draws over the solid discs' rims.
- Base grid cards are judged against the patch by their centre (`m` in CardPlan). Well inside:
  left out. Inside, past the soft ring: lifted above (hidden). Just outside the edge: hung wholly
  below, so they draw in front of it.
- The wall-cloud hole (no discs within 1.15 R + half a disc) now reaches CardPlan through
  `CardPlan.planHole`, set by StormCards before each re-plan. Base cards were being left out
  there as if discs covered it.
- The small lumps under the base shrank to 350 m out to the whole deck range and read as crisp dark
  ovals. Now they shrink only in the patch and fade out over 0.45-0.85 of it.

Still open:
- Blue sky right behind the wall cloud (view 6 of the X survey). It is probably the RFD clear slot,
  which is meant to be there. Whether the wall cloud should look joined to the base around it is
  for the user to decide.
- Directly under the base away from a wall cloud was not looked at after the patch change.
- Disc vs card colour mismatch: much less visible now that the discs are a small overhead patch with
  a soft edge; not measured.
- Follow-up: hanging the patch-edge base cards below the deck (part of 13j) put km-wide cards under
  the base, and from a distance they drew a cloud wall in front of the tornado (user report).
  Removed. Cards that reach the solid discs sit above them, the rest stay at base height, and the
  soft edge discs hide the patch's edge.
- Follow-up 2: the stovepipe was still hidden at spawn (user). Cause: limiting the discs to the steep
  patch overhead brought the big billboard base cards back 1-5 km from the camera, hanging under the
  base as a wall. The discs cover the full deck range again, with the soft edge ring kept. Only the
  small base lumps stay limited to overhead: they fade out over 0.45-0.85 of DECK.steep x the base
  height, so the dark ovals don't return. Checked at spawn, +8 s and +18 s: the funnel stays clear.

### Round 14a: precipitation released by fall-out physics (positioning plan item 1, 2026-10-30)

`Storm.emitPrecip` no longer paints where precipitation leaves the storm. Removed: the release
direction (downshear + 0.3 rad ± N(0.4) at 1.1-1.8 ru), the ±1.75 rad V-notch spread aloft and the
prescribed hook spiral. Now (docs/stormlab/research/POSITIONING-PLAN.md 3.1):
- a particle crosses the updraft on the storm-relative wind at its height and falls out where the
  updraft drops to its fall speed, r* = ru sqrt(ln(W f / vt)) (rain farther out than big hail);
  the chord it crosses on is weighted by the updraft's mass flux, so the exits form a crescent;
- nothing falls out inside the vault (BWER): r* >= 1.1 ru. Measured: from 0.6 ru, 4 cm hail fell on
  the low-level updraft, melting chilled the inflow (CAPE 0 at the inflow point) and the storm
  collapsed within 5 min;
- while crossing, the mesocyclone's rotation carries it round by v_theta/r x crossing time. Not
  for the low-level share: the low meso's own winds wrap that one as it falls (the hook).
- The old release is kept for A/B as `Storm.PRECIP_RELEASE = "angles"`; `tools/stormlab/diag_release.luau`
  prints storm C001 every 5 min (W, CAPE, rain-core and hail-core bearing and distance from the LLM).
  `diag_layout.luau` gained hail-core, neighbour-storm and near-core rows, and is pinned to C001.

Results (Supercell scenario, C001, 1 h; bearing from motion, - = left):

| | before | after | research |
|---|---|---|---|
| rain core within 15 km of the updraft | -1..-24 deg, 8-10 km | -20..-32 deg, 6-9 km | -60..+10, 5-20 km |
| hail core (>= 1 cm, low level) | -9..+15 deg, 7-10 km | -23..-41 deg, 3-6 km | -100..-20, 2-4 km |
| updraft W | 55-56 m/s | 55-59 m/s | |
| largest hail | 4.2-4.5 cm | 4.2-5.1 cm | |

The "28 deg right at 12.9 km" rain core in the old layout run was mostly a neighbour's rain inside the
30 km box (C002 and later C004), not this storm's rain on the wrong side. Not checked in Studio yet.

Studio check of 14a (2026-10-30): Supercell scenario and the stovepipe scene run with no errors;
rain shafts sit behind and beside the tornado, the funnel stays clear, the storm holds steady.

### Round 14b: wall-cloud lowering from physics, not the cap (positioning plan item 2, 2026-10-30)

The lowering formula (mixed-parcel LCL + vlow^2/g) was already physical, but it came out at
~0.6 x the base every time. Cause: once the outflow was over 2.5 K it was taken in at the full 0.6
share, and being saturated, the lowering was 0.6 x 125 x spread = 0.6 x the base.
- **Ingestion now depends on lift** (`Storm.luau`, wall-cloud block). Outflow air is negatively
  buoyant: NB ~ 1/2 g (dF/theta) h over the cold pool's depth (`ColdPool.depthOf`). The lift
  against it is the low meso's pressure deficit (vlow^2) plus the updraft's pull at the base (w_b^2/2);
  share = 0.6 x ramp(dF) x lift/(lift + NB). A cold, deep outflow is undercut; a 1-3 K one is taken
  in ("intermediate cold pools are best"; tornadic storms <~ 2-4 K near the meso, Markowski 2002).
- **The updraft's pull at the base** uses the inflow's arrival speed at the base (s.fBase, smooth).
  The profile itself has a break there: in the cloud the speed restarts from zero (0.22 -> 0.04 across
  the base). Making it continuous (w^2 = w_base^2 + 2 int B) was tried and reverted: it doubled the
  squall line's tornadoes (17 -> 56 in 2 h, most EF5), because the tornado supply (World.parentOf,
  wLow = W f(1000)) is calibrated on the broken profile. Marked KNOWN ISSUE in Storm.luau; fix it with
  the tornado refit (plan item 5).
- The 0.6 x base cap is now a 0.85 x base safety limit.
- `diag_wallcloud.luau` prints the terms (mix, dyn, dF, share, NB, lift); `Storm` keeps them as
  s.lowMix/lowDyn/lowDF/lowShare/lowNB/lowLift.

| | before | after | research |
|---|---|---|---|
| Supercell C001 lowering | 800-990 m (~0.6 base) | 400-580 m, steady | 100-800 m (~0.5 km example) |
| Squall-line day (bases 150-700 m) | | 10-490 m, wall 20-680 m AGL | moist day: hangs near the ground |
| Supercell C001 W / rain / hail | | unchanged (50-60 m/s, -20..-33 deg, -21..-36 deg) | |

Lab scenes that pin `lowering` (VisualTests) are unaffected. Not yet looked at in Studio.

### Round 14c: funnel base and pressure factor checked (positioning plan item 3, 2026-10-30)

No change needed. `tools/stormlab/diag_funnel.luau` (new) prints each free-running tornado's strength,
core, cloud base and how far its condensation funnel reaches down.
- **Funnel base:** already the local wall-cloud base. World.parentOf passes s.wallBase, the tornado
  relaxes to it over 60 s, and the client draws the funnel up to it, where the wall cloud's underside
  is.
- **Pressure factor 2.06 rho vc^2:** it is the exact integral of the sim's own wind profile (Wood-White,
  fed tail R^-0.6). The research's 1.33 is a different profile, and swapping only the pressure would
  break cyclostrophic balance with the winds.
- **Funnels are not too long.** Squall line, 2 h, 23 tornadoes; average share of the way down from the
  base: EF0 6%, EF1 19%, EF2 74%, EF3 89%, EF4-5 98%. That is weak tornadoes as partial funnels over
  dust, strong ones condensed to the ground, as in the research.
- **They can be fat at low bases:** the ground condensation radius is typically ~2 rc, but up to 4-8 rc
  for the strongest tornadoes under ~150-300 m bases. Observed funnels are usually no wider than the
  core. The client already caps the drawn funnel at 3 rc (StateAdapter), so this is not visible.
- The free-running Supercell scenario makes no tornadoes in 2 h, with or without today's changes
  (low-level meso only 5-10 m/s). In Studio its tornadoes come from the scenes.

Studio check of 14b/14c (2026-10-30): no errors, but not visible there. Every test scene pins its
own lowering (VisualTests storm.lowering, applied each step), and the default engine-driven storms
are far off and barely rotating.

### Round 14d: item 4 started, blocked by the cold pool (2026-10-30)

Stage 1 done: **rear-flank air tracer.** Precipitation from the storm's low-level (hook) share
carries origin 1 (Precip.po). Its evaporation, melting and downdrafts mark the cold air they make
(ColdPool.R, 0..1: the share of the cold air that came down at the rear), and R is carried with
the pool. Precip.rainRateR is the rear share of the surface rain. Nothing reads R yet.
`tools/stormlab/diag_fronts.luau` maps the cold pool round C001 (f forward-flank air, r rear-flank
air, U updraft, L low meso), with the motion up the page.

Stopped before stage 2 (the low meso placed at the triple point), because the map shows **the storm
inside its own cold pool**:
- by 40 min every cell within 15 km is cold air, the updraft included; the deficit at the low meso is
  5-6 K (tornadic storms: <~ 2 K), which caps vlow at 5-6 m/s (fCold) - the reason the free
  Supercell scenario never makes a tornado. The same happens with the old precipitation release;
- **no sharp front:** from the LLM toward the inflow the deficit falls 5.7 -> 4.7 -> 3.3 -> 1.9 -> 0.9 K
  over 8 km, where a gust front is a 1-2 km edge with warm air at the updraft;
- **the cause:** the downdraft target (ColdPool.downdrafts) is the environment's DCAPE parcel
  (Thermo ddDeficit: saturated descent from the lowest theta-e level, no mixing) = 13-20 K below
  the surface air here (mean 17 K), applied in full at 30 mm/h and a quarter of it at 4 mm/h. Real
  downdrafts are subsaturated and entrain, so observed outflows are 2-6 K (max ~10). The pool reaches
  9-10 K, and the 2 km grid's smoothing (0.04 Laplacian a step) spreads it under the updraft.

Proposed next (needs the user's go-ahead: it changes every lab storm, the squall line's gust front
and bowing too):
1. Downdraft arrival temperature from a subsaturated, entraining descent instead of the saturated
   parcel (evaporation limited by the rain water present, Srivastava 1985/1987; Kamburova & Ludlam
   1966), targeting 2-6 K forward-flank outflow;
2. a sharper front: less smoothing, or a 1 km pool near storms;
3. then stage 2: the low meso at the triple point, occlusion from the rear-flank air wrapping round it.

## Round 14e (2026-10-30): cold pool step 1 done, step 2 tried

**Downdrafts (step 1, in).** `Thermo.downdraftArrival` (subsaturated, entraining descent from the
lowest-θe level, Klemp-Wilhelmson evaporation) sets the pool's target, stored as `dd5/dd20/dd60`
and interpolated in rain rate. `ColdPool.SATURATED = true` restores the old saturated target.
Supercell pool max 5-6 K (was 8-10), deficit at the low meso 3-4 K (was 5-6); squall line max
4-4.6 K (was 6-7).

**Parcel bug found and fixed (Thermo.lift).** A surface parcel that was already buoyant below its
LCL (a hot superadiabatic surface layer) never got an LFC: CAPE 0 and CIN ~-3400 J/kg, flipping
to ~3900 J/kg CAPE under a 0.05 K change. This was C001's "collapse" at 22-40 min (W 60 -> 10).
Now the LFC is the LCL in that case. C001 holds W 56-60 for the whole hour.
Side effect: surface CAPE now shows that layer, so the Supercell day started 10-16 storms. Initiation
and squall-line regeneration now use the mixed-layer parcel (`mlcape`/`mlcin`, matching the `lfc`
field, which was already mixed-layer): back to 5 storms.

**Sharper gust front (step 2, not solved).** Measured with `diag_fronts.luau` (now prints the
deficit in K) and `diag_coldpool.luau`:
- smoothing as a diffusivity (`ColdPool.MIX_K`, m²/s; default 8000 = the old 0.04/step): 2000 and
  500 change nothing visible;
- a 1 km grid (`ColdPool.DX`): no sharper, 4x the cost;
- the pool carried by the full low-level wind (`ColdPool.ENV_K` 1, default 0.5): the pool moves off
  the storm (deficit at the low meso 1.7 K at 20 min) but neighbours' pools then fill the inflow
  side with 2-3 K by 40 min, and the Supercell day starts 9 storms.
Conclusion: the broad 4-5 K blob comes from where the cooling is laid down (rain spread 6-9 km
round the core), not from smoothing or grid size. A sharp edge needs the gust front carried as a
density current with its own head, not a smeared field. Defaults left as before.

**Side effect still open:** squall-line tornadoes 64 in 2 h vs 26 with saturated downdrafts (the
tornado tuning was done against the over-cold pool). Goes with item 5's refit.

Tools: `diag_coldpool.luau` (pool stats, MODE new/old), `diag_fronts.luau` (deficit map).

**Round 14e, continued (same day): two more gust-front tries, neither changes the picture.**
- Bounded Catmull-Rom resampling for moving the pool (`Grid.sampleCubic`, `ColdPool.CUBIC`):
  bilinear resampling a tenth of a cell per 20 s step smears like ~9000 m²/s, so this should have
  sharpened the edge. Edges went from ~10 km to ~8 km wide; the low meso still sits in 3-4 K air.
  Left off (option kept).
- Front speed from the local depth instead of the pool behind it (deep air catching up with the
  head, as in a real density current): no visible change. Removed.
Reading of all five tries: the edge is about 1 K per 2 km cell, not unrealistic for a forward-flank
gust front. The low meso sits in 3-4 K air because rain falls 6-9 km ahead-left of the updraft and
the updraft's track runs through the edge of that rain swath. Observed tornadic supercells mostly
have rear-flank deficits under ~3 K (Markowski et al. 2002), so 3-4 K is at the cold end, not
wildly off. Recommendation: stop chasing the front's sharpness and move to item 4 stage 2 (triple
point from the existing 1 K contour plus the R field).

## Round 14f (2026-10-30): item 4 stage 2 - rear-flank air in, triple-point placement not adopted

**Rear-flank downdraft air into the cold pool (in).** Before, the RFD only made wind; the pool had
no rear-flank air at all. Now `Storm.step` sends it down through `Thermo.downdraftArrival` (new
optional args: forced descent speed, dry start) from 1.5 km at the RFD's speed, cooled only by the
hook's rain, and `ColdPool.addDowndraft` replaces the pool's air under it (warmer or colder,
R -> 1). `Storm.RFD_AIR = false` turns it off.
Result: the RFD air arrives at 0-0.2 K (dry-adiabatic from a well-mixed boundary layer, hook rain
1.5-10 mm/h): a slightly warmer (~2 K) slot and trail behind the low meso inside the 3-4 K
forward-flank air, as observed (tornadic RFDs <= 2 K, Markowski et al. 2002). Deficit at the low
meso 3.0 K (was 3.6), vlow 12 (was 10). Squall-line tornadoes 78 in 2 h (was 64): warmer RFDs help
genesis - for item 5's refit.

**Field-placed low meso (tested, not adopted).** `tools/stormlab/diag_triple.luau` scores points
round C001 by baroclinity x updraft footprint x warmth. The best point is always just right of the
updraft (bearing -90 deg, 0.15-0.3 Ru: the inflow-side pool edge), not at the rear (observed and
current: ~150-160 deg). The rear-flank gust front is a wind boundary (the RFD's momentum), not a
temperature one, so baroclinity can't find the triple point.
Checked instead: the mid-level storm-relative wind (where the RFD comes from) blows from 175-180 deg
on both lab days; the fixed lowAngle is 158 deg (rear, slightly left), within ~20 deg of it and of
the research. Recommendation: keep lowAngle; if it must come from fields, tie it to that wind's
bearing. Occlusion stays RFD-driven as before.

## Round 15a (2026-10-30): item 5 measured - core size already on target

`tools/stormlab/diag_core.luau` (2 h of each lab day, all free tornadoes): squall line 84 tornadoes,
median core radius 99 m (per-tornado life medians 78-145 m, peaks 127-183 m). The target was a
100-150 m median, so the physics is about there; any "too small" look is in the drawing (the
condensation funnel is narrower than the core), not the sim. The problems the run does show:
- counts: 84 in 2 h on the squall line, many with peak core wind 9-13 m/s (below EF0's ~29 m/s);
- extremes: peaks up to 117 m/s;
- the Supercell day makes no tornado of its own in 2 h.
These are the refit (counts, strengths, the updraft profile break and wLow), not the core size.

## Round 15b (2026-10-30): tornado refit - counts and strengths

Lab-only (free-running storms; engine-led tornadoes keep the engine's rating). Measured with
`diag_genesis.luau` (genesis terms per storm) and `diag_core.luau` (now also EF counts and peak
ground wind / parent vlow).

**Why the Supercell day makes no tornado: correct.** Its own data has median LCL 2000 m and
median STP 0; the genesis drive stays 0.1-0.7 (needs 0.8). The day's only tornado is the engine's.

**Counts: one chance per occlusion cycle (`Storm.genesisTry`).** Before, every circulation that
organised (G >= 1) made a tornado: on the squall-line day all ~35 rotating cells did, 84 in 2 h.
Now each gets one draw per cycle with odds from its strength, `Storm.genesisChance` = 0.6 x
ramp(vlow, 10, 35) (~12% at 15 m/s, 36% at 25, 60% at 35). The shape follows Trapp et al. 2005
(about a quarter of mesocyclones tornadic) and Smith et al. 2015 / Thompson et al. 2017 (odds rise
with low-level Vrot); approximate, because the papers' tables could not be read here. Draws are
seeded by storm and cycle. Squall line: 7 tornadoes in 2 h. `Storm.GENESIS_ODDS = false` restores
the old rule.

**Strength: `Tornado.VC_EFF` 0.42.** The core ran to 2.2x the parent's low-level spin (80-117 m/s
at vlow 20-27), and 30 of 84 tornadoes rated EF5. An efficiency on the contraction spin-up,
calibrated to the radar relation (peak ground wind ~2x Vrot, Thompson et al. 2017, approximate).
All-tornado sample (old genesis rule, 86): EF0 47%, EF1 19%, EF2 21%, EF3 8%, EF4 5%, EF5 0
(was EF5 36%); median peak wind / vlow 1.7. With the new rule, 7 tornadoes: 3 EF0, 2 EF1, 2 EF2.

**Visual cost:** weaker cores mean shallower pressure drops, so condensation funnels reach less far
down. Squall line: EF0 ~5%, EF1 15-24%, EF2 37-61%, EF3 80% of the way down. Before, most lab
tornadoes were violent and funnels reached 94-99%. Weak tornadoes often show only partial funnels
over a debris whirl in reality, but on this low-LCL day more would usually reach the ground.
Engine-led tornadoes (the main game) are not affected.

## Round 13k (2026-10-30): gas tornado at 500 billboards

User: raise the tornado budget from ~200 to 500 billboards to make it look better.
`Render/TornadoCards` gas style now draws 500 a tornado:
- body puffs 164 -> 250, edge tatters 36 -> 52 (`NGAS` 302 incl. tatters). The opacity share per puff
  scales with the count, so the funnel is just as opaque but smoother and less blotchy;
- **surface lumps** (`NLUMP` 110, new): smaller gas puffs just under the surface (0.7 rc), carried
  round by the flow and bulging together on one noise field read at the flow's own coordinates.
  Shaded about the body's own shade (bulges lighter, hollows darker) and faded toward the sides,
  so they add rolling relief without bumping the outline. (Lit brighter than the body on average,
  the first try drew pale round blotches.)
- **striations** (`NSTRI` 70, new): faint `wispSheetFlat` streaks along the flow (turn + rise) on
  the middle of the near face, the volume style's wisps in the gas body;
- condensation tags 18, unchanged. Detail layers hide beyond 9 km (a few pixels each).
- **Shift+T** turns the two detail layers on/off for A/B.
- Seen in Studio (stovepipe and cone): the layers give the upper funnel visible rolling relief;
  the striations are subtle at scene range. Script time ~1.4 ms a frame (was 0.58 ms at 200).
- Studio check needed a temporary `Tornado.VC_EFF = 1` (removed after): since the item 5 refit
  (VC_EFF 0.42) the stovepipe/wedge/tube scenes come out at vc 21-26 m/s and barely condense, so
  scenes 3, 4 and K show almost no funnel. Their pins (vlow) predate the refit.
- Pale grainy blotches on the funnel (stovepipe and cone) show with the detail layers off too:
  another layer (wall cloud, scud or dust), not the funnel cards. Not chased.

## Round 13l (2026-10-30): less murk - directional sky light, thinner edges, dust hidden in the funnel

From a pasted review of the 500-card tornado: shape is right, but it is murky - one even dark grey
with no separation between funnel, wall cloud and inflow band. Geometry left alone; changes are to
light and optical depth:
- **`SceneLight.skyDir(ctx, x, y, z)`** (new): where the sky light comes from. Marches the storm
  shapes (as the sun test) along 16 headings at 4 and 15 degrees up, each weighted by the rain the
  low light crosses in the first 8 km (`Precip.surface`, `C.rainExtinction`). Returns the light's
  heading and how one-sided it is (aniso). The storm shapes alone gave aniso 0.04 (discs round each
  storm: even all round); with the rain, 0.58 on the stovepipe scene (dark toward the rain core,
  bright toward the clear rear).
- **Funnel** (TornadoCards gas): sky light x (1 + 0.85 aniso (n . d)) on body, lumps and striations;
  lumps have more light/dark range (darker masses, lit turbulent regions); the outer body
  (q 0.26-0.42) is up to 35% thinner on a noise field turning with the flow (translucent,
  irregular edges, dense core kept). The F4 counter shows `sky side` (aniso) and `sun`.
- **Wall cloud** (WallStream): outline pieces 0.55 + 1.5 depth (were 0.9 + 1.2), fringe 0.32 (was
  0.45): thinner outer region, dark middle kept; sides lit by the sky direction (fading inward).
- **Inflow band** (WallStream tail): lobes from a noise read at each puff's place in the inflow air
  (fixed for life, so lobes travel in with the air): thickness 0.65-1.35x, lobes bulge up and sag
  under, gaps where the noise is low (closed in the last 25% before the wall cloud), lit by the
  sky direction, lobe tops lighter.
- **Dust** (TornadoDust): the grainy pale patches on the funnel were dust (gone with the dust layer
  off). Dust whose centre is inside the condensed funnel at its height is now hidden (faded over
  a quarter of the puff's size either side of the condensed radius). Lofted dust outside the
  funnel still shows as lighter puffs beside it (the debris cloud).
- Seen in Studio (stovepipe, VC_EFF now off by default): dark core, lighter rolling lobes, a lit
  side, softer edges. Open: a few lobes near the top still read as separate round blobs; the
  inflow band was not looked at closely; the review's sunlit-vs-dark-storm question not tested
  (scene sun share 0.08 here).

## Round 13m (2026-10-30): sunlit tornado test

New scene **S "Stovepipe, low sun"** (key **G** with the F4 panel open): the stovepipe storm at
18:24 local (sun ~7 deg up; the lab scenario's sunset is 19:00, not 20:00), camera west of the
tornado (yaw 180) with the sun behind it. Higher suns are blocked by SceneLight's storm shapes.
Result (direct-sun share on the funnel 0.25, sky side 0.57):
- the dust and the inflow band / outer clouds take the low sun well: warm tan dust, lit cloud edges;
- the wall cloud and the base round the funnel stay a near-black mass, and the funnel's top blends
  into that colour (TornadoCards lerps toward `stormBase.col` near the base), so the upper funnel
  is lost in it. Murk in sun = lighting, not opacity.
- Cause: SceneLight / Render/Sky shade storms with a symmetric base disc of 2.5 Ru (~6.5 km) round
  each storm at base+200 m. A low sun reaching the lowering from the rear crosses that disc, so
  `lit` at the wall cloud is ~0. Real supercells have a short, often clear rear side (RFD clear
  slot) through which a low sun lights the wall cloud's sides.
- Proposed next: make the base disc's extent follow the storm's fields (downshear/forward-flank
  long, rear side short, cut by the RFD), in SceneLight and Render/Sky together. Not done.

**Round 15b, revised the same day (user: the lab should make tornadoes; realism of counts and
strengths doesn't matter there; the lab work is about visible storm structure).**
- Both trims are now OFF by default, kept as options: `Storm.GENESIS_ODDS = true` (one draw per
  cycle) and `Tornado.VC_EFF = 0.42` (calibrated strength). Strong lab tornadoes keep their full
  funnels.
- New lab genesis boost, `LabConfig.GENESIS_EASE` = 3, set as `Storm.GENESIS_EASE` by the lab
  server. It lifts weak genesis drives (x3, up to 1.5) and leaves strong ones alone.
  "Own" mode, 2 h: Supercell 5 tornadoes (was 0; 2 rated EF5), squall line 99 (was 84).
  "Engine" mode (the default) is unchanged: the engine's tornadoes.

### Round 13m fix (same day): storm base footprint from the storm's fields
`SceneLight.baseCover(s, px, py, k)`: the base runs forward past the rain core (ffd), ends ~0.45 Ru
behind the low-level mesocyclone at the rear, and the RFD (rfdX/rfdY, strength `rfd`) cuts a clear
slot. Used for the base level of SceneLight's sun test and Render/Sky's sun ray + overhead cover
(the tower and anvil shapes are unchanged; StormCards' own deck already had a slot).
- Low-sun scene (G): sun on the funnel 0.25 -> 0.97; funnel and wall cloud now lit warm brown,
  the base's underside still dark (right).
- Afternoon stovepipe (3): sun 0.61, sky side 0.69, looks as before with lit gaps in the base.

## Round 13n (2026-10-30): murk fixes - shade gradient, fewer body layers, top blend, backlit rim
Diagnosis: each of the 250 body puffs spans the whole funnel and was shaded by its own centre's
angle, so lit and shadowed puffs overlapped everywhere into flat grey; many faint layers also
averaged away texture and used only the bottom alpha steps.
- Each gas body card carries a UIGradient (7 points across it, along the axis-perpendicular on
  screen): the column's light profile - cylinder normal vs sun, directional sky, and a forward-
  scatter rim when backlit. ImageColor3 = brightest point, gradient = ratios (1/32, shared seqs).
- Budget split: body 250 -> 150 (+52 tatters), lumps 110 -> 160, striations 70 -> 120 (482 total).
- Upper-funnel blend toward the lowering's colour 0.9 -> 0.5.
- Result: a lit and a shadowed side read on the afternoon stovepipe (3) and the low-sun scene (G);
  TornadoCards ~2.1-2.3 ms (was ~1.6).
- Not done: new detailed / pre-lit puff texture (needs a Blender bake + upload); dust 256 px frames.

### Round 13n part 2: detailed puff textures + dust sheet
- tools/smoke/gas_puff2.py: four separate 1024 px puffs (gasPuff2A-D in LabConfig): blended
  gaussian billows, a frayed multi-octave fringe, direction-free relief (AO from thickness). Used
  by the gas body + lumps via setPuffTex (falls back to gasPuffSheet).
- tools/smoke/dust_wisp2.py: 2x2 x 512 broad smooth dust wisps (dustWisp2), replacing the 4x4
  wispFlat (256 px frames, the grainy patches) for tornado dust in TornadoDust.
- Studio (3 and G): funnel more defined and textured, lit/shadow sides kept; dust smooth, no grain.
  TornadoCards ~2.4 ms. Not rechecked: cone, rope, wedge.

## Round 13o (2026-10-30): scene-by-scene fixes (multi-vortex, wedge, cone)
Review of all scenes: rope + stovepipe good; multi-vortex drew its sub-vortices as straight glassy
planks, the wedge was invisible in rain (sight 0.09), the cone had a pale crown and no edge.
- Sub-vortices: soft gas puffs (setPuffTex) instead of the crisp slice; 8-24 short pieces up the
  helix (was 6-16 long ones); each piece overlaps the next, opacity shared over the overlap,
  target x1.5 and darker colour. Now dark smoky tubes curving up through the dust.
- Wedge scene (4): Ru 6000 -> 4500, pinned pw 12 / rhMid 0.2 (drier: less rain), camera 3 km.
  Sight 0.09 -> 0.44: a broad dark wedge under the lowering (low contrast still).
- Cone: surface lumps fully faded in the flare (was 30% left) and their bulges no brighter than the
  body: the pale crown is gone, a clean dark cone.
- Pale ring-shaped blobs seen beside the multi-vortex are storm inflow puffs (not tornado cards).
Open: storm-cloud renderer look (hard blobs, speckled edges, blue streaks, star-like dots seen on
dark cloud and ground in the wedge scene); dust not wrapping the funnel foot; rope lighting.

## Round 13p (2026-10-30): tornado outline - transparency cut at the funnel edge
Cause (measured, tmp sim): the body puffs' summed soft falloffs spread the edge from 0.6 to 1.1 rc
(90%->10% opacity); a real condensation funnel (optical depth ~13 across) goes clear within ~0.02 rc.
- Each gas body card's UIGradient now also carries Transparency: clear outside the funnel's edges
  x = +-1 (as seen, across the axis), ramp half-width EDGE_FADE 0.035 rc, softened where the
  funnel is thin (+0.35 (1-A)) and where it widens into the lowering (+0.6 flare). Edge wobble
  EDGE_WOB 0.1 rc, two octaves along the funnel, drifting in time.
- Body cards 2.8 rc wide (dense where they reach the edge), 0.62-0.78 as tall; the image turns
  with the axis (0/180 deg) so the gradient maps exactly across the card.
- Outer 35% noise thinning removed (it smeared the edge).
- Studio: stovepipe (3) and cone (2) show a defined, slightly ragged outline; top dissolves into
  the base. TornadoCards ~2.3-2.7 ms. Rope not rechecked.

## Round 13q (2026-10-30): outline contrast against what is behind + rope/wedge/multi-vortex review
- TornadoCards gas body: per row and side, bgBehind() follows the sight line past the edge -
  into the parent storm's base where SceneLight.baseCover reaches (base.col luminance), else the
  horizon haze (Lighting.Atmosphere colour), or the ground. The outer rim (|x| > 0.62) is kept
  EDGE_SEP 0.25 apart in brightness from it (darker against bright sky, lighter against the
  base); off where the funnel flares into the lowering. No errors; stovepipe edges read darker.
- Review (no changes):
  - Rope: clean S silhouette; flat grey hose (no lit side), jagged at the sharp low bend, beaded
    tip, dust off to one side instead of at the tip.
  - Wedge: nearly invisible up close - same tone as base and rain haze (rain grey 0.44, sight
    0.57), sides soft (flare softening covers most of a squat wedge), no ground contact but a
    dust strip. White specks on dark cloud/ground persist.
  - Multi-vortex: sub-vortices invisible (50 subs at op 0.22, dark on a dark, sunless scene
    SkyDirect 0.04); parent shell gone; reads as a dust curtain under a dark lump.

## Round 13r (2026-10-31): high-angle "stamp roll" + wedge/multi-vortex/rope fixes
High (C/orbit) view of the stovepipe showed two things:
- Dust broke into strips with hard horizontal edges. Cause: a billboard is a flat camera-facing
  card; seen from above, the part below the ground is hidden along a straight screen line, at a
  different height per card. Fix (TornadoDust): each dust card fades out (UIGradient, 0.22 of
  the card) above the line where its plane meets the ground, (height above ground)/camUp.Y below
  its centre; wisps kept near level (0/180 +-12 deg) so the fade runs down the card as seen.
- Pale dashes stacked up the funnel like a loosened roll of stamps = the striation detail
  layer (gone with Shift+T): straight lenses lit paler than the body. Fix: body's own light with
  a +-13% relief (half ridges, half grooves), opacity cap 0.35 -> 0.22, thinner (0.16 of length)
  and longer.
Other fixes (TornadoCards unless noted):
- bgBehind/sepFrom moved up so the sub-vortices share them; background now seen through rain
  and haze (e.wrap extinction + 0.04/km) both toward the base and toward the ground (a dipping
  sight line meets far ground = haze). Wedge's lower funnel now a dark column against the rain
  haze (rain grey 0.63, sight 0.31 there - still a heavily rain-wrapped wedge).
- Multi-vortex: sub-vortex tubes kept EDGE_SEP from their background (dark columns now show);
  parent shell floor A >= 0.3 thin (faint envelope).
- Rope: body cards >= 2.4 puff spacings along the axis (tip no longer beads) and no longer than
  the on-screen bend allows (edge cut off the curve <= 0.1 rc); TornadoDust lifts dust at the
  vortex but places it about the drawn foot (Vortex.axisAt(e, 0)): dust now round the tip.
Open: rope sides slightly furry (tatters at small rc); sub-vortex tubes soft smudges; the
lowering above the wedge is StormCards' lumpy mass.

## Round 13s (2026-10-31): funnel shape + tornado dust
Funnel "loosened stamp roll" and uneven widening, seen up close: each body card was ~0.6-0.8 of
its width tall with a straight edge cut, so a sloping or bending outline became a stack of
straight steps (silhouette test: 2 rc cards mean edge error 0.41 rc, max 2.4 rc; 0.4 rc cards
0.05 / 0.37). Fixes (TornadoCards):
- Body cards short: height rc*(0.32+0.14 sd), but at least 5 puff spacings along the axis (at
  2.4 a thin section showed separate plates) and no taller than the on-screen bend allows.
- Edge wobble 0.1 -> 0.06; lumps toned down (opacity 0.24 -> 0.15, cap 0.35 -> 0.2, shading
  nearer the body's) and narrowed to ~0.5 rc (at ~1 rc they showed as dark plates past a
  narrowing funnel's outline).
Dust (TornadoDust), from photo/radar studies of the debris cloud: hollow ring, 2-6 funnel
widths, densest at the ground, bell/collar shape, dark when backlit.
- Skirt puffs (70%): 1-2.5 rc, big (1.1 rc, 20-260), low. Collar puffs (30%): on the rim
  0.9-1.3 rc, 0.6 rc, lifted up to ~1/4 of the cloud base (scaled by vc), faster rise.
- Tornado dust denser low (x1.5, thinning with height over 0.08 of the cloud base), cap 0.55
  -> 0.8.
- Colour by sun view: gain 1.1 + 1.3*front (was always 2.4): tan front-lit, dark backlit.
Seen in Studio: stovepipe (chase + high orbit) and cone outlines smooth, no steps or shoulder,
fine streaks; dust a wide tan skirt round the base. Open: a soft dark bulge can still show on
one side of the lower stovepipe (body cards, not lumps); collar could rise more visibly.

## Round 13t (2026-10-31): outline ribbons - the funnel's banding fixed by design
Diagnosis (user: 13s banded worse; "maybe we shouldn't be using wide band cards"): every gas body
card spanned the whole funnel (2.8 rc) and cut its own piece of the outline, so card height was
the only knob and both ends banded - tall cards stepped on a taper or bend (13r "stamp roll"),
short ones needed ~95% opacity each (vs 76%: ~2 effective overlaps) so each showed as a stripe
and its end as a tooth on the edge (a comb, worst from the high C view). The same root sat under
the earlier banding rounds (13g, 13h, rope, rings, looking up). The flat slabs low on the 13s
funnel were the dust collar's streaky wisps (gone with dust off), not the funnel.
Redesign (TornadoCards; same 202-card body budget):
- Outline: NEDGE = 52 ribbons, 26 down each side. Each is tilted to its own side's slope on
  screen (edge points with wobble at both ends of its stretch), so the edge follows tapers and
  bends. Flat across: the gradient cuts the edge sharply outside and fades softly 0.15-0.35 rc
  past the axis, under the other side's ribbon. New texture funnel_ribbon.png
  (tools/smoke/funnel_ribbon.py, LabConfig funnelRibbon): full over the middle third, linear fade
  over the outer thirds; ribbons spaced a third of their length apart, each 1 - sqrt(1 - A), so
  cover is ~A everywhere. At the axis's depth; they fade out where the funnel is seen end-on
  (projL 0.2-0.45), where the fill takes back the edge.
- Fill: 98 cards (NGAS 150 incl. 52 tatters), tall (1.2-1.6 rc), faint (<= 0.35 each), cut softly
  at 0.75 of the edge - never touching the outline.
- Light-across-funnel code shared (frameAt / shadeX / edgesAt / opacityAt) so ribbons and fill
  agree; cutSeq takes separate left/right ramp widths.
- Dust collar (TornadoDust): 20% of puffs (was 30), up to 0.12 of cloud base (was 0.25), round
  soft texture, half opacity.
Seen in Studio: stovepipe chase and high orbit - clean continuous edge, no bands/comb/slabs; cone
- smooth taper, no steps; rope - one continuous strand; multi-vortex tubes still show.
Open: the body can read smooth/tube-like up close (texture now from fill + detail layers only);
slight corners where ribbon chords meet on the rope's tightest bends.

## Round 13u (2026-10-31): seam/dust/rope fixes, then the "smoke" style
After 13t: ribbon cost-spacing (jitter, an "inner core" from widened ribbons) and straight ribbon
chords on rope bends were diagnosed; the user then asked why texture was lost and how to match the
reference games. Diagnosis: the references (docs/tornado-reference) get texture and soft edges from
many faint fibrous smoke sprites riding the flow, not from cut outlines; our near-opaque blank
outline ribbons hid all texture, and every band/seam/jitter bug came from that outline geometry.
Built (TornadoCards style "smoke", now LabConfig.TORNADO_STYLE; T cycles smoke -> gas -> volume ->
rings; no inner core, per user):
- NSMB = 320 body sprites (wispyFlat 4x4 fibrous puffs), a stratified place along the funnel's
  length, rising with the surface flow (0.15 vc) and turning at the flow's rate; within 0.45 rc of
  the axis, ~2-2.4 rc wide (the puff fills ~0.7 of its frame, mean alpha 0.1), stretched along the
  axis up to 4:1 where the funnel is long (ropes). Opacity share 1-(1-A)^(10/nEff), nEff = sprites
  over a point (capped at all of them: a wedge is shorter than its sprites), at most 0.85. Each
  one flat colour: the column's light at its screen x, its normal turned 30% toward its own place
  round the axis (turning masses lighter/darker), +-7%.
- NSME = 100 edge sprites (strandsFlat), 50 a side at the silhouette, climbing 1.3x the body,
  wandering in/out by noise, faint (0.3 A), rim tone with a light sepFrom (0.3; 0.7 drew a solid
  dark stripe). Gone where their spacing would leave gaps (ropes) or the axis is end-on.
- Dust (TornadoDust): tornado puffs use the fibrous wispyFlat sheet (skirt and collar), darker
  grey-brown soil (104,94,80 -> 70,70,70 lofted), gain 0.85+0.95 front (was 1.1+1.3), collar
  opacity 0.75, skirt cap 0.2 of the puff size (0.12 made a smooth dome).
Seen in Studio: cone/stovepipe - fibrous soft-edged smoke with a lit and a shadow side; wedge -
solid dark mass with soft edges (as clip 11-01-22); rope - a smooth frayed chain of puffs, no
corners. Open: motion (jitter/sort flicker) not judged from stills; multi-vortex not checked; the
lower cone is still slightly see-through against the bright slot; dust still dome-shaped.

## Round 13v (2026-10-31): smoke style - edges out, tighter body, rope, dust
User review of 13u: edge funnels not needed, the core puffs too spread, the rope could be better.
Done one at a time, each checked in Studio:
1. Edge strands removed (they drew a dark band on the shadow side like a separate tube); 60 of their
   billboards went to the body: NSMB 380 (+18 tags = 398).
2. Tighter body: puff centres within 0.2 rc of the axis (was 0.45), puffs 1.6-1.85 rc wide (was
   2-2.4) so the fringe lands at the edge (it reached ~1.3 rc: a broad haze, no outline on the lit
   side). Tone across the funnel from each puff's screen side (x = offset / 0.2 rc), so the lit and
   shadow sides remain. Result: a clear frayed taper on both sides.
3. Rope: a puff's random tilt shrinks with its stretch ((h/w)^-1.5: ~3 deg at 4:1; 25 deg made a
   knobbly outline); thin funnels (rc < 8-30 m) take one even tone across (the per-puff place-round-
   axis tint and +-7% alternated as blotches). Result: a smooth, even, tapering frayed tube.
4. Dust (TornadoDust): 40% collar (more where the funnel is much thinner than the core), skirt within
   0.8-1.8 rc (was 1-2.5), sideways stretch 1+0.4 (was 0.8), per-puff height cap 0.15-0.4 of its size
   (one shared cap drew a flat top), size floor 6 m (was 20) and growth scaled by rc/60 (a rope's
   dust was a wide disc); the collar rings the funnel's condensed radius at 0.05 Hb, not the core
   (on a rope-out its few puffs floated round the core as specks). Result: cone - a taller lumpy
   ball wrapping the foot (sides still a little straight); rope - a small ragged mound at its tip.
Open: motion/sort flicker still to be judged live; multi-vortex and wedge not rechecked after the
tighter spread.

## Round 13w - smooth Severity body (2026-10-31)

User: the smoke was coarse, the rope looked like a snake; match the Severity references. Reference study:
their funnels and ropes are smooth, near one-tone soft blobs (fine texture 0.0008 on ref1); only the debris
ball is rough. Ours (fibrous wispyFlat puffs, full lit/shadow shading) measured 0.0092 on the cone body.
- Body texture: new soft haze puff (tools/haze_puff.py -> hazePuffFlat rbxassetid://72760570308893): flat
  white, gaussian falloff, broad lobing, no disc or rim. The smooth cloud puff (smoothPuffFlat) was tried
  first: its dense disc + darker rim drew arcs - a rope in rings.
- Sprites 3.4-3.8 rc wide, K 6, cap 0.45, ~8 over each point of the length, stretch at most 3:1.
- Shading near flat: 0.3 of the lit/shadow swing, no per-puff tint, ~8% darker off-axis (edge band).
- Result: cone body texture 0.0015, rope a smooth even tube. Dust not yet changed (next step).
- Follow-up (user: haze made the cone and stovepipe cloudy; the step-2 look was better): each body sprite
  picks its puff from how rope-like the funnel is where it sits (rc / funnel length, 0.04-0.1, each sprite
  changing over at its own point). Thick: smooth puff, 2.7-3 rc, K 3.5, cap 0.6, full lit/shadow shading
  and +-7% tint (the step-2 look). Rope: haze puff and near-flat shading. Checked cone, stovepipe, rope.

## Round 13x - ascending condensation filaments (2026-10-31)

User's research: cloud rising along the funnel's periphery on helical paths, upward speed varying
with radius and height. 
- Vortex.updraftAt(p, r, z): the steady axisymmetric updraft of Vortex.sample (no sub-vortices,
  gusts, translation). TornadoCards keeps it per row at 0.9 x the condensed radius (row.wUp).
  Typical w/vc at the edge: ~0.01-0.16 on a wide cone's flare (R 1.5-3), ~0.3-0.5 on a narrow
  rope/tip (R 0.3-1); ~0 in the lowest ~3h (corner flow) and above the cloud base.
- Smoke body climbs at the column's mean updraft (one rate: per-height rates would bunch puffs).
- 80 filaments (streakSoft rbxassetid://115060594741751, tools/streak_puff.py): each rides its own
  helix for 3-7 s (turn at the row's omega, climb at its wUp), ~1.3-1.8 rc long, body's shade +-6%,
  opacity <= 0.2, near face only (fade before the outline), 75% weaker on ropes. Shift+T toggles.
  Budget 380 + 80 + 18 = 478.
- Seen in Studio: soft spiral ribbons on the cone (flat on the wide upper part, steeper low down);
  rope stays smooth. Live motion not yet judged by the user.
