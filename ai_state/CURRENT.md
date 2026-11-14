# Current

Updated: 2026-11-13

<!-- Rewrite in place when the objective, what is true now, next actions, or blockers
     change. Write plain sentences a reader with no context can act on. Respect each
     section's cap; if content does not fit, move it to CONSTRAINTS.md,
     TECH_DECISIONS.md, QA_STATE.md, or docs/, or delete it (git keeps it). Never
     compress prose to fit. -->

## Goal

<!-- Set by the owner; agents propose changes instead of editing this section. -->

Not set yet. Proposed: the Roblox place on the boilerplate plays end to end in Studio (spawn, chunks load,
storms from the engine draw, products screen opens) with the engine on Railway, before new feature work.
`docs/spec/PRODUCT.md` stories are not written yet (see `docs/spec/README.md`).

## True Now

- The engine runs on Railway at https://highrisk.up.railway.app and keeps its world across deploys
  (`docs/HOSTING.md`); one engine feeds every Roblox server.
- Public name is "High Risk" (2026-11-13, deployed from `fb36ab4`; the address was renamed from weatherworld.up.railway.app the same day): the site's pages, saved pictures and GIFs (files
  `highrisk-...`), watch text and the social kit say High Risk. The repo, engine internals, service names and
  the Roblox place still say WeatherWorld.
- Public outlook pages (2026-11-11, deployed to the engine from `5da98f7`): `/outlook/day1` .. `day3`
  (`outlook.html`) show each outlook's categorical and tornado/wind/hail maps (SVG from
  `server/OutlookPublic.js`) and discussion; `/api/outlook/index` lists the issues. The Discord bot
  (`weatherworldbot` service on Railway, code outside this repo) posts each new issue to the High Risk
  server's `#📋outlooks`. The issued outlooks and their ensemble runs (the models page, since `344a505`) are saved beside the world (`outlooks.bin`, matched by the
  runtime's `worldId`) and put back after a restart, so a deploy no longer blanks the pages for the ~15-minute
  re-run; only a new world starts with none.
- Watch, mesoscale discussion and warning posts (2026-11-11, deployed to the engine from `c3a86a4`, bot posting
  live): `server/ProductArchive.js` keeps every watch and
  discussion of the world (saved in `products.bin`; the mesoscale runtime in `mesoscale.bin`) and the last 3 hours
  of warnings, and serves `/api/products/feed`, maps (`server/AreaMap.js`) and the pages `/watch/N`, `/md/N`
  (`product.html`). The bot posts them to `#⚠️watches`, `#📝discussions` and `#🚨warnings` (tornado and destructive
  warnings one post each, the rest in a roundup each minute). Warning numbers still restart with the engine (the
  warning runtime is not saved); the bot tells warnings apart by number plus issue minute.
- Storm sentences in discussions about a watch (2026-11-13, in the working tree, not committed or deployed): at
  each look ahead `MesoscaleRuntime.radarLooks` has the nearest radar (2 radars at most) look at the rotating
  storms under the watches in effect, and a discussion about a watch then speaks of its leading storm
  (`describeStorm` in `js/forecast/MesoscaleDiscussion.js`): the radar's low-level rotational velocity, a tornadic
  vortex signature, a debris signature (`debrisSignature` in `js/radar/RotationDetection.js`), the significant
  tornado parameter around it and its motion. Measured on this machine: a radar's 9-tilt volume is about 3.5 s
  of one radar thread and the detection 0.1 s. Checked by `tests/mesoscale-discussion.mjs`,
  `tests/radar-simulator.mjs` and real scans of a made supercell; not yet seen on a running engine. This is the
  first step toward SPC-style storm-scale ("meso-gamma") discussions; the full product (its own discussion for
  an ongoing strong tornado, with a wind estimate from rotational velocity and the tornado parameter fitted on
  our own world) is proposed, not scoped. For it: over 4 saved days EF3+ tornadoes lasted a median 74 world
  minutes (9 real minutes) and EF2+ 25, so it suits EF3-class storms with about a 60-minute valid time.
- World controls admin only (2026-11-12, deployed from `d933a58`): every `/api/authority/*` write (new world,
  +30 min / +1 day, seek, pause clock) needs the `WEATHER_ADMIN_KEY` (`server/ChaserArchive.js` isAdmin; with no
  key set only the local machine). The mesoanalysis World card has an Admin sign-in; the key is kept per tab
  (`wwAdminKey`, shared with `/chasers`). Checked on the hosted engine: no key gives 401, the key gives 200.
- Chaser network (2026-11-12, on `main`, engine deployed; place "plains" published as version 493): one page `/chasers`
  (`chasers.html`) whose view comes from the viewer's role (`server/ChaserArchive.js` roleOf): public sees dots and
  unnamed day tracks; admin (the `WEATHER_ADMIN_KEY`, entered on the page) sees names, user ids, servers and a speed
  check that flags legs above a set mph (teleports). Live dots plus a loop of each world day with that day's storm
  reports; tracks saved in `chasers.bin`, 24 world days kept. The game servers now add UserId, DisplayName and
  Name to their player reports (`LiveStormsService`). Checked with `tests/chaser-archive.mjs` and a local engine fed
  by two fake servers (both roles, phone width). An in-game per-server layer on the M map (names, this server
  only: `ChaserNetService`, `Layers/Chasers.luau`) is not yet seen running. Version 493 is also the first publish of the
  boilerplate place: the live place plus the Rojo build and a fresh map export, old scripts removed (merged with
  Lune; the version before is saved in `roblox/build/published-before-chasers.rbxl`, not in git). Publishing through
  romcp fails with 409 while Studio has the place open (Team Create): close Studio first. A build for publishing needs
  both git-ignored export folders, `Server/WorldData` and `Shared/MapData` (version 494 lacked MapData: the M map
  waited on it forever; fixed in 495), plus `Packages`.
- Live servers take the hosted engine (2026-11-12): the place carried a `WeatherFeedUrl` attribute pointing at a dead
  Cloudflare tunnel, which overrode `Config.WEATHER_FEED_URL`. `Config.feedUrl()` now honours that attribute in Studio
  only, and the attribute is cleared in the published place. The engine wants the experience secret
  `weather_feed_key` (= Railway's `WEATHER_GAME_KEY`; 401 without it); whether it is set in Creator Hub is not
  checked (no API for secrets). A version 494 server reached the engine and got 401 on every request: the secret
  is missing or wrong in Creator Hub (owner action), so the live game has no weather until it is set.
- Synoptic page (2026-11-12, deployed to the engine from `85c9a9b`): `/synoptic` (`synoptic.html`, `js/pages/synopticPage.js`, linked from every
  page's menu) shows the whole large-scale model (the 10,240 x 5,120 km QG channel, wrapping east-west) with the game
  map's box and drift, H/L centres and chart presets (250 mb jet, 500 mb vorticity, 850 mb jet, surface, dewpoint,
  moisture transport and advection, temperature advection, large-scale lift and rain, deep shear), looping the last
  18 h. `server/SynopticRuntime.js` reads every grid point through the regional layer's `outer()` and conversions, so
  near the map it matches the map (`tests/synoptic-runtime.mjs`); API `/api/synoptic/frame` and `/api/synoptic/field`.
  These are the large-scale fields only (no daytime heating, lee trough, cold pools or storms).
- World clock locked to real UTC (2026-11-11, deployed from `75ad4ac`; the live world came up in step): 8 world days
  to each real day, and every public label names the day "11/11/26 Day 3" instead of the world's own count
  (`js/forecast/calendar.js`; decision in `TECH_DECISIONS.md`). Day 3 outlooks had no High
  risk in the key. The Roblox report-day names need the place synced and published to show.
- Branch `roblox/boilerplate` (committed and merged to `main` 2026-11-11) moves `roblox/src` onto the Roblox Boilerplate: Services and
  Controllers, all remotes replaced by `Shared/Net` Network events and `Network.Request`, Trove, Signal,
  Profiler, Settings (`roblox/README.md`).
- On that branch all four Rojo projects build, luau-lsp shows no new type errors against the old code, the Node
  tests `tests/tornado-frame.mjs` and `tests/cloudmodel-restore.mjs` pass, and the lune storm tests pass except
  `tools/stormlab/test_client.luau` and `tools/cloudlab/test_visual_atmosphere.luau`, which fail the same way on
  `main`.
- Nothing on that branch has been run in Studio yet.
- Skinned-tree foliage (2026-11-11, committed with the boilerplate move, on `main`): 8 generated trees (`tools/blender/
  foliage_trees.py`), wood mechanics that pass the EF DI 27 checks, sway, chunk tree records, `FoliageService`
  (breaks, permanent shared damage), `FoliageController` (mesh, impostor, pieces), Studio plugin `FoliageTool`.
  The 8 models and 64 billboard views are uploaded to user 18865611 through Studio's MCP (`open_cloud_invoke`,
  `upload_image`; upload folder `roblox/assets/foliage` approved) and recorded in `Foliage/Assets.luau`
  (`ready = true`: the old part trees are off). In a Studio play test with a hand-made test chunk: templates load
  and scale, 38 trees draw and sway (0.5 ms a frame), an uprooting and a limb break swap to pieces and fall, and
  far trees switch to billboards. Not yet seen: the billboards' look and view order, damage from real weather,
  DataStore persistence.
- The place now plays in Studio (2026-11-11): the pre-boilerplate `ServerScriptService.Server` is parked, disabled,
  in `ServerStorage._Legacy`; `Players.CharacterAutoLoads` is on (also in `default.project.json`); the map data is
  exported. A play test spawned at Elm City with 214 chunks, ~850 trees (98 mesh, 657 billboards, 0.25 ms a
  frame). The billboard Decals log "No asset content representation found" though the images preload as
  Success: look at them in game. The engine still answers this Studio server with HTTP 401: add the Studio local
  secret `weather_feed_key` (docs/HOSTING.md) for real weather and storm damage.

- Site redesign and social post kit (2026-11-12, deployed to the engine from `e9e1d15`; the world carried over): the engine's pages
  are one website (`site/README.md`): a front page at `/`, `/outlooks`, `/watches`, `/discussions`, `/warnings`,
  `/about`, a real 404, and the map tools as document pages in the same look: `/analysis` (mesoanalysis;
  `/index.html` still works), `/synoptic`, `/models` and `/models/large-scale`. Every page takes its header (hover
  menus for Outlooks, Mesoanalysis and Models; the world's clock in a strip above) and footer from `site/*.html`
  (filled in by `server/SitePages.js`); the look is `css/site.css` (light document pages, charts drawn dark,
  self-hosted Public Sans and IBM Plex Mono in `fonts/`).
  - `/warnings` (`warnings.html`): a map and list from the new `/api/warnings/active` (polygons and bulletins);
    choosing a warning zooms to it and shows its details.
  - `/models/large-scale`: each short range run now keeps a frame of the whole large-scale model every 3 forecast
    hours (`SHORT_RANGE.synopticEvery`, about 0.5 MB a frame, taken in the forecast worker by `SynopticRuntime`);
    the synoptic page draws them from `/api/models/short-range/synoptic/frame|field`. `/synoptic?share=1` (and the
    model view's) is a picture view with title, time, key and "simulated weather" in the frame.
  - Day 3 outlooks now send their one chance of any severe weather (`GameProducts.gameOutlook` no longer drops
    it): the page and the Roblox Outlook layer show Categorical and Severe for Day 3 (owner's request 2026-11-12,
    replacing "categorical only").
  - Roblox products screen (not yet seen in Studio; no Studio was connected): the site's look in `Ui.luau`
    (charcoal, square corners, brand band with a gold line), details with a hazard tag, named lines and the
    bulletin on a block, and the map goes to a chosen warning, watch or discussion (`MapCanvas.frame`, "Zoom to
    it"). Checked only by `luau-compile`, selene and a Rojo build. Not published.
  - Large-scale charts redrawn as model charts (2026-11-12, owner's request): filled colour bands, labelled
    contours and barbs on the charts' dark ground, the charts listed by level (250 mb wind, 500 mb wind, 500 mb
    vorticity, 500 mb temperature, 850 mb charts, surface, lift, shear) in `js/pages/synopticPage.js`. The
    view (everyone, since 2026-11-12 late): as it first was: the chart follows the game map east-west (the box moves
    north-south); dragged or wheel-zoomed, the view holds still and the map's box moves freely. No page
    draws a drift arrow. The drift's speed and the day's aim are still admin only (`forRole` in
    `server/index.js` leaves them out of a public frame). Admin sign-in is in the site's top
    bar only (`js/site.js`, kept for the tab); no page has its own sign-in button.
  - Day summaries (`/days`, `/day/<id>`, `server/DayArchive.js`, `tests/day-archive.mjs`): each day's
    highest-risk Day 1 outlook is kept as the issues come out; an admin sees the recent days and saves one,
    which keeps a full copy for good in `days.bin` beside the world's state (saved days are public). The day
    page has the two post pictures (PNG made in the browser, or opened alone), the numbers, and the tornado tracks alone on a time slider (GIF or PNG, from the summary, so any
    saved day has it; one solid line a tornado, deployed from `ef59400`). Every loop the site saves as a GIF can also be saved as an MP4 (`js/mp4.js`: the browser's encoder and a small MP4 writer; deployed from `ed58a63` as H.264. Not yet deployed: AV1 for an admin only (everyone else still gets H.264), at a constant quantizer of 18 above 1080 lines, else a constant 8000 kbit/s, H.264 where the browser has no AV1 encoder; `tools/social/make-loop.mjs` the same through ffmpeg, `--codec h264` to go back). Days before this was deployed have no outlook kept.
  - Day replays (2026-11-12, `server/ReplayArchive.js`, `tests/replay-archive.mjs`): each world day's hourly
    mesoanalysis and large-scale frames and every warning are kept in `replays/<world>-<day>.bin.gz` beside the
    world's state (about 13 MB a day) for 16 world days. A day's page links to `/day/<id>/analysis` and
    `/day/<id>/synoptic` (the live pages on the kept hours), plays the warnings on a slider, and opens a tornado's
    panel (path, damage indicators) when its track is selected. "Save loop as GIF" (`js/gif.js`, made in the
    browser) is on the two replay pages, the warnings replay and the live pages. Seen working on a local engine
    (two days run; pages and GIFs checked in a browser).
    A day has no report (list, page, save) until it has ended. A tornado's panel has a map zoomed to its track
    with the survey's swath and damage points as diamonds (`/api/day/<id>/tornado/<tid>`; the points are kept
    with the day's summary). The mesoanalysis map draws county lines and the larger cities (a tick box).
    Tornado radar (2026-11-12 late): each tornado's radar loop is back, off the
    live path. A storm tick only records what the radar picture is made from (1.8 to 2.7 ms on the main thread);
    the scans wait on the day's list (kept in its file) and are worked out one at a time in the radar pool's low
    lane (`RadarPool.run(..., low)`: only when nothing live waits and another thread stays free). Measured on a
    local engine with 2 radar threads: 27 scans, 2.3 s of radar thread and 15 to 19 ms of main thread each, none
    failed; a day that ended with scans waiting finished them afterwards. `/api/replays/status` (admin) and
    `/api/performance` (`tornadoRadar`, `host`) show the cost, the waiting count and the container's CPU limit.
    The hosted container reports a limit of 32 vCPU and 30 GB (`host` in `/api/performance`); the hosted radar
    threads were about 1% busy. Not measured: live radar response while the list drains.
  - Long range model (2026-11-13; `js/forecast/LongRangeModel.js`,
    `server/LongRangeRuntime.js`, `tests/long-range-model.mjs`): a 7-day run at each 06Z (and one at the first
    whole hour after a start), no storms, with one timing error drawn per run (`ensemblePerturbation.js`, 1.2 m/s
    sd: about 100 km a day). Shown at `/models/long-range` (the large-scale page), 57 frames every 3 h, 4 runs
    kept. About 100 s a run on this machine. `WEATHER_LONG_RANGE=off` turns it off. Checked first: a storm-free
    copy follows the world's steering and large-scale model exactly (5 days, zero difference), so without the
    error the run would be exact.
  - Severe-weather charts on every large-scale page (same date): CAPE, CIN,
    supercell composite and significant tornado parameter across the whole large-scale model, joined from three
    sources in `server/SynopticRuntime.js` (`severe()`): the game map's own cells in its box (`mapFields`); the
    wide window around it (`js/world/WideRegion.js`, `tests/wide-region.mjs`: the regional layer again at 80 km
    over 3,200 km, display only, stepped after the map, saved with the world, shown once 24 h old; each step its
    cells under the map take the map's own air, and its air is drawn to the entering-air values in a quarter of a
    day, as the map's effectively is from its edges); and beyond
    that the large-scale model's own columns through the sounding code (CAPE sound, composites low: no backed
    low-level winds or cap). Measured over a week on seeds 1000 and 7: the ring of window cells round the box follows the
    map's edge strips on the south, east and north (CAPE mostly within a quarter); to the west the window is dry
    (the dryline at the foot of the high ground) where the map's western columns are sometimes still moist, so a
    step can show on the box's west edge. 2026-11-13 later (the owner: a square block of no CAPE south-west of
    the box): the window is faded out by distance from the map's middle
    in a rounded shape, all of it to half its half-width and none at its edge, reaching only half as far west
    (`WIDE_FADE` in `SynopticRuntime.js`), and the map's feed now carries the storms' cold pools, wet ground and
    anvils, so the box's edge is a gradient across a window cell. Cost: about 35 ms a step for the window, about 80 ms for its soundings a frame, about 0.2 s the first time a
    frame's large-scale columns are asked for. Engine fingerprint identical to HEAD (seed 1000, 8 h).
  - Fixed (same date): the mesoanalysis replay of a day not yet saved did not send the admin key, so it stayed
    empty for a signed-in admin.
  - Soundings (2026-11-13): the live world's are admin only (`/api/live/sounding` answers 401 without the key; the
    mesoanalysis page opens none for the public). The public's come from the models: each short range run (every
    hour) and long range run (every 3 h) keeps what a sounding is made from for every cell
    (`js/forecast/soundingColumns.js`, 33 numbers a cell, 322 KB a frame; `tests/sounding-columns.mjs`: the
    figures are the cell's own). `/api/models/{short-range,long-range}/sounding?init&hour&row&column`; a point
    selected on the Models map, or inside the map's box on the long range page, opens it
    (`js/pages/soundingPanel.js`). About 6 to 16 MB more a short range run and 18 MB a long range run; 0.08 ms
    an answer.
  - `tools/social/` records a live day from the public routes and makes the outlook card, the tornado-track card
    and synoptic loops (`tools/social/README.md`); the High Risk day of 11/12/26 Day 7-8 is in
    `data/social/high-risk-2026-11-12/` (not in git).
  - Checked: `tests/site-pages.mjs`, `tests/short-range-synoptic.mjs` (the frames change nothing in a run), the
    static page and game-products tests, and each page at desktop and phone width against the hosted engine
    (`node scripts/site-preview.mjs`) and a local one (warnings, model large-scale view, hover menus in a browser).
    `tests/short-range-model.mjs` fails on `main` with or without these changes ("the same storms in the same
    places at +45 min while the dice are shared"; it failed on `3dea3bb` too): open. The `Dockerfile` copies the
    new pages, `site/` and `fonts/`.
  - The engine itself (`js/storms`, `js/world`, `js/atmosphere`, `js/mesoscale`, `js/sounding.js`) is as it was on
    `main` at the start of 2026-11-12 (owner's decision that day): the storm environment batch and the removal of
    live storm reports are on the branch `engine/storm-relative-separation` only, not merged.

- World map terrain and roads (2026-11-13, branch `map/terrain-and-roads`, pushed; place published as version 497 from `a92556d` with `tools/worldmap/patch-place.luau` (the published place with the new `ServerStorage.World`, `WorldData` and `Shared.MapData`, 9.86 MiB of the 10 MiB limit; the version before is `roblox/build/published-before-map-09a4e5a.rbxl`, not in git); merged to `main` and the engine deployed from `9e927f8` the same day (the world resumed at hour 585; it serves the new map's 332 counties and 12 radars; watches, discussions and day summaries kept from before name the old map's counties and towns); not seen
  in Studio): the map has real relief (hill regions 22 to 34 m per 5 miles, every stream in a valley, a
  meandering big river, wandering region borders; `WorldMapGenerator.js`), so towns, roads, counties and radars
  all moved. The road graph is one connected network with no stacked edges and ramps joined at both ends
  (`streets.js`, `curves.js`, `sectionRoads.js`). Roblox lays every road from that graph and builds houses on
  the map's blocks (`WorldData/Graph`, `WorldMap.roadEdges` / `blocks`, `RoadNet.build`); bridges are planned
  from roads 420 studs beyond the network's pad, roads meeting an overpass ramp climb to it, and interstate
  bends keep their median. Checked: `tests/world-map.mjs` passes, `tools/worldmap/check-graph-export.mjs` 11 of
  11, `tools/worldmap/audit-map.mjs`, selene, luau-lsp (fewer errors than `main`), `rojo build`. Open: seed 1's
  hand-removed radar list is empty (those radars no longer exist; the map has 12 radars) until the owner
  chooses again; the M map still draws section roads from `sections.u8`, which differs from the graph in
  places, and has no streets.

## Next

0. Map branch (published as 497, unseen): join the place or play it in Studio and look at roads (interchanges, overpass ramps with a
   side road, a town's streets and houses, a cul-de-sac) and the hills and valleys; then decide the radar list,
   commit, and plan the engine deploy (it moves radars and counties under the live world).
1. Run `roblox/setup.ps1`, `node scripts/export-world-roblox.mjs`, then `rojo serve` and play the place in Studio:
   check the server boots from `ServerStorage.main`, storms and products arrive (the ready handshakes), and the
   debug page teleport works; then the three labs (`stormlab`, `cloudlab`, `tornadolab` projects).
2. Foliage: after step 1 brings real chunks in, look at the billboards (view order) and a storm's breaks; after
   any generator change, re-upload through Studio's MCP and update `Foliage/Assets.luau`.
3. Chaser network: open `/chasers` on the hosted engine as public and admin; join "plains" (version 493, the first
   boilerplate publish) and check it boots and storms arrive; then turn on the M map's Chasers layer and check dots, names and trails (`ChaserNet.Ready` handshake).
4. Site: look at the Roblox products screen in Studio (restyle and zoom-to-warning are unseen), then publish the
   place. Open choices: a `/day/N` page that keeps each day's outlook and tornado tracks on the engine, so the daily
   "forecast, then what happened" pair needs no recording. (The charts stay dark: owner, 2026-11-12.)
5. With the owner, start `docs/spec/` (ideation into `IDEATION.md` and `FEATURES.md`, then `PRODUCT.md`).

## Blockers

- Studio play-testing needs a Studio session connected to romcp (the owner opens Studio).
- romcp's own Open Cloud upload fails with 401; use Studio's MCP (`open_cloud_invoke`) for uploads instead.

## Pointers

- `roblox/README.md` (the place's layout, networking, labs)
- `docs/STATUS.md` (the engine's working log and measurements)
- `docs/stormlab/STATUS.md`, `docs/cloudlab/STATUS.md`
- `docs/HOSTING.md`
