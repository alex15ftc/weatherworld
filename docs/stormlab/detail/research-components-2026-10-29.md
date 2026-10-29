# Visible severe-storm components vs. what the storm lab draws (2026-10-29)

Paths are relative to `roblox/src/stormlab/`. CP = `client/Render/CloudParts/`. Status is judged from the code only; most of these features have not been looked at on screen. Builds on RESEARCH-SUPERCELL-LAYOUT, RESEARCH-WALLCLOUD-HV, storm-reference/NOTES.md and LIFECYCLE-AND-TYPES.md.

## Inventory

| # | Component | What a chaser sees (shape, colour, scale, where) | Field that drives it (sim) | Status | Code / what's wrong |
|---|---|---|---|---|---|
| **Updraft and upper cloud** |||||
| 1 | Towering Cu, congestus, "turkey towers", early tower | Hard, bright cauliflower towers 1–5 km wide, rising and sometimes collapsing; before initiation, where the cap is breaking | Initiation lift vs CIN (`Sim/Initiation`); W, maturity | PARTIAL | A storm's own early tower exists (CP/CardPlan.luau:212 dome while rising). There are no pre-initiation Cu or failed towers: Initiation candidates are never sent to the client. |
| 2 | Flanking line | Stair-step towers 5–30 km long, rising toward the main tower along the RFGF on the S–SW (right-rear) side. It points to the updraft and the meso from 50+ km. | RFGF convergence from the ColdPool gradient + `rfdX/Y`, CIN; Initiation already merges flanking towers into the parent (`Sim/World.luau:372`, `Sim/Initiation.luau:88`) | MISSING | Only a comment (CP/CardPlan.luau:342). No towers are drawn along the RFGF. |
| 3 | Main tower, tilt, crisp sunlit lobes | Bright, sharp-lobed column leaning downshear | W, Ru(z), `wprofAt` tilt | PRESENT | CP/CardPlan.luau:166-210 (lit lobe sheets, CONDENSATION-DETAIL). |
| 4 | Overshooting top | Dome above the anvil top, 1–9 km | top − el | PRESENT | CP/CardPlan.luau:228 |
| 5 | Anvil, flat top, sharp edge | Flat ice slab tens to 100+ km downstream, fibrous underside, sharp upwind edge | anvilU/V, anvilLen, el | PRESENT | CP/CardPlan.luau:244, CP/StormShape.luau:72 |
| 6 | Back-sheared anvil, knuckles | Anvil pushing *upwind* against the upper flow, with lumpy "knuckles" on its upwind edge: a strong, sustained updraft | W at el vs upper wind (upperU/V), overshoot | PARTIAL | The upwind reach is fixed at 1.05 × the root radius (CP/StormShape.luau:72) and does not grow with W or overshoot. No knuckle lobes on the edge. |
| 7 | Mammatus | Pouches under the anvil, lit pink or orange by a low sun | precipRate, age, anvilLen | PRESENT | CP/CardPlan.luau:295 |
| 8 | Pileus / scarf cap | Smooth, thin cap draped over a fast-rising tower | W, moist layer above the tower top (Environment td profile) | MISSING | Cheap: 1–3 smooth cards over the top when W > ~25 and RH aloft is high. |
| 9 | Orphan anvil / decaying storm | The anvil drifts on and thins 30–60 min after the tower dies; the tower goes soft and fibrous | `dead`, `deadFor` | PARTIAL | `fade` thins every part, and Sky.luau keeps anvils for ~30 min, but nothing detaches or drifts as an orphan. |
| 10 | Kelvin-Helmholtz waves | Breaking-wave billows on the anvil top or the shelf's upper edge | shear across a layer (profile u/v) | MISSING | Low value. |
| **Storm base (supercell)** |||||
| 11 | Rain-free base | Dark, flat slate deck 8–20 km across, on the inflow side | base, Ru, rot, lowX/Y | PRESENT | CP/CardPlan.luau:333-436 (shifted so the wall cloud sits on its rear edge) |
| 12 | Striations / barber pole (LP, classic) | Banded, corkscrew updraft base, turning | rot, vmid | PRESENT | CP/CardPlan.luau:484 (rings turn at vmid/Rr). The bands are flat rings, not a helix; LP storms need more of them, which comes from rot and vmid, not from the type. |
| 13 | Wall cloud (rotating, rising) | Abrupt lowering 1.5–6 km across, smooth on the inflow side, ragged on the rear, turning, scud rising into it | lowering, wallBase, vlow, lowX/Y | PRESENT | CP/CardPlan.luau:511-630 |
| 14 | Tail cloud | Ragged horizontal band from the rain to the wall cloud, often backlit | ingested FFD outflow (`lowering`) | PRESENT | CP/CardPlan.luau:631 |
| 15 | Beaver tail / inflow band | Smooth, flat band along the FFGF out into the inflow | srU/V, rot, inflow speed | PRESENT | CP/CardPlan.luau:439 |
| 16 | Low-level inflow feeder bands (several), cloud streets into the storm | Parallel bands of low Cu/fractus streaming into the updraft from the SE, several km long | srU/V, low-level RH and LCL (Environment) | MISSING | Only one band is drawn. |
| 17 | Collar cloud | Ring of cloud round the top of the wall cloud | vlow, lowering | MISSING | Rare; low value. |
| 18 | Scud (rising, rag, streak) | Dark or light fragments under the base, riding the wind | `World.windAt` w>0 + saturation from surface rain | PRESENT | `client/Render/Scud.luau` (field-driven), CP/CardPlan.luau:107 |
| 19 | **Clear slot / RFD cut** | A very bright, backlit gap cut into the dark base on the wall cloud's W/SW side, wrapping S and E; sharp, frayed lip. The highest-contrast feature in a supercell. | rfd, rfdX/Y (`Sim/Storm.luau:272`), rfdDeficit, occl | MISSING | The base deck is a full disc (CP/CardPlan.luau:355-436). Only the rain is absent there (CP/Shafts.luau:4). Nothing cuts the cloud. |
| 20 | **Horseshoe / U-shaped base, occlusion** | Base curved round the wall cloud as the RFD wraps in; the tornado sits on the north arm | rfd, occl, lowAngle | MISSING | Comes from #19 (shape the cut by `occl`). |
| 21 | Vault / BWER (seen from under the base) | Dark, domed hollow above the updraft, seen looking up | the weak-echo region already exists in `Sim/Precip` | MISSING | Rarely seen from the ground; low value. |
| **Precipitation** |||||
| 22 | FFD rain curtains, rain gradient | Grey curtains, densest at the core, sharp updraft-side edge, slanting downwind | precip volume (`cw.vol`) | PRESENT | CP/Shafts.luau, `RainShafts.luau`. Bins are 4 km, or 2 km within 14 km, so the edges are coarse. |
| 23 | **Hook / RFD rain wrap, curtain round the meso** | Translucent curtain curling behind and round the tornado, 1–4 km; HP storms bury the tornado in it | hook spiral rain (`Sim/Precip`), occl | PARTIAL | The physics has the hook, but the 1 km surface grid plus the 2–4 km shaft bins smear it; the funnel only approximates it with a grey wrap term (`client/Tornado/StateAdapter` `e.wrap`). STATUS: "occlusion has no echo signature yet". |
| 24 | Hail shafts | Whiter, brighter shafts, often next to the updraft | vol.hail | PRESENT | CP/Shafts.luau:9,134 |
| 25 | Hail at the camera, hail on the ground | Bouncing stones (present); fields turned white after the core passes | surface hail | PARTIAL | `NearPrecip.luau:19` draws falling stones; nothing builds up on the ground. |
| 26 | Hail fog | A shallow, very dense ground fog in and just after a hail swath | surface hail + warm, humid boundary layer (Environment t/td) | MISSING | Could be one extinction term in NearPrecip plus low fog cards. |
| 27 | Green or teal core | Green-teal core under a deep, heavy core with a low sun | precipRate, cloud depth, sun elevation | PRESENT | `Sky.luau:27,53` (camera tint only; the shafts and cards are not tinted) |
| 28 | Rain foot / wet microburst | A curtain whose foot bulges and spreads sideways at the ground | ColdPool downdrafts (`ColdPool.downdrafts`), surge | MISSING | Shafts slant (CP/Shafts.luau:379) but never spread at the foot. |
| 29 | Virga, fallstreaks, anvil precip | Streaks stopping short of the ground, backlit gold; light rain out of the anvil | precip parcels evaporating aloft | MISSING | Shafts always reach the ground (CP/Shafts.luau header). |
| 30 | MCS trailing stratiform shield | Wide, layered grey overcast and light rain behind the line | Storm.luau:858 (decaying ice snowing out), vol | PARTIAL | Rain shows through the shafts; there is no stratiform cloud deck, only per-storm anvils. |
| **Outflow / lines** |||||
| 31 | Shelf cloud (tiered, laminar top, whale's mouth) | Wedge-shaped arcus ahead of the line, tiers, dark turbulent underside | Systems segments, deficit, active | PRESENT | CP/ShelfPlan.luau:1-12 |
| 32 | Shelf / gust front on isolated or HP supercells | A bowl or shelf leading edge on HP storms, the FFGF/RFGF arcus | ColdPool gradient by the storm | MISSING | ShelfPlan runs only for `systems` (`StormCards.luau:870`). |
| 33 | Roll cloud | A detached horizontal tube along the gust front | strong pool + stable layer | MISSING | Low value. |
| 34 | Bow apex, stepped line towers | Bowed shelf, strongest at the apex | segment bow | PRESENT | Via the segments (ShelfPlan header) |
| 35 | Outflow dust, haboob | A brown dust wall 1–3 km tall, km wide, ahead of a dry outflow | wind > threshold, dry ground (TornadoDust pickup) | PARTIAL | Dust fronts are drawn only near the camera and the focus (`TornadoDust.luau:8,156`), never as a wall seen from afar. Sky browns the haze. |
| 36 | **Gustnado** | A short-lived (≤1–2 min) dust or debris whirl on the gust front, without a funnel | vertical vorticity along the ColdPool edge / RFGF (shear across the front) | MISSING | No source of vorticity along the front. |
| **Tornado** |||||
| 37 | Funnel cloud aloft, partial condensation | Funnel not reaching the ground, dust whirl beneath | `Vortex.condensationRadius` (Sim/Vortex.luau:331) | PRESENT | `TornadoCards.luau` header |
| 38 | Cone, stovepipe, wedge, rope-out | Shape changes with swirl and decay | swirl ratio, decay in `Sim/Tornado` | PRESENT | `TornadoCards.luau`, `Sim/Tornado.luau` header |
| 39 | Multivortex | Suction vortices orbiting inside the envelope | `Vortex.subvortices` | PRESENT | `TornadoCards.luau:397` |
| 40 | Debris cloud, ground dust whirl | Brown sheath at the foot, wider than the funnel | wind beating the pickup threshold | PRESENT | `TornadoDust.luau` |
| 41 | Satellite tornado | A small tornado orbiting a large one at 1–3 km | not in the sim (one vortex per circulation) | MISSING | Needs a sim change. |
| 42 | Anticyclonic tornado (south arm of the horseshoe) | A weak tornado on the south side of the RFD | not in the sim | MISSING | Already an open item in memory. |
| 43 | Landspout, non-meso tornado | A thin, smooth, glassy tube under a growing tower on a boundary, little rain | Boundaries + Initiation (main engine has them; the lab has no pathway) | MISSING | QLCS mesovortex tornadoes exist (`Sim/Systems.luau:418`, `Sim/World.luau:398`). |
| 44 | Flying debris | Debris lofted and falling | `Sim/Debris` | PRESENT | `DebrisView.luau` (the user wants no flying debris particles for now) |
| 45 | **Power flashes** | Blue-green bursts at ground level under or near the tornado, the best tornado cue at night | Damage to the town's power poles (`server/Town.luau:286`, `Sim/Damage`) | MISSING | Cheap and fully event-driven. |
| **Lightning and night** |||||
| 46 | CG, +CG from the anvil, bolt from the blue | Channels; +CG far downstream under the anvil | `Sim/Lightning.luau:67-93` | PRESENT | `Lightning.luau`. A true bolt from the blue (out of the side of the tower into clear air ahead) is not separate; +CG covers most of it. |
| 47 | **Anvil crawlers / spider lightning** | Slow, branching horizontal channels crawling along the anvil and base underside, very visible at night or dusk | IC flashes along the anvil (`Sim/Lightning.luau:102`) | PARTIAL | IC channels are drawn "mostly hidden" with dim flickers (`Lightning.luau:12-13`); crawlers should be visible along the underside. |
| 48 | In-cloud flash illumination, night structure | Lightning lighting up the whole tower and base from inside; at night the only way to see structure | flash events | PRESENT | `StormCards.luau:18` recolours cards; `Tornado/FlashField` lights the funnel |
| 49 | Night sky, moonlight | Dark storm against a faint sky | sun elevation, moonlight | PRESENT | `Sky.luau:345` |
| **Sky and light** |||||
| 50 | Sunset- or sunrise-lit storm | Gold or pink tower and anvil, dark base | sun elevation | PRESENT | `StormCards.luau:300,358` (warm term) |
| 51 | Crepuscular rays / sun shafts | Beams through gaps (clear slot, between towers, under the anvil edge) into hazy air | sun direction, StormShape.sunLit, haze | MISSING | A few long additive cards from the gaps toward the camera. |
| 52 | Rainbow | Arc opposite the sun on rain shafts when the sun is behind the viewer and below 42° | sun, vol rain ahead | MISSING | Cheap: one arc card; rain is from the field. |
| 53 | Low-level haze / humid inflow murk | Milky distance haze on muggy days, which shrinks the range at which storms can be seen | Environment surface td/RH | PARTIAL | Clear-air visibility is fixed at 50 km (`Sky.luau:48`) instead of coming from the humidity. |
| 54 | Darkening under the anvil and core | Scene dims and cools | optical depth along the sun ray | PRESENT | `Sky.luau` |
| 55 | Distance haze / blueing of far storms | Far storms paler and bluer | distance | PRESENT | `StormCards.luau` haze |

## Top gaps, ranked (value to a chaser ÷ cost)

1. **Clear slot + horseshoe base (#19, #20).** *Value:* the single best visual cue to where the tornado will be, and the highest-contrast feature in the photos (06_a-c). *Cost:* low to medium. Thin or drop deck cards inside an RFD region from `rfdX/Y`, `rfd` and `rfdDeficit` (warm dry RFD = clear; cold wet RFD = rain-filled, so no cut) and wrap it by `occl`. Add bright backlit sky cards behind the gap. All in CardPlan's base section.
2. **Hook / RFD rain-wrap curtain near the meso (#23).** *Value:* in HP and occluding storms this is what hides the tornado or reveals it. It makes rain-wrapped tornadoes a real danger and a chaser decision. *Cost:* medium. Use `Precip.sampleFine`/`binFine` around the low meso for 0.5 km shafts within ~8 km, drawn as a curved curtain that follows the hook spiral.
3. **Flanking line (#2).** *Value:* it is seen from 50+ km and points straight to the updraft and the meso. It is a basic of supercell recognition, and the storm currently has no "stairs". *Cost:* low to medium. Place 4–8 decreasing tower card clusters along the RFGF (ColdPool edge), sized by convergence and CIN, reusing the tower code.
4. **Power flashes (#45).** *Value:* the best real tornado locator at night and in rain wrap; a strong game moment. *Cost:* low. When `Sim/Damage` fails a pole or wire, send an event; the client draws a blue-green PointLight plus a glow card and a flash pulse.
5. **Gust fronts and shelves on isolated or HP supercells (#32).** *Value:* the HP "bowl" or shelf leading edge, and the RFGF, show which side the outflow is on and where the danger is. *Cost:* low to medium. Feed ShelfPlan segments from each storm's ColdPool edge (`ColdPool.contours`), not only from `systems`.
6. **Back-sheared anvil and knuckles (#6).** *Value:* the classic far-range "this storm is strong" cue a chaser uses to pick a target. *Cost:* low. Make the upwind reach scale with W at el and the overshoot against the upper wind, and add lumpy edge cards there.
7. **Gustnadoes (#36).** *Value:* common, and a wrong-target lesson (they look like tornadoes but sit on the gust front, away from the wall cloud). *Cost:* medium. A spin-up source along the ColdPool edge where the shear across the front is high, feeding TornadoDust as short-lived whirls.
8. **Anvil crawlers (#47).** *Value:* a striking dusk and night spectacle, and it lights up structure. *Cost:* low. Draw the IC flashes that run along the anvil and base underside as visible slow branching channels (they already have endpoints).
9. **Pre-initiation Cu / towers and failed towers (#1).** *Value:* the first hours of every chase day: watching where the cap breaks. Players read the sky to target, not only the radar. *Cost:* medium. Send Initiation's lift-vs-CIN candidates and draw small Cu and towers that grow or collapse with them.
10. **Rain foot / wet microburst + haboob wall (#28, #35).** *Value:* outflow hazard cues that come entirely from existing ColdPool and dust fields. *Cost:* low (shaft foot spread where downdrafts or surges are strong) and medium (a far-range dust wall along a dry outflow edge).
11. **Inflow feeder bands + humid haze (#16, #53).** *Value:* show the inflow direction (driving into the inflow is safe), and haze sets how far you can see. *Cost:* low. Add several thin bands along srU/V; derive clear-air visibility from the surface dewpoint depression.
12. **Crepuscular rays + rainbow + hail fog (#51, #52, #26).** *Value:* photogenic "being there" moments; a rainbow tells you the sun is behind you and the rain is ahead; hail fog is a real visibility hazard. *Cost:* low each.

Later, because they need sim work: satellite and anticyclonic tornadoes, and landspouts (#41-43).

## Sources

- NWS Spotter Guide: supercells (LP/HP, clear slot, horseshoe, anticyclonic on the south arm): https://www.weather.gov/spotterguide/supercell2
- NWS Spotter Guide glossary (C, R, T): https://www.weather.gov/spotterguide/glossary_c, https://www.weather.gov/spotterguide/glossary_r, https://www.weather.gov/spotterguide/glossary_t, https://www.weather.gov/spotterguide/glossary_f
- NWS Storm Spotter's Dictionary (FWD): https://www.weather.gov/media/fwd/skywarn/StormSpottersDictionary.pdf
- NWS FWD Spotter Handout 2022: https://www.weather.gov/media/fwd/skywarn/Spotter%20Handout%202022.pdf
- NWS MEG Spotter Handout 2020: https://www.weather.gov/media/meg/Spotter_Handout_2020.pdf
- NWS Spotter's Field Guide 2011: https://www.weather.gov/media/unr/SpottersGuide2011_fielduse.pdf
- NWS DMX Spotter Reference Guide: https://www.weather.gov/media/dmx/Spotter/SpotterReferenceGuide.pdf
- NWS MKX extended spotter training: https://www.weather.gov/media/mkx/spotters/extendedspottertraining.pdf
- NWS RAC glossary: https://training.weather.gov/wdtd/courses/rac/documentation/RAC-glossary.pdf
- Wall cloud overview: https://en.wikipedia.org/wiki/Wall_cloud
- Supercell overview (Lemon & Doswell model): https://en.wikipedia.org/wiki/Supercell
- Hail fog: https://www.theweathernetwork.com/en/news/weather/forecasts/the-science-behind-the-prairies-twilight-zone-hail-fog
- Chaser accounts of power flashes, gustnadoes and anvil crawlers (anecdotal): https://www.umanitoba.ca/environment/envirogeog/weather/images/chase2017/chasesummary.html, https://stormtrack.org/threads/5-7-07-reports-tx-ok.10043, https://weather.ou.edu/~nwilson/chase7.html
- Repo references built on: docs/stormlab/RESEARCH-SUPERCELL-LAYOUT.md, RESEARCH-WALLCLOUD-HV.md, STATUS.md; docs/storm-reference/NOTES.md (photo lessons: clear slot = highest contrast); docs/storm-visuals/LIFECYCLE-AND-TYPES.md.
