# Current

Updated: 2026-11-11

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

- The engine runs on Railway at https://weatherworld.up.railway.app and keeps its world across deploys
  (`docs/HOSTING.md`); one engine feeds every Roblox server.
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
  (`js/forecast/calendar.js`; decision in `TECH_DECISIONS.md`). Day 3 outlooks are categorical only, with no High
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

## Next

1. Run `roblox/setup.ps1`, `node scripts/export-world-roblox.mjs`, then `rojo serve` and play the place in Studio:
   check the server boots from `ServerStorage.main`, storms and products arrive (the ready handshakes), and the
   debug page teleport works; then the three labs (`stormlab`, `cloudlab`, `tornadolab` projects).
2. Foliage: after step 1 brings real chunks in, look at the billboards (view order) and a storm's breaks; after
   any generator change, re-upload through Studio's MCP and update `Foliage/Assets.luau`.
3. Chaser network: open `/chasers` on the hosted engine as public and admin; join "plains" (version 493, the first
   boilerplate publish) and check it boots and storms arrive; then turn on the M map's Chasers layer and check dots, names and trails (`ChaserNet.Ready` handshake).
4. With the owner, start `docs/spec/` (ideation into `IDEATION.md` and `FEATURES.md`, then `PRODUCT.md`).

## Blockers

- Studio play-testing needs a Studio session connected to romcp (the owner opens Studio).
- romcp's own Open Cloud upload fails with 401; use Studio's MCP (`open_cloud_invoke`) for uploads instead.

## Pointers

- `roblox/README.md` (the place's layout, networking, labs)
- `docs/STATUS.md` (the engine's working log and measurements)
- `docs/stormlab/STATUS.md`, `docs/cloudlab/STATUS.md`
- `docs/HOSTING.md`
