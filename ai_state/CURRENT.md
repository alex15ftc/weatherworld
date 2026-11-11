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
3. With the owner, start `docs/spec/` (ideation into `IDEATION.md` and `FEATURES.md`, then `PRODUCT.md`).

## Blockers

- Studio play-testing needs a Studio session connected to romcp (the owner opens Studio).
- romcp's own Open Cloud upload fails with 401; use Studio's MCP (`open_cloud_invoke`) for uploads instead.

## Pointers

- `roblox/README.md` (the place's layout, networking, labs)
- `docs/STATUS.md` (the engine's working log and measurements)
- `docs/stormlab/STATUS.md`, `docs/cloudlab/STATUS.md`
- `docs/HOSTING.md`
