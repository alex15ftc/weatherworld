# Storm lab realism review (2026-10-29)

Three parts: (1) what was synced from the main game, (2) what we are missing, (3) how to reach the reference looks and how close we are. The full research notes behind parts 2 and 3 are in `detail/research-components-2026-10-29.md` and `detail/research-techniques-2026-10-29.md`.

## 1. Sync from the main game

The game and the lab share the same Sim and Render files, so most game changes (rain visibility, tornado smoothing, clock handling) already reach the lab. Three things did not:

| What | Problem | Fix |
|---|---|---|
| **Frozen lab storms** (regression from 2026-10-28) | `Storm.fromEngine` always made a storm "engine-driven" after the game's StormHost change. Every scenario storm in the lab (and in the game's lab mode) moved in a straight line with its first updraft, rotation and occlusion, and could never make its own tornado. Measured: the focus storm's W 43, vmid 10.2, vlow 5.8 and G 0.00 stayed fixed for 40 min. | Engine-driven is now opt-in: `Storm.fromEngine(e, follow)`, `World.new(data, { followEngine = true })`. |
| **The lab couldn't run storms the way the game does** | The game's storms follow the engine's 5-minute updates (position, strength, rotation, occlusion and tornado all from the engine). The lab only ran its own dynamics, so what was tuned in the lab was not what players see. | The engine-following code moved out of `server/StormHost` into `Sim/EngineFollow.luau`, used by both. Scenarios now carry `polls` (the engine's `/lab/storms` answer every 5 min for 2.5 h). The lab defaults to **Storms: engine** (`LabConfig.DEFAULT_STORMS`; F4 panel button; Workspace attribute `StormLabStorms = "own"` for the lab's own dynamics). |
| **Stale scenarios** | `data/Supercell` and `data/SquallLine` were exported on 2026-10-23, before the capping inversion, drivers batch, outbreak climate and the 8 pm sunset. | Re-exported from the current engine. The export now builds the window with the game's own `js/game/LabWindow.js`, so lab and game data can't drift apart. |

Left as is on purpose:
- **Clock:** the lab runs at 1x by default; the game runs the weather at 8x with local motion at real speed (`visualScale = 1`). Set the lab's time scale to 8 to preview the game's pace.
- **Rain visibility:** the game uses `Config.PRECIP_VISIBILITY = 0.4`, the lab 1 (physical). Tuning in the lab is at full rain fog, so the game looks clearer.
- **Sky scale:** the game draws storms smaller with distance (`Config.skyScaleAt`); the lab is true scale.

## 2. What we're missing

Of 55 visible storm components, about half are drawn. The biggest gaps are the ones that tell a chaser where the tornado is.

**Drawn:** main tower and lobes, overshooting top, anvil, mammatus, rain-free base, striations, rotating wall cloud, tail cloud, beaver tail, scud, squall-line shelf (tiers, whale's mouth, bows), rain and hail shafts, green tint (camera only), sunset and night light, cone/wedge/rope/multivortex funnels, dust and debris cloud, CG and +CG lightning.

**Partly drawn:** hook rain wrap (smeared by the 1 km rain grid and 2-4 km shaft bins), back-sheared anvil (fixed upwind reach, no knuckles), anvil crawlers (mostly hidden), haboob (near the camera only), stratiform rain behind lines, early towers, orphan anvils, haze (visibility fixed at 50 km in `Sky.luau`).

**Not drawn:** clear slot, horseshoe base, flanking line, power flashes, gust front/shelf on single supercells, gustnadoes, rain foot, virga, hail fog, pileus, feeder bands, crepuscular rays, rainbow, roll cloud, collar cloud, Kelvin-Helmholtz waves. Satellite, anticyclonic and landspout tornadoes are missing from the sim too.

**Top gaps for a chaser (value, then cost):**
1. **Clear slot + horseshoe base.** The base is a full disc (`CloudParts/CardPlan.luau:355-436`); nothing cuts it where the RFD is. Best tornado cue, brightest feature in the photos. Fields exist (rfd, rfdX/Y, rfdDeficit, occl).
2. **Rain wrap round the low meso**, from finer rain sampling there.
3. **Flanking line** along the rear-flank gust front: points to the updraft from 50 km. Only a comment now (`CardPlan.luau:342`).
4. **Power flashes** from the town's poles when they fail: the best night locator, cheap.
5. **Gust front / shelf on single and HP supercells** from each storm's cold-pool edge (today `ShelfPlan` runs only for line systems).
6. **Back-sheared anvil with knuckles**, scaled by updraft vs upper wind.
7. Gustnadoes, 8. visible anvil crawlers, 9. pre-storm cumulus and failing towers, 10. rain foot and a far haboob wall, 11. feeder bands and dewpoint haze, 12. crepuscular rays, rainbow, hail fog.

## 3. Reaching the reference looks

**What frames it:**
- Nobody has published how Severity, Twisted or Helicity draw storms; what we know is from their frames (our NOTES.md diagnosis) and Twisted's changelogs (meshes, then a "dynamic tornado system").
- Every Severity reference is close range (within ~1 km). At 0.28 m a stud the ~800-stud particle limit is only ~225 m, so their big-particle look only covers what is near. For whole storms at 5-20 km the real photos are the target, and billboards are the right tool.
- Roblox still has no volumetric clouds or custom shaders in 2026. The community ray-marchers are CPU EditableImage experiments, as ours was on 10-22.

**How close we are (0 = absent, 5 = recognisable but clearly wrong, 8+ = passes beside the reference):**

| Effect | Score | Main gap |
|---|---|---|
| Base deck from below | 6 | oval lumps, grey not blue-slate |
| Bright backlit rain behind dark scud (the Severity look) | 4 | the rain isn't the bright element |
| Clear slot | 2 | not drawn |
| Wall cloud + tail | 4-5 (not seen since 10-26) | needs a capture |
| Striations | 3 | camera-facing cards can't wrap a band round the updraft |
| Sunlit towers vs shadowed base | 6 | base ~0.5 of the tower's brightness; photos ~0.14 |
| Anvil / mammatus | 5 / 3 | backlit anvil smears; pouches read by outline, not shading |
| Rain shafts | 5 | no rain foot, no virga |
| Rain-wrap veil | 5 | may be too strong; colour should be lit rain |
| Shelf cloud | 3 | lumpy all over, no smooth laminar top |
| Funnel | 5 (no capture of the card funnel) | needs a capture |
| Condensation motion | 5 | needs a capture |
| Dust | 5 | small and uniform |
| Lightning | 6 | no in-cloud glow or bloom |
| Distance haze | 6 | cards ignore Atmosphere |
| Motion | 6 | striation rings step at ~5 Hz |
| Whole supercell from 10-20 km | 4 | pale grey tower on a blue sky, no dark core |

Overall: about 4.5/10. The structure is right (layout, field-driven parts); the look loses on contrast and light, not on missing cards.

**Ranked changes (visual gain per effort):**
1. **Brightness against the background.** Light rain and low cloud by sun scattered forward through the rain, so they're brighter than the base; make scud darker than whatever is behind it. Code only; the core of the Severity look.
2. **Haze per card + darker, wider base and core from afar.** Billboards ignore Atmosphere, so fade each card toward the haze colour by its true distance. Fixes the pale far storm.
3. **One continuous overhead deck:** a few huge down-facing flat cards (SurfaceGui on a part) with the seamless `ceiling` texture and a darkening gradient. *Bends the billboards-only rule: your call.*
4. **Clear slot** cut where the RFD dries the cloud, with a frayed lip of wispy cards. Needs 3.
5. **Tone tuning in the soft style:** `lobe_post.py` feather 1.4-1.8, warmer cream sun, darker sky-only underside.
6. **Dust from many large, faint, fibrous, long-lived layers**, coloured by land use; real particles only within ~200 m.
7. **Long flat cards seen edge-on** for striation bands and shelf tiers (one new crisp-edged sheet).
8. **Funnel core as a few stacked camera-facing Beams**, cards for the fringe (best match for Ref1). *A second primitive: your call, and capture the current card funnel first.*

Cheap extras: a Bloom pulse and an in-cloud glow card for lightning; per-frame motion for the striation rings.

**Before acting:** take fresh Studio captures of the card funnel, wall cloud and tail, and scud. The scores marked as not seen are guesses.

## Found while testing the sync (affects the game)

In the new Supercell scenario the engine's tornado sits 3.9 km from its storm's centre at touchdown and drifts to 8.6 km over 10 minutes. Meanwhile the engine's occlusion jumps from 0 to 1 within 5 minutes, and its low-level rotation is only 0.07-0.11 under an 80 mph tornado. `Storm.followEngine` slides the whole drawn storm so its circulation sits over the tornado, so during a tornado **the storm on screen is up to ~7 km from the storm on the engine radar**. The tornado itself is in the right place. Two possible fixes, your call:
- **Engine side:** keep the tornado under its storm's low-level circulation (the real geometry). This is cleaner, but it changes the engine.
- **Game side:** shift only the low-level parts (wall cloud, RFD, hook) toward the tornado, not the whole storm. This was rejected on 10-28 because it bent the hook's rain over the tornado.

## Storms grow from the mesocyclone (engine, 2026-10-29)

- **Origin:** a rotating storm's position is now its low-level mesocyclone (`js/storms/StormGeometry.js`). The wall cloud and tornado form there.
- **Updraft lean:** the updraft column, with its BWER, mid-level mesocyclone and highest tops, leans downshear by the distance the storm-relative wind carries air rising 5 km. That is clamped to 1-5 km and scaled by how much the storm rotates; cells and lines stay centred on their updraft.
- **Placed from the origin** (`StormStructureEngine.js`; bearings from RESEARCH-SUPERCELL-LAYOUT):
  - forward-flank rain downwind of the updraft;
  - hail on the updraft's forward edge;
  - rear-flank downdraft behind and left (~210°);
  - hook round the origin;
  - inflow notch to the right-front (~42°);
  - debris at the tornado.
- **Radar:** `PrecipitationField.js` feeds the rain from the leaned updraft, and its mesocyclone leans up to it.
- **Occlusion drift:** capped at 0.4 updraft radii (was 1.8). The engine's tornado in the Supercell scenario now stays within 3.1 km of its mesocyclone (was 8.6 km).
- **Lab:** `Storm.followEngine` puts the lab's low-level circulation on the engine's position, or on its tornado, all the time.
- **80-day check (4 seeds x 20 days, before -> after):**
  - unchanged: tornado count (1,451), EF shares (EF2+ 13.3% -> 13.7%), categories (MDT+HIGH 12% -> 13%);
  - **regressed: long tracks**, 25+ mi tracks 5.9% -> 7.9%, 90th percentile 18.0 -> 20.5 mi. A tornado at the drift limit now keeps pace with its storm instead of slowing.
- **Drift limit 0.4 kept (user's call).** Measured on its own (both runs with the touchdown fix): 0.4 vs 1.8 gives 25+ mi tracks 7.9% vs 5.9% and a 90th percentile of 20.5 vs 18.0 mi; the tornado count and ratings are the same. The layout change alone changes nothing.
- **Touchdown:** a new tornado is now placed under its mesocyclone; its track and path still start where the wall cloud was at the step's start (it used to sit a step's motion, ~4 km, behind until it drifted back).
- **Occlusion loops** (`TornadoEngine.js` occlusionStep):
  - While a tornado occludes it revolves cyclonically round its mesocyclone, at `ORBIT.share` (0.25) x its wind above 65 mph x the occlusion. That is ~34 km/h for an EF3, 48 for an EF4 and 62 for an EF5.
  - The track loops only when that beats the storm's speed: an intense or violent tornado under a slower storm.
  - Research: Bennington KS 2013 (a slow EF4 that crossed its own path), Kellerville (trochoidal track from revolving inside the tornado cyclone), Lee & Finley (rear-flank surges turn tornadoes left and about double their speed), "failed occlusion" loops.
  - Each ended tornado records `loops`. The game gets `tornado.orbit` (rad/s), and the lab draws the revolution smoothly between updates (`Tornado.setEngine`).
  - The lab's storm stays on its mesocyclone while its tornado revolves; the funnel leans to it.
  - **Measured:** 40 days, 1 of 25 EF3+ tornadoes looped (an EF3 under a 31 km/h storm), no EF0-2. Everything else unchanged over 80 days.
