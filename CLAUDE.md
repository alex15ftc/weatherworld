# WeatherWorld

Deterministic weather engine (Node, `js/`, `server/`) that feeds a shared-weather open-world storm-chasing MMO on Roblox
(`roblox/`). One engine runs the weather for every Roblox server. All UI lives in Roblox; Node keeps only the
mesoanalysis, performance and models pages.

## Standing rules
- **Git is allowed** (since 2026-11-07): use it to inspect history and diffs and to compare before/after
  (`git diff`, `git stash`, `git show`). Commit or push only when the user asks. Other sessions may edit the same
  files at the same time: re-read before delivering. Engine equivalence:
  `node tools/engine/fingerprint.mjs <seed> <hours> out.json` then `--compare a b`.
- **No hard-coding or painting.** Storm and atmosphere behaviour comes from the fields through continuous relations:
  no rules keyed on labels, no vetoes, stepped caps or painted values.
- **Regression suite around every engine batch** (`engine-batch` skill): baseline before, check after, keep nothing
  that regresses beyond tolerance.
- **Keep verification short.** Run only the tests a change touches (`node scripts/run-tests.mjs <filter>`); long
  reports at most once, at the end. No hours-long runs; ask before forecast checks (~25 min) or refits (~80 min).
- **Step storms like the server** in audits (5-min storm ticks); `AtmosphereWorld.advance(0.5)` steps storms 30 min.
- **Long-lived storms are deliberate** (8x clock); don't shorten supercell or tornado lives.
- **Visuals:** soft, smooth Severity-style clouds (not cauliflower); storm body = soft billboard puffs; one tornado
  build, stages come from storm evolution; check every visual change from several angles (`watch-scene` skill).
- Meteorologist reviews use the `meteorologist-reviewer` agent, which reads `docs/REVIEWER-BRIEF.md` first.

## Layout
- `js/storms`, `js/world`, `js/atmosphere`, `js/mesoscale`: the engine. `js/forecast`: outlooks, watches, models.
- `server/`: authority runtime and game feed API. `js/game/`: lab windows and storm workers for the game.
- `native/cloudmodel/cloudmodel.c` -> `js/cloudmodel/cloudmodel.wasm` (`build-wasm` skill).
- `roblox/src`: game (`client`, `server`, `shared`, `serverworld` = server-only world generator in
  ServerStorage.World), `stormlab`, `cloudlab`; Rojo projects `default`, `stormlab`,
  `cloudlab`.
- `tools/regression` (suite), `tools/engine/fingerprint.mjs`, `tools/stormlab` (offline Luau diag/test scripts),
  `tools/blender` (art, `blender-export` skill).
- Status logs: `docs/STATUS.md`, `docs/stormlab/STATUS.md`, `docs/cloudlab/STATUS.md`.

## Tools on this machine
- Node 22. Long node runs must raise priority (Windows throttles background processes 5-8x after ~3 s); Claude
  sessions do this automatically via `NODE_OPTIONS` in `.claude/settings.local.json`.
- Luau: `selene` (lint, `selene.toml`; runs on every .luau edit via hook), `stylua` (format, `stylua.toml`, manual
  only), `luau-lsp`, `luau` / `luau-analyze` / `luau-compile` (offline run and type check), `lune` 0.11.1, `rojo`.
- Blender 5.2, Zig 0.13, ffmpeg, ImageMagick (`magick`), jq, Python (`py`) with MetPy and Py-ART.
- romcp MCP drives Roblox Studio (select the Studio connection first; Studio must be in the foreground).
