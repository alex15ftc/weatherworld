# AGENTS.md - WeatherWorld

Deterministic weather engine (Node, `js/`, `server/`) that feeds a shared-weather open-world storm-chasing MMO on Roblox
(`roblox/`). One engine runs the weather for every Roblox server. All UI lives in Roblox; Node keeps only the
mesoanalysis, performance and models pages.

This is the only instruction file at the root (`CLAUDE.md` only points here). `ops/AGENTS.md` covers the business
layer. Workspace shape follows the project template: the product (code, `ai_state/`, `docs/`) is this repo's root,
and business state lives in `ops/`.

## Session Start

- Read `ai_state/CURRENT.md` and `ai_state/CONSTRAINTS.md`. They are the only mandatory reads.
- Read `docs/spec/PRODUCT.md` when choosing what to work on (once it is written: see `docs/spec/README.md`).
- Heading-scan `ai_state/TECH_DECISIONS.md` before loading entries in full.
- For history, use git (`git log --oneline -- <path>`, `git log -S "<string>"`) and the status logs:
  `docs/STATUS.md`, `docs/stormlab/STATUS.md`, `docs/cloudlab/STATUS.md`.
- Do not eagerly read full specs, runbooks or docs at startup.

## Working Rules

- **No hard-coding or painting.** Storm and atmosphere behaviour comes from the fields through continuous relations:
  no rules keyed on labels, no vetoes, stepped caps or painted values.
- **Regression suite around every engine batch** (`engine-batch` skill): baseline before, check after, keep nothing
  that regresses beyond tolerance. Engine equivalence: `node tools/engine/fingerprint.mjs <seed> <hours> out.json`
  then `--compare a b`.
- **Keep verification short.** Run only the tests a change touches (`node scripts/run-tests.mjs <filter>`); long
  reports at most once, at the end. No hours-long runs; ask before forecast checks (~25 min) or refits (~80 min).
- **Step storms like the server** in audits (5-min storm ticks); `AtmosphereWorld.advance(0.5)` steps storms 30 min.
- **Long-lived storms are deliberate** (8x clock); don't shorten supercell or tornado lives.
- **Visuals:** soft, smooth Severity-style clouds (not cauliflower); storm body = soft billboard puffs; one tornado
  build, stages come from storm evolution; check every visual change from several angles (`watch-scene` skill).
- Meteorologist reviews use the `meteorologist-reviewer` agent, which reads `docs/REVIEWER-BRIEF.md` first.
- Follow existing patterns before adding abstractions; in `roblox/`, use the boilerplate's modules (Network events
  declared in `Shared/Net`, Trove, Signal, Promise, Profiler, Settings, ConVars) rather than hand-made remotes.
- Do not claim completion without verification evidence. Surface blockers, risks and verification gaps as soon as
  they are found.
- You may read `ops/STATUS.md` and `ops/STRATEGY_MASTER.md` for framing and naming. Do not edit `ops/` unless asked.

## Specs

`docs/spec/README.md` defines the spec system (ideation, `FEATURES.md` rows with IDs, `PRODUCT.md` stories,
`SYSTEM.md`, area specs). Only the owner scopes features or marks them `accepted`; agents build the recorded MVP
form and propose changes instead of resolving them. Cite feature IDs in commit messages once rows exist.

## State Discipline

Update state only when something a fresh session would need has changed (`ai_state/README.md` has the rules):

- `ai_state/CURRENT.md`: objective, what is true now, next actions, blockers. Rewrite in place.
- `ai_state/CONSTRAINTS.md`: a protected record, never-repeat rule or environment invariant added or lifted.
- `ai_state/TECH_DECISIONS.md`: a durable decision made or superseded.

Commit state changes with the work that caused them. Do not create other state files (`HANDOFF.md`, `MEMORY.md`,
dated snapshots). The long status logs under `docs/` stay as working logs of measurements; `ai_state/` is the
short current picture. Before ending a session, make sure `CURRENT.md`'s Next section is true.

## Git

- Git is allowed (since 2026-11-07): use it to inspect history and diffs and to compare before/after
  (`git diff`, `git stash`, `git show`). **Commit or push only when the user asks.**
- Work on short task branches from `main`; one commit per coherent change, with its state update in the same commit.
- Other sessions may edit the same files at the same time: re-read before delivering, stage only the paths your
  task owns, review the staged diff, and never discard or overwrite others' work.
- Deploy only from committed, pushed source and record the SHA (the engine's host is described in `docs/HOSTING.md`).
- Keep large binaries (screenshots, video, run output) out of git; commit a manifest with their hashes instead.

## Layout

- `js/storms`, `js/world`, `js/atmosphere`, `js/mesoscale`: the engine. `js/forecast`: outlooks, watches, models.
- `server/`: authority runtime and game feed API. `js/game/`: lab windows and storm workers for the game.
- `native/cloudmodel/cloudmodel.c` -> `js/cloudmodel/cloudmodel.wasm` (`build-wasm` skill).
- `roblox`: on the Roblox Boilerplate (Service/Controller loader, `Shared/Network` events declared in
  `Shared/Net`, Trove, Signal, Promise, Profiler, Settings, ConVars; see `roblox/README.md`): game
  `Client` (Controllers, Modules/Weather renderers), `Server` (Services, Modules, `World` = server-only
  world generator), `Shared` (World, Weather, CloudModel, StormLab sim); labs in `Labs/StormLab`,
  `Labs/CloudLab`, `Labs/TornadoLab`; Rojo projects `default`, `stormlab`, `cloudlab`, `tornadolab`.
- `tools/regression` (suite), `tools/engine/fingerprint.mjs`, `tools/stormlab` (offline Luau diag/test scripts),
  `tools/blender` (art, `blender-export` skill).
- `ai_state/`: current posture, constraints, decisions. `docs/`: specs and the lanes in `docs/README.md`.
- `ops/`: business and operating state (its own `AGENTS.md`).

## Tools on this machine

- Node 22. Long node runs must raise priority (Windows throttles background processes 5-8x after ~3 s); Claude
  sessions do this automatically via `NODE_OPTIONS` in `.claude/settings.local.json`.
- Luau: `selene` (lint, `selene.toml`; runs on every .luau edit via hook), `stylua` (format, `stylua.toml`, manual
  only), `luau-lsp`, `luau` / `luau-analyze` / `luau-compile` (offline run and type check), `lune` 0.11.1, `rojo`.
- Blender 5.2, Zig 0.13, ffmpeg, ImageMagick (`magick`), jq, Python (`py`) with MetPy and Py-ART.
- romcp MCP drives Roblox Studio (select the Studio connection first; Studio must be in the foreground).

## Conditional References

- State files: `ai_state/README.md`
- Product specs: `docs/spec/README.md`
- Engine design: `docs/ARCHITECTURE.md`; the Roblox place: `roblox/README.md`; hosting: `docs/HOSTING.md`
