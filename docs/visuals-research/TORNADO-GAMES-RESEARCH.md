# How tornado games build storms and tornadoes, and what it means for WeatherWorld on Roblox

*2026-11-10. Web research on Roblox storm games, non-Roblox games, VFX and papers, and the current Roblox toolset,
checked against what `roblox/src/stormlab/client/Render/` already draws. It follows on from
[VOLUMETRIC-RESEARCH.md](VOLUMETRIC-RESEARCH.md) (2026-11-05), which covers Roblox technique by technique. This file
adds what other games do, a plan for each structure, and what changed in Roblox since then. Labels: **C** = a developer
or the docs say so; **I** = inferred from footage or community advice.*

## Summary

- **Nobody publishes how they do it.** Twisted, Helicity and Severity have never written up their rendering. Their
  changelogs list features, not methods. The only detailed Roblox write-up is Roblox's own *Mystery of Duvall Drive*
  storm.
- **The big Roblox games use meshes plus particles.** Twisted's funnels and wall clouds are meshes ("81 wall cloud and
  tornado mesh combinations", C). Particles do the debris, inflow, rain and scud. Everything visual runs on the client
  from server state, with a draw-distance setting. Both Twisted and Severity warn that they run badly on low-end devices.
- **AAA clouds are raymarched** (Horizon's Nubis, RDR2, Flight Simulator 2020/24, Unreal). None of that ports to
  Roblox, and nothing on the 2026 Roblox roadmap changes it.
- **What does port:**
  1. **Flight Simulator 2004 sprite clouds** (Niniane Wang): each cloud is a cluster of soft sprites, lit by a cheap
     per-sprite formula (height-based ambient + sun dot product), with sprites fading from the edges in when a cloud
     forms and from the edges out when it dissipates. This is what our cards already are.
  2. **The Just Cause 4 tornado:** a bending spine made of two Bézier curves that morphs between S and C shapes, with
     a wind profile written around it. The fix that stops debris being flung out is to add the spine's own movement to
     the wind.
  3. **The Twisters (2024) film breakdown:** separate pieces (funnel, dust shroud, debris field, rigid debris, wall
     cloud, shelf cloud) hung on one master path. The shelf moves a little slower than the wall cloud. Ground-level
     spiral inflow shows in almost every shot.
  4. **Duvall Drive's rotating layers:** stacked semi-transparent cloud meshes, each spinning at its own speed, so the
     motion reads as rotation without any texture scrolling.
- **WeatherWorld is already on the most portable path.** Soft billboard cards, one storm drawn from shared
  frames + seed + server clock, lightning timed by the server. The gaps are not about method. They are a few missing
  structures (mammatus, hail shaft, supercell shelf, collar cloud, ground inflow) and **visible rotation**, which you
  reported missing on 2026-11-09.

---

## 1. What the games do

### Roblox

| Game | Confirmed (C) | Inferred (I) |
|---|---|---|
| **Twisted** (Willzuh + Siryzm) | 1.17: wall cloud and tornado **meshes** in 81 combinations; atmosphere and ambience on the client; debris cloud fades as the tornado widens; rain shafts change with hail. 1.18: LP/HP structure; base height from the LCL; rain curtains that "shroud visibility and fade as you approach"; tornadoes change shape and spin faster when stronger; ground inflow particles; **render distance setting**. 1.21: Rankine wind fields, tail clouds, intra-cloud lightning, darker tornado cores, StreamingEnabled, client memory cut by 1.58 GB. | Funnel = mesh variants swapped and blended, plus particles. |
| **Severity** (same team, due 2026) | Listing credits the same team and warns about low-end devices. No technical posts. | From our saved footage (`docs/storm-reference/frames`): big soft overlapping sprites, a flat dark ceiling, heavy fog and colour grading, debris parts near the tornado. Runs on mobile. |
| **Helicity** 1.8 | Storms remade; dynamic wall clouds and **dynamic funnels**; RFD and FFD winds, with the RFD wrapping round the meso to rain-wrap the tornado; hail graphics remade; radar moved to the client. | Players rate its tornadoes the most realistic of the Roblox games. |
| **Tornado Alley Ultimate** | Funnels are meshes ("Ghostnado Mesh", themes). | Arcade. |
| **Duvall Drive** (Roblox case study) | Layered cloud meshes with SurfaceAppearance, each spinning at its own speed. Meshes chosen because they **take light from lightning**. One client script spins everything. The server picks lightning timing for everyone. Bolts are Beams tweened with bloom; distant flashes are particles. Rain is a grid of emitter volumes. | — |
| **DevForum** | One billboard tornado used ~4,000 cards. A particle supercell of ~2,500 particles overheated the GPU. A particle cone shows "harsh horizontal lines" from the side. Shared clouds: the server holds cloud data and clients draw it. | Swap particles for meshes or beams with distance. |

Common techniques, most often seen first: mesh funnels and clouds → particles for debris, rain and scud → server
state with client effects → distance tiers and settings → layered meshes spinning at different speeds → Beams for
lightning → tint and Atmosphere darkening → billboard swarms (rare, costly).

### Outside Roblox

- **Just Cause 4:** the best-documented game tornado, but only its physics: a stack of cylinders around a deforming
  spine, with tangential, radial and up winds each shaped by curves, peaking near 230 mph. There is deliberately no
  central downdraft, so lofted debris stays airborne. How it is drawn is not described.
- **Horizon (Nubis):** raymarched, so not portable. Two useful lessons:
  - Guerrilla tried polygon clouds and multi-orientation billboards first and dropped them. The polygons "only worked
    for thick clouds", and the billboards could not shade each other, could not evolve and cost a lot in overdraw. That
    is the same wall our cards hit, so the fix is good per-card lighting, not more cards.
  - The *Burning Shores* superstorm lights its insides with almost free lightning flashes.
- **Indie Unity and Unreal tornadoes:**
  - The funnel is nested twisted cylinders with textures panning along the spiral. Outer layers pan slower than inner
    ones, and the mesh ends fade to clear.
  - One UE5 author kept the funnel **opaque**, because transparent nested meshes sort badly.
  - Dust at the base is particles or a dithered texture.
- **Sea of Thieves:** stylised clouds without raymarching (SIGGRAPH 2018). Details could not be read.
- **Flight Simulator 2004:**
  - Each cloud is 5–50 sprites from 16 shared textures. Sprites closer than about a third of the cloud's height are
    culled.
  - Brightness = ambient from height (5 artist colour levels) + dot(sun direction, sprite offset).
  - Sprites near the camera fade out.
  - Distant clouds become impostors, refreshed after the camera moves ~15%.
  - Overdraw was the bottleneck.
- **Lightning:** a main channel plus thinner branches. Phases go stepped leader → return stroke → re-strobes, with a
  light that flickers on the same timing.

Not portable at all: raymarching, per-pixel particle lighting (six-way lightmaps), soft depth fade, dissolve masks,
motion-vector flipbooks, and render-to-texture impostors. Partial substitutes:
- 2–4 pre-lit variants of each puff texture, chosen by sun angle;
- overlapping soft puffs instead of depth fade;
- `FlipbookBlendFrames` (Roblox now crossfades between flipbook frames) instead of motion vectors.

---

## 2. Roblox changes since the 2026-11-05 research

| Change | Effect on us |
|---|---|
| **Mesh streaming and improved cloud LoDs** (opt-in Apr 2026, planned to become the default ~Jul 2026). When on, `RenderFidelity` is ignored and Roblox picks mesh detail by distance, screen size and memory. Users report big meshes popping. | We set `RenderFidelity` in `shared/Tornado/*View.luau` and `cloudlab/Model/MeshView.luau`. **Check `Workspace.MeshStreamingAndImprovedLoDs` in the place.** It matters for any mesh body or far mesh. |
| **Low-end devices: minimum draw distance raised to 500 studs** (Late 2026 roadmap). | Low-end phones may draw very little beyond that, so distant storms need to be billboards (drawn to ~100k studs), not parts. |
| **`CreateDataModelContentAsync` fully released** (May 2026). Turns an EditableMesh or EditableImage into static content that is outside the Editable memory budget. | A far image card per storm (baked occasionally) or a baked base sheet becomes cheaper and safer than a live EditableImage. Only one EditableImage can update per frame, so bake far cards in turns. |
| **Custom flipbook layouts** (beta, Oct 2025: 1–64 frames per side, non-square) and **`FlipbookBlendFrames`**. | Smoother near dust, scud and debris particles with fewer frames. |
| **EditableMesh** caps: 60k vertices, 20k triangles. Still beta-gated (13+ and ID-verified creators). | Unchanged: fine for 1–2 hero meshes, not for many. |
| **No shaders or volumetrics** on the Spring or Fall 2026 roadmaps. | Unchanged. |
| Transparent objects are still **sorted per object, by centre depth**. | Unchanged: big transparent shells pop against cards and beams. This is why the opaque core and mesh body failed. |

---

## 3. Every structure: what others do, what we have, what to do

What we have is from the code survey (`Render/`, `CloudParts/`). Effort: S = hours, M = a day or two, L = more.

| Structure | Others | What we have now | What to do on Roblox | Effort |
|---|---|---|---|---|
| **Anvil** | Flat stratus-type sprite clusters (FS2004); mesh slab at range | CardPlan slab at the EL, downstream | Keep. Add soft fibrous edges with wider, blurrier stratus cards at the downwind edge. Shade the underside darker with the FS2004 formula. | S |
| **Overshooting top** | Dense bright cluster | CardPlan | Keep. Its brightness should track updraft strength continuously. | — |
| **Mesocyclone / striations** | Twisted panning meshes | CardPlan striations (on when rotation and mid-level wind are high) | **Conflicts with the no-bands rule.** Show the meso through differential rotation of card rings (Duvall layers), not stripes. Consider removing the striation cards. | S |
| **Wall cloud** | Twisted mesh variants; Twisters: its own piece where funnel meets base | WallStream (Rankine-orbiting puffs) | Keep. Rotation is not visible yet (see §4). | M |
| **Collar cloud** (ring at the funnel–wall join) | Twisters wall-cloud piece | **Missing** (proposed, never built) | A ring of 8–16 cards at the spine top, radius from the core radius, turning at the core angular speed. | S |
| **Tail cloud / inflow band / beaver tail** | Twisted 1.21 tail clouds; Twisters cloud pieces | WallStream tail, CardPlan inflow band | Keep. Cards should travel along the engine inflow streamlines toward the wall cloud; motion sells it. | — |
| **Shelf cloud / gust front** | Twisters: its own piece, slower than the wall cloud | ShelfPlan for squall-line segments only | **Add for supercells:** run ShelfPlan along the engine gust-front line (`Sim/GustFront`, cold-pool strength), with a dark underside and the "whale's mouth" strip. | M |
| **Scud** | Particles moving with the inflow | Scud.luau | Keep. Rising scud is the main cue for motion. | — |
| **RFD clear slot** | A gap in the density | BaseDeck hole, `Util.slotAt`, gaps in the shafts | Keep. Add a brighter rim tint on cards next to the slot (backlight). | S |
| **Rain shafts / FFD core** | Twisted curtains fade as you approach; beams or cards | RainShafts + Shafts (on again 2026-11-08), NearPrecip | Keep. Make the far-to-near handoff a fade (as Twisted does). Note `render-plan-2026-11.md` still says rain shafts are off; update it. | S |
| **Hail shaft / core** | Twisted tints storms by hail; Helicity remade hail | Partial: stones near the camera, white tint in shafts | Lighter, sharper-edged shaft cards where the engine hail rate is high (`RAIN-AND-HAIL-AT-DISTANCE.md`). Tint the core green-grey with hail. | S–M |
| **Mammatus** | Downward-facing sprites under the anvil | **Missing** | Downward-facing soft lobe cards under the anvil, placed where the anvil is sinking (sign of vertical motion at the anvil base). Warm when lit by a low sun. | M |
| **Lightning (CG, +CG, IC)** | Duvall: Beams + bloom, server timing; JC/Nubis: flash inside the cloud | Lightning.luau (Neon blocks, light, thunder); StormCards has flash code | Keep. Possible upgrade: Beam channels with LightEmission (cheaper than parts, as the community LightningBolt module does), and strobe on the leader → return-stroke → re-strobe timing. | S |
| **Funnel: rope, cone, stovepipe, wedge** | Mesh variants (Twisted, TAU); nested panning meshes (indie) | TornadoCards (~478 cards); stages from the radius profile | Keep the single build. Shape comes from the engine vortex radius by height. Adopt the **JC4 S/C spine** for lean and kinks (more than 8 points, spline-smoothed). | M |
| **Multi-vortex** | Choreographed sub-funnels; sprite chains orbiting | TornadoCards two-cell shell + sub-vortices | Keep. Sub-vortices orbit at 0.5–0.8 of the core radius with a 10–20 s period. | — |
| **Debris cloud / dust shroud** | Twisters: shroud and debris field are separate pieces; Severity brown-out | TornadoDust (skirt + lofted dust) on; DebrisView/DebrisCloud **off** in the game | Turn flying debris parts back on near the player only (within ~2,500 drawn studs), moved by the JC4-style wind around the spine. Tie the dust colour to the ground type. | M |
| **Ground inflow / dust whirls** | Twisted 1.18 ground inflow particles; Twisters: in almost every shot | Partly in TornadoDust | Low dust spiralling in along the engine near-ground wind toward the tornado and RFD, as near particles. It also shows rotation. | S–M |
| **Rope-out** | Spine thinning + more curvature | TornadoCards segmented rope | Keep. The JC4 S→C morph adds natural kinks. | — |
| **Far storms (tens of km)** | FS2004 impostors; Twisted draw-distance setting | Cards pulled closer beyond 60k studs; never nearer than 2.5 km | Optional: one baked image card per storm via `CreateDataModelContentAsync`, refreshed in turns, for low-end devices. | L |

---

## 4. Making rotation visible (the open problem)

Every source that shows rotation uses **different speeds**, not one spinning object:
- **Duvall:** layers spin at different rates and pass through each other.
- **Indie funnels:** outer layers pan slower than inner ones.
- **Twisted:** stronger tornadoes spin visibly faster.
- **Twisters:** the shelf moves slower than the wall cloud.

What this suggests for us, all following the engine wind:
1. **Shear between rings.** Wall-cloud and meso cards at different radii turn at the engine angular speed for that
   radius (Rankine: fast near the core, slower outside). The difference between neighbouring rings is what the eye
   reads.
2. **Something moving against a still background.** Rising scud and inflow dust moving into the wall cloud while the
   base deck holds still or drifts with the storm.
3. **Motion inside each card.** A looping flipbook or a slowly rotating ImageLabel inside each card adds swirl without
   adding cards. This matches the ~500-card budget rule of adding detail inside cards, not more cards.
4. **Check the time scale.** At the 8x clock, real meso rotation periods of a few minutes come out as tens of seconds.
   Confirm the cards really turn at the engine rate and that no smoothing cancels it out. 2026-11-09 suggested it may
   be too slow or smoothed away.

---

## 5. Suggested order

1. **Rotation pass** (§4), checked with `watch-scene` from several angles. It is the most visible gap. M.
2. **Collar cloud + ground inflow dust.** Both are small and also show rotation. S each.
3. **Supercell shelf from the engine gust front.** M.
4. **Hail shaft and hail tint.** S–M.
5. **Mammatus.** M.
6. **JC4-style spine and wind for the funnel and flying debris.** Turn debris parts back on near the player. M.
7. **Checks:** the `MeshStreamingAndImprovedLoDs` setting; draw distance on low-end devices; remove or replace the
   striation cards (no-bands rule).

Per standing rules: physics before visuals. Each item draws from engine fields the frame already carries (gust front,
hail rate, inflow, vertical motion at the anvil base) or needs a few bytes added to the look record. None needs
painted values.

---

## 6. Sources

**Roblox games:**
- Twisted 1.16: https://devforum.roblox.com/t/twisted-116-changelog/1316554
- Twisted 1.17: https://devforum.roblox.com/t/twisted-117-changelog/1610076
- Twisted 1.18: https://devforum.roblox.com/t/twisted-118-change-log/1988107
- Twisted 1.21: https://devforum.roblox.com/t/twisted-beta-121-changelog/2956061
- Kotaku on Twisted: https://kotaku.com/twister-video-game-roblox-server-twisted-tornado-1850675932
- Severity listing: https://www.roblox.com/games/103597332801951
- Helicity 1.8: https://devforum.roblox.com/t/helicity-update-18/2778001
- Tornado Alley Ultimate: https://devforum.roblox.com/t/tornado-alley-ultimate-50/2512258
- Duvall Drive case study: https://create.roblox.com/docs/resources/the-mystery-of-duvall-drive/develop-a-moving-world

**DevForum threads:**
- Recreating a tornado: https://devforum.roblox.com/t/what-is-the-best-way-to-recreate-a-tornado/723959
- Tornado recreation: https://devforum.roblox.com/t/tornado-recreation/768500
- Billboard tornado: https://devforum.roblox.com/t/make-a-billboard-gui-tornado/3492541
- Tornado VFX lines: https://devforum.roblox.com/t/tornado-vfx-doesnt-look-quite-right/3668521
- Realistic clouds: https://devforum.roblox.com/t/realistic-clouds/2229650
- Particle clouds: https://devforum.roblox.com/t/3d-volumetric-clouds-no-decal-stacking/3267875
- Shared cloud system: https://devforum.roblox.com/t/realistic-cloud-system-with-minimal-lag/2320769

**Other games and research:**
- Just Cause 4 aerodynamics: https://www.gamedeveloper.com/programming/aerodynamics-of-just-cause-4
- Nubis: https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine
- Real-Time Volumetric Superstorms: https://www.gdcvault.com/play/1027688/The-Real-Time-Volumetric-Superstorms
- Horizon clouds (80.lv): https://80.lv/articles/creating-clouds-in-horizon-zero-dawn
- Unity tornado: https://80.lv/articles/creating-a-tornado-in-unity/
- UE5 tornado: https://matthewburgess.squarespace.com/dev-blog/3/4/2022/ue5-tornado
- Flight Simulator 2004 clouds (Wang): https://history.siggraph.org/learning/realistic-and-fast-cloud-rendering-in-computer-games
- Harris GDC 2002: https://aurora.cs.uaf.edu/~olawlor/academic/thesis/ref/RTCloudsForGames_HarrisGDC2002.pdf
- Six-way lighting: https://unity.com/blog/engine-platform/realistic-smoke-with-6-way-lighting-in-vfx-graph
- Twisters VFX: https://beforesandafters.com/2025/05/16/twisters-what-went-into-a-storm
- Twister VFX history: https://www.theringer.com/movies/2020/5/7/21249788/twister-special-effects-history-tornado-cgi

**Roblox toolset:**
- EditableMesh: https://create.roblox.com/docs/reference/engine/classes/EditableMesh
- CreateDataModelContent: https://devforum.roblox.com/t/full-release-introducing-createdatamodelcontent-convert-editable-mesh-and-image-data-into-static-content/4541898
- Custom flipbooks: https://devforum.roblox.com/t/client-beta-optimize-your-particle-animations-with-custom-flipbook-layouts/4005128
- Mesh streaming: https://devforum.roblox.com/t/introducing-mesh-streaming-and-improved-cloud-lods-in-published-experiences-opt-in-phase/4601232
- Fall 2026 roadmap: https://devforum.roblox.com/t/creator-roadmap-2026-fall-update/4880208
- Beam: https://create.roblox.com/docs/reference/engine/classes/Beam
- Lightning beams module: https://devforum.roblox.com/t/effect-v11-lightning-beams-seamless-smooth-and-procedurally-animated-with-beam-like-properties/843534
- Particle sorting: https://devforum.roblox.com/t/particle-rendering-order-bug-w-semi-transparent-parts/314154
- UnreliableRemoteEvent: https://create.roblox.com/docs/reference/engine/classes/UnreliableRemoteEvent

Source gaps: there is no rendering write-up for Twisted, Severity, Helicity, Storm Chasers (Little Cloud Games), GTA or
Sea of Thieves. The Nubis and Sea of Thieves PDFs could not be read, so those points come from abstracts. The 100k-stud
draw limit and the particle caps (~16k on PC, ~3.6k on mobile) come from community reports.
