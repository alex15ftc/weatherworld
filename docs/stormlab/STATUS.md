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
- Dust (2026-10-31): tornado dust puffs 70% smooth puff (opacity x0.45, it covers ~2.5x its card),
  30% fibrous wispy for a frayed fringe. Seen: a soft dark lumpy debris ball (cone). Wedge seen: broad
  smooth soft-edged mass. Multi-vortex scene (EF2, rain-wrapped) barely condenses - nothing to judge.

## Round 13y - wedge edge, multi-vortex scene (2026-10-31)

- Wedge edge (user: too soft vs the stovepipe): cause - the wedge is ~350 m tall (base 350 m, rc 148,
  swirl 0.68, no two-cell thinning) and each smooth body puff was ~2.85 rc wide and ~as tall, taller
  than the funnel, so its outline averaged rims from every height. Puff height now <= 0.35 x funnel
  length; flatter than 2.5:1 it is narrowed and set out (rim ~0.34 w out kept at rc). Seen: a defined
  wedge outline.
- Dust: smooth puffs reset ImageRectOffset (a leftover sheet-frame offset drew a cropped corner, a
  hard-edged translucent box under the multi-vortex).
- Multi-vortex scene (user: a bowl lowering with filament vortices from the ground): Ru 8000 rained it
  out. Tried Ru 4500 (EF3 single vortex - swirl comes from circulation width), Ru 8000 + dry (still
  2000 t/s), W 24 / Ru 6000 / base 550 with vlow 22 (bowl over a big dust skirt - kept), 26 (murky), 30
  (condensed to the ground, a wedge). Sub-vortices at vc 37 don't condense (0.45 vc) and their dust
  tubes are lost in the parent's dust skirt. Filaments need renderer work - see the plan in chat.
- Open: pale round blobs at the ground under the tornado (seen in several captures, also before the
  dust change) - source not found yet (not lightning, debris parts or condensation tags).
- Dust gap at the ground (user): the ground fade (a gradient hiding each card below its ground line)
  ended exactly at the line and was lifted further by a fixed allowance for tilted cards, so the dust
  thinned just above the ground and the bright horizon showed through (stovepipe foot: brightness
  57 -> 65..154 in the last ~6 px). Now the line is placed on the tilted card's true screen extent
  (h|cos| + w|sin|) and the fade is centred on it. Seen: flat ~57 down to the ground row.

## Round 13z (2026-10-31): filaments from a flow field, horizontal vortices, sub-vortex dynamics
User's research: filaments are density concentrations carried by the flow, not laid-out helices;
multi-vortex = an unstable parent whose sub-vortices form, are carried, interact and decay.
- Filaments (TornadoCards, smoke style): one turbulence field `turb` carried by the flow (looked
  back along the swirl and updraft at each point, two copies cross-faded every TURB_T = 10 s so
  shear never winds it into stripes). Body sprites take density (+-35%) and tone from it; the 80
  streak cards are now 40 material lines (3 points each, carried by the same flow + eddies, shown
  only where the field is dense). Seen on the stovepipe: faint streaks, near level (swirl >> updraft), no stripes.
- Horizontal vortices: DebrisCloud publishes `ctx.hvWindAt(x, y, z)` (the tubes' Rankine wind);
  TornadoDust uses it, and the lower funnel's outer sprites are displaced by it (<= 0.4 rc).
  Not yet checked in Studio.
- Sub-vortices: new shared/Sim/SubVortices.luau. Instability index (swirl 0.95-1.5 x strength x
  organisation) with hysteresis (on 0.25 / off 0.1); centres carried by the parent swirl (0.6 vc
  profile), each other's winds, drift; kept in 0.3-1.15 rc; merge within 0.24 rc; strength
  toward a target (peaks near the RMW, spun up inward, decays outward). Stepped on the server
  (Tornado.step), packed 4 bytes each in the snapshot (svp), stepped on the client
  (StateAdapter, lab nudged to the server's). Vortex.sample's sub wind: 2q/(1+q^2), tapered, skipped
  past 6 cores. Python check: ~0.7 / 1.8 / 4 effective subs at index 0.3 / 0.6 / 1.0, merges at
  high index, travel ~0.6 vc. Sub tube cards keyed by slot (1-6), not id.
- Open: the Studio playtest after the sub-vortex change showed a frozen, smeared viewport (no
  script errors in the Studio log; client reported ready). Not yet known whether that was the
  window not redrawing or the change. Multi-vortex scene not yet seen.
- Follow-up (user: the playtest did not freeze; the frozen view was the capture). Multi-vortex
  scene seen: bowl lowering over a low dust layer, runs fine; distinct sub-vortex columns not
  visible yet (likely the 120 m subDepth cut on the dust columns + the 0.12 rc width).
- Dust at the base less dense / widespread (user): skirt 0.7-1.3 rc (was 0.8-1.8), skirt puffs
  0.8 rc (was 1.1), spread rate x0.6, pickup 0.3 (was 0.4), near-ground boost 1.15 (was 1.5).
  Stovepipe: a compact dark ball round the foot.
- Pale round blobs: seen at the foot of the stovepipe and, in the multi-vortex view, exactly at
  other cells' labels (C001, C003) - not the tornado's own dust; source still open.

## Round 14a (2026-10-31): lifecycle scenes, step 1 (written, not yet seen)
User approved the lifecycle plan (replace the genesis scenes; reference-case lengths; landspout later).
Research: docs/stormlab/research/LIFECYCLE-RESEARCH.md.
- Storm timelines: `storm.keys` ({t, vlow, Ru, W, vmid, base, lowering, occl, rfdDeficit,
  rearShare}) blended over the scene's time in Storm.applyPin (Storm.keysAt). Only the storm is
  keyed; the tornado lives the life it gets.
- Scenes L1 classic (2100 s), L2 long-track wedge / multi-vortex (3000 s), L3 high base, dust
  whirl first (1200 s), L4 brief rope (420 s) replace the genesis scenes on keypad . / * +.
  First-draft keys, to be tuned against the log.
- Stage check: the server prints `[Life]` every 10 sim s (phase vs stage, vc, rc, swirl, O, decay,
  funnel tip / cloud base, tilt, sub-vortex count, dust) until the scene's length or 120 s after
  the tornado ends.
- (Rojo had stopped syncing mid-day; user reconnected it.)

### Round 14b: the four scenes run in Studio (15x)
- L1 classic: funnel lowers ~5 min, touchdown ~300 s, cone/stovepipe ~15 min (vc ~75 after the
  keys were cut from vlow 38-40 to 22-25: it was ~100 m/s), shrinking from 1310 s, rope (rc 46 ->
  17 m, tilt 43 deg), funnel lifts over ~150 s, dust whirl ~2 min after the funnel leaves the ground.
- L4 rope: funnel lowers ~150 s, tilts to 40 deg, rc 45 -> 16 m, lifts over ~80 s.
- L3 high base: dust whirl from ~90 s under a funnel aloft; funnel creeps down to the ground at
  ~570 s as the base lowers. Clear air between funnel and whirl (plan step 4: the dust tube).
- L2 wedge: cone 240 s, stovepipe, widening (rc 88 -> 283 m), multi-vortex 1020-1860 s (3 subs),
  wedge again, narrowing, rope (tilt 53 deg). The multi-vortex phase renders as a dim grey mass
  from 3.5 km, with or without dry air (pw 12, rhMid 0.2 kept): sub-vortex visibility, open.
- Fixes: Tornado no longer ends when decay hits 1 - it ends when spun down (vc < 9), backstop
  10 min (t.decayFor): the rope used to vanish fully condensed at 65 m/s. Context:focus keeps the
  chosen tornado after it ends (the camera jumped to the strongest storm).
- Tornadoes are rated EF4-5 on the label in the lab (VC_EFF off by design).

### Round 14c (2026-10-31): multi-vortex wisps, dust tube, rope segments, L5
User: multi-vortex vortices as disorganised wisps under a broad lowering, condensing from the
ground up without meeting it.
- Two-celled parent: past touchdown the swirl dries the core (Vortex.hollowR = 0.75 x
  ramp(swirl, 0.9, 1.4) x O; Snow/Church 1980, Lewellen 2000): near-calm eye inside it, the
  deficit and condensation are the eye wall's - the parent's lowering ends aloft.
- Sub-vortices: SUB_V 0.8 vc (was 0.45; LES, El Reno), SUB_R 0.12 rc, Gaussian depth
  (Vortex.subFz, 0.4 rc, min 60 m). Each condenses by its own pressure fall (2 rho vs^2/(1+q^2))
  on top of the parent's at its radius; rendered narrow (<= 1 core), wobbling with height,
  broken up by noise. L2 keys retuned (swirl ~1.6-1.8 at 1500-2000 s: Ru 8000, W 18, vmid 18,
  base 850): ~6 thin leaning wisps from the ground fading out under a lowering ending ~230 m up.
- Dust tube (uncondensed funnel, TornadoDust): while the funnel is not condensed to the ground
  and few sub-vortices, puffs rise from the skirt along the core annulus toward the funnel tip,
  fading with height; plain soft texture (the lumpy one drew stacked bubbles with rims).
- Rope segments: the core wind fluctuates along the axis by up to 8% x smooth(0.5, 1, decay),
  more where the axis lies flat; only the condensation reads it. Laminar look: low swirl (< ~0.3)
  damps the body turbulence and densifies the filaments.
- L4 seen at 15x: thin contorted S-shaped rope to the ground (~250-330 s), lifts over ~1 min.
  The rope phase lasts ~4 real seconds at 15x - watch at 5x. Do not use 60x (L2 tilted past
  50 deg and roped out early).
- L5 rain-wrapped wedge (key ; with the test panel open; last scene in the list): HP supercell,
  rearShare 0.15 -> 0.7 over the life, Ru 3000 -> 4500, base 700 / lowering 200. Cone ~170 s,
  wedge (rc ~160 m) by 700 s - a broad low-contrast grey wedge in rain - and by 1180 s a dim
  shape behind the wrapped rain. (At base 550 / lowering 250 the young vortex leaned past the
  300 m under the lowering and was cut off at birth.)
- Open: the broad lowering's underside draws as lumpy, mammatus-like cards; a hard-edged pale
  patch with straight cut-outs in the cloud layer seen in L5; lab EF labels high (VC_EFF off).

### Round 14d (2026-10-31): base pouches and the pale disc patch
Found by tinting each card group a debug colour in Studio (L5).
- Mammatus-like pouches under the base: the squall-line shelf cards (ShelfPlan pieces turned into
  cards by CardPlan.fromPieces - the lab storm and its neighbours form a system), km-wide round
  `lumpyFlat` cards drawn upright at full height, hanging below their piece's bottom. Now: the
  camera is passed in; a card keeps its bottom at its piece's bottom (add()'s floor rule), is
  foreshortened (`seenHeight`, shared with the deck's seenH), and is smooth sheet facing down
  (`softSheetFlat`, nz -1) when seen more than ~8.5 deg up or when its piece is a thin slab (the
  dark base strip). The rain-free base's rim cards follow the same rule. (24 deg still left a
  scalloped row lower in the sky.)
- Pale hard-edged patch: BaseDeck's solid discs took the deck cards' average colour after rain
  fog - mostly the far cards' pale fog - times gain 1.7, a pale plate overhead in a dark wrapped
  base, cutting the cards that cross its plane along straight lines. Now StormCards keeps each
  down-facing card's colour before haze and fog (`inst.raw`), publishes the storm's fog, fog
  colour and distance in ctx.stormDeck, and each disc is fogged for its own distance (as a card
  is), then hazed as before. Discs beside the clear slot (slotAt > 0.12) are soft edge discs: a
  solid one there ended the base in a many-sided outline.
- Seen: L5 at ~700-1200 s a continuous soft dark ceiling; L2 multi-vortex phase the broad
  lowering under a smooth base.

### Round 14e (2026-10-31): diagnosis at 15x / 60x - tornadoes, wall cloud, inflow tail (no fixes)
Measured from Studio captures (L1, L2, W) and the [Life] log.
Only at high speed (60x):
- The slow step (storms) cannot keep up: budget 6 ms/frame (LabConfig.RATES.slowBudgetMs), the
  server at ~8 ms/frame; storms freeze ~1.5-2.5 real s (80-150 s sim), then jump.
  - Tornado tilt sawtooth: 2 deg -> 30-50 deg over 80-150 s sim, then snaps back (L1 and L2 at 60x;
    1-4 deg at 15x). The contact steps every frame (stepFast) while the parent meso stands still.
  - View judder: the chase camera follows the storm; its label moved ~130 px and back in 1 s at
    60x (+-10 px at 15x).
- BaseDeck grid: StormCards republishes ctx.stormDeck every 0.25 real s (= 15 s sim at 60x), and
  BaseDeck carries it on at most 5 s sim (math.clamp(now - d.at, 0, 5)): the disc grid stands still
  ~2/3 of the time and jumps ~110 m.
- Rope-out lasts ~1 real s at 60x (known).
At any speed:
- W scene: BaseDeck's solid discs draw as hard dark circles, ~(70,76,84) against the cards beside them
  at 104-160, each disc a slightly different tint, so every disc's outline shows; an edge-on soft disc
  is cut along straight lines by the solid ones. Probably made worse by Round 14d (disc colour from
  unhazed raw colours; rim cards seen from below now face down and join the average) - needs an A/B.
  The discs also reshuffle every ~second at 15x (edge/solid state changes as the storm moves).
- Wall cloud contrast inverted in the W scene: the lowering (110-125) is lighter than the disc
  ceiling above it (~70); a pale lump under it (~170, sky ~200) dissolves its bottom edge. Stream vs
  ring style differ by only ~10 levels at 4.5 km.
- Inflow tail: what shows is CardPlan's beaver tail (stays with Y toggled), a row of thin separate
  dashes under the base at 3-12% contrast to the sky - a dotted line, not a band. WallStream's tail
  cloud could not be picked out from four angles: it merges into the base band.
- Funnel top lost in the lowering: contrast 0.05-0.27 in the funnel's upper half vs 0.35-0.57 near
  the ground (L1, L2, both speeds).
- Grainy speckle on lit card rims (local noise sd 11-13 vs <3 elsewhere; L1 and W).
- From the side the W base reads as round dark blobs with bright gaps between them; flat lens cards
  seen near edge-on float in the bright tower.
Tooling: the [Life] log trails the live sim by ~150-200 s at 15x; the Studio viewport froze once on a
scene switch (playtest restart fixed it).

### Round 14f (2026-10-31): 60x timing fixes (step 1 of the plan after 14e)
- Tornado tilt sawtooth: World.sinceStep carried a storm on from its last slow step for at most
  60 s; at 60x the slow cycle runs 80-150 s, so the meso froze while the contact moved on. Cap now
  600 s. Seen: L1 at 60x mature tilt 0-2 deg (was 2 -> 50 deg and back), rising smoothly to ~30 in the
  rope-out as at 15x.
- View judder: World.snapshot sent storm positions from the last slow step stamped with the current
  time; it now carries x/y, lowX/Y, ffdX/Y, rfdX/Y on by u, v x the time since (not while held still).
  Seen: W scene at 60x the storm label holds within ~10 px a second (was ~130 px).
- BaseDeck grid carry-on cap 5 s -> 120 s (StormCards republishes every 0.25 s real = 15 s sim at 60x).
  The discs now ride with the storm; they still pop in/out and change tint every second or so (edge /
  solid / wall-hole changes, per-disc colour) - left for the disc colour work.

### Round 14g (2026-10-31): base disc colour, popping, soft discs
- Colour per disc from the nearest down-facing cards (StormCards publishes each card's storm-local
  x, y, raw colour and opacity in ctx.stormDeck[id].samples; BaseDeck.localCol weights them by
  distance beyond the nearest, sigma 1.5 km), eased toward the new value at each restyle. Mottle is
  brightness only. Measured (temporary log): outer disc 23-33 grey vs nearest card's drawn colour
  16-43 - the colours match. Measured before: discs set to ~29 drew ~50 on screen (Neon), cards
  beside them ~110 on screen.
- So the dark-disc contrast is opacity, not colour: the base cards are see-through and the paler
  sky/cloud behind lifts them; the solid discs were not. Every disc is now a soft one (deckEdge
  texture; LabConfig.DECK.solid = false; true brings back solid discs inside a soft band now two
  grid steps deep). The hard dark ovals and the scalloped rim are gone; L1 tornado from the chase
  cam showed no straight cuts across the lowering or funnel.
- Popping: discs were dealt from a pool in list order each frame, so one disc coming or going
  re-dealt every disc after it (new colour, new kind). Now each grid cell keeps its disc, discs fade
  in/out over 0.8 s, and a disc changing kind fades out, switches, and fades back.
- Still open: at 60x in W the soft discs still read as separate dark round blobs (opaque core 0.3 of
  the frame) against the paler cards, and one showed edge-on as a dark flat ellipse. Matching them
  needs the disc's opacity/colour to match what the card layer composites to (plan step 2/3: shared
  shading + optical depth), or a lighter, more transparent edge texture.

### Round 14h (2026-10-31): shared card shading for the discs; the "saucer" found and fixed
- One shading function: StormCards' card colour + rain fog is now `cardColour` (ctx.stormShade.card),
  used by every card and by BaseDeck. Each disc is shaded as a down-facing base card standing in at
  its spot: light, sky light and albedo interpolated from the nearest base cards (samples now carry
  c.lit, c.sky, c.albedo and the card's opacity), at the disc's own height, through the same view
  direction, haze and rain fog. Its opacity is the nearby cards' opacity, eased. BaseDeck's own
  factors (gain 1.7, centre darkening, mottle) now apply only to solid discs (DECK.solid = true).
  Seen: the overhead base blends into the cards - no separate dark blobs.
- The "saucer" (the dark flat lens under the base, also noted in 14e): found by tinting card kinds -
  the beaver tail's first, lumpy segment, a 3 km x 0.5 km band drawn upright at its side-on height.
  Now its height is as seen from the camera (seenHeight) and from well below (>~8.5 deg up) it is
  smooth sheet, as CardPlan.fromPieces and the deck. Seen: a soft band, no lens outline.
- CardPlan.flatDeckSolid (set by BaseDeck): only solid discs lift the cards near them above their
  plane and push "inside" two grid steps in; with soft discs cards are left out once discs cover them.
- Checked: W at 15x/60x (no blobs, no saucer), L1 chase view (no straight cuts on funnel/lowering).
  Not checked: right under the base beside a tornado.

## Round 14i (2026-10-31): gaps in the base from below; wall-cloud brightness diagnosis

- **Gaps from below** were the BaseDeck soft discs: at grid spacing 0.8 Dm the point between three discs was clear sky, and each disc drawn at the cards' opacity showed its outline where discs overlapped. Now spacing 0.67 Dm and each disc's opacity is `1 - (1 - A)^(1/LAYERS)` (A = nearby cards' opacity, LAYERS = average discs deep, ~1.3) so the overlapping layer adds up to the cards' opacity. From below the base is a continuous ceiling. Still visible: small dark flat ovals (lumpyFlat lumps hanging under the deck).
- **Wall cloud lighter than base (not fixed).** Found by tinting: in the W scene the wall cloud is WallStream (the low band); the big pale patch above it is the main layer's sunlit updraft tower (lumpyFlat/softSheetFlat at 2-4 km, lit ~1.0) seen beyond the base - expected. WallStream is greyed by rain fog. Tried fogging it along its own sight line (rainFog to the wall instead of the storm centre): 0.59 against 0.20, so the wall went paler (~120 -> ~146). Reverted. rainFog samples surface rain up to the wall's centre, so it counts the hook rain beside the wall, not only rain in front of it. Next: decide whether rain at the wall's own spot should count (sample to its near edge) before touching the wall's colour.
- **Wall cloud fog (14i, later): fixed.** WallStream now fogs each wall cloud by the rain between the camera and the wall's near edge (centre minus R toward the camera), via StormCards' exported `ctx.stormShade.rainFog`, refreshed every 0.5 s per storm. Logged in W at 15x: near-edge fog at or below the old centre-line fog (0.19 vs 0.32, 0.06 vs 0.23, 0.04 vs 0.09; once 0.63 vs 0.61). Checked from 5 angles (default chase, orbit left, orbit right, zoomed out, under the base): the wall cloud is dark and matches the base from the sides. No script errors. Still open: a pale lump inside the base seen from the orbit-right view (pre-existing), and faint disc shapes from below near the base's edge (orbit-right then tilt up).
- **Disc shapes from below (14i, later): fixed.** Modelled the coverage of overlapping soft discs on the hex grid (`$CLAUDE_JOB_DIR` script, deck_edge profile, mean 0.7): the random 0.3-step offset per disc left spots down to 0.08 (round shapes + pale gaps); on the grid at 0.70 spacing, 0.60-0.80 (darker spots where three discs overlap, seen tinted). New texture deck_soft (tools/smoke/deck_soft.py, `rbxassetid://138862961385378`, LabConfig TEXTURES.deckSoft): opaque to 0.20 of the frame, clear by 0.48, round; soft discs on the grid (JIT 0) at spacing 0.60: modelled 0.68-0.73. LAYERS uses the texture's mean opacity (0.375). Solid mode keeps deck_edge, spacing 0.8 and its jitter. Tinted check from below: one smooth layer. Cost: ~334 discs in W (about 35% more). Five-angle check untinted (default, orbit L, orbit R, under after orbit R, zoomed out): no change except a smooth base from below; no script errors. Still open: pale lump inside the base from the orbit-right side.
- **Dark ovals under the base (14i, later): fixed.** They were the base's hanging lumps (CardPlan, deck "texture underneath"): lumpyFlat cards, side-shaded, at half the base's sunlight. Seen from below (over ~8.5 deg up, the same rule as the rim, the beaver tail and fromPieces) they are now softSheetFlat. Tried also lighting them as the sheet (0.6 instead of 0.5): pale smears over the darker discs from the orbit-left view - reverted to 0.5. Five angles: no crisp ovals from below; other views unchanged. No script errors.

### Round 14j (2026-10-31): open items - the "dotted dashes" far off

- **Row of beads at the base seen from far off: fixed.** Found by tinting each renderer in turn and by hiding layers (U isolate, rain layer off, system groups skipped). It was not the beaver tail (tinted alone: no beads; the tail is not active in W). Two sources:
  1. **The line's shelf** (`ShelfPlan` + `CardPlan.fromPieces`, the system group of W's cells): each piece became a regular grid of same-size lumpyFlat cards 1.5 grid steps wide at one opacity - side-on a string of identical beads across the whole view. Now each card sits a little off its grid place (+-0.3 step), varies in size (0.75-1.25) and opacity (0.70-0.95), is ~2.1 steps wide, and is drawn as smooth sheet when small on screen (narrower than 0.2 of its distance, ~11 deg; a fixed 10 km cut still left beads nearer in). Up close the lumps stay lumpy.
  2. **Far rain curtains** (`CloudParts/Shafts`): the curtain sheet's column is ~0.56 of its frame wide at half opacity, so at 1.25x a partly rainy cell drew ~0.7 of its rain's width and neighbouring curtains' soft tops read as beads under the base. Curtains now 1.6x the rain's width (a tornado's 1 km columns stay 1.25x).
  Checked: default, far orbit-left, mid, orbit right; zoomed-out earlier in the round. Under-base view was beside a rain core (unchanged by this). No script errors.
- **WallStream inflow tail "invisible": not reproduced.** Tinted magenta, the tail draws in W from the default and orbit-right views (a band trailing from the wall cloud). Closed.
- **Pale lump under the wall cloud from orbit right: gone** (no change needed). Untinted orbit-right view in W: brightness runs ~50 in the wall cloud's body, 70s, 100-130 at its soft lower edge, sky ~170 - a soft edge, no separate lump (the 14i near-edge fog and smooth-base fixes took it).
- **Funnel top lost in the lowering: not reproduced** (no change). L1 at 15x, EF3-EF5 mature: from the default side the funnel is ~73 against ~120 near the ground (contrast ~0.4) and a slightly paler column into the dark lowering higher up (~55 vs ~37); it only fades in a short band where its background turns from sky to cloud. From orbit left a solid column flaring smoothly into the lowering (the reference look).

## Round 14k (2026-10-31): base from below, tower brightness

Analysis (W, untinted, measured): from under the base one view spanned 66-206 - a dark slate wall cloud beside mid-grey and near-white patches, with grainy rims, dark lenses and streaks; another view a few seconds of orbit away was an even ~55-70. The tower from afar sat at ~195 against a ~188 sky (the whole storm within ~40 levels). Logged per card: the near-white patches overhead were not the base - they were the tower's sunlit lobes, its core cards and the anvil, seen from below; of ~2700 cards overhead only ~70 were base cards (median 0.65, base discs 0.10-0.14). Tinted by texture the base from below was four kinds of piece: discs, lumpy lobes (tower's lowest ring), sheets and striation streaks.

- **Seen steeply from below** (`StormCards` `colour`, over ~27 deg up, ramped to ~49): a lobe shows the side facing the camera (lean toward the camera 0.7 -> up to 2.3); a card without a normal takes the camera-facing side's light; a top face seen from below takes its underside's; the forward-scatter glow is off. The wrapped-Lambert floor (0.3 of the sun on any face) now shrinks as a face turns away from the sun (to 0.09), so shadowed flanks darken too.
- **The base hides the column above it** (`CardPlan` `belowBase`): when the sight line from a camera under the base crosses the base inside the column's footprint, the tower's ring lobes and core cards are drawn as base sheets (smooth, facing down, the base's light) and its billows and the striation bands are left out. Tinted, the base from below is now discs + sheets only.
- **Sunlit tower** (`StormCards` `setCol`/`colour`): a card's colour may pass 1 (to 2.6); the excess goes into the billboard's Brightness. Roblox tone-maps it hard (Brightness x2 alone: 197 -> 215), so the direct sun's share on the cards is raised x2.2 (SUN_GAIN; clear-day sun is ~5-10x the diffuse sky, it was ~1.5x). Faces the sun cannot reach keep their light. inst.col stays the clipped colour (discs and wall cloud sample it). Tower core cards (c.core) show the face toward the camera (lit with the sun behind the viewer, shaded backlit).

Results: under the base p95 133-171 -> 93-128, median 69-75 (photos 50-100); a side-lit tower now shows bright sun-side lobes against a grey shadow side; sun-behind-camera tower median 197 -> 213. Checked: default, far front (sun side), far orbit-left, under base (two angles), far orbit-right. No script errors.

Open: tower shape (lean, asymmetric stack, flank turrets), anvil flat top and the slice bands at the tower's waist (F/G/H) not started.
- **Grainy lobe rims** (lobe sheets v4): the speckle was lobe_post.py's rim wisps (fine noise eating the thin edge) plus Cycles' volume noise in the raw passes, magnified when one card fills the screen. Regenerated with `--wisps 0 --denoise 3` (new --denoise option: Gaussian blur on the raw passes) from the kept raw bake, all 17 sheets re-uploaded, LabConfig.LOBES updated. Smooth soft rims now.
- **Bright lenses overhead** (`CardPlan` striations): tinted by texture they were striationFlat bands on the tower's flank. An upright band seen steeply from below is foreshortened (hT cos e + depth sin e) but a billboard draws it at full height, so each hung overhead as a lit lens. Bands and plates now take the foreshortened height and fade with it; from the side (far views) unchanged.
Checked after both: default, orbit left, far, far orbit-right, under base. No script errors, no TEMP lines.

## Round 15 (2026-10-31): storm bodies as EditableMeshes (key F: mesh / cards)

User: replace the supercell's body with EditableMeshes (tornado and wall cloud/inflow left as they are); mammatus removed.

- **`client/Render/StormVolume.luau`** (new; `LabConfig.STORM_MESH`): the 3 storms biggest on screen (extent / distance, holders x1.5) each get one pooled, opaque, self-lit (Neon) EditableMesh: tower 64x56 (lobes from smooth noise rising with the updraft, banded bell in the rotating zone, dome or overshooting top), anvil 48x36 (flat-topped slab from `StormShape.anvilAt`, knuckles upwind, frayed edges), base 26x72 (flat-bottomed lens, ragged edge, lumps, clear slot pressed up). ~14k triangles. Shapes come from `CloudParts/StormShape` (the same fields as the cards). Reshape every 3 s, shading on camera/sun moves, both as jobs within 2.5 ms a frame.
- **Light:** vertex colours: `StormShape.sunLit` (march through the storm's own cloud; base sampled inside its slab), wrapped Lambert on the true normal, sky by up-ness, a weak silver edge, the storm's rain fog and haze, then `exposure` 0.6 (Neon draws much brighter than an unlit card of the same colour; colours over ~0.85 glow). Exposure must be applied after haze/fog, or far storms fade to a glowing white.
- **Draw / depth:** each mesh is a scaled copy pulled toward the camera (`cam + (P - cam) * kv`, kv in 3% steps). `LabConfig.pull` + `pullAt` now feed `scaleAbout` / `toWorldAbout`, so every renderer drawn about a point of that storm (its cards, WallStream, TornadoCards, dust, shafts, flashes) is pulled by the same kv and keeps its depth order against the mesh. StormCards anchors go through `toWorldAbout`.
- **Cards for a meshed storm** (`CardPlan.meshBody`): no core, top-cap, overshoot, anvil, base-deck or striation cards; tower ring lobes (pushed out to the mesh surface), billows and dome kept as detail (`STORM_MESH.detailCards`, `CardPlan.meshDetail`); scud, inflow band, wall cloud and tail unchanged. No deck is published, so BaseDeck draws no discs for it.
- **Mammatus:** removed from CardPlan (all storms).
- **Seen in Studio** (Supercell, 4 runs): no script errors; the final look is a dark shaded cumulonimbus with a grey base, rain shafts and lightning in place. Fixed on the way: shards from plateau-shaped lobe noise, Neon glow halos, white base / far storms (exposure order).

Open:
- Detail lobe cards draw paler than the mesh (match their brightness).
- Pulled tornado / wall cloud / scud draw in front of true-scale things nearer than them (houses, trees, debris, terrain). Not yet looked at with a tornado on screen.
- Lightning doesn't light the mesh; the base edge is a hard flat rim; the slot is a groove.
- Only checked from the default chase view and one overhead view (not the five-angle pass).
- Published game: EditableMesh needs "Allow Mesh / Image APIs", and the client memory budget (~3-6 meshes) is unmeasured with 3 storms.

### Round 15b (2026-10-31): mesh review fixes (not yet seen in Studio)
From an external review of screenshots (ribbons/plates, white-to-black shading, sharp silhouettes, flat black disks):
- Tower: tier bands in the rotating zone removed (gentle flare only); lobes from domain-warped 3-octave noise (`lumps`); crease albedo 0.9 -> 0.96.
- Light: normals smoothed (3 passes over 4 neighbours, `STORM_MESH.normalSmooth`); softer shading (wrap floor 0.5, sun 0.2 + 0.8 lit, down-facing sky 0.38, deep tint x0.6).
- Base: rounded tapering edge, varying thickness, rougher outline, larger underside lumps; the base's rim cards kept over the mesh as detail.
- Key F cycles mesh + detail cards -> mesh only -> cards only (StormCards re-plans on the switch).
Seen in Studio below.
- Hybrid follow-up (second review; user: its screenshot 1 = mesh only, 2 = cards only, 3 = both): detail cards over a mesh sit mainly on its silhouette (side directions within ~60 deg of across the line of sight; `STORM_MESH.detailEdgeOnly`) at opacity 0.7 (`detailAlpha`), face cards at 0.4 of that. Edge choice follows the camera at each re-plan, so a fast orbit can lag. Normal smoothing 3 passes flattened the tower into a plain dark cone; now 1 pass (`normalSmooth`) with lobe 0.12.
- Seen in Studio (Supercell, chase view + view C, hybrid and mesh only): one lumpy, irregular tower, no ribbons or plates; edge cards soften the outline. Still open: the base still reads as a flat plate (esp. from below), lobe undersides seen from below go near-black with stepped ledges, C003 (cards) is much paler than the meshed C001, the anvil underside is a flat slab.

## Round 16 (2026-10-31): reference shots, storm-owned sky, supercell lifecycle

User: the supercells look poor; priority is the live visuals. Analysis: wrong proportions (tall tower on a small base disc), dark self-lit mesh with hard edges, a clear blue sky round the storm, and no fixed target to judge against. Plan agreed: shots first, then the sky, then rebuild around a wide low base. User also asked for a supercell lifecycle.

- **Reference shots** (`docs/stormlab/SHOTS.md`): P1-P5 + SC in `shared/VisualTests` (`SHOTS`), each paired with one photo; comma/F7 steps them, `'` runs the lifecycle; camera presets take `lookUp` (aim height above the base, `CameraRig`). `tools/shot_compare.py` puts a capture beside its photo with brightness/blue-sky numbers.
- **Storm-owned sky** (`Render/Sky`): 41 rays over the dome measure the share of the sky the storms' base, tower and anvil cover (`SkyCover` attribute); it greys/darkens the Atmosphere (haze +6 x cover) and drives a Terrain `Clouds` deck. Key `\` A/B.
- **Scene anvils** (`World.labScene`): scene storms are built 1 h old but only 10 min were run, so they had a 5-10 km anvil; they now start with the anvil Storm's own spread rule gives over that hour (~40-50 km).
- **Supercell lifecycle** (`life_supercell`, key `'`): a storm born in view (`fresh`): its top rises from the base at 0.5 W (`Storm` `cloudTop`/`topEq`) and its anvil starts at the equilibrium level; keys after RESEARCH-SUPERCELL-LIFECYCLE.md; server `[Life]` log for storm-only scenes. Seen: TCu 2.7 -> 13 km in ~20 min, anvil from ~18 min to 62 km by ~100 min, occlusion 70-77 min, cycle 2 at 80 min.
- **Server**: one scene build at a time (overlapping builds took ~40 s each and stalled the server - user saw the lag); build errors are caught and logged.

Findings: see SHOTS.md. The mesh body makes the storm dark and slab-like at every life stage; cards only read better from far off; the base is a small disc at every stage.
Next: the body - wide low base and forward flank first (StormShape/CardPlan), light from the sun side; decide mesh vs cards (see the report to the user).

## Round 17 (2026-10-31): supercell body on billboards, forward flank from the rain field

User agreed to drop the EditableMesh as the main body and rebuild on cards.
- **Default body = cards** (`LabConfig.STORM_MESH.defaultStyle = "cards"`; key F still cycles to the mesh).
- **Forward flank** (`CardPlan`, new section before Base): cloud wherever the storm's own surface rain is (`CardPlan.rainAt`, set by `StormCards` from `Precip.surface`, nearest live storm only). Per 2.2-4.5 km cell: a ragged lowered underside (lower/darker in heavier rain), one tall soft wall sheet on the rain area's edge (outward normal), a lumpy top where no anvil covers it. Top height from rain rate (0.35-0.8 of base->EL); under the anvil it reaches the anvil underside.
- It joins the storm's volume for the sun march (`StormShape.sh.ffAt` in `inCloud`), so its far side sits in its own shadow; skylight under the anvil x0.55.
- **Sky cover** (`Sky`) counts cloud over raining ground too.
- **Base from outside**: hanging lumps and rim are smooth sheets when the camera is outside the base (the lumpy cards read as a row of dark ovals - the "saucer").
- Shots: `shots/P1_cards_ff_2026-10-31.png`, `shots/SC_mature_cards_ff.png` (W42, ~45 min). Mature storm now reads as one body: anvil, stepped cauliflower forward flank, base under the tower.

Numbers vs 01_classic_supercell_a (mean 85, 0% blue): P1 mean 121 / 31% blue; SC mature mean 139 / 45% blue. Still too bright and too much clear sky: the scene storm is smaller than real ones, and the cards' skylight keeps shaded sides pale.
Open: shaded sides too pale; oval artefacts on the tower's face; base still small next to the forward flank; no five-angle pass yet; P2-P5 not re-shot.

## Round 18 (2026-11-01): Round 17 open items

- **Skylight the storm hides** (`CardPlan`, end of plan): each side/top card looks out along its normal and up (7 rays, 8 x 900 m, through `sh.inCloud` = tower + anvil + forward flank); its sky term x (0.35 + 0.65 open). Replaces Round 17's fixed x0.55 under the anvil. Memoised on a 600 x 600 x 300 m grid.
- **Striation ovals** (shots P5, SC): one plate per tier, sized as the ring seen from the camera (2.1 Rr wide, depth + 2 Rr sin e tall) on the ring's near side, instead of a lens per ring card; bands lower contrast (albedo 0.74, alpha x fa^2) and faded rather than narrowed on the silhouette. P5 now reads as stacked flared bands (`shots/P5_r18_plates.png` vs `P5_r17_ovals.png`).
- **Tower seen through the base** (P2): from under the base, tower and striation cards whose sight line crosses the rain-free base (0.9 of its radius, outside the clear slot) are left out (`c.tw` tag). The big pale oval overhead in P2 is gone. Forward-flank walls/tops behind its own underside are left out too (`hiddenFF`).
- **Terrain Clouds layer off** (`LabConfig.SKY_CLOUD_DECK = false`): found by A/B with `\` - it drew the stair-step edge across the sky in P2/P3, a dark mass and a pale ring under the base, and greyed the sunny side. The Atmosphere greying/haze from sky cover stays.
- Shots: `shots/P1_r18.png`, `P2_r18.png`, `P3_r18.png`, `P5_r18_plates.png`; P5 also orbited ~100 deg left.

P1 vs 01_classic_supercell_a: mean 121 / 35% blue (photo 85 / 0%) - unchanged; the scene storm is smaller than the photo's and lit from the side, so this number alone won't close.
Open: a row of small pale beads at base height beside the mothership (orbit view; source not found - beaver tail suspected); a thin pale lens in P2; P1 brightness; plan cost of the skylight pass not measured; SC lifecycle not re-shot this round.

## Round 19 (2026-11-01): Round 18 open items

- **Debug key Period**: leaves out one part of the card plan at a time (tower, anvil, forwardFlank, base, inflowBand, striations, wallScud; prints "[cards] hiding section"). Cards carry `c.sec`. Used to find the beads below.
- **Beads beside the mothership** = the inflow band (beaver tail), confirmed with Period. Every segment drifted ~2 km a cycle toward the updraft and faded at its ends, so the band broke into pale beads. Now only its turbulent root (first 30%) drifts; the laminar band stays put. P5 orbit: one continuous soft band (`shots/P5_r19_orbit.png`). The thin pale lens in P2 went with it (`P2_r19.png`).
- **Plan cost**: `StormCardsSkyMs` / `StormCardsCount` attributes. Skylight pass 0.9 ms of a 2.9 ms plan (479 cards); one storm re-plans every ~3 s.
- **P1 brightness** was mostly framing: `tools/shot_compare.py --horizon REF,LAB` measures above each horizon only - P1 at 15 km was 170 against the photo's 89 there, because the storm was small in a clear sky. P1 now 6 km, lookUp 2500 (as its primary photo 12_mesocyclone_striations_c): mean 100 (photos 85 / 119), median 85 (photo 01: 85), blue in the top third 20% (was 35%), all beyond the anvil edge (`P1_r19_6km.png`).
- **Tower hidden through the base** now only with the camera within 0.75 of the base's radius: at 6 km (near the deck's edge) it opened a blue band over the base, because the deck there is thin grazing cards.
- **Lifecycle** re-shot at ~40 min (W38, organising): smooth tower, anvil starting, forward-flank bulge, no stacked ovals (`SC_40min_r19.png`).

Open: the corner of blue beyond the anvil in P1; wall cloud and tornado not reviewed in the shots yet (plan step 5).

## Round 20 (2026-11-01): wall cloud + tornado review (plan step 5), in progress

- **Cone scene (2), 1.5 km** (`shots/cone_r20.png`): a large soft dark mass over the funnel. Period A/B: not the tower, forward flank, base or wall/scud cards; it is the lowering (WallStream; Y to cards style gives the same darkness). Brightness is in range for the view: underside median 0.19 of the frame's bright sky (photos looking up at an underside 0.16-0.18; side views 06/04a 0.36-0.48). What is missing is structure: no tiers, no crisp edge.
- **P2 wall cloud** (`P2_r20_before_reframe.png`): no recognisable wall cloud. Cause 1, framing: the chase camera ignores `pitch` and aims 1.5 km above the base by default, so P2 looked 29 deg up with the lowering at the frame's bottom edge. Now `lookUp = 0` (aimed at the base, as photo 04_wall_cloud_a). Re-shot: the base now sits mid-frame (`P2_r20.png`).
- Cause 2 (open): every WallStream piece uses soft blur textures (smoothPuffFlat / softFlat / wispSheetFlat), so the lowering cannot show the photo's crisp flat bottom edge or laminated tiers at any distance.
- **Wall as bright as the base seen from outside** (P2: wall 0.66, base 0.66 of the bright sky; photo: body 0.51, lower band 0.40, base 0.57). Found with new readouts on the WallStream folder (`WallMidCol`, `WallLit`, `WallSkyDirect`, `WallFog`, `Wall_body`/`Wall_under`: count, mean opacity, opacity-weighted colour; once a second):
  - the pieces are dark (body: 88 on, mean opacity 0.64, colour 0.07-0.09; sun reaching the wall 0.16);
  - isolated (U: no storm body or rain), an opaque disc of that colour still draws ~90 at 4.5 km against a ~190 horizon: renderer distance haze, the same for everything at that range. Against its own horizon the lab wall (0.47-0.68) is within the photo's (0.6-0.77);
  - so what is wrong is shape and contrast with the base, not overall light: from the side the lowering is a thin wavy band (R 1070 m, 350 m deep) with a long tail, its outline pieces see-through (opacity ~0.3-0.6), so sky shows through its lower edge. Photo: an opaque, flat-bottomed block, darker than the base, darkest along its bottom edge (`P2_r20_isolated.png`).
  - `volShade`'s 1.7x side boost (from a misread of 04a) cut to 1.15x; no measurable change in P2 (its side pieces are a small share), kept as it matches the photo.

Next (needs a look decision): an opaque wall cloud with a defined flat bottom edge (outline and fringe pieces denser near the bottom, or a flat-bottomed sheet texture for the lowest tier). The 2026-10-30 reviews found opaque overlap read as a featureless black mass, so this should come with the tiers.
- **Wall cloud as tiers with a flat bottom (user: go ahead, 2026-11-01).** WallStream's 45 outline lumps (cls 2) are now level tiers: one per ~120 m of the lowering's depth (2-4; 3 at 350 m). Each tier sits on the floor at its own radius (`zbot` rises toward the rim), so the lowest is the inner flat floor and each one above steps out: narrower at the foot, as 04_wall_cloud_a. The lumps hold their level and turn with the circulation (no rise). Seen side-on (under ~17-33 deg up) they use the new texture `wallTierFlat` (tools/smoke/wall_tier.py: soft top, crisp slightly uneven bottom edge at 0.70 of the frame, faint laminations; uploaded as rbxassetid://112138404673588), 1.7x wide, nearly opaque (density 3). From beneath they keep the old soft fibres and the 10-30 opacity, so the cone/under views are unchanged.
  - P2: a broad lowering with a defined flat bottom and a step on its side (`P2_r20_tiers.png`, orbit `P2_r20_tiers_orbit.png`). Sharpness of the bottom edge (largest grey step per pixel across it) 19, was 6. Cone from 1.5 km about as before (`cone_r20_tiers.png`).
  - Still open: the wall is the base's grey (0.68 vs 0.66; photo wall 0.51 / bottom band 0.40 vs base 0.57) - the pieces' colours are dark, the renderer's haze at 4.5 km evens them out, so contrast has to come from the base being lighter than the wall (its sunlit/sky-lit share), not from darkening the wall; the edge is slightly scalloped where tier lenses meet.

## Round 21 (2026-11-01): supercell + tornado lifecycle (SC, key ')

The SC scene (`life_supercell`) now runs a storm and its own tornado from birth to death, about 2.5 h of sim time. No tornado is forced: the storm makes one when its own genesis builds up, and the occlusion ends it.

- **Two blockers to natural genesis, both fixed:**
  - `Storm.applyPin` zeroed `G` every step for pinned lab storms. A scene storm with `genesis = true` now keeps its build-up.
  - The Supercell scenario is engine-driven, so `EngineFollow.beforeSpinUp` turns `world.genesis` off: the engine owns its storms' tornadoes. `World` stepStorms now also runs genesis for a non-engine storm whose pin asks for it (`s.pin.genesis`).
- **Timeline** (keys in VisualTests):
  - The low-level meso goes vlow 20 to 30 by 3000 s. At 20, genesis drive peaked at ~0.8, the threshold, and no tornado formed.
  - The first occlusion now runs to completion: occl 0.6 at 4500 s, 0.75 with rfdDeficit 3 at 5100 s. The old brief one (back to 0.1 within 5 min) left the tornado alive through both cycles, an hour.
  - The second cycle starts at 5400 s, its occlusion at 6900 s; decay as before.
- **Result** (two runs, same within ~3 min):
  - G passes 1 at ~3500 s. T02 is organizing from 3540 s, mature 3610-4730 s (peak vc ~70 m/s), shrinking/rope 4730-4850 s, dissipating, ended ~5020 s: about 25 min on the ground.
  - Cycle 2 makes no tornado (drive peaks 0.5). The storm decays to W 5 by 9000 s; the log ends there.
- **Camera keys by sim time** (`camera.keys`, CameraRig: dist + lookUp eased between keys, works at any speed):
  - 20 km for the growth;
  - 9 km at 3000 s;
  - 3 km from 3400 to 5100 s, aimed 500 m below the base so the ground and the contact stay in frame;
  - back out to 12 km and then 20 km for the decay.
  - At 6 km the funnel was a sliver. Aiming 500 m above the base at 3 km cut off the ground (`SC_r21_tornado_aimhigh.png`). Now: `SC_r21_tornado_3km.png`, funnel, debris and ground in frame.
- **[Life] log** for a storm lifecycle: adds `G`/`drive` before a tornado, its stage/vc/rc while it lives, and logs every 10 s during it.
- Shots: `SC_r21_organising.png` (~40 min), `SC_r21_tornado_3km.png`, `SC_r21_decay.png`.
- **Watching it:** at 60x the rope-out is ~5 real seconds; drop to 5-15x around 4700 s.

Open:
- The tornado's label briefly reads EF5 near its peak: vlow 30 is strong. The lab judges looks, not strength.
- Round 20's wall items are not done this round: the wall is the base's grey, and the tier edge is slightly scalloped.

## Round 22 (2026-11-01): inflow-band beads, shelf trigger, gradual mergers, wall tiers

- **Beads off the supercell (SC, default 20 km view): wrong, fixed.** The chain of dark ovals rising up-left from the base's end was the inflow band (beaver tail; Period-hide test: it goes with `inflowBand`). A beaver tail is one smooth flat band. Causes, CardPlan inflowBand:
  - `softSheetFlat` frames are soft round puffs, opaque over only their middle ~half;
  - segments 450 m apart (900 m at a distant storm's lower detail), and seen end-on (the band runs toward the default camera) each one sits higher on screen than the last;
  - so the cores never met: a row of ovals with sky between.
  - Fix: segments 0.35 of the band's width apart (opacity per card scaled so the band is as dense as before); each card tall enough (2.6x the on-screen step to its neighbour); the turbulent root drawn smooth beyond 6 km (its lumpy cards became round "under" lobes, a stack of dark knobs).
  - Checked at W36 (`shots/SC_r22_inflow_band.png`, one smooth streak) and W42; before: `SC_r22_beads_before.png`.
- **Shelf cloud for an outflow-dominant storm: built, not seen in the lab.**
  - Server (Storm.step): every 30 s, 9 rays across the forward half find the gust front (the ray's pool edge: last point colder than half its peak and 1 K, before a gap; out to 15 km) and its strength: RKW ratio = ColdPool.speedOf(peak deficit) / 0-3 km shear (`gustR`, `gustD`, `gustK`, in the snapshot).
  - Client (StormCards): where a ray's front runs ahead of the updraft and its RKW ratio is over ~1 (ramp 0.9-1.6), shelf pieces along that arc via ShelfPlan (new optional `seg.len`) and CardPlan.fromPieces, as the squall-line shelves.
  - `Storm.rkw` (cold-pool speed at the updraft itself) is ~0 under a supercell's updraft, so it could not show this.
  - SC lifecycle: the ratio stays 0.13-0.20 all life, also in the "outflow-dominant, decaying" phase - the forward pool is a few K, the 10 K RFD air stays behind the updraft, and the scene keys' `rfdDeficit` is only a readout. So no shelf is drawn (correct for these fields). `[Life]` now logs `gust lead` and `RKW`.
- **Storm mergers: gradual (World stepStorms).** A same-mover updraft within 0.6 (Ru1+Ru2) of a stronger one is drawn in gently (its own motion does most of it; inside 0.35 Ru it rides with the big one), hands its updraft over in ~10 min (`mergeF` 1 -> 0, also scales pinned W), and the big one strengthens and widens (`mergeBoost` up to 0.3, fading over ~15 min). The cell dies only once its updraft is given up. Before, the smaller storm vanished in one step.
  - New scene MG (key backquote; `/` is Roblox chat): supercell + a cell 15 km SW closing at ~10 m/s; `scene.storm2` in World.labScene.
  - Run: merge starts 840 s, cell absorbed 1680 s; supercell W 45 -> 51, Ru 3.0 -> 3.2 km, rain 607 -> 829 t/s, then relaxing. The cell's tower fades into the supercell's flank (`MG_r22_merging.png`, `MG_r22_merged.png`). A first try with a 400 s pull swallowed it in 2 min.
- **Wall tier edge:** each tier's floor now comes from the tier's own radius, not each piece's (zbot rises as r^4, so 8% radius jitter put neighbouring lens bottoms up to a third of the depth apart: the scalloped edge). Not measured on screen yet.
- **Wall darker than the base: still open.** Wall pieces' sky light now limited to the sky under the base's edge (h / sqrt(h^2 + O^2), O = how far the deck reaches past the piece); measured at 3 km no change (wall 0.58, bottom band 0.61, base 0.56 of the sky; photo 0.51 / 0.40 / 0.57). Something other than the sky term sets the wall's grey - next: isolate the wall (U) and read WallStream's light readouts.

Open:
- Single-storm shelf needs a storm whose outflow outruns the shear (heavier rain / weaker shear), or a cold pool where a collapsing core's outflow surges ahead.
- Wall vs base contrast (above).

## Round 23 (2026-11-01): night supercell too bright - legacy fog

- **Night SC (F6, 22:30) was too bright: fixed.** The tower drew light grey (~170/255) on a black sky and near-black ground, the same grey as by day.
- **Not the cards' colour.** After the ~20 s recolour, every card's ImageColor3 was ~0.01-0.04. Toggling the gradients changed nothing.
  - Test: all cards tinted pure red rendered pale pink (200,166,166) = red mixed 87% with grey 191 (`shots/SC_r23_night_red_cards_test.png`).
  - Up close the same cards were ~80/255: a grey that grows with distance.
- **Cause: Roblox's legacy distance fog.** Lighting.FogColor (place default #BFBFBF, FogEnd 100000 studs) still greys BillboardGuis under an Atmosphere. Nothing in the lab wrote it, so it stayed day-grey at night. (A day-grey Atmosphere haze was a second, smaller source.)
- **Fix (Sky.luau):**
  - Sky now owns FogColor: the place's FogColor x dayK, the same night factor as the ambient. By day it is unchanged.
  - Atmosphere Color/Decay also x dayK.
  - Restored with the rest of the Lighting when sky is off.
- **After:** the moonless night storm is ~1/255, about its cards' own colour. It is invisible between flashes, which is right for a dark night (`SC_r23_night_after_fog.png`; before: `SC_r23_night_before_fog.png`).
  - The moon setting (VisualTests panel, moonlight 1) raises the skyglow for a visible silhouette.
- **Lightning at fast-forward (Lightning.luau):** at speed s only 1/s of flashes start a bolt (seeded), so 60x does not merge 20-30 flashes a sim-minute into a steady glow.
- **Rojo note:** the sync went stale silently for ~11 h this session. When an edit seems to do nothing, compare the Studio script (studio_read_script) to disk.

Open:
- Flash lighting of the cards at night not yet confirmed on screen (flashes too short to catch with single captures).
- Night look for play: decide whether a moonless night should keep a faint skyglow silhouette.
- Wall vs base contrast (Round 22).

## Round 24 - dusk transition (2026-11-01)

New test key **F8**: a dusk sweep. The visual clock runs 17.5 -> 21 h local over 90 s; press again to stop. Pause the sim first so the camera holds still.

Finding (side view of the SC tower, paused):
- The card colours already fell smoothly with the sun (0.77 at sunY 0.32 -> 0.39 at 0.06 -> 0.01 at -0.16).
- On screen, though, the storm was mostly Roblox's legacy fog (FogColor). That fog stayed at noon grey until sunY 0.05, then dropped to black.
- Result: the tower held ~172/255 through dusk. At sunY 0.13 it was +131 brighter than the darkening sky, then fell 158 -> 81 -> 11 in about 0.12 of sun height.

Fix (Sky.luau): FogColor now follows the cards' own sky light, the daySky curve from StormCards light() as a share of noon's. At night it blends to the night floor. Noon is unchanged.

Tower brightness (sky brightness in brackets):

| sunY | before | after |
|---|---|---|
| 0.32 | 174 (158) | 149 (158) |
| 0.25 | 172 (158) | 91 (158) |
| 0.19 | 171 (104) | 73 (108) |
| 0.13 | 158 (27) | 56 (28) |
| 0.07 | 81 (6) | 23 (6) |
| 0.01 | 11 (3) | 4 (3) |
| -0.04 | 1 (3) | 1 (3) |

The fall is now monotone with no glow. The lit side now shows a warm, side-lit face at low sun; before, the fog hid it.

Shots: SC_r24_dusk_before_sun019/013, SC_r24_dusk_after_sun019/013/007.

Open:
- Roblox's own sky drops from blue to dark green-black between sunY 0.19 and 0.13 while the sun is still up. This is the sky and grade (green tint), not the storm.
- The deepest dusk frames (sunY ~0) are near-black. A little more twilight on the cards may be wanted there.

## Round 25 - daytime SC lifecycle check, many angles (2026-11-01)

The SC scene was swept at 60x, paused at storm ages 0-3, 8-10, 24, 47-50, 64 (tornado), 79 (rope-out), 101 and 135 (decay). At each stage: the default view, orbits of 90-120 deg, the far side, zoomed out (O x4) and under the base (I + PageUp). Shots: `shots/SC_r25_*`.

### Fixed

1. **Stray rain at birth.** A 2.6 km cumulus aged 0 min rained 18 t/s and drew a shaft and lid beside the puff. The cause was `Storm.precipRate`, which was condensate x efficiency from the first second.
   - Now it is also x `ramp(top - freezing, 500, 3000)` (shared/Sim/Storm.luau): no rain until the tower is well into the ice zone.
   - Engine storms (no growing cloudTop) are unchanged.
   - First rain now comes at about 8-10 min.
2. **Storms vanished beyond ~28 km; orphan rain and bolts.** Roblox does not draw billboards beyond ~100000 studs. At the lab's true scale, a storm's cards vanished past ~28 km while its rain shafts and flashes (pulled in by their own renderers) still drew.
   - Symptoms: rain hanging under bare lids, a bolt in clear sky, engine storms shown only as labels, and the mature SC gone from 34 km.
   - Fix (LabConfig.pullAt): in the lab, on clients, anything drawn about a point beyond 60000 studs (~17 km) is a copy pulled toward the camera, with the same angular size. This is the mesh-mode pull, made general.
   - The game is unchanged because it sets F.sky.
   - Every far renderer already places through toWorldAbout.
3. **Zoom did nothing in keyed shots.** I/O and the mouse wheel did nothing during SC: the camera keys overwrote the distance each frame.
   - The viewer's zoom is now a multiplier on the keyed distance (CameraRig `self.zoom`), reset when a shot starts.

### Seen, not changed (open)

- **Floating puff.** A lone round puff floats beside the tower at many stages and angles (ages 10, 24, 47, 135). Period-hiding puts it in the **tower** section, and it can disappear on a replan.
- **Base gaps.** Under and beside the updraft at maturity, the base breaks into separate lumps with blue sky between them and small bright holes. From behind and far, the base still reads as a flat saucer under a bright tower.
- **Wall cloud and funnel.**
  - At the tornado stage the wall cloud is a flat blade with pointed tips. From far it reads as two stacked discs.
  - The mature tornado's funnel is a cone that ends high above the ground with almost no visible dust ("dust whirl"). The EF5 label vs the thin cone is known and ignored.
- **Scud dashes.** Scud reads as many thin dark dashes scattered under and beside the base, some in clear sky (Scud renderer).
- **Ground dust domes.** Pale dome-shaped dust blobs sit on the ground ~1 km from the camera with no tornado: TornadoDust's ambient path, spawned wherever the 2 m wind is over 8 m/s on dry ground. That is deliberate blowing dust, but it reads as a solid dome. Options: a higher threshold over vegetated fields, flatter and wider puffs, or less colour gain.
- **Early rain position.** Early rain (age ~10) still falls well downshear under its own lid, with clear sky between it and the tower.
- **Lightning.** No stray bolts were seen after fix 2. Flashes stop in the decay (0/min at age 135).

Testing notes:
- The 60x button does not unpause; the Pause/Resume button toggles.
- The Studio layout (Explorer left or right) changes between sessions. Input coordinates are viewport-relative, so they still work.

## Round 26 - Round 25 open items (2026-11-01)

Traced by two read-only passes (tower puff, base gaps), then fixed and checked in SC at ages 14 and 51 (default, 120, 240, far). Shots: `shots/SC_r26_*`.

1. **Lone puff beside the tower: fixed.** The flank billows (CardPlan `boil`) were carried by Flow through the full wind. That wind includes the environment's 10-25 m/s shear, which the column's tilt already accounts for, so a billow drifted 1.5-4 km downshear and never evaporated. An A/B with CLOUD_FLOW off showed the tower compact and attached.
   - Now "up" cards move with the storm's own air (`windAt - env:windAt`, Flow `envAt`).
   - Flank billows also evaporate outside the cloud edge (`sh.cloudR`), over `150 rh/(1-rh)` m, capped at 60-400 m (Flow `outside`).
   - The rising dome keeps no edge fade, because it is meant to rise above the column top.
2. **Pale lens mid-tower: fixed.** The tower core card nearest the base, squashed by the floor clamp to a wide flat oval, is skipped when h/w < 0.6. The lobes and the base fill that level.
3. **Base broken into lumps, bright holes: fixed (from under, 120, 240).**
   - Deck grid cards are now 3x the step (was 2.4) with 0.3 of a step jitter (was 0.6), so the ~40%-opaque soft frames' cores meet.
   - The near disc patch takes its colour and opacity only from the base's own sheets (`sec == "base"`, softSheetFlat), not the half-transparent hanging lumps or the tower core cards.
   - Down-facing cards get no forward-scatter (silver lining) glow.
4. **Flat saucer from far: fixed.** The far-mode deck cards use `seenH` (foreshortened by the view's elevation), so from far the base is a thin level sheet.
5. **Dust domes: changed.** Wind-raised dust (no tornado) is drawn as a low streak 3x wider than tall, with the dustWisp2 texture and sun-angle shading, not cream round puffs. When it spawns is unchanged (8 m/s at 2 m on dry ground): the client has no ground type.
6. **Scud dashes: reduced.** Wisps are at most ~4:1 (stretch 1.3 + up to 1, height 0.55 x size), was ~10:1. Small dark flecks still show round the base at 120 deg.

Still open:
- The wall cloud draws as stacked flat discs (120 deg).
- The base is still 2.2 Ru across (~10 km), with no rain-free deck joining it to the forward flank (the trace suggests sizing it from the rain and anvil fields).
- Tower cards are hidden by the base only within 0.75 Rb of the camera.
- The tornado funnel ends high, with little dust.
- Early rain falls downshear under its own lid.

## Round 27 - remaining SC open items (2026-11-02)

The wall-cloud and funnel causes were traced read-only, then fixed and checked in SC (ages 10, 14, 57 and tornado T02, default + 120 deg). Shots: `shots/SC_r27_*`.

1. **Early rain downshear: fixed.** Release height is capped at the tower's current top (`min(0.8 el, 11 km, top - 300)`, shared/Sim/Storm.luau). A 5-7 km tower was releasing rain from up to ~9.6 km, in clear air, and it fell for minutes through the shear. At age 10 the first rain now falls under the tower's base. Engine storms are unchanged (their top is at least the EL).
2. **Base not joined to the forward flank: fixed.** The deck grid now reaches to 1.8 Rb wherever a forward-flank rain cell is within about a cell (`sh.rainNear`, CardPlan). The rain-free base and the rain area's underside are one cloud; at age 57 from under it is one dark deck into the rain.
3. **Wall cloud as stacked discs: fixed.** Side-on, WallStream drew 3 opaque level tiers. Each showed only its texture's 40% lens (~7:1, pointed tips), and over them a dark underside disc.
   - Now each side piece is one card spanning the lowering's full depth: crisp bottom on the floor at its radius, width at most 2.5 x the depth. `band`'s 0.72 height cap is overridden.
   - The central underside disc fades side-on, like the streaks.
   - From 120 deg it is one rounded solid lowering.
4. **Funnel aloft over clear air: dust column made visible; funnel unchanged.** The tip follows the condensation rule (vc^2 I / g under a 2.07 km base: ~0.9-1.4 km up for vc 60-75), and a high funnel is what a high-base storm shows. What was wrong was the debris column under it:
   - The column is now also drawn for multi-vortex tornadoes.
   - The tip is found in 40 height steps (was 10), so the column meets it.
   - Column puffs are 2 core widths (was 0.9; they drew as a trail of dark dots), with the smooth-texture halving undone (x1.3).
   - Blowing dust leaves 30% of the 280-puff pool to tornado debris.
   - From 120 deg the column is a soft dark plume into the lowering.

Still open:
- The lone puff beside the young tower still turns up now and then (seen at age 12 in one run, not at 14 in the next); the flank billows' edge fade may not catch the first frames before a trace.
- A few round dust puffs at the ground still read as separate balls.
- The funnel is a sharp cone; the documented "humidity" lowering in Vortex.condensationRadius is not implemented. It would need a replicated core-moisture field.

### Round 27b - funnel core moisture (2026-11-02)

- `Vortex.condensationRadius` now uses the base the core's own air condenses at: `cloudBase x (1 - 0.7 coreWet)` (`Vortex.coreBase`). This was the doc comment's unimplemented "humidity" term.
  - `coreWet` is recent rain at the tornado's contact (`world:groundAt` wet, 8 mm saturates), eased over 60 s in `Tornado.step`. It goes out in the tornado snapshot and is copied by the client StateAdapter. It is not in the engine's required `Frames.TORNADO_FIELDS`; engine tornadoes count as dry.
  - The renderer, the dust tube and `funnelGround` all use the same rule.
- The panel shows it: "cloud base 1770 m (core air 1768 m)".
- In the SC scene T02's contact is in rain-free inflow (coreWet ~0), so its funnel stays ~1 km up over the dust column, as a high-base storm's does. Rain-wrapped tornadoes (L5) now condense lower.

## Round 28 (2026-11-02): low-base storm + open items

- **Lone floating puff (fixed).** Cause: a forward-flank rain cell that is open on opposite sides (a lone cell, or a band one cell wide) had its outward directions cancel, so it got no side wall. Its lumpy top then floated alone over a thin underside. The fix is in `CardPlan.luau` (FF block): such cells now get their wall facing the camera, or across the band. Checked at 60x, ages 9-28: the forward flank now reaches down to the base, and the puff no longer shows.
- **Low-base scene.** New scene `life_supercell_low` (Shift + '). It is life_supercell with a base of 800 m, pw 40 and rhMid 0.7. Results at 60x:
  - The base is low, dark and wide.
  - T02 formed at storm age ~59 (EF2-EF3 rope), with a tornado cloud base of 500 m and core air 497 m.
  - The rope funnel reaches about two-thirds of the way down, with a dust whirl under it. "Funnel at ground" stays no.
  - It lived about 2 min before dissipating.
- **Open:**
  - Wall cloud: a small dark lump sits on top of the lowering disc (stacked look). Seen at storm age ~60 in the low-base scene.
  - Round ground dust balls: not seen in this run. Dust read as specks at distance; not changed.
  - Funnel to ground: core air equals the cloud base (dry contact), so the cone stays short even with an 800 m base. A moist contact would need the inflow to carry more moisture (environment, not painting).

## Round 29 (2026-11-02): the storm "shove" + open items

- **Periodic shove (fixed).** Three causes, each measured with a temporary server diagnostic (since removed):
  1. Storms were only stepped inside the background slow step. At 60x one slow-step cycle (rain, cold pool, binning) takes 2-3 real s, so storms stepped about every 150 sim s. Motion was carried forward in between, but everything else landed at once: an engine update's eased jump, the low-level circulation shift, and the storm's own turns and growth. The fix is a new `World.stepStormCells`: storms step every frame (every 2 sim s), outside the slow step. Hosts set `world.stormsApart` and call it after `stepFast`; this is done in both the lab server and the game's `StormHost`.
  2. Sub-steps were stamped with the slow step's end time (`validAt`). A part-moved storm was drawn behind, then caught up. Each sub-step now has its own clock (`World.stormClock`), and engine storms (`Storm.followEngine`) place themselves on that clock too.
  3. Engine occlusion was set instantly. It is now eased like the other engine fields, because one update swung the circulation (and the tornado under it) about 2 km.
  - After the fix: no shoves over 35 sim min at 60x. The storm moves 0 m off its track per frame, where before it jumped 50-150 m. Server frame time is unchanged at about 8-9 ms.
- **Wall cloud beads (fixed).** With the base hidden, the lowering's fringe pieces (WallStream class 3) were a ring of small dark round beads. They are now wider (0.22-0.36 R), flatter (0.35) and fainter (dens 0.24), and read as one smooth lowering.
- **Dust balls (fixed).** The dust tube's round soft puffs (2 rc) were too few to overlap and showed as grey balls on the ground. They are now upright (aspect 0.75) and larger (2.8 rc, up to 420 m), and form a veil rising toward the funnel. A few patches remain.
- **Funnel to ground: left as is.** The condensation is field-driven (core pressure vs a dry contact). The dust veil now fills the gap under a high funnel.
- **Funnel to wall cloud gap (fixed, low-base scene).** The funnel started fading at 0.9 of the cloud base, so under the lowering's soft floor it was half gone, and side-on a strip of sky showed between funnel and wall cloud. It now stays solid to 0.98 H and fades only inside the lowering (0.98-1.06 H). Both funnel passes in TornadoCards were changed. Checked zoomed in on the low-base scene (EF3 and EF5 stages): it joins the lowering with no gap.

## Round 30 (2026-11-02): ground elevation for storms and tornadoes

The user saw tornado feet clip through the ground and dust skirts that started above it. Causes and fixes:

- **Game: far ground scaled with the storm (fixed).** Far storms draw at a smaller sky scale (`Config.skyScaleAt`), and that scale was also applied to the ground height under them. Far tornadoes sank into hills or floated over valleys. New `LabConfig.groundIn(x, y, cx, cy, k)` / `groundScale(cx, cy, k)` give ground at true scale whatever the storm's scale; this factor is 1 in the lab. Used by TornadoCards (`altitude` via `gK`), TornadoDust, DebrisCloud and rain shafts (`CloudParts/Shafts`).
- **Dust was placed aloft (fixed).** Dust-tube puffs started up to half the funnel's height and collar puffs up to 0.12 of the cloud base. They now all start 1-4 m above the local ground and are carried up by the vortex's own updraft (`cw:windAt`). A tube puff's life comes from that updraft: about the time to rise 0.8 of the funnel, 8-45 s.
- **Funnel sprites showed below ground (fixed).** The funnel's smoke sprites start slightly under the ground and climb out. Where no terrain covered them (past the ~2.8 km ground ring, or a hill's far side) they showed below it. Each sprite near the ground now gets a gradient cut at the ground line, tilted to the local slope under it (`groundCut` in TornadoCards).
- **Dust fade assumed flat ground (fixed).** Each dust puff's ground fade now tilts with the slope across it, so puffs on a hillside fade along the hill, not along a level line.
- **Hills test toggle (new).** F2 (or "hills" in the F4 panel) rebuilds a scene over local hills (`VisualTests.HILLS`: amp 70 m, wavelength 1.8 km, radius 5 km). The hills are centred on the tornado's predicted track, 1.5 km ahead of it (life_supercell uses `hillsLead`). The town and its flat pad go 3 km to the track's left, because a tornado forms right of its storm's centre. The relief now has its own centre (`relief.cx/cy`); Terrain, groundAt and the farmland tiles use it. The terrain builds at a 12 ms/frame budget.
- **Checked (Studio, 60x):** the stovepipe (G) and low-base SC (Shift + ') scenes with hills on. In both, the funnel foot meets the slope, and dust starts at the ground and spreads along it. Seen from ground level, from the side and from above. The flat low-base SC funnel still joins the wall cloud.
- **Open:** the dark puffs trailing off the EF4 at cloud height are lofted debris (they go when the debris layer is off). Seen from high up, the farmland ring's square edge shows. It is unchanged here: see the ground ring note in the sky-lighting memory.

## Round 31 (2026-11-02): wall-cloud hole, far land, light under the base

The user saw three things: a hole in the wall cloud at touchdown, land that ends too close, and too much light under the base.

- **Hole in the wall cloud at touchdown (fixed).** The wall cloud itself was solid (isolated with U). The hole was the base deck's.
  - BaseDeck cut its opening around the live wall-cloud centre. At touchdown, WallStream re-centres the wall cloud onto the funnel top.
  - The base cards (CardPlan) had planned the opening around the old centre, and they re-plan only every 3 s.
  - In between, the deck's hole and the cards' hole were in different places, so sky showed through.
  - Fix: StormCards publishes the planned hole storm-relative (`stormDeck.hole`), and BaseDeck cuts exactly that, carried with the storm.
  - Checked at 15x after touchdown: from ground level, from 1.2 R and from 2 R raised. The lowering reads as one dark mass joined to the base.
- **Far land (new: a billboard ring).**
  - Parts are not drawn past ~7000 studs (~2 km). Widening the tiles to radius 12 showed nothing more, so the ground stopped short.
  - `Render/Ground` now adds rings of ground-coloured billboards (which draw to ~28 km) at 2.4 / 3.2 / 4.3 / 5.8 / 8 / 11 / 15 km round the camera, 96 cards a ring.
  - Each card hangs from the ground line (`SizeOffset (0, -0.5)`) with a 3% feathered top. Each ring shows only the band between its own line and the nearer ring's, so the haze grows ring by ring.
  - Cards are widened by 1/cos² of their angle off the view's centre; without that, seams opened at the screen's sides.
  - Each card is lit from SceneLight, sampled in 16 sectors a ring and blended between them, so land under a storm is darker.
  - Depth-safe: nearer things draw over a ring. Anything beyond it stands above its line on screen, so far storms and tornadoes are not covered.
  - One ring at 6 km came out a grey wall, because it jumped from the tiles' haze to ~50%. The stepped rings fixed that.
  - Open: from a raised camera (~2 R, half height) faint terracing between the rings remains. Ground level looks continuous.
- **Light under the base (lowered).**
  - Sky.luau's diffuse light now counts how much of the sky dome is covered (the SKY_DIRS rays, weighted by elevation), not only the overcast above the camera.
  - DIFFUSE_FLOOR is 0.12 (was 0.35).
  - The OutdoorAmbient scale is 0.25 + 0.75 D (was 0.45 + 0.55 D). The Ambient scale is 0.35 + 0.65 D (was 0.5 + 0.5 D).
  - The exposure boost is capped at 0.5 (was 0.8), at -0.2 per stop (was -0.3).
  - Ground under the base is now dark green-grey, not bright. The base underside is darker than the open sky past its edge.
  - First try had a floor of 0.06, which left the ground under the base near black.

## Round 32 (2026-11-02): funnel-to-wall-cloud join, the storm's shadow on the ground

The user still saw a gap between the funnel's top and the wall cloud. They also clarified that "light under the base" meant the shadow the storm puts on the ground, as the player sees it.

- **Funnel to wall cloud (fixed).**
  - Measured in the low-base scene: the tornado's cloud base H was 500 m and the lowering's floor over the funnel was 453-470 m.
  - The funnel began widening at a fixed share of H (`zAt(0.55-0.6)`, ~275-300 m), well below the lowering. The flare also fades the funnel's layers (`1 - flare`).
  - Together these hung a wide see-through skirt under the wall cloud. From 2 R out at half height, sky showed on both sides of a faint neck.
  - Now the flare starts no lower than just under the lowering's floor (`mergeAt`: WallStream publishes `wallStreamBase[id].floor`, and TornadoCards looks it up per tornado). That is about 0.88 H in this scene, and the funnel widens where the cloud is.
  - Checked at 1x from 1.2 R, from 2 R raised, and from the opposite side: the funnel widens straight into the lowering with no gap.
  - The F4 counters line now carries a `JOIN` readout: H, top, the lowering's floor and zb, and the funnel's radius, condensation, top fade and flare at 0.8 / 0.9 / 0.95 / 1.0 H.
- **The storm's shadow on the ground (new).**
  - The tiles are lit by Roblox's single world light, which is the camera's (Render/Sky). From outside a storm, the ground under it was as bright as the sunlit field underfoot. A billboard cloud casts no shadow, and Roblox's shadow maps don't reach km.
  - New `SceneLight.groundLight(ctx, x, y, z)` gives the light on level ground at any point: the sun through the storms (the same ray test as `sample`) plus the sky light left by the bases over it (`baseCover`, local, not the camera's).
  - `Render/Ground` puts it on the tiles as one small EditableImage over the tile field (8 px a tile). Each tile's top-face SurfaceGui shows its own square of the image, bilinear, so there are no blocks or seams. It is built a few rows a frame within a 2 ms budget.
  - Against the camera's own light: darker ground gets a black veil, brighter ground (sunny land past the base's edge, seen from under it) a veil of its own lit colour.
  - The ratio is applied in display (gamma) terms: `r^(1/2.2)`. Applied linearly, a tenth of the light drew the ground black.
  - The far rings use the same light, so near and far ground agree.
  - Seen from outside: a darker band of land under the storm, sunlit fields near the camera.
- **Ground under the base (lighter).** It drew near black (~20/255) under a cloud base at ~80. OutdoorAmbient now scales by 0.6 + 0.4 D (was 0.35 + 0.65 D), and the grade's desaturation is -0.15 (was -0.25). The ground under the base now reads dark green (~28/255).
- **Open:**
  - From a raised camera, the near tiles (in the storm's shade) and the hazier far rings meet in a visible brightness step at the tiles' edge.
  - After a tornado lifts, a pale crescent of sky can show under the wall cloud for a few seconds, until the base cards re-plan. The deck's hole follows the planned hole, and the wall cloud moves back off the funnel.
  - The ground under the base could go a little lighter if wanted: it is one factor in Sky.luau.

## Round 33 (2026-11-02): Round 32's open items

- **Step between the near tiles and the far land (fixed).**
  - The far cards were coloured as a fixed share (0.38) of SceneLight's light at the camera. That matched the tiles in sun only. Under a storm the tiles are lit by Roblox's ambient alone, and the far land drew up to ~2x brighter than them.
  - Now `litGround()` in Render/Ground recomputes the tile colour from what Roblox lights the tiles with: OutdoorAmbient, Brightness × sun height, and the eye's ExposureCompensation. The fit is albedo × (kA·amb + kS·sun), in linear terms.
  - kA 0.25 and kS 0.2 (`G.far.kA/kS`) were fitted to the tile underfoot at ground level: about 58/255 green in sun and 29 under a low base. A first fit to raised views had matched the shade veil's own colour, not the tiles.
  - The shade layer's brighter-than-camera veil uses the same colour.
  - Checked: in sun at ground level the horizon runs smoothly into the near fields (67,76,57 down to 53,64,38). From 2 R raised under the storm, the far land and tiles meet at the same value. Under the base, the far land past the base's edge is a little brighter than the ground underfoot (45-50 against 30-36), with no hard edge.
- **Sky crescent under the wall cloud after a tornado lifts (fixed).** BaseDeck now leaves out discs only where the planned hole and the live wall cloud (`wallStreamBase`) both are. When the wall cloud has moved, the deck covers the part of the old hole it left. Checked after a lift: the base above the old track stays solid.
- **Ground under the base.** OutdoorAmbient's floor is now 0.7 + 0.3 D. Grass tiles seen at ground level under a low base still read about 30/255, which is Roblox's own shading of Grass in flat ambient light. Lifting it further would mean a brighter OVERCAST_FILL in Sky.luau.
- **Still open:** faint terracing in the far rings from raised cameras.

## Round 34 (2026-11-02): far-land terracing

- **Cause.** Each far ring is one flat colour, hazed by Roblox at its own distance, with only a 3% feathered top. From a raised camera the land stepped down in bands, about 8/255 apart.
- **Fix (Render/Ground).**
  - Each ring's top is now feathered across the whole band between its ground line and the next farther ring's: `hc·(1 - dR/dN)/hM` of the card, worked out every frame from the camera's height. The farther, hazier ring fades into the nearer one as a smooth gradient.
  - At ground level the feather stays ~3%.
  - The farthest ring feathers as if another ring stood 40% beyond it, which softens its saw-toothed edge against the sky.
  - Cards are now twice the ring's spacing (was 1.15×), so every point sits under two cards alike. The feathered tops had stacked only where neighbours overlapped, giving card-wide vertical stripes.
- **Checked from 2 R raised under the storm.**
  - Down the band, the values had held flat in steps (118, 118, 118 / 111, 111, 111 / 103 …). They now fall steadily from 171 to 87.
  - Side-to-side variation mid-band went from 2.4 to 1.3.
  - Faint card seams are still visible when zoomed.

## Round 35 (2026-11-02): funnel join, tornado counterparts, dust, far-storm order

- Funnel top (TornadoCards): smoke body no longer faded where it flares; fadeTop starts at H.
  The flare is held to the shape rule again (holding it under the lowering's floor drew a mushroom).
- Static tornado scenes now hold their SETTLED tornado (VisualTests.SETTLE = 600 s, 1 s steps).
  At 150 s they showed a half-settled state no live tornado keeps (stovepipe vc 60 / rc 88 vs settled 79 / 63).
  Their storms are refit so the settled state is the old look (settled swirl 0.25 vlow rlow / (700 wLow),
  wLow = W fW + vmid/2; Ru +15%, vlow -16%, W 0.8x, rest from vmid; cone vlow 25 for ground contact).
- Tornado counterparts SC2 cone, SC3 stovepipe, SC4 wedge, SC5 uncondensed, SC6 multi-vortex, SCK tube.
  Each is the SC lifecycle in the scene's air mass, base and seed. The low meso tightens to at least
  SC's mature storm (W 42, Ru 3000, vlow 30) to make the tornado, then broadens into the scene's
  storm at <= 2 m/s of meso drift (faster cut the tornado off), holds 25 min, then occludes.
  A lab storm's genesis tornado gets the scene's identity (seed x 7 + 11).
  Verified: SC3 = stovepipe numbers; SC6 survives the broadening to multi-vortex.
- Dust skirt sized halfway between the funnel's foot and the core (was the core: ~400 m of dust round a 46 m foot).
- Tornado scene cameras ~0.6x closer (900 m cone/stovepipe).
- Far pull keeps depth order (LabConfig farPull: 60000 + 15000 (1 - e^-(d-60000)/15000) studs), so a far storm
  no longer sorts through a nearer one. Not yet checked in Studio.
- Open: SC2/SC4/SC5/SCK and the refit wedge/uncondensed/multi/tube statics not viewed yet.

## Round 36 (2026-11-03): why the lifecycle tornadoes all looked alike

User: in SC2-SCK the wedge never looked like a wedge, and once the meso broadened the tornado was "no longer fully condensed".

Measured in Studio. These are the panel's new `organised · decay · lean` line plus vc, rc, swirl and cloud base:

| | vc | core | swirl | cloud base | decay | lean |
|---|---|---|---|---|---|---|
| static wedge (settled) | 42 | 175 m | 0.79 | 350 m | 0 | 26 m |
| SC4 at sim 83-93 (after broadening) | 48-49 | 167-169 m | 0.78 | 350 m | 0 | 34-38 m |

The simulated tornado is the scene's tornado: no cut, no decay, no lean penalty. The difference was the camera.
- **Cause.** The lifecycle shot followed the storm's centre (`focusKind "storm"`). The tornado sits under the low meso, 0.6 Ru away: ~3 km for the wedge, through the forward-flank rain. Every lifecycle tornado was therefore seen small, greyed by rain and alike. The farther the meso broadened, the more washed out ("not condensed") it looked.
- **Fix, `client/UI/VisualTests.luau` update.** A storm lifecycle scene (`life` + `noTornado`) focuses its storm's tornado while one is alive (or ended < 60 s ago), and goes back to the storm after.
- **Fix, `client/CameraRig.luau`.** The focus-kind change no longer resets the distance (900 / 18000) under a keyed shot: the shot's keys hold it.

Checked: SC4 now shows a broad funnel into the base from the near key. SC2/SC3/SC5/SC6/SCK not yet re-viewed with the new focus.

### Round 36b (2026-11-03): what the static tornadoes have that the lifecycle ones don't

User: SC2 had no visible tornado; SC4 isn't a wide wedge and isn't fully condensed; the dust skirt is huge; a wedge's core should be bigger than 175 m.

**New debug readouts.**
- F3 overlay: the server dumps the newest live tornado's full state plus its parent's supply every 2 s (Workspace attribute `TorDump`).
- The H panel shows the focused tornado's rain grey, sight, wrap, light and sight-line rain.

**Measured** (static scene, then lifecycle):

| | vc | rc | swirl | supply | rain grey | sight | sky / sun / side light |
|---|---|---|---|---|---|---|---|
| Static wedge | 42 | 175 | 0.79 | same | 0.73 | 0.20 | 0.15 / 0.15 / 0.04 |
| SC4 | 48 | 169 | 0.78 | same | 0.16-0.23 | 0.77-0.87 | 0.22 / 0.28 / 0.71 |
| Static cone | 52 | 120 | | | | | |
| SC2 (at its moment) | 47 | 120 | | | | | |

**Findings.**
1. **The simulated tornado is the same.** Same supply, same seed, no cut or decay. The difference is what surrounds it and the moment it's seen.
2. **The static wedge stands in 1-5 mm/h of its own warm-up rain** (sight line 1-5 mm/h, wrap 5). This greys the funnel into a flat, dark, solid mass with no lit side. The lifecycle's tornado is in clear air (0 mm/h), lit, with strong side contrast: the see-through edges show. That is the "not fully condensed" look.
3. **Neither is a wedge.** At vc 42-48 and rc 170-175 under a 350 m base, the funnel at the ground is 57-124 m in radius, a third to two thirds of the core. A wedge needs ~vc 60 with rc 400, or moist core air.
4. **The cone condenses to the ground only above vc ≈ 50** (520 m base). The tornado's pulse moves vc ±20-30% over minutes. The static scene froze a moment at vc 52; SC2 was at 47, so no funnel reached the ground and only the dust whirl showed. The dust tube/skirt is sized to the core (120 m) round nothing condensed: the "huge skirt".
5. **SC2 had no tornado at all before.** Genesis takes 60-75 min with the organising storm; the broadening began at a fixed 65 min and killed it.

**Fixes.**
- **Lifecycle waits for touchdown.** `Storm.applyPin` holds the scripted clock at a key marked `waitTornado` until the storm has made its tornado (1 h at most). SC2-SCK mark g(3600). The storm snapshot carries `pinWait`; the keyed camera shifts its later keys by it (`waitAt`, `stormId`). SC2 now makes its tornado (78 min).
- **Scene builds clear old rain.** They clear rain parcels (`Precip.clearNear`) and ground wetness within 40 km of the old lab storms and the new site. Before, a static scene's rain veil and core moisture depended on the scene run before it (sight 0.21 vs 0.77, coreWet 0.02 vs 0.09 for the same wedge).

**Open (needs a decision).**
- The wedge's size. Lab/genesis tornadoes get rc = 0.05·rlow·(0.5 + 2.2·swirl). The game's engine tornadoes use the damage path width instead, so the rule doesn't touch them. This tops out at ~0.13·rlow before swirl > 1 turns it multi-vortex, so no storm we can set gives a wide, single, condensed wedge.
- Real wide tornadoes have cores of 300-500 m+.
- Making the static scenes match what a live tornado looks like most of the time, not one frozen moment.

## Round 37 (2026-11-03): a real wedge, refit scenes

User: "go with your recommendation" (wide strong rotation makes a bigger single core; refit scenes so their look holds through the pulse). Then, of SC4: "that looks like a multi-vortex not a wedge".

- **No rule change was needed.** Python copy of the settling maths: a wide, high-swirl storm already settles to a ~300 m core whose funnel condenses well past it (sub-vortices inside the cloud). The fix was a refit plus two renderer bugs.
- **Refits (shared/VisualTests):**
  - cone_partial: Ru 3400, vlow 29, base 600.
  - The seed-103 stovepipes: vlow 34.
  - wedge_rain: W 45, Ru 6500, vmid 24, vlow 34, base 600, lowering 250.
  - Wedge camera: 1200 m.
  - Measured static wedge: vc 57, rc 317, swirl 1.25, funnel at ground 375 m, EF5. SC4 at the same stage: vc 53, rc 315, swirl 1.25, funnel 307 m.
- **Renderer (client/Render/TornadoCards):**
  - The multi-vortex shell thinning was linear in 0.7·core/condensed radius, which left a 950 m-wide wedge half see-through (shell 0.93). Now it uses the shell's own extinction: `thin · exp(−2·BETA·max(0, rcond − 0.7·rcore))`. A funnel condensed past its dry core is opaque. The multivortex scene (parent not condensed at the ground) keeps its see-through bowl.
  - Sub-vortex tubes inside the parent's condensed radius are hidden (smoothstep on their offset vs `Vortex.condensationRadius`).
- **Keys:** with F4 open, Shift + a scene's key runs its lifecycle counterpart (Shift+4 = SC4, Shift+K = SCK). Mouse clicks on the F4 panel stopped registering in Studio's play view.
- **Seen:**
  - The static cone is solid to the ground.
  - SC4 shows a broad dark wedge in clear air, no legs.
  - Not yet orbited; SC2 not re-checked.
- **Open:**
  1. The static wedge still stands in 5–6 mm/h of its own storm's rain along the 1.2 km sight line (rain grey 0.63–0.68). SC4 has 0 mm/h. This is not leftover warm-up rain: it barely fell over 2 min. Both tornadoes sit at `lowMesoAt`. Cause unresolved; suspect the fresh full-size storm's rain pattern vs SC4's storm, which broadened late.
  2. The sim stage label still says "multi-vortex" (swirl > 1). That is correct physically: the sub-vortices are inside the cloud.
  3. The wedge merges into the base without crisp sides at some pulse phases.

### Round 37b (2026-11-03): why wide funnels never look condensed

User: "our wedges don't fully condense into a funnel; this is what was happening to any tornado that was broadening", then "the funnel is see through and the cards are way too big".
- **The drawing style in use is `smoke`** (LabConfig.TORNADO_STYLE), not `volume`. Its body is 380 sprites sized from the radius (2.7–3.8 rc). A wide funnel's sprites end up narrower than it and spread round a ring, either from the 2.5:1 shape cap (squat wedge) or the two-celled push out to 0.7–0.95 rc (high swirl, i.e. any broadening tornado). The opacity rule assumed every sprite covers every point, so wide funnels drew see-through and blotchy.
- **Fixes (client/Render/TornadoCards, smoke body):**
  - Opacity counts only the share of sprites that cover a point: ring geometry `(2/π)·asin(w/2rr)`, or `w/2rc` when tiled.
  - **Wide funnels are tiled:** `tileK = smooth(0.25, 0.5, rc/arcL)`. Sprites are sized `sqrt(2·rc·arcL·25/NSMB)` (~25 deep; ~140 m on a 900 m wedge), spread across the width toward the edge, and use the soft haze puff, because tiled smooth puffs showed their rims as bubbles. Tiled haze opacity cap is 0.45 → 0.6.
  - Cones, stovepipes and ropes (rc/arcL < 0.25) are unchanged.
- **Seen (SC4, vc 65, funnel 459 m at the ground):** one smooth dark mass from the base to the ground. Still soft-sided, and thin at the foot in places. Not orbited.
- The `volume` body readout now also shows slice kind (PUFF/slice/soft/caps) at 4 heights. That style isn't in use.

### Round 37c (2026-11-03): wedges drawn as cones are

User: "wedges should have tornadocards behave how we do for cone and stovepipe tornados, just with more to handle the thickness of a wedge. The current look [haze tiles] is very poor, especially at 1x."
- **Haze tiling removed.** Wedges use the cone's smooth cards.
- **Two-celled push to the shell** (rf → 0.7–0.95 rc) is now scaled by the shell's extinction, `thin·exp(−2·BETA·max(0, rc − 0.7·rcz))`. A funnel condensed past its dry core keeps its cards near the axis, like a cone.
- **Squat cap (w ≤ 2.5·hsMax):** cards spread over a disc out to the rim radius (`rEdge·u^0.35`) instead of a ring, so the outer rims make the outline and the rest fill the middle. Opacity coverage is `w/(2·rEdge·rc + w)`. A short wedge already has ~100+ cards over each height, which is the "more of them".
- **Keys:** Home 1x, Delete 15x, End 60x, Insert pause (client/Panel). Panel buttons don't take clicks in some Studio layouts.
- **Seen at 1x on SC4:** an opaque dark column from the base to the ground, no holes or bubbles. Not orbited. The cone and stovepipe scenes are not re-checked; they should be unchanged (no squat cap, low thin).

### Round 37d (2026-11-03): feathers fixed; surface card layout (experimental)

- **Feathers:** each smoke card's random tilt was scaled by `(hs/w)^-1.5`, meant to calm tall rope cards. On flat wedge cards (0.4 as tall as wide) it was ×4, up to ±100°. It is now clamped to ≤1 by stretch either way. Wedge cards are at most 1.8:1 (was 2.5:1) and spread across the width by a golden-ratio sequence. In the radius layout, SC4's wedge body is now a solid dark column, no feathers.
- **Surface layout** (user: "a standardized way to morph from stovepipe to wedge"; Ctrl+T, `LabConfig.SMOKE_SURFACE`, **default off**):
  - Card heights are spread by surface area. Card size is `min(2.7–3 rc, 0.45·arcL, sqrt(80·area/(0.9·NSMB)))`, with the rim on the surface.
  - It blends back to the radius layout from the flare's start; the flare counts in the area sharing as the funnel where it starts.
  - On a wide surface, ~60% of the cards are rimless haze (the fill). The smooth ones fade unless they sit on the sides as seen (the outline).
  - Opacity comes from the local area density.
  - **Seen:** the stovepipe is the same as the radius layout. The SC4 wedge went from round bubbles (smooth cards on the face) to too faint (haze fill + faded smooth cards). Not usable yet.
  - **Open:** the fill needs more opacity (the haze K/cap) without bubbles.
- **Both layouts:** bubbly grey lobes in the flare/lowering above a wedge.
- **Speed keys:** Home 1x, Delete 15x, End 60x, Insert pause.

### Round 37e (2026-11-03): wedges as cones, flatter (the squat branch removed)

User: "use reference images of wedges… it worked at 175 m, check how wedges looked a day ago".
- **A day ago, rebuilt:** TornadoCards from the file backup before Round 37 (only the shell extinction and sub-vortex hiding undone), plus the old wedge_rain storm (W 38, Ru 5200, vlow 21.7).
  - Settled it is vc 42, rc 175, funnel at ground 66 m. In Studio there was no funnel to see, only dust in the storm's rain.
  - The 175 m "wedge" was a narrow cone greyed by rain; there was no wedge look to restore.
- **Reference:** `docs/tornado-reference/frames/clip_2026-02-28_10-44-44_sheet.jpg` shows one smooth dark mass, a bowl wider than tall, with soft frayed sides and no card shapes inside.
- **Fix (client/Render/TornadoCards, smoke body, radius layout):** the squat branch is removed.
  - It narrowed cards to 2.5:1, later 1.8:1, and spread them across the funnel, so their rims showed as bubbles and feathers.
  - Every funnel now uses the cone's rule: cards ~2.7–3 rc wide on the axis, no taller than ~0.35 of the funnel's length, flattening down to 1:6 (`max(hsMax, w/6)`).
  - One rule from rope to wedge, so a broadening tornado morphs smoothly.
- **Seen:**
  - Static wedge (key 4): a dark mass with soft sides, like the reference.
  - SC4 at 1x after broadening: a broad smooth dark bowl from base to ground, stable over time.
  - Cone (key 2): unchanged, solid.
  - Orbit not checked (Studio input can't drag the camera).
- The surface layout (37d) stays off and is not needed; Ctrl+T still toggles it.

## Round 38 (2026-11-03): supercells decay into the cloud they built

User: "supercells decay strangely, with a skinny tower that looks nothing like what happens (outflow dominant storm mode, squall line, etc)". Diagnosis and sources: `docs/stormlab/research/SUPERCELL-DECAY-RESEARCH.md`.
- **Why:** the cloud was drawn from the live updraft (StormShape `cloudR` from W and Ru). When the updraft died the tower narrowed to ~3 km wide and 11 km tall; the anvil root and base deck pinched in with it. The SC scenes also scripted the decay (W 25 → 10 → 4, Ru 3000 → 1800) and forced `dead = false`.
- **Cloud memory (Sim/Storm `stepCloud`):** 17 levels every 1 km, each with a remembered radius R and condensate Q.
  - The updraft fills a level out to its live cloud in ~3 min with the water its parcel brings (Qf: a quarter of the inflow vapour less the parcel's saturation).
  - Unfed, the edge erodes at `U_MIX·Dq/(Q + Dq)` (U_MIX 3 m/s; Dq is the level's saturation deficit, over ice once glaciated). The water falls out over 20 min (liquid) to 50 min (ice).
  - Dry mid-levels go in tens of minutes. The glaciated top lasts hours, because cold air holds little vapour. No per-case tuning.
  - Drawn: `max(live, remembered)` (StormShape `cloudR`), so the card tower and the mesh body both keep the width. The live cloud needs an updraft (`× ramp(W, 0.5, 3)`).
  - Engine storms get it too (Storm.step runs for them), including after the engine drops them.
- **Texture from freshness (CardPlan):** per level, `freshAt` is the share of the drawn cloud the updraft still feeds, `(live/drawn)²`. Ring lobes, billows and the top dome are crisp lumps only on that share, dithered card by card so it changes gradually. The rest is soft sheet where liquid and wisps where glaciated (above freezing + 3–6 km). It thins as its water rains out.
- **Stratiform rain (Storm `emitPrecip`):** the remnant's falling-out water (`s.stratRate`) is released from the ring between the live cloud and the remnant's edge, as rain or melting snow. It feeds the cold pool and the forward-flank cloud cards.
- **Anvil (Storm `stepAnvil`):**
  - Fed in proportion to the updraft (`ramp(W, 4, 12)`; was all-or-nothing at W 8).
  - Unfed, it sublimates over the anvil level's own erosion time (1800–14400 s) and drifts off on the anvil-level wind (`s.anvilGap`, at most its own length): an orphan anvil.
  - Its root keeps the width of the tower top that fed it (`s.anvilRootR`). Dead storms do the same; they no longer lose a fixed 4 m/s.
- **Outflow feedback (partial):**
  - `Storm gustFront` now also gives `gustL`: the lift per ray, the pool depth against the inflow LCL × the front's speed.
  - It also gives `gustRkw`: the front's RKW where it has run out between the updraft and its inflow. `balance` uses `max(rkw, gustRkw)`.
  - The single-storm shelf (StormCards) is driven by `gustL`, not W, and is no longer gated off for dead storms. Dead storms keep stepping their gust front.
  - The Ru cut at W 6 is now continuous.
- **Base deck:** it needs an updraft (`× ramp(W, 0.5, 3)`) and is at least the remembered foot (`1.1 × mem(base + 500)`); there is none when Rb < 600 m. A dead storm's fade is now `min(old 25-min ramp, 1 − cmVis)`. World keeps a dead storm while its remnant or anvil shows (at most 4 h).
- **Scenes (VisualTests):**
  - The keyed decay is gone from SC, SL and SC2–SCK. A `free = true` key (SC/SL at 7500 s, the counterparts at T2 + 1500, after their rope-out) hands the storm to its own physics, eased over 15 min (`Storm.applyPin`: every pinned field blends to the storm's own value, `pin.freeU`).
  - Air mass (base, pw, rhMid) stays pinned. The storm can die once free.
  - Tornado timing is untouched: nothing before the free key changed. The waitTornado shift applies to the free time too.
- **Files:** `shared/Sim/Storm.luau`, `shared/Sim/World.luau` (removal), `shared/Sim/Frames.luau` (`STORM_OPTIONAL`), `shared/VisualTests.luau`, `client/Render/CloudParts/StormShape.luau`, `client/Render/CloudParts/CardPlan.luau`, `client/Render/CloudParts/ShelfPlan.luau` (a dead storm's base), `client/Render/StormCards.luau` (shelf), and the new tool `tools/stormlab/diag_decay.luau`.
- **Offline checks** (`luau diag_decay.luau`; offline runs need a copy with SubVortices' `require(script.Parent.Noise)` patched: `tmp/decay/sync.sh`):
  - Mature storms are unchanged: remembered = live within 0.1 km, stratiform 5–9 t/s against 600 t/s of convective rain.
  - SC with the old keyed collapse (W 25 → 4 by 9000 s), widths at 3 / 6 / 9 km:
    - at 7500 s: 5.5 / 9.1 / 11.5 km;
    - at 9000 s: 1.1 / 6.7 / 11.1;
    - at 10800 s: 1.0 / 2.6 / 10.1;
    - at 14400 s: 1.0 / 2.1 / 8.1 (was 1.0 / 2.1 / 3.4 live at 9000 s, the skinny tower).
  - In that run, stratiform rain peaked at 225 t/s 15–25 min after the collapse and was 80 t/s 1.5 h later. The anvil went 96 → 70 km and drifted 70 km off.
  - MG (key `): the merging cell dies at ~1500 s. Its 6 km level is gone ~20 min later; its 9 km ice is 4.3 km wide after 45 min.
- **Not a decay in the Supercell scenario:** freed at 7500 s, SC re-strengthens to W ~58 m/s (CAPE 4100–4500, CIN 0, gustRkw ≤ 0.05, 0–3 km shear too strong for its pool). Cooling the boundary layer by 9–12 K over 1.2–2 km still left 1400–2900 J/kg (Thermo.parcel). So SC/SL/SC2–SCK no longer end by decaying here; the scene says "free: its own physics".
- **In Studio:**
  - SC (key ', 60x): unchanged up to ~2 h (7500 s). From there the storm is free; check that nothing jumps over 7500–8400 s.
  - MG (key `, 15–60x) from ~1200 s (~20 min): the cell drawn into the supercell should leave a soft, wide, fading mass with a fibrous top, not a thin column. The remnant may hide inside the big storm, so look from the cell's side.
  - The game: a storm the engine drops should keep its body, erode from the bottom up and leave a drifting anvil and light rain for up to an hour or more.
  - Check soft/wisp remnant cards, the orphan anvil and the shelf from several angles.
- **Open:**
  1. Nothing in the Supercell scenario ends a supercell within 2.5 h. A visible SC decay needs a scenario or time of day whose air ends it; the scene could offer a hook for that.
  2. Fix 3 is partial: the inflow parcel does not yet come from behind a leading gust front, and the updraft does not drift toward the front. Those would touch `inflowPoint`, which feeds the low meso and genesis, so they wait for the tornado work.
  3. gustK/gustRkw use the 0–3 km shear magnitude, not its component normal to the front, so a supercell in strong shear is never outflow-dominant.
  4. The remembered cloud sits on the current tilted axis. It does not drift downshear on its own; only the anvil does.
  5. `followEngine` still clamps W ≥ 5 and Ru ≥ 1500 while the engine runs a storm.
  6. U_MIX 3 m/s gives ~60 min for a 9 km wide mid-level in RH 0.3. LP cases may want faster.

## Round 39 (2026-11-03): tornado morphing, cyclic and landspout genesis, SC decay, cone squash, wedge wobble
User asked for: tornadoes that morph between types (wedging out, a wedge narrowing back to a stovepipe as the base rises, and more), more genesis types, no quality loss through a transition, the cone looking squashed, supercells decaying as a skinny tower, and wedge genesis wobbling. Research: `docs/stormlab/research/TORNADO-MORPH-RESEARCH.md` (P1-P10) and `SUPERCELL-DECAY-RESEARCH.md` (Round 38 did the decay rendering).

- **Cone squash (TornadoCards).** The card flattening was keyed on each card's own width, so it hit the cone's flare. It is now keyed on the whole funnel's squatness, `hsAsp = 1.8 + 4.2·smooth(0.3, 0.8, rc(quarter height) / arc length)`: 1.8:1 on a cone, up to 6:1 on a wedge, continuous between them.
- **Wedge wobble.**
  - TornadoCards' shell thinning read the live sub-vortex count, which jumps between whole numbers, so the shell swung 0.4 ↔ 0.9 and cards jumped between axis and ring. It now uses the swirl's continuous sub-vortex index.
  - Tornado.step's contact wander ran on a fixed 17 s clock, so a 300 m wedge swung ~80 m back and forth as it broadened. Its phase now advances with the core's turn rate (vc/rc), integrated.
- **Morphing (all continuous, from fields):**
  - P1, core condensation level from the air the core takes in. `Tornado.step` mixes the wall cloud's air with the cold-pool air at the contact. The more the RFD has wrapped round it (occlusion, decay), the more pool air: its LCL is ~125 m/K of dewpoint depression, less its deficit, closed by its moistness. Dry RFD air raises the funnel base: the funnel lifts and narrows, so a wedge goes back to a cone or rope. Moist outflow lowers it: the funnel fills in and wedges out. Sent as one snapshot field, `coreZb` (read by `Vortex.coreBase`; ground wetness counts only for the share not already pool air).
  - P3 (tornado half): the core contracts in ~20 s and broadens over ~60 s, so a strong wedge can tighten back quickly.
  - P7, multi-vortex-first genesis: `SubVortices.index` no longer needs organisation (O). A broad, high-swirl young vortex starts as several sub-vortices. The hollow core stays O-gated.
  - Not done: P4 (dying core widens), P5 (trajectory envelope), P6 (rc growth with height from swirl), P8 (inflow depth). Each changes the approved cone/stovepipe/rope looks and needs its own Studio check.
- **Cyclic tornadoes (P2, World).**
  - When a storm's occlusion reaches 0.6 (where Tornado.step cuts the tornado off), its low-level circulation is detached (`detachOccluded`). It becomes the tornado's own parent and drifts on the 1.5 km wind, which takes it left of and behind the storm. It spins down over ~10 min and keeps only the stretching the storm's updraft still gives at its distance.
  - The storm is released: an own storm resets its occlusion right away and organises its next circulation while the old tornado ropes out.
  - This fixes the low-meso jump (~1.5-2 km) at the occlusion reset that a still-living tornado used to follow.
  - The genesis drive fades out over occlusion 0.45-0.6, so no new tornado starts in a circulation that is about to be cut off.
  - Offline (Supercell world): T01 detached and ended on its own circulation ("parent kind occluded").
- **Outflow-dominant transition (Storm.environment).**
  - The inflow reaching the updraft over the storm's own cold pool (the pool sampled from Ru out to the inflow point) is the pool's air, so the storm goes elevated. The decay agent left this open (Round 38 open item 2).
  - Genesis needs surface-based inflow: × ramp(`sbShare` = sb CAPE / mu CAPE, 0.3, 0.8).
- **SC decays from its air (Round 38 open item 1).**
  - A scene air-mass pin, `dryK`, keyed from 7500 s (0) to 9600 s (16 K): the storm runs off the moisture axis, with boundary-layer dewpoint lowered, tapering out over 1.5-3 km. `life` is now 12600 s.
  - A night's cooling or a 4 K warm layer aloft barely touched this air (CAPE 4100 → 4277).
  - Offline:
    - CAPE 4041 → 9 J/kg; W 40 → 2.5 m/s by 11400 s.
    - Remembered cloud 8.6 / 10.5 km wide at 6 / 9 km while the live updraft is 1.6 km (no skinny tower).
    - The anvil detaches (6 km gap); stratiform rain peaks at 159 t/s.
  - SL inherits the keys. The SC2-SCK counterparts are unchanged.
- **Landspouts (new `Sim/Landspouts.luau`, L6 scene).**
  - Misocyclones roll up along detected boundaries (Boundaries) where the along-boundary wind changes across them (sampled one surface-grid cell either side), at ~dV/2 over 0.6-1.4 km, spaced ≥ 6 km apart.
  - A cell's updraft over one stretches it: circulation is kept, w(base)/base converges it, and v = Γ/r.
  - A G integrator (like the QLCS mesovortex one) on ζ × stretching × (not undercut by outflow) starts a tornado through `World.parentOf` kind "misocyclone".
  - Nothing shapes it: small rc and low swirl under a high base give a dust column with a stub aloft.
  - The Supercell world's boundaries only resolve 2-3.4 m/s of wind change, so there were none in 2 h offline. That's honest for that day, so it isn't forced.
  - Scene L6 (F4 open, Shift + ;): a young non-rotating cell, base 1700 m, over a misocyclone with dV 9 m/s (`scene.miso`, pinned to its boundary's circulation). Offline it stretches to rlow 480 m / vlow 9.4. Tornado at ~1900 s: rc 35 → 18 m, vc 17 → 28 m/s, EF0-1, funnel aloft only.
  - The base updraft uses max(wprofAt(base), 0.35) of W, because of Storm's known profile issue (speed restarts at the base).
- **Tools:**
  - `tools/stormlab/diag_landspouts.luau`: a scenario world, boundaries, misocyclones, tornado parents.
  - `tools/stormlab/diag_landspout_scene.luau`: L6 offline.
  - Both run via `tmp/decay/sync.sh` + luau.
- **Not seen in Studio.** The play session started without errors, but its view stayed a stale frame and keys did not reach it (Studio not foreground), and it ended at its 10-min limit.
- **To check in Studio** (Studio in front):
  - SC4 (F4, Shift+4) at 1x/15x near genesis: wobble.
  - Cone (F4, 2): not squashed.
  - SC (key ') from 7500 s at 60x: decay, from several angles.
  - L6 (F4, Shift + ;) at 5-15x.
  - Any lifecycle with an occlusion: the old tornado drifts left-rear while the storm reorganises.

## Round 40 (2026-11-03): hazy big tornadoes, transitions (the diagnosis order, steps 1-5)
User: "large tornadoes look hazy/blurred"; then "go for the order" of the diagnosis.

1. **Wide funnels: edge in metres, a lit and a shadow side (client/Render/TornadoCards, smoke body).**
   - Cause: every body card is ~2.85 rc wide, its edge ramp ~0.11 of its width, spread 0.2 rc round the axis. Offline (tmp edge model, real texture formula) the 90→10% edge was ~0.2 rc: 22 m on a cone, 65 m at rc 320, 104 m at rc 450. Each card is one flat colour as wide as the funnel, so ~130 stacked drew a wedge in one tone.
   - `RC_EDGE` 120 m (the approved cone). Past it each card takes the sharper puffs (`smoothPuffSharp2/4`, tools/smooth_puff_sharp.py, same lobes, ramp 1/2 and 1/4; uploaded) by its own seed, and the spread and width jitter scale by RC_EDGE/rc. Offline: edge 28-38 m at every size. At or under 120 m nothing changes.
   - `NSKIN` 60 of the 380 body cards are the skin: haze puffs on the near surface across the face, each `shadeAt` its place (lit/shadow side), tone from the turbulence field there. Fade in past RC_EDGE (full by rc ~300), not in the flare, not from closer than ~1.3-2.2 rc, not in a two-celled shell.
   - Seen once (static wedge, Studio in background): crisp right edge against the sky, no errors. Not orbited; skin shading not judged.
2. **No painted fades (client/Tornado/StateAdapter).** Opacity no longer 0.25 + 0.75 O (O already scales vc in the sim). An ended tornado keeps its entry: vc, peak wind and lofted dust decay on the sim clock (25 s / 40 s), it drifts on, and goes once vc < 4 and dust < 0.03 (then 2 s fade). Scene changes (endedFor 1e9) still clear at once.
3. **One lowering per circulation.**
   - Sim (World detachOccluded / stepOccluded): the occluded parent's occlusion carries on from 0.6 (was set to 1: the RFD push on the contact jumped), its base follows the storm's, and its wall base rises as it leaves the updraft's reach (lowering x wLow/wLow0; the lowering is mostly the updraft's moist inflow, the spin's own part is tens of metres). Offline: 543 → 963 m over 6 min while T01 ropes out.
   - Sim (Tornado.step): a cut-off tornado's held values follow its occluded parent's spin-down (~3 min), or spin down by themselves with no parent (no hard vT = 0 while a cut is held); recovering, it blends back to the live supply over the last 0.3 of its decay (was a step at decay 0).
   - Snapshot: `pk`, `ovl`, `obase`, `oocl`.
   - Client (WallStream): a detached tornado gets its own lowering (stand-in storm from its snapshot) and takes over the set its storm drew round it; the storm's new one grows from nothing. A storm that cycles with no detached tornado leaves its old set as a ghost that fades where it was, drifting with the storm. Every set has a presence eased over ~20 s sim (in and out: no more vanishing at death or at the gates). Centre offset, R and wall base eased over 2 s. Young lowerings start at 0.3 of full width (was 0.7), here and in CardPlan. MAXS 3. The storm's lowering no longer follows a detached tornado.
   - Offline (diag_cycle.luau, Supercell world): T01 detaches at m23 as its storm cycles; lifetime unchanged (ends m29).
4. **Card identity (CloudParts/CardPlan, StormCards).** After each plan, cards take the key, sheet frame and turn of the nearest same texture+section card in the storm's last plan within 0.6 of their size (`rekey`; 400 m grid, 8 km grid for cards over 4 km, search ≤ 2 cells; offline 10.5 ms for 1500 cards, all kept on a 150 m shift). Kept cards ease to their new place and size over `MOVE_T` 2.5 s. `detail` steps by 1/8 with a 0.1 margin and counts live storms only. (A first version searched by reach in the fine grid and hung the client on anvil cards: fixed before it was seen.)
5. **Fades, not switches.** CardPlan `presA` x card opacity per section from ramps: tower (fade 0.6-0.97), overshoot (maturity 0.9-1, fade < 0.15), anvil (`sh.anvil.a`, length 0.2-0.6 root), forward flank (maturity, fade; each cell by ramp(r, 0.5, 3), walls by the neighbours' weights), base deck (`sh.deck.a`: maturity, fade, radius 300-900 m), inflow band / striations / wall scud by W (2-8 m/s) instead of `s.dead`, mothership plate by ramp(ms, 0.1, 0.3). TornadoDust: the tube's share of puffs is 1 - smooth(0.5, 3, condensed radius at the ground), per puff.

**Not done:** rain grey up to 0.8 and whether storm rain cards grey the funnel a second time; vc/rc eased on separate clocks (circulation not kept); sub-vortex merge/adopt snaps; rim scud (CardPlan cluster, Scud.luau) still at the storm's lowX; SceneLight still ignores the remnant cloud; stale stormBase in stream mode.
**To check in Studio (foreground):** static wedge and SC4 orbit (skin shading, edge); cone/stovepipe unchanged; SC at 60x through a cycle (old lowering goes with the rope, new one grows); storm death (wall cloud fades); growing tower shimmer (F3 `StormCardsPlan` new count).

## Round 41 (2026-11-03): physical volume storms - plan, cloud field, first volume cards
User: "make the entire storm physics based with card usage, so nothing is spoofed ... billboards used for the volume".
Plan: `docs/stormlab/PHYSICAL-VOLUME-PLAN.md` (5 phases). Done this round: phase 1 and a first cut of phase 3.

- **Cloud field (`shared/Sim/CloudField.luau`, new).** `CloudField.at(world, x, y, z)` / `CloudField.storm(s, tor, x, y, z)` give the cloud's condensate and extinction anywhere. Air is cloud past its condensation level `zc = LCL(air) - p'/(rho g)`: the inflow base, lowered by the ingested moist air round the low meso (the storm's lowering less vlow^2/g) and by the meso's Rankine deficit, and at a tornado by its core air (`Vortex.coreBase`) and `Vortex.deficit`. Base, wall cloud and funnel are one surface. Above it q = `gammaL` (z - zc) (new `Storm.gammaL`, the moist-adiabatic water gradient at the base, ~2.1 g/kg per km; in the snapshot). Column cloud above the base = live updraft (no floors) or cloud memory, with a mixed edge (DQ 1 g/kg). `Thermo.moistLapse` exported.
  - Offline check (`tools/stormlab/cloudfield_view.luau` + `cloudfield_png.py`, ray-marched views + slice, shots/cloudfield_*_sheet.png): funnel width matches `Vortex.condensationRadius` within ~5% to 200 m on the cone (126/168/246 m vs 130/174/266) and the wedge low down; the funnel flares into the lowering and base as one surface. 0.2-0.8 us a sample.
  - Simplifications to replace: the ingested air's share round the meso a Gaussian (1.5 R) - it spreads the lowering over ~5 km on the wedge storm, too broad vs a real wall cloud; DQ one value; no anvil yet; no turbulence.
- **`SubVortices.luau`** used `require(script.Parent.Noise)`, which broke every offline tool; now the two-way `dep` require like the other Sim modules.
- **Volume cards (`client/Render/VolumeCards.luau`, new; Backspace toggles; WallStream and TornadoCards stand down while on).** Wall: parcels on the condensation surface under the base, carried by `cw:windAt`, born where the surface is pulled down (a step >= max(30 m, h/4)), spacing by distance (25-800 m in steps of 2, theta follows a 600-parcel budget, fades across steps). Funnel: slices along the axis at the field's own edge radius (bisection) up to where the funnel is as wide as the wall spacing, plus 2 tags a slice orbiting at the vortex wind. Every card is the screen ellipse of its patch's 3-D half-extents (projected covariance), opacity Beer-Lambert through the patch (wall: its cell's tau shared over the overlapping cards, WFIT 2.8), light marched through the field to the sun and the open sky.
  - Studio (background, static wedge): runs, no errors, ~3 ms for ~650 cards. Look not there yet: the smooth/sharp puffs drew rims (bubbles), the haze puff at 10 deg spacing blotches; with the shared-tau wide haze it is a smooth dark mass with no structure. The wedge is wider than the wall spacing, so it is all wall parcels (no slices); the cone/rope slices are untested in Studio.
- **Next (in order):** look at it in the foreground from several views (wedge, cone 2, SC lifecycle); a sharper ingested-air boundary in the field (the wall cloud's real edge); detail from the field (turbulence on zc / the column edge) rather than from textures; then phase 2 (lifecycle from the gust fronts) with the regression suite.

## Round 42 (2026-11-03): wall-cloud edge, volume card cost, phase 2 probe
User: "Lets do it" (the Round 41 next list, in order).

- **Wall cloud's edge (CloudField).** The ingested moist air now lowers the condensation level only inside the low meso's rising core (radius R = 0.3 Ru) with a ragged edge: fbm noise moves the edge 0.8-1.2 R, and eddies a tenth of R across lift/drop zc by a fifth of the lowering plus 15 m of scud out to 2 R, all in the circulation's turning frame (angle less (V/R) t). Was a Gaussian of 1.5 R (a ~5 km smear). Offline (shots/cloudfield_cone_sheet_r42.png): ragged scud along the base, a wall-cloud shoulder flaring into the cone; funnel widths unchanged (126/168/250 m vs 130/174/266). Cost 1.7 us a condLevel (noise only computed where it can matter).
  - Back-trajectories for the edge were tried first (`tools/stormlab/diag_airmap.luau`): the sim's low-level rising air spans ~13 km, nearly all of it off the cold pool, so trajectories gave no edge.
- **VolumeCards cost** 11-30 ms -> ~7.5 ms up close, 5.5 ms further out (Studio in the background; split printed with the stats every 5 s: spawn ~1.1, seat ~1.8, light ~2.1, drawing ~2.5): parcels re-seat on the surface and read the wind 5 times a second (every frame within 5 core radii of the tornado), light shared by parcels in a cell of 2 h, one-sided slope. First-frame hitch (48 ms) removed by starting theta at its settled value.
- **Studio (cone, F4 2, Backspace):** chase, orbit left/right and zoomed out - the cone hangs from the wall cloud as one surface from every side (no tilt, no seam), drawn by wall parcels alone (h 100 m < the funnel radius). Still too dark and soft overall; no texture detail yet.
- **Phase 2 probe (no change made).** `tools/stormlab/diag_cycles.luau` (own storms, 2 h baseline: 3 rotating storms, 8 cycles, 1 tornado 16 min) and `diag_mesopath.luau`. The cold-pool deficit under the low meso drifts only 2.3 -> 3.5 K over a cycle and stays 67-95% liftable, so the plan's "cut off when its inflow is unliftable" never fires; the storm-relative low-level wind has a fixed convergence point at ~2.1-2.4 rad on the arc, so an advected low meso would park there and never occlude; the pool's own wind pushes it rearward (-4 to -6 m/s). The sim has no surging RFD gust front to wrap the circulation (the Round 14e attempt to sharpen the pool's front failed for the same reason). A physical occlusion needs a gust-front model (an outflow boundary that propagates as a density current against the inflow). Decision asked of the user.

## Round 43 (2026-11-03): RFD gust-front model - built, OFF by default
User: "Go for it" (build a gust-front model so occlusion and the cut-off come from physics).

- **`shared/Sim/GustFront.luau` (new)**: per storm, the RFD gust front as a closed loop of points (250 m spacing, at most 240) round the RFD's cold air, stepped every 10 s. A point moves with the low-level air plus its own advance c along the outward normal; c = the downdraft's wall jet, w Rd^2 / (2 r h) with h = max(pool depth, Rd/2) (continuity), or the density-current speed, whichever is more. The downdraft keeps the front out of its own radius; the front is followed to 2.5 Ru. The low meso moves with the storm on the warm side and, once overrun, by the outflow's share of its depth (h / 1.5 km). Occlusion = its depth into the cold air over the meso's diameter, or its distance from the updraft past 1.5 Ru (cut off at 2.25 Ru). The occlusion point (new meso) = where storm-relative inflow runs hardest into the front within 1.2 Ru of the updraft; a cycle needs it within 1.5 Ru. On a cycle the front goes on and the RFD source re-forms behind the new meso over 10 min.
- **Storm.luau**: `Storm.GUST_FRONT` (default **off**) switches an own, unpinned storm's occlusion, low-meso position (`lowMesoAt`) and RFD position (`rfdAt`) to the front (eased by a scene's free share, `gfK`); snapshots carry the meso/source offsets (`gfMOX/gfMOY/gfSOX/gfSOY`, `gfK`) so clients agree. `Storm.windAt(..., noRfd)` leaves out the RFD's own outflow and the updraft's inflow sink (cold outflow is not drawn into the updraft). Default path unchanged: `diag_cycles` matches the Round 42 baseline exactly (8 cycles, 1 tornado 16 min / 2 h).
- **What the runs showed** (`tools/stormlab/diag_gustfront.luau [min] [coupled] [stormId]` + a plot of the front; `diag_cycles ... front`), each fix moving the failure:
  1. meso as a passive tracer on the front: swept 2-3 Ru behind, cycles every 2-3 min;
  2. meso with the storm, overrun pushes it: ~6 min cycles (the meso's ~15 m/s spin turns the front past it in half a turn, ~4 min);
  3. front carried by the updraft's inflow sink (~20 m/s at 150 m): pulled into the updraft - removed (physically wrong);
  4. cut-off at a meso diameter: 16-18 min cycles (in the 15-40 min literature range) but 0 tornadoes - each new meso was born on a fresh front with the RFD right behind it;
  5. front kept through cycles, RFD re-forming: the occlusion point drifted > 1.5 Ru out and the storm cycled hundreds of times; limiting new mesos to the updraft's reach left storms stuck occluded with the front 1.5-2.5 Ru behind the storm (the 150 m storm-relative wind blows rearward);
  6. outflow with the RFD's origin-level momentum (1.5 km): the front surges forward as a real RFD does, but carries the meso to the storm's front-left (~1.1 rad off the heading, 1-2 Ru out). 0 tornadoes coupled in every run.
- **Why it is off:** the front amplifies how crude the sim's low-level winds are - the forward flank's outflow is a Gaussian blob, the meso's spin is full strength at 150 m, the RFD a fixed-radius downdraft placed behind the meso. Turning it on now breaks tornado production (the lab must make tornadoes).
- **Next if continued:** give the low-level winds the structure the front needs before tuning it again - the meso's spin decaying toward the ground (the cold air feels less of it), the forward flank's outflow as its own front (the triple point where the two meet = the occlusion point, as in Lemon & Doswell 1979), the RFD placed by the hook's precipitation rather than behind the meso; then rerun `diag_cycles ... front` against the baseline (cycles 15-40 min, tornadoes not fewer).

## Round 44 (2026-11-03): low-level winds rebuilt for the gust front - front ON by default
User: "yes, do the rebuild" (the low-level structure the Round 43 front needed).

- **RFD placed by its drivers** (Storm.step): the source is the weighted mix of the hook's rear-flank rain (the rain-weighted centre of `precip.rainRateR` within 1.2 Ru of the meso) and the dynamic site (the meso's upwind side in the 4 km storm-relative wind), weighted as `rfdT` weighs them, followed over 5 min. It is kept clear of the meso's core (at least Rd + R_low): sinking air can't sit in the rising, low-pressure core. Before this, the downdraft's own radius already touched the meso, and any spreading overran it at once.
- **Front start**: a new front begins at the downdraft's own edge, not through the meso.
- **Cold-air momentum**: the outflow moves with the mean of the 150 m and 1.5 km winds (RFD air mixes on its way down). 150 m alone fell behind the storm; 1.5 km alone overran it.
- **Meso spin felt by the cold air**: `Storm.windAt(..., mesoK)`, with `Storm.GF_MESO_K = 0.9` (VORTEX2: near-ground spin is about half to all of that at 1 km).
- **Triple point** (GustFront.step): the front point nearest the updraft where it stops facing forward-flank cold air (cold-pool deficit not from the RFD, over 1.5 K, 400 m outside the front) and starts facing warm air. It is where the next meso forms. Without one, the next meso forms where the inflow runs hardest into the front near the updraft, or at the updraft's rear edge.
- **Meso motion**: while warm inflow reaches it, the meso moves with the storm (it is regenerated by the updraft, not a material vortex). Once overrun, its lower part (the outflow's share of its depth) is pushed by the outflow. Tried and rejected:
  - Pulled toward the triple point at the local stretching rate: under 0.001/s there, since the front lies outside the sim's 1 km updraft.
  - Carried by its depth-mean wind with the inflow sink, propagating up the stretching gradient: blown off at about 12 m/s. The sim's kinematic updraft draws in only about 4 m/s at the meso.
- **Occlusion downdraft (Klemp & Rotunno) checked**: it never fires here (vlow 12-17 against vmid 25-34 m/s), so it was not added.
- **Results** (Supercell day, 2 h, 3 storms; `diag_cycles 120 quiet [clock | front k]`):

  | | cycles | tornadoes |
  |---|---|---|
  | clock (old) | 8 | 1, 16 min |
  | front k 0.65 | 0 | 1, never ends |
  | front k 0.8 | 1 | 1, 17 min |
  | front k 0.9 (default) | 2 | 1, 12 min |
  | front k 1.0 | 4 | 1, 9 min |

  Each occlusion now takes 12-18 min: the front wraps the meso, occl climbs 0 → 0.4 → 0.6 → 0.8, then the storm cycles. After a cycle the new meso is weaker (vlow about 10), so storms tend to go steady. The clock run also makes no second tornado.
- **SquallLine day** (`diag_genesis [clock | front k]`): 61 tornadoes in 2 h with the clock, 22 with the front. Fewer cycles means fewer fresh genesis chances.
- **Cost**: both lab days took 242.5 s against 241.4 s.
- **SC lifecycle scene** (`diag_decay life_supercell 9000 - - front:0.9`): identical while keyed. Once freed it stays unoccluded instead of creeping on, and its decay comes from dry air either way.
- **Studio**: a run test started clean, but its default scenario is engine-driven (the engine owns those storms' occlusion), so the front ran only in the offline tools.
- **Sensitivity**: the result depends strongly on `GF_MESO_K` (0.65 none, 1.0 four cycles). It is the one uncertain number; leave it at 0.9 unless a lab scene shows the wrong regime. `Storm.GUST_FRONT = false` puts back the clock exactly.
- Also fixed: a Round 44 edit had duplicated half of GustFront.luau, and the older step overrode the new one until it was found.
- **Studio check (same day, play test, Storms: own, Supercell)**: no errors. Two tornadoes by sim 9:21 (T01 from C002, T02 from C001), a third at 44:38 from C002. Chase view: a cone funnel under the lowering with debris. Orbit view: the funnel shrinks to a stub as T02 weakens to EF1. **Problem:** C001 never occluded (0.00 at sim 48:37), so T02 was still alive at 39 min as an EF1. With the front, a steady storm never cuts its tornado off. Offline runs missed this because there C001 made no tornado. Open: a tornado's end in a storm that doesn't occlude. (The Studio output's `loadstring() is not available` comes from an installed plugin, `cloud_10913122509`, not from the game.)

## Round 45 (2026-11-03): tornado decay under a storm that doesn't occlude
User: "Fix tornado decay, do the recommended fix" (Round 44's Studio check: an EF1 still alive at 39 min under C001, which never occluded).

- **Cause:** nothing in a tornado's decay read the gust front. The outflow's push on the contact and the share of cold air the core draws in both used the clock-style occlusion number, and the cut-off came at parent occl 0.6. Under a steady storm the front sat 300-1100 m off the tornado for an hour (`tools/stormlab/diag_tordecay.luau C001 10 70`: a tornado forced under C001, still mature at 60 min).
- **The front feels the tornado** (Storm.step, the front's wind): the tornado's own circulation, a Lamb-Oseen vortex (rc vc / r outside its core) fading over the low meso's core radius. It wraps the RFD's outflow round the tornado, as observed.
- **The tornado reads the front** (`Storm.rfdWrapAt`, Tornado.step): how deep its contact sits in the RFD's cold air, against half the low meso's radius. This depth now drives the outflow's push on the contact (the undercutting lean that makes the rope), the cold-air share of the core's air, and the cut-off (at 1).
- **Results:**
  - Forced tornado under C001: the front reached the contact at 18 min, the contact leaned about 250 m, then cut off, shrinking, rope, dissipating, and ended at 38 min. The storm's occlusion rose with it (0 → 0.54).
  - Supercell day, 2 h: 1 tornado of 10 min (it ends as the front wraps its contact, parent occl 0.55), 1 cycle.
  - SquallLine day: 24 tornadoes in 2 h (22 before).
  - Cost: both days 237.9 s (242.5 before).
  - Clock mode: unchanged by construction (no front, so `rfdWrapAt` returns 0).
- **Studio check (foreground, own storms): the fix isn't enough.**
  - T01 (C002, peak EF5) was mature at 27 min with decay 0; its funnel lifted only because the cloud base rose.
  - T02 (C001, EF2) was still mature at 51 min: decay 0, lean 6 m, path 35.7 km. C001 never cycled in 150 min (occlusion 0).
  - Offline repro (`diag_tordecay C002 9 60`): the cold air partly wraps the contact again and again (wrap 0.4-0.9), but the outflow's push carries the contact back out ahead of it. It never reaches 1, so the tornado lives 50+ min.
  - A stronger near-ground spin is not the fix: `diag_cycles 150 quiet front 1.0` gives 3 cycles but one tornado of 3 min (against 1 cycle and 10 min at 0.9).
  - Offline runs also don't reproduce Studio's natural C001 tornado: offline C001 makes none.
- **Open:** in a steady storm, nothing moves the low-level meso back into the RFD. It moves with the storm while warm air reaches it; tracking it as a vortex drifting in the wind was rejected earlier because it blew off at ~12 m/s.
- **Option 1 (user's choice): gradual weakening from cold inflow.**
  - `Storm.coldInflowAt` gives the share of the tornado's inflow ring (the low meso core radius, 0.3 Ru, round the contact) that lies inside the gust front.
  - Tornado.step smooths it over 120 s (`t.coldIn`). A fed tornado's decay changes by cold/300 − warm/600 per second, so more than a third cold weakens it while it is still fed.
  - Offline, forced EF4 under C002: weakening from 29 min, rope from 37, dissipating at 49-51 (was mature at 51+).
  - Offline, forced tornado under C001: ends at 36 min (was 38).
  - Supercell day: 1 tornado, 10 min, 2 cycles in 150 min. SquallLine: 24 tornadoes. Both unchanged.
  - Studio, foreground: T02 (C001, EF2; mature at 51 min last check) had ended by minute 84 (end time not logged).
  - Studio: T01 (C002, peak EF5) lived about 70 min. Its decay began at ~24 min, but the cold air then pulled back (RFD 0.1 K) and it recovered. It ended weakening with its parent's low spin: EF1 dust whirl at 55 min, EF0 dissipating at 68.
  - Still open: a steady storm's warm RFD lets a strong tornado live about an hour.

## Round 46 (2026-11-03): tornado cut off from its wall cloud when far away
User: the tornado looked disconnected from the wall cloud from a higher orbit angle.
- **Cause:** a rendering limit, not the sim. `Render/WallStream` drew wall clouds only within 40 km (RANGE) and for the 3 nearest storms (MAXS); tornadoes have no range. Zoomed out (T01 drawn ~75k studs away, a far-pulled copy) only C006's wall cloud was drawn. T01 hung under its storm with sky between its top and the base: the storm's kept card plan still had the hole cut for the wall cloud.
- **Close up it was already fine:** the funnel merged into the wall cloud. The sim keeps the top under the low meso, and the heights overlap (funnel top ~1.27-1.4 km, wall floor ~1.0-1.1 km).
- **Fix:** a lowering with a tornado drawn under it (a storm's, or a detached circulation's) is drawn at any distance and takes the MAXS slots first. This adds about 186 billboards per far tornadic storm.
- **Studio check:** the readout shows 2 storms' wall clouds drawn, against 1 before. The funnel still doesn't meet the wall cloud, so two more gaps remain (not fixed yet, being discussed with the user):
  1. **Empty lower lowering.** The big dense puffs sit at mid-depth (f 0.5, ~800 m), and the tiers start at 0.6 R. Near the axis, the lowering's lower ~150 m is filled only by the underside discs, which hide unless seen from below (upE > 0.12). From level or above, the funnel top (H ~460-520 m) ends ~80-140 m under the dense body, with the horizon showing between them.
  2. **Rain fogs the two differently.** The funnel's sight (`Tornado/StateAdapter.obscuration`) uses the surface rain on a ground-level line and dims and greys it (sight 0.03 at 3.8 km). The wall cloud uses `rainFog` to its near edge, scaled by height. Through rain, the funnel vanishes under a dark wall cloud.
- **Fix for gap 1 (user chose it, 2026-11-03):** half the dense middle puffs (odd k of the 20 large ones) are now centred at 0.3 of the lowering's depth, 0.6 of it tall. Their bottom sits on the floor, so the lower lowering round the axis is solid cloud from every angle. The other half stay at mid-depth and 1.05 tall. No extra billboards. Gap 2 (rain dims the funnel and the wall cloud differently) is still open. Not yet seen in Studio: Play has to be restarted to load it.
- **Donut hole in the wall cloud (diagnosed 2026-11-03, not fixed):** the user looked straight down from inside the storm. With U (isolate) on, the wall cloud alone is a ring: ground shows through its middle, and only the funnel's flared top (rc ~610 m at H) fills the centre.
  - Measured in Studio: the 19 big middle puffs sit at 0.42-0.88 R from the wall's centre. None are nearer.
  - Cause: each big puff's radius is `0.72 rMax sqrt(rnd(k, 2))`, and `rnd` (a sin hash) gives clustered values for k 1-20 (0.57 0.57 0.57 0.57 for k 6-9). 18 of the 20 land at 0.42-0.70 rMax; only k 1 and 13 fall inside 0.33.
  - The medium tiers (≥ 0.6 rMax) and the fringe (0.8-0.98) are a ring by design. So within ~0.4 R (~700 m) of the funnel there are 2 big puffs, and the funnel flares to ~610 m into empty air.
  - The donut-layout models (tmp donut.py / donut2.py) missed this because they used true random numbers.
  - Proposed fix: place the dense middle by an even spiral (radius sqrt((k - 0.5) / NLARGE), golden-angle start) instead of the hash.
- **Donut fix (2026-11-03):** the 20 big middle puffs now start on a sunflower spiral: radius `0.72 rMax sqrt((k - 0.5) / 20)`, start angle k × golden angle. Odd (low) and even (mid) layers interleave.
  - Top-down coverage from the big puffs alone, using the real radii: centre 0.55 → 0.93, and 0.2 R 0.67 → 0.93. It stays the same once the differential turn shears the spiral.
  - No extra billboards. Not yet seen in Studio: Play needs a restart.
- **Wall cloud to base join (2026-11-03):** after the spiral fix, the user's low side view still showed the wall cloud and funnel floating as one blob under the deck, with horizon sky between them.
  - Cause: the body cards are softFlat, whose alpha is about 0.5 at ±0.33 of the frame. So the lowering's visible top sat about 100-150 m under the base. BaseDeck cuts its discs within 1.15 R of it, and the storm cards are soft-bottomed.
  - Fix: the NC ceiling set, previously isolate only, now draws outside isolate as a collar. It runs from 0.29 D under the base to just above it, out to 1.3 R, and is shaded as the base's underside. Isolate keeps the wide 3 R base.
  - Not yet seen in Studio: Play needs a restart.
- **Research: how a tornado joins its storm (2026-11-03).** Sources: NWS spotter glossary and handouts, spotterguides.us, Wikipedia (wall cloud), VORTEX2 wall-cloud paper (AMS 27SLS).
  - The wall cloud is an abrupt, often blocky lowering of the rain-free (updraft) base. It is attached at its top, sometimes with a collar ring of fragments where it meets the base. It is mostly made by rain-cooled forward-flank air drawn into the updraft; only the middle lowers further from the pressure deficit.
  - The funnel is the same cloud surface, lowered further by the core's pressure deficit. It is narrowest on the axis and widens smoothly up into the wall cloud. It outlines only the inner core, at most about 1/10 of the circulation.
  - The user's 2026-11-03 rain-wrapped view against this:
    - (1) The wall cloud reads as a soft lens, not a blocky step down from the base.
    - (2) The funnel is greyed paler than the wall cloud (gap 2).
    - (3) The JOIN readout shows the funnel's cloud stopping short: rc 297 at 0.8 H, then rc 0 / c 0.00 at 0.9, 0.95 and 1.0 H, with its top at 426 m against the wall floor at 466 m. The earlier session showed the same 0.9-0.95 H zeros. A band of no condensation sits right at the joint. Not yet traced.
- **Funnel-to-wall-cloud fixes (2026-11-03, not yet seen in Studio):** three causes were found in the user's rain-wrapped view.
  1. `Vortex.condensationRadius` returned 0 between the moistened core air's base (coreBase, 290 m) and the cloud base (373 m), because it used the core's base as the cut-off. That left a clear band 80 m deep under the funnel's top (JOIN: rc 0 at 0.9-1.0 H). Now it returns the solve's limit, `I_MAX rc`, there, and callers cap it. Every caller was checked: they cap the value or scan up from the ground.
  2. TornadoCards drew the funnel to the tornado's cloud base (H) and faded it by 1.1 H. WallStream's floor (the storm's `wallBase` minus the dip) sat at 466 m, about 60 m higher. Now `Hj` = the nearest wall floor (within 1.2 R, at most H + 300): top = `Hj + 0.07 H + 30`, and fadeTop runs from Hj to Hj + 0.1 H, in both funnel styles. Above H the rows keep the cap radius, so the flare continues up into the floor.
  3. Rain fog: the wall's `fogW` was marched only to its near edge (about 180 m out here) and capped there, so the lowering by the funnel was greyed 0.10 against the funnel's 0.57. Now `fogC` is also marched to the wall's middle. A piece past the near edge blends toward it by distance: the same march as `StateAdapter.obscuration`.
  - Research for the shape: DreamWorks' Puss in Boots tornado joined funnel to deck with a transition layer of small swirling cloud elements, like the real collar cloud.
  - Next, if a seam remains: a collar ring of WallStream pieces spiralling in at the joint, from about 0.8 H up to the floor and from the funnel's width out to about 0.5 R.

## Round 47 (2026-11-03): reliable occlusion cycles (own storms)
- **Cause found** (`diag_cycles 120 - front 0.9`, Supercell day): after C002's first occlusion its new meso was put at the occlusion point, 1.50 Ru from the updraft, and only carried with the storm. It sat there for 80 min in 3.5-4.2 K air with its spin falling 5.5 → 3.2 m/s, and made no more tornadoes. C001 and C003 never cycled. Results: 1-3 cycles and 1 tornado, swinging with GF_MESO_K.
- **Fixes:**
  1. `GustFront.step`: a meso not overrun settles, over ~5 min, at the front's nearest point to the updraft's 1 km core, where the updraft stretches the front's spin. (Tried: centring it one core radius toward the updraft. It then outran the front and storms went steady again, so that was reverted.)
  2. `Storm.step` cycle: the new meso inherits the old circulation's Rankine wind at its distance, instead of `vlow *= 0.35`.
  3. The genesis drive no longer multiplies by `fLcl`. It was already in vlow (Vl), and counting it twice cut a 1.4-1.7 km-LCL day's drive to 35-55%.
  4. `LabConfig.GENESIS_EASE` 3 → 1 (the physics alone).
- **Results** (2 h, no boost):
  - Supercell day: 11 cycles and 5/5/6 tornadoes at GF_MESO_K 0.8/0.9/1.0.
    - Repeat tornadoes from the same storm: C001 ×3-4, C002 ×2.
    - Strong storms cycle every 40-75 min (literature 40-90).
    - Weak storms in cold air late in the day cycle every ~12 min (outflow-dominant).
  - SquallLine day: 27 tornadoes (43 with the old boost).
  - Peak vc is often 100-110 m/s, as before.
- **Checks:** `test_world` and `test_engine_follow` pass. Engine storms are unaffected: the gust front, the cycle and genesis are own-only.
- **Not yet seen in Studio.**

## 2026-11-10: wide puffs for flattened cards (no more squashed textures)
- **Problem (user):** cards "get stretched from certain angles and don't look good with texture". A billboard is an upright rectangle, and the renderers flatten cloud-base, anvil and wall-cloud cards by the camera's elevation (`CardPlan.seenHeight`, WallStream's bands: up to ~1:6 side-on). A square puff or lobe texture on those cards was squashed into smeared, scalloped lenses.
- **Fix:** `Render/CloudParts/WidePuff.luau`. A soft-puff card wider than ~1.4:1 draws a texture made at the nearest width:height (2, 4 or 8), so it is never stretched more than ~1.4x. Bounds sit at √2, 2√2 and 4√2, with 12% hysteresis.
  - Textures come from `tools/smoke/wide_puff.py` (`roblox/assets/clouds/wide/`), with ids in `LabConfig.WIDE_PUFFS`.
    - **detail**: two billowed variants per width. It is the gas-puff look, lit from the top with shaded undersides.
    - **haze**: a soft sheet for the plain soft textures.
  - **StormCards.put:** lobe families and `lumpyFlat` / `mediumFlat` / `smoothPuffFlat` take detail. `softFlat` / `softSheetFlat` / `hazeSoftFlat` take haze. The card's sun gradient still shades them, and half of them are mirrored.
  - **WallStream.showImg:** every image write goes through it. Gas puffs take detail; the smooth and far puffs take haze. The wisp sheet and the tier texture are unchanged.
  - Streak textures (shreds, wisps, striations, curtains, fractus) keep their stretch.
- **Switches:** `LabConfig.WIDE_PUFFS.enabled = false` brings the old textures back. In Studio, **Pause** flips it on the client. StormCards re-picks a card's texture at its next re-plan, so wait ~5 s.
- **Seen in Studio** (game, replay `lifecycle-serve` moment 10, supercell follow at 2-4x): on/off/on shots taken seconds apart.
  - Captures: `docs/storm-visuals/captures/2026-11-10_wide_puffs_*.png`.
  - The scalloped, squashed lenses along the base edge are gone. The edge is now a soft taper with lit tufts.
  - **First version:** a gaussian haze and flat-relief detail, which drew the flank as a featureless fade (visual-judge). Fixed by v2: billows on every lobe card, top light, and a fuller haze.
  - **A hard diagonal line** on the left of the base is in the "off" shots too, so it is not this change. It is probably a rain-shaft card edge; not traced.
- **Open:**
  - Not yet checked from directly under the base. Cards there are near square, so they are unchanged.
  - The lowering is still a round dome on the horizon in both versions (judge).
- **Research behind this:** `docs/visuals-research/TORNADO-GAMES-RESEARCH.md`.
- **Tornado funnel too (2026-11-10, later):** a wedge's smooth body cards flatten down to 6:1 (`hsAsp`). The square smooth puff squashed that far drew pointed lens ends down the sides (a scalloped, onion-bulb foot) and its rim shading as thin lines.
  - `tools/smoke/wide_funnel_puff.py` writes wide copies at 2:1/4:1/8:1 for each edge sharpness (smoothPuffFlat, Sharp2, Sharp4) to `roblox/assets/tornado2/wide/`.
    - The end edge keeps the same ramp in half-widths, so the RC_EDGE rule still holds. Each mean alpha matches its square original (0.27/0.33/0.36), so the opacity rule still holds.
    - The top and bottom fade as a bell to zero by 0.95, with no rim shading there, so stacked cards merge with no bands.
    - The ids are in `LabConfig.WIDE_PUFFS.funnel`.
  - In TornadoCards' smoke body, the texture is now written after `setSize`: `WidePuff.bucket(w, hsSeen)` then `WidePuff.funnel(bucket, lvl)`. Haze and skin cards are unchanged.
  - **Seen in Studio** (replay moment 12, a 589-yd wedge; on/off seconds apart; captures `2026-11-10_wide_funnel_*.png`). Visual-judge verdict: keep. The onion-bulb foot and the scalloped rim are gone; the sides stay soft, with no new hard lines.
  - **Open (judge):**
    - Dark horizontal ovals inside the body: the skin cards' field tone, which were there before but stand out more on the smoother body.
    - The wedge reads as an even, straight-sided slab: no flare into the wall cloud, and nothing on its face shows the turn.
- **Dust (TornadoDust):** left as it is. Its cards flatten only to ~1.7:1, except drifting dust at ~5:1, which uses streaky wisp sheets meant to stretch.
- **Rotation, measured:** the game draws local motion at real speed (`visualScale = 1`; at 8x it read as fast-forward). The wall cloud turns at the low meso's Rankine speed: for vlow ~30 m/s and Ru ~2 km, the edge takes ~8 min per turn and the core ~2 min. That is realistic and visible on screen (~2-3 px/s at 5 km) if the cloud has features to follow. So "can't see rotation" comes from the low-contrast, soft surfaces, not the speed. Next step: moving features with contrast (scud tags and rising ragged pieces at the wall cloud's rim, streaks on the funnel's face, and inflow dust), judged from short videos rather than stills.

## 2026-11-10 (later): wall-cloud depth from its air, rain-shaft edge line
- **Wall cloud too tall (user).** The engine gave every strong wall cloud a fixed 600 m (`150 + 450 × strength`, capped at 15-45% of the base in StormAppearance), whatever the air. That was a painted value; the research gives 100-1000 m, often 200-500 (`docs/stormlab/RESEARCH-WALLCLOUD-HV.md`).
  - Now `StormGeometry.wallLoweringM` sets it. It is the drop in condensation level when the forward flank's rain-cooled outflow (cooled toward its wet bulb and moistened) mixes into the inflow, using the lab sim's rule with the engine's fields. The share taken in is limited by the lift (SpinBudget's low-level spin and the updraught) against the cold pool's negative buoyancy, so a cold, deep pool is undercut. The wall cloud's strength is counted once; the lab's rule counted it twice.
  - The mesocyclone's pressure fall (v²/g) is left out, because it lowers only the centre, which the funnel and WallStream's dip already draw. Added across the whole wall cloud, it made a 150 mph storm's wall cloud hang 815 m under a 1,133 m base.
  - **Seed 9** (456 storm-steps with a wall cloud): the median went 451 → 273 m (19% of the base), and 374 → 233 m under tornadoes; the 10th-90th percentile range went from 267-600 m to 47-648 m.
  - **The replay storm** (S0036, a 150 mph tornado under a 1,124 m base, 8 K cold pool) gets deeper: 506 → 635 m. Its strong lift takes in the full share of nearly saturated outflow. Real violent-tornado wall clouds do hang that low; tell me if this one should still look shallower.
  - **Checks:** the regression suite (8 seeds, 10 days) was identical to its baseline in every value but the run time, so storm behaviour is unchanged (the lowering is display only). `storm-shape-and-interactions` was updated: its storm now carries its cold pool's deficit, and it checks that the lowering deepens under a higher base and shrinks with a cold, deep pool. `storm-appearance`, `warnings` and `radar-simulator` pass.
  - The lab sim's own storms (`Storm.luau`) keep their old rule.
  - The default replay cache `tools/stormlab/out/life-9-17-100` still has the old lowering. The re-recorded one is in the job scratch folder; delete the cache's `frames.json` to re-record.
- **Hard diagonal line on the storm base.** The rain-shaft sheet `curtainFlat` (`tools/smoke/storm_sheets.py`) had alpha 0.19 at the top row of each 256 px frame and 0.32 at its foot, because the noise pushed the fades past the frame edges. A slanted shaft card therefore ended in a straight line. Each frame now fades to zero at both ends; the middle is byte-identical. The new id is in `LabConfig.TEXTURES.curtainFlat`. (`rain_curtain.png`, used by `shared/Tornado/RainCurtains`, has the same edge but isn't in the game path.)
- **Not changed:**
  - The funnel's dark skin ovals: single skin cards darker than the now-smoother body. Their tone was tuned over regrades 11-14 on 2026-11-09.
  - The slab-like wedge: its shape is the engine's funnel profile, whose top moves with the new lowering.

## 2026-11-10 (late): rain and hail shafts as Beams - built, tested, OFF in the game
- User: "find a different solution for rain and hail besides billboards, look at what twisted does".
  Research is in `docs/visuals-research/TORNADO-GAMES-RESEARCH.md` section 7.
- Built in `CloudParts/Shafts` (`LabConfig.RAIN_BEAMS`; Scroll Lock switches Beams and cards in Studio).
  - Per shaft: 4 camera-facing ribbons through its depth, 2 paler hail ribbons in the core.
  - Hung from the cloud base, upwind of the rain's column; the texture scrolls down at the fall speed.
  - Textures: `tools/smoke/rain_beam.py` writes rain_beam 106068821128086 and hail_beam
    96811168010482. The first upload (70385017359407, 121552743909792) was made with no Studio
    selected and never loads.
- Fixed on the way:
  - Beams under the camera (ctx.root) did not draw; they now sit in `Workspace.RainBeams`.
  - With Segments 1 the length fade was read only at the two clear ends, so no ribbon showed; now 12.
  - The foot feather from 70 % hid the only part seen against the bright sky.
- **Why it is off.** Beams are parts, drawn only within LIMITS.partRange (~6500 studs, under 2 km of
  map at 0.28 m a stud). The game draws the storm and its shafts 13k+ studs out.
  - Pulled toward the camera to draw at all (as the bolts are), the shafts sorted in front of every
    storm card beyond them: a light grey wall over the tornado.
  - The cards (billboards: any distance, true depth) keep the wedge seen through the rain.
  - Near the camera, where a Beam could stand at its true place, the shafts already fade into the
    rain fog (NearPrecip).
  - So in Roblox the far shafts can only be billboards. Better cards are the way: wide curtain
    textures as with the base, and a scrolling streak layer.

## 2026-11-10 (late): open, user reports from the game
- **Gap overhead and the sun through the clouds: one cause, the sun part fixed.**
  - Measured 8 km south of S0036 (tick 10), engine frames: no cloud above the player or within
    1 km; the cloud starts ~2 km north. The game draws the storm about its tornado at 1.37
    studs/m, ~3.7x the map's 0.37, so the drawn base reaches over the player and ends just past
    the zenith. That drawn edge against the sky is the "gap".
  - `Render/Sky` traced the sun's ray and the overhead cloud through the field at the camera's map
    place, so it found clear sky where the drawn cloud was: the sun showed through.
  - Fix in `Render/Sky` analyse(): with `anchorFn` (the game), the rays start from the camera in
    the nearest storm's own frame (`fromWorldAbout`), so the sky samples the cloud where it is drawn.
    Same spot, before -> after: sun tau 0.00 -> 5.40 (hidden past 4), overhead tau 0.01 -> 5.09,
    cover 31 % -> 76 %. 8 km east: sun tau 0 -> ~4. The scene now lights as under the storm.
  - Angle check (8 km south, fix off vs on, same steps): the default view and orbit left/right
    lose the sunlit ground under the dark base (mean brightness 128-140 -> 84-89). Far views with
    the storm on a sunny horizon are unchanged (154/157 vs 151/154).
  - Tried and reverted: cutting BaseDeck's reach to LIMITS.partRange. Discs draw to 7.5k studs, so
    that limit isn't the cause.
  - The "gap" (step 2, same day): not a hole. Hiding renderers one at a time showed that
    StormCards draws both the base and the towers. With the clear slot switched off (CardPlan
    `slot`) the view did not change. The player stands ~2 km outside the drawn base's south edge
    (base centre 8.8 km, radius 6.9 km), so looking north the base fills the low sky and above
    ~30 deg you see past its edge to open sky and the sunlit towers. The engine has no cloud
    overhead there too. The edge is soft once the cards settle (~10 s); the hard straight line
    shows only in the first seconds after a teleport while the cards fade in.
  - Tools for next time: Home/End/Insert/Delete are the lab's speed keys and BackSlash is
    Sky's storm-owned sky switch; don't bind them for diagnostics.

### Short-range rain Beams (2026-11-10, on)
- Beams are back on (LabConfig.RAIN_BEAMS.enabled = true), near only. A shaft takes Beams while its
  drawn middle is inside 3/4 of LIMITS.partRange (6500 studs), blending from its card out to
  partRange - 500 (Shafts: bS). Beyond that it stays a card. Nothing is pulled toward the camera any
  more, which removes the grey wall the pulled far Beams drew over the tornado.
- Range is judged by the shaft's middle, not its whole size: drawn at the storm's scale (k ~3.6), a
  1 km shaft is ~4500 studs across and never fit wholly inside the range (first try: 0 Beams).
- The card curtain still fades out as you drive in (near: gone at 0.6 w + 300 m). The Beams stay
  until the shaft's edge (nearB: 0.5 w to 0.5 w + 600 m), then the rain is the Atmosphere fog.
- Seen 1 km east of the replay tornado (tick 10): 7 of 89 shafts on Beams, soft streaked curtains
  under the base; Scroll Lock A/B shows the change; looking into the core both are just dark.
- Judge round (same day, tick 10, follow camera ~2 km): tornado overall 3/10, supercell structure
  1/10. The near Beams draw large straight-edged see-through slabs over the upper half of every
  close shot. Confirmed by Scroll Lock A/B at the same pose: with Beams off the slabs are gone and
  the base is soft. From 1 km east of the tornado they looked fine; the trouble is ribbons ~2700
  studs wide (sh.w x 0.7 x k 3.6) seen from nearby. Sun-through-base: fixed (base dark in every
  shot). Bright cyan-white glow on the horizon beside the funnel's foot (4/10) still open. The 4x
  "supercell" zoom stays under the drawn base (k ~3.6), so that set showed no tower or anvil;
  the far set needs ~15 km of map.
- Beam fix (same day): ribbons 0.35 of the shaft's width (was 0.7), 6 a shaft (was 4), faded out
  while a ribbon would look wider than ~1/3 of its distance (bS x (1 - ramp(w*0.35*k/dist, 0.3,
  0.6))), top fade over 20 % of the length. Judge regrade: slabs gone in all 8 shots incl. the
  settling period; tornado overall 3 -> 4, rain near funnel 2 -> 4, nothing regressed. At ~2 km
  the Beams are faded out (the cards carry it); from 1 km east of the core they still show.
- Shafts: the forward-scattered light of backlit rain is now the sun's colour (L.sunColour), not
  the shadowed rain's cool grey. It did NOT change the cyan glow (brightest horizon pixels 141,167,
  201 vs 142,167,202), so that glow is not the rain's forward scatter. Haze is ruled out too (70 km
  visibility: ~6 % at 5 km). The glow sits only at the feet of rain curtains near the horizon,
  ~(160,184,201). Next: a reliable per-renderer hide (an attribute set in the edit place before the
  test, one test per renderer: keys F10 = Studio's device bar, and the Output is flooded by
  TornadoAudit).
- Supercell framing (same day): the follow zoom never leaves the drawn storm; far set now = storm placed 18 km
  from the player (ground view) + VTCam "whole 25000 up" / "whole west" (watch-scene skill updated). First real
  far grade: structure 2/10 - from far it reads as fair-weather cumulus: white round puffs lit alike on every
  side in a white haze ellipse, short tower, no anvil, base as 2-3 thin lens strips, nothing under the base from
  far (no rain shaft, wall cloud or funnel); from 18 km on the ground the whole sky is one grey lid. Judge's top
  fixes: shade the far storm by depth (dark base, white crest), one dark flat base deck, a flat anvil, an opaque
  forward-flank rain shaft.
- Horizon "cyan glow": hiding each of the 10 storm layers in turn (VTCam Insert) did not remove it - it is the
  sky's own horizon band under the base (Sky.luau atmosphere Color from HAZE_COLOUR toward STORM_GREY by cover),
  seen past the rain; the "rays" are the rain curtains' fibres against it. A bright horizon under the base is
  real; whether to grey it by the rain along the line of sight is open.
- CORRECTION to the "gap" finding above: the PageUp presses used to "look up" were stepping VTCam poses
  (whole 25000 up / whole west), not tilting the player's camera. The gap captures were far test-camera views,
  so that conclusion is not valid; recheck with a real first-person look-up (mouse look; send_input mouseDelta
  fails with an unlocked cursor).
- Funnel: judge wants rotation cues (striations, debris skirt) and a separate wall-cloud step; striations
  conflict with the no-bands rule, so waiting on the user.
- Funnel rotation without stripes (same day, user chose "a"): the skin (turning tone patches) stays off on
  narrow funnels by the user's 2026-11-09 call (onion layers on a 145 m cone); this EF2's core is 95-160 m.
  The filaments (flow-carried density streaks) now take the face's lit/shadow swing deepened (x1.25) and a tone
  from the eddy field by the eddies' strength (1 + 0.6 uI tb), up to 0.35 opacity (was a fixed +-6% at 0.2).
  Measured on a 10-frame 1 s sequence (VTCam south 6000): frame-to-frame change 0.62 -> 0.68 grey levels,
  local contrast 0.60 -> 0.64. Small: the face is ~56/255 and made of many stacked body cards. Kept (field-driven).
- Far supercell (user chose "c"): root cause per a code read - StormCards hazed, angled and detailed every
  storm by its MAP distance, while the game draws it at the sky scale (a storm drawn as if 35 km off was hazed
  as at 95 km: 2/3 haze colour, detail at its 0.25 floor). Now StormCards uses the camera in each storm's
  drawn frame (camOf: fromWorldAbout about the storm's anchor) for card colour, haze, lobe family and detail;
  the lab (no anchor) is unchanged. Anvil cards are foreshortened as a plate (seenHeight, as the deck) and the
  anvil card cap is at least 40. Result: the west far view went from a white cumulus row to a dark slate base
  with grey cloud; the south far view's towers have grey sides but the white ellipse remains. Near view
  unchanged. Not done from the plan: one continuous dark base from outside (CardPlan base section albedos and
  seenH skirt), rain columns filled round storms not the camera (FrameWorld FAR_KM), WallStream.RANGE and
  Shafts haze by drawn distance, lowering/funnel visible far.

