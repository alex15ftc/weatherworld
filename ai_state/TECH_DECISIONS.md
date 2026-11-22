# Technical Decisions

<!-- Durable decisions currently in force. One compact entry per decision; heading-scan
     before loading in full. When a decision is superseded, mark it and link its
     replacement; once the file passes ~25 KB, delete superseded entries (git keeps
     them). -->

## Entry Format

### YYYY-MM-DD — Decision title

- Status: `active | superseded by [YYYY-MM-DD entry]`
- Decision: `[what was decided]`
- Rationale: `[why, including alternatives rejected]`
- Follow-up: `[remaining obligations, or None]`

## Decisions

### 2026-11-22 — Storms come in from a margin round the map (INFLOW)

- Status: `active`
- Decision: storms also start in an 11-cell (~110 mi) margin round the map, in the air of the nearest cell inside it (a
  zero-gradient lateral boundary), only where their first motion brings them onto the map within 3 h
  (`InitiationEngine.js` `INFLOW`). They step offstage with no tornado and no reports until they cross; one that never
  does leaves no record. Warnings, watches and discussions may use them only for ground on the map
  (`Warning.js` issueWarnings, `Watch.js` stormsFiring, `MesoscaleDiscussion.js` describeNow cell -1).
  `fullRatePerHour` 0.20 to 0.16 keeps the tornado count.
- Rationale: storms drift a median ~110 mi (mostly north) between forming and their first tornado, and nothing came in
  across the edges, so the upwind (south and west) side had only its own storms: 6% of tornadoes in the south-west
  quadrant, 56% in the north-east. With the margin, the south half 28 to 36%; regression suite: no regressions,
  1,412 tornadoes against 1,524. Rejected (no measurable change, 4 seeds x 7 days): faster storm organization, aiming the
  steering upstream of the drift, a steeper genesis rate.
- Follow-up: the west half stays at ~20% (north-west lost what the south gained): the plateau needs its own work
  (moisture carried up the slope by the low-level wind). Deploy with the owner's go-ahead.

### 2026-11-18 — The engine stands on the game map's ground; a divide ridge in the western High Plains

- Status: active (the map has the ridge since 2026-11-19, laid on its finished ground: see below)
- Decision: the regional layer's cells take the world map's mean height over each 10-mile cell (`groundReliefM`,
  from `js/worldmap/engineGround.js`, stored in `engineGroundData.js`) instead of the bare east-west slope, and the
  world map gains a Palmer Divide-like ridge (`DIVIDE`: 350 m, west edge to 30% east, about a third of the way
  south) so that north and south winds have ground to climb. A map roaming along the geography keeps the slope alone.
- Rationale: the bare slope (at most ~1.7 m/km, no north-south relief) could not give upslope storms; the owner
  asked for the terrain change. Rejected: a higher, steeper west edge (shifts the whole map's climate), a SW mesa.
  Regression suite: no regressions; upslope-led storms 49 to 76 per 1,800 (probe, seeds 1-4 x 4 days).
- 2026-11-19: the ridge is laid on the map's finished ground (`layDivide`), not built in before erosion and
  planning: built in, it moved 220 of 452 towns, renamed 226 and changed radars, offices, counties and roads across
  the whole map (the owner chose to keep the published towns). Streams crossing it get water gaps; everything
  planned stays identical to the map without the ridge.
- Follow-up: publish the place and deploy the engine together. Rebuild `engineGroundData.js` after any change to
  the map's ground.

### 2026-11-18 — Nothing below EF0 is a tornado

- Status: active
- Decision: a vortex or damage swath counts as a tornado only at EF0 (65 mph) or above, in every count, list,
  check and product. Damage survey points estimated below 65 mph are left out, so no survey or tornado is rated
  "EF-1" (a survey with no EF0+ point stays EFU); outlook truth (`truth.js`, `countTornadoes`), the regression
  worker, the activity report and day reviews drop sub-EF0 tornadoes; the lab scripts count vortices whose
  `peakEf` reached 0; the game lists only EF0+ vortices as tornadoes (`WeatherController`, 2026-11-15).
- Rationale: the owner's rule (2026-11-18): sub-EF0 vortices were counted and surveys rated tornadoes "EF-1".
  The engine's own tornadoes always rate 75 mph or more (start wind 75, `damageRatingWind` floor), so
  `stormEngine.totalTornadoes` needs no filter; `tests/storm-reports.mjs` checks that floor.
- Follow-up: None.

### 2026-11-17 — Steering support scaled by moisture (ramp), not cut when dry

- Status: active
- Decision: the warm-sector support in `RegionSteering` is multiplied by a ramp of the outer model's moisture over the map about its mean, none at -2 g/kg and all at +4 (`moistRangeGkg`), in place of the dry cut (`dryGkg`, which gave average and very moist air the same support).
- Rationale: over 80 regression days the map's large-scale moisture and warmth tracked tornado counts (rank 0.50 / 0.49) and the support did not (0.13); below-Slight days sat on the jet's cold, dry flank. Suite: below Slight 13.8 to 6.3%, Enhanced 27.5 to 38.8%, High 3.8 to 6.3%; wind and hail report counts rose past tolerance and the owner accepted that. Rejected: `lookAheadDays` 2 (more lull runs), a warmth ramp as well (no gain), a ramp ending at +1 (saturates on half the days).
- Forecast check (seeds 41-50): Day 1 right 60 to 43%, within one 97 to 100%; Brier skill level or better for tornado; in-sample recalibration gains 0-1 point: no refit.
- Also rejected (owner kept [-2, 4], 2026-11-17): [-3, 3], inside every tolerance (wind 90th 239, hail median 141) but below Slight 11.3% against 6.3%, and lull runs in a 160-day screen 5.6% against 1.3%.
- Follow-up: about a third of lull-like days are caps in the regional layer, which steering cannot see.

### 2026-11-16 — Night stratus from the stirred layer under the jet; night cooling stopped, not undone, by cloud

- Status: active
- Decision: stratus forms at night where the layer under the jet's nose (`jetNoseM` times the share not decoupled) reaches the ground air's LCL within the moist layer (overcast `stratusDeckM` past it), as well as from the near-saturated ground air; the night's cooling is let through step by step by each step's cloud (`nightShape`); the deck keeps the night's top and base (`deckTop`, `deckLcl`) through the morning until the day's mixed layer grows through it. The satellite draws the low cloud as stratus and cumulus apart (`cloudStratus`, `cloudCumulus`) and has a night fog image.
- Rationale: windy warm-sector nights are held 2 K short of saturation at screen height (`nightSpreadK`), so no seed had stratus under open sky at dawn and overnight moisture return could not be seen. A deck forming late used to warm the ground back at once (the cooling so far was scaled by the cloud of the moment). Rejected: drawing stratus in the satellite only (the engine's cloud also sets heating and cooling: one truth).
- Forecast check (seeds 41-50 x 3 against HEAD): Day 1 right 67 to 60%, Day 2 within one 80 to 95%, Day 3 one day of ten lower; Brier skill equal or better: no refit.
- Follow-up: the deck now breaks about noon on seed 2, the late end of real Gulf stratus (it holds back the morning sun).

### 2026-11-16 — Soundings keep the mixed layer's vapour; drying share refitted to the 850 mb dewpoint

- Status: `active`
- Decision: `buildAnchors` (js/sounding.js) adds a point at the mixed layer's top carrying the atmosphere's
  `mixedTopMixingRatioGkg`, and blends 780 mb into the layer where the layer reaches it. Lift raises `moistTop` by its
  height above the ground over the 500 mb height (`ascentMidLevelMslM` 5600). `mixedTopDryingShare` 0.2 -> 0.42.
- Rationale: the sounding dried straight after 850 mb inside a layer the atmosphere holds well mixed. Fixing only that
  (780 mb alone) moved daily MLCAPE peaks onto the high ground (8 -> 65% of days, p90 3,687 -> 4,599) because full-rate
  lift had deepened thin high-ground moist layers; the lift profile brought that to 13%. With the sounding now honest,
  the warm sector's 850 mb dewpoint ran 14.8 C against the real 13.0; 0.35 gave 13.7, 0.5 12.2, 0.42 13.1. Rejected:
  capping CAPE or the moist top (painting). Suite: no regressions; forecast check seeds 41-50: no refit needed.
- Follow-up: warm-sector surface dewpoints ~1 C moist and too uniform (the remaining MLCAPE excess, SBCAPE peaks);
  Day 1 High false alarms (forecast check 77% FAR on few cases).

### 2026-11-15 — Day 1 update table refitted; updates stay on the perturbed runs

- Status: `active`, its tornado row superseded 2026-11-16: `day1update.tornado` is `day1.tornado` (the owner's choice). On
  seeds 53-56 (perturbed runs, 8 days an issue) the fit read raw tornado chances about half as high as they verified (raw 6%
  verified 7.8%: fit 2.9%, day1 8.6%; RMS 2.16 -> 1.08), being made from short-range runs; its wind and hail rows agree with a
  perturbed-run fit there and stay. Seeds 53-56 had 16:30Z and 20Z updates too low on 63% and 75% of days with the fit.
- Decision: the Day 1 updates' table (`CALIBRATION.day1update`, used from 3 h into the day: the 16:30Z, 20Z and 01Z issues)
  is refitted from the raw chances of updates made the short-range model's way (seeds 41-46; the script takes the last
  source's data) and checked on the perturbed runs the server uses (held-out seeds 47-52). Updates keep coming from the perturbed runs; making them the
  short-range model's way (one run of the live air without forecast errors carrying 7 cheap runs, none of the live world's
  storm dice shared) is kept as an option for cost.
- Rationale: `scripts/outlook-updates-verify.mjs` now makes the server's issues and scores them as the live scoreboard does.
  Seeds 41-46 x 3 days: the short-range way and the perturbed runs had the same Brier skill at every update (within a point);
  both fell a category low from 16:30Z (too low 50-67%) because the 2026-10-24 table pulled middle chances down about
  threefold. The refit (fitted on 41-46) on held-out seeds 47-52: Brier skill up or level at every update (wind +3 to +5);
  20Z highest category right 39% -> 61%, too low 56% -> 28%; 16:30Z right 44% -> 50%; 01Z right 39% -> 33%, too high 17% -> 28%.
- Follow-up: false Moderates on the 01Z updates (live scoreboard); a short-range-way table if updates are moved to it for cost.

### 2026-11-16 — Day 3 caution back to 0.65 on the quieter engine; Day 2 stays 0.9

- Status: `active` (supersedes the Day 3 part of "caution raised to 0.9" below)
- Decision: `OUTLOOK.caution` is Day 1 0.9, Day 2 0.9, Day 3 0.65 (the owner's choice after a full outlook review).
- Rationale: the 0.9 numbers were measured on 11-14 weather. New runs of the engine at `40ce207` (steering look-ahead,
  mixed layer at dusk; 13.8 tornadoes a day against 19.3 on the same seeds), 80/60/40 mornings of seeds 41-60, saved as
  `data/outlook-archive/2026-11-16-40ce207`: Day 3 at 0.9 drew Enhanced+ over 37% of the map against 17.5% verified, its
  30% and 45% areas verified 20% and 32%; at 0.65 23%, 32% and 45.5%, day right 37.5 -> 40%, too high 30 -> 22.5%,
  issued Brier skill 4 -> 9.5 (0.75 between). Seeds 41-50 alone (10 Day 3s) lean to 0.9, 51-60 (30) strongly to 0.65.
  Day 2 at 0.9 held: 45% areas verified 44-45% (53-54% at 0.75), right 42% at 0.75-0.9. Day 1 chances still verify at
  their values (tornado 30% -> 29-31%, wind and hail 45% -> 41-48%), High 6% forecast and verified, but Moderate 11% against
  22.5% verified, mostly hail-hatch Moderates (hail 2 in hatch verifies on ~30% of days, drawn on 0-4%).
- Follow-up: chosen and checked on the same mornings; watch live Day 3. The verified mix on 40ce207 (TSTM 1 / MRGN 8 /
  SLGT 26 / ENH 36 / MDT 23 / HIGH 6%) has Moderate over the owner's 15% aim; raising the hail 2 in hatch bar
  (`CIG_BOUNDS.hail[0]`) 0.35 -> 0.50 gives Moderate about 14%, then the forecast hatches need refitting (owner to decide).

### 2026-11-16 — Day 2 and Day 3 caution raised to 0.9

- Status: Day 2 `active`; Day 3 superseded by "Day 3 caution back to 0.65" above (supersedes the caution part of 2026-11-14 below; its hatches stand)
- Decision: `OUTLOOK.caution` is Day 1 0.9, Day 2 0.9, Day 3 0.9 (was 0.75 and 0.65). The owner chose 0.9 over 1.0 to
  keep a slight lean low.
- Rationale: 30 mornings (seeds 41-50, rescored from saved runs at each level). Day 3 at 0.65 drew Enhanced+ over 8% of
  the map against 21% verified, too low on 60% of days; at 0.9 15%, day right 30 -> 50%, Enhanced+ CSI 0.25 -> 0.34; at
  1.0 17% but the calibrated chance had no Brier skill. Day 2 at 0.9: Enhanced+ 14 -> 19% (20% verified), right 35 ->
  50%, too high 5% either way, Enhanced+ CSI 0.54 -> 0.60. Running 8 members to Day 3 instead of 4 gained nothing
  (Enhanced+ CSI 0.25 -> 0.13).

### 2026-11-14 — Outlooks lean low at longer leads; stricter tornado and hail hatches

- Status: `active`
- Decision: each day's calibrated chance is scaled by `OUTLOOK.caution` (Day 1 0.9, Day 2 0.75, Day 3 0.65), so Day 2
  and Day 3 lean low as the SPC's do (the owner's wish), maps and categories alike. Hatches (`CIG_SHARE`): Day 1 tornado
  EF2+/EF3+ need 3 of 8 runs (was 2), Day 1 hail 2 in needs 6 of 8 (was 4; the owner wants Enhanced a little more
  common than Moderate), Day 2 tornado EF3+ needs 2 of 4 (was 1).
- Rationale: 80/60/40 unseen days (seeds 41-60). Every false High was a tornado High. Day 1 mix TSTM 4 / MRGN 3 /
  SLGT 21 / ENH 37 / MDT 28 / HIGH 7.5% (verified 3 / 5 / 19 / 35 / 29 / 10), right 70%, too high 11%, too low 19%.
  Day 2 too low 40% / too high 14%, High 3% (verified 7%). Day 3 Slight 30% / Enhanced 70%, too high 10%, Brier skill
  9 -> 13. Rejected: the tornado curve fitted to the smoothed truth (High gone, tornado skill 16 -> 11).
- Follow-up: values chosen on the same test days; check the live mix on the scoreboard after a week or two.

### 2026-11-14 — Day 3 outlooks from storm runs again

- Status: `active` (supersedes the 2026-10-24 choice of Day 3 from the ingredients)
- Decision: the four Day 2 storm runs keep their storms through Day 3 (`OUTLOOK.stormShare.day3: 0.5`), with the
  installed Day 3 chance table and intensity-group share.
- Rationale: 40 unseen Day 3s (seeds 41-60, current engine): issued Brier skill +9 / +10 against -5 from the
  ingredients, Enhanced-or-more CSI .47 against .11; highest category right 38% against 40%, within one 90%+ against
  80%. A Day 3 refit fitted on 51-60 lost on 41-50; significant areas verified 5-33%, so Day 3 Moderate (60% with the
  hatch) stays out of reach, as at the SPC. About 6 s more an issue, twice a game day.
- Follow-up: check the engine's CPU after deploy; Day 3 Moderate is never issued.

### 2026-11-14 — Outlooks: gates off, truth corrected at the map edge, areas tidied, scored live

- Status: `active`
- Decision: the hand-set gates over the calibrated chance (run agreement, the calibration's one-level guard, the
  High-day easing) are off (`OUTLOOK.gates`, switchable for scoring with `OUTLOOK_GATES`). The practically perfect
  sums are divided by the share of their 120 km Gaussian that lies on the map (`truth.js onMapShare`), so chances
  no longer sag toward the edge (the borders that ran along the edge). σ stays 120 km. Issued areas are tidied
  (`contourShapes.js tidyRanks`, `OUTLOOK.tidy`: pieces and holes under 1600 sq mi go, except a level's largest
  piece; each category ringed by one cell of the one below), and the web maps draw no outline along the map edge.
  Every live outlook is scored at its day's end (`server/OutlookScoreboard.js`, `/api/outlook/scores`, the
  performance page).
- Rationale: 30 unseen mornings (seeds 41-50) re-scored from one archive (`outlook-verify --from`, `REPP=1`
  re-smooths saved runs and truth). Gates off: issued Brier skill up on every hazard and day (Day 1 tornado
  14→18, wind 32→38, hail 39→41; Day 2 hail 20→28; Day 3 -17→-6); Day 1 highest right 53→63%, too low 37→7%,
  too high 10→30% (nearly all one category). highRun changed nothing. Edge correction: issued skill up on all
  hazards (Day 1 hail 34→39). Tidying: no score change. σ 48 km was rejected (verified ENH/MDT/HIGH a third each).
  Calibration not stale: calibrated skill 19/36/45 against 17/39/46 on 2026-11-07, a refit in sample gains ≤3 points.
- Follow-up: watch High's false alarms on the live scoreboard (forecast on 27% of days, verified 17%); Day 3 still
  under-forecasts (too low 70%).

### 2026-11-14 — A storm's winds are one description, read by everything that shows them

- Status: active (branch `engine/one-storm-wind`, not merged)
- Decision: a storm's mesocyclone and tornado are worked out once (`js/storms/StormVortices.js`, from the engine's
  mesocyclone strength, low-level rotation and tornado) and its cold pool's outflow by one rule (`ColdPool.js`);
  the frames, the radar's velocity, the rain's fall-out, the debris and the trees' wind read those, never their
  own copies. The tornado's core at the ground keeps the engine's damage width; aloft it widens into a tornado
  cyclone.
- Rationale: six separate vortex rules disagreed by up to 7x in circulation (frame 12 m/s across 1.6 km, radar
  38 m/s across 3.4 km on one storm), and trees felt a tornado twice.
- Follow-up: None (the engine's own fall-out, `StormFallout.js`, reads it too since 2026-11-14).

### 2026-11-13 — The long range model is a storm-free copy with one timing error; severe-weather charts are the map's own

- Status: `active`
- Decision: 7-day runs at each 06Z, stepped without storms, each with a timing error drawn once (the outlook
  members' mechanism and spread). On the large-scale pages CAPE, CIN, SCP and STP cover the whole model (the
  owner's choice): the map's cells in its box, a display-only wide copy of the regional layer around it
  (`WideRegion.js`), the large-scale model's own columns beyond. Rejected: spreading the map's values outward by
  distance (painted); the regional layer over the whole channel (its geography is the map's, not a continent's).
- Rationale: the owner asked for the timing error rather than an exact run. A copy is otherwise exact (steering
  and the large-scale model are deterministic and storms do not feed back into them; measured over 5 days), which
  would be a spoiler. The composites need the regional layer's low-level air (backed winds from the lee trough,
  the cap): from large-scale columns alone they read far too low (SCP 1 against the map's 10).
- Consequences: a run's large-scale fields are the world's own; what differs is where the map sits in them, and
  from that the map's weather. Storms are not forecast beyond the short range model.

### 2026-11-12 — Day replays are kept 16 world days and played by the live pages; GIFs are made in the browser

- Status: `active`
- Decision: a day's replay (hourly mesoanalysis and large-scale frames, every warning) is a file per day beside
  the world's state, let go after 16 world days; a saved day summary outlives its replay. The mesoanalysis and
  large-scale pages play a replay through the same routes' answers they get live. Loops are made into GIFs in the
  reader's browser.
- Rationale: the owner's requests (replays on the day reports, expiry after two real days). The frames are ones
  the live pages' runtimes have already worked out, so keeping them costs the engine nothing. Rejected: whole-map
  radar mosaics through the day (a build every one or two real minutes, dropped for performance in October);
  making GIFs on the engine (its image has no browser or image libraries, and the charts are drawn by page code).
- Tornado radar (owner asked for it back without a cost to the live game, 2026-11-12): recorded on the storm
  tick, scanned later as low-priority work on the radar threads (one piece at a time, never the last free
  thread), the waiting list kept in the day's file. Scan only once a tornado exists, from the rolling copy of the
  storm's inputs: scanning every storm that might produce one measured about twenty times the cost. Rejected:
  a thread of its own (needs a spare core the plan may not give); scanning on first view (the wait lands on a
  reader, and on the live path); other products on request (one scan makes every product in the same pass).
- Consequences: a replay cannot be made for a day after the fact; while the world is stepped by hand in bursts
  the warnings between steps are missed (the live clock keeps them all).

### 2026-11-12 — The public is not shown that the game map moves; day summaries are kept only when an admin saves them

- Status: `active`, changed the same day by the owner: the view is as it first was for everyone (it follows the map east-west;
  dragged or zoomed, the map's box moves through the frames), and no page draws the drift arrow. The drift's speed and the
  day's aim stay admin only. A day has no report until it has ended.
- Decision: on the large-scale charts the public view holds the game map in the middle of the chart, and the
  server leaves the map's drift (speed, direction, the day's aim) out of the frames it sends the public; an admin
  (the admin key) gets them and the draggable view. Pictures and loops made for sharing use the public view.
  A day's summary (its highest-risk Day 1 outlook, tornado tracks and numbers) is public only once an admin has
  saved it; a saved day is a full copy kept for good.
- Rationale: the owner's requests. The drift is how the world is steered to its weather, not something a
  player should read off a chart; hiding it in the page alone would leave it in the data. Saving by hand keeps
  the public list to days worth showing and keeps the file small (the log lets days go after about two weeks).

### 2026-11-12 — Day 3 outlooks show one chance of any severe weather beside the categorical map

- Status: `active` (replaces "Day 3 outlooks categorical only", 2026-11-11)
- Decision: the Day 3 product carries its `severe` hazard (5 to 60%, with its hatching), as the forecast already
  makes it (`DayOneOutlook.js` hazards.day3); the website and the Roblox Outlook layer offer Categorical and Severe
  for Day 3. No tornado, wind or hail maps on Day 3. The key still has no High risk.
- Rationale: the owner's request; the real Day 3 outlook is a categorical map and one probabilistic map of any
  severe weather.

### 2026-11-12 — The engine's pages are one website with shared parts and a light, plain look

- Status: `active`
- Decision: every page takes its header and footer from `site/*.html`, put in by the server when it sends the page
  (`server/SitePages.js`, which also holds the address list); no build step, no client-side templating. Document
  pages are light by default (dark when the reader's system is), with square corners, rules and tables instead of
  boxed cards, and colour kept for hazards; the map tools stay dark. Type is Public Sans and IBM Plex Mono, served
  from `fonts/`. Pictures meant for sharing carry their title, time and "simulated weather, not a real forecast" in
  the frame.
- Rationale: the owner asked for a proper website that does not look machine-made. Real forecast sites (SPC,
  weather.gov, Tropical Tidbits) are light, dense and text-first with every product stamped with its times; the old
  pages' dark navy, rounded cards, pill buttons and default Inter are the commonly named marks of generated pages.
  Rejected: a header written by script in the browser (flashes, and each page still needs its own copy for readers
  without script); fonts from Google's servers (a third-party request, and the pictures the tools make need the
  same files locally); a static site generator (the image has no npm packages).
- Consequences: a new page needs a row in `server/SitePages.js` and its file in the `Dockerfile` (`tests/site-pages.mjs`
  checks both). `/` is now the front page; an unknown address is a 404, no longer the mesoanalysis page. The map
  tools are document pages with a controls column and a chart; their charts stay dark because their colours are
  chosen for a dark ground (redrawing them light is a separate, larger job). The Roblox products screen takes the
  same colours and square corners in `Ui.luau`.

### 2026-11-11 — Trees are chunk records drawn by clients; their breaking is the server's and permanent

- Status: active
- Decision: The chunk generator records its trees on each chunk's props model (`Trees` attribute) instead of
  building them from parts; clients draw them (skinned mesh near, 8-view impostor far, rigid pieces once broken)
  and sway them from the lab wind field. The server alone decides breaks, from the shared weather
  (`FoliageWind`: lab world, or the window's environment plus the engine's full frames) through wood mechanics
  checked against EF DI 27, writes them to the chunk (`TreeDamage`), and keeps them permanently in a DataStore
  shared by all servers (MessagingService for live servers). The fall's rest pose is not stored: `Mechanics.rest`
  computes it alike everywhere (flat ground at the foot).
- Rationale: the owner asked for persistent, shared blowdowns and seamless breaking. Replicating thousands of
  skinned trees and physics debris from the server would cost far more; records plus deterministic poses keep
  every client identical. The skinned mesh stays whole until a break, then is swapped for pieces cut from the
  same faces at the current pose (no seams while whole).
- Follow-up: upload the generated trees (`Foliage/Assets.ready`); until then the old part trees stay. Damage
  only happens near players (loaded chunks); tornado tracks where nobody was could come from the engine's damage
  surveys.

### 2026-11-13 — Roblox lays its roads from the map's road graph, not by its own rules

- Status: active
- Decision: the Node generator's road graph (`js/worldmap/streets.js`) and its town blocks (`blocks.js`) are
  exported (`WorldData/Graph`) and are the only source of where roads run, end and meet in Roblox;
  `RoadNet.build` maps edges to cross-sections and makes no road decisions. Road rules change in the generator.
- Rationale: Roblox rebuilt roads per chunk by rules that differed from the generator's, so the generator's
  conflict check ran on roads the game never drew and the M map and the world disagreed.
- Follow-up: the M map still draws section roads from `sections.u8`; move it to the graph.

### 2026-11-11 — The world's clock is locked to real UTC time; products name days "11/11/26 Day 3"

- Status: active
- Decision: the hosted engine's clock (`WeatherAuthorityRuntime.startClocks`, `clockLock`) puts each world hour
  at a fixed real time: world hour = 8 x real hours since 1970 + `clockOffset` (whole world days, saved with the
  world). Each real UTC day holds world days 1-8 (Day 1 from 00 UTC, Day 2 from 03 UTC ... Day 8 from 21 UTC).
  Every public label (products, pages, maps, Discord posts, the game's report days, `/status`) names an hour by
  `js/forecast/calendar.js`: "2330 UTC 11/11/26 Day 3"; DDHHMMZ stamps use the real day of the month. The
  world is never ahead of the clock and catches up when behind (less than a world day); a new world, a pause
  longer than 3 real hours or a manual advance picks a new offset. `WEATHER_CLOCK_LOCK=off` turns it off.
- Rationale: the owner wanted the world's age (its own day count) kept out of public view, with a date that
  matches the real one.
- Follow-up: the raw hours in the public APIs (`nowHourUtc`, `/api/health`) still give the world's age to
  anyone who reads the JSON.

### 2026-11-11 — Workspace follows the project template, adapted to one repo

- Status: active
- Decision: `AGENTS.md` is the instruction file (`CLAUDE.md` holds only `@AGENTS.md`); state lives in `ai_state/`;
  specs in `docs/spec/`; business state in `ops/`. The product stays at the repo root rather than moving to
  `tech/<product>/`, and there are no child repos (`repos.txt`, `scripts/clone-all` not used).
- Rationale: the owner chose conventions plus the ops layer over a full restructure, which would have broken every
  path in scripts, tools, tests, Rojo projects and docs.
- Follow-up: fill `docs/spec/` and `ops/` with the owner.

### 2026-11-11 — The Roblox place runs on the Roblox Boilerplate

- Status: active
- Decision: `roblox/` uses the boilerplate layout (Client in ReplicatedFirst, Server in ServerStorage, Shared and
  Packages in ReplicatedStorage), the Service / Controller lifecycle, and its modules. All networking is Network
  events declared in `Shared/Net`; `Network.Request` (Promise based) replaces RemoteFunctions. The labs are their
  own Rojo projects on the same core.
- Rationale: one loader, typed and validated networking, cleanup through Trove, profiler labels, player settings
  and ConVars; replaces per-module remotes and folder lookups.
- Follow-up: play-test in Studio (see `CURRENT.md`).

### 2026-11-11 — The simulation modules stay pure and runnable under Lune

- Status: active
- Decision: `roblox/Shared/StormLab/Sim` and `roblox/Shared/CloudModel` take no boilerplate dependencies and keep
  their sibling requires, so `tools/stormlab` and `tools/cloudlab` run them offline.
- Rationale: offline diag and test scripts are the fast check for the sim.
- Follow-up: None.

### 2026-11-07 — Engine storms drawn from shared frames on every client

- Status: active
- Decision: in engine mode the clients build each storm from the engine's shared numbers and frames
  (`Client/Modules/FrameWorld`), so every server and player sees the same storm; the server's own lab sim is
  not taken for the body (`docs/stormlab/FRAME-V2.md`, `docs/research/ENGINE-PHYSICS-PLAN.md`).
- Rationale: one engine is the authority for the shared weather.
- Follow-up: None.

### 2026-10 (exact date not recorded) — One engine, one world, all UI in Roblox

- Status: active
- Decision: the Node engine is the single weather authority for every Roblox server; the game's map and products
  screens live in Roblox; Node keeps only the mesoanalysis, performance and models pages.
- Rationale: shared weather across servers; one place for player UI.
- Follow-up: None.
