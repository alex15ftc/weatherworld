# Constraints

<!-- Facts about the current state of the world that every session must respect.
     AGENTS.md says how to work; this file says what not to touch right now and why.
     Read every session; changes rarely. Each entry states what, why, and what would
     lift it. Delete an entry once it is lifted (git keeps it). -->

## Protected: Never Modify or Delete

- **The live world on Railway (`/data/atmosphere-state.bin` on volume `engine-volume`):** every Roblox server
  shares it. Do not reset it (`POST /api/authority/reset`) or bump `STATE_VERSION` in
  `server/WeatherAuthorityRuntime.js` without the owner asking — lifted when the owner asks for a new world.
- **The climate the engine is tuned to** (the activity targets in `docs/STATUS.md` Goals, agreed 2026-10-15):
  engine changes must keep it within the regression suite's tolerance (`engine-batch` skill) — lifted by the owner.
- **Long storm and tornado lives:** deliberate for the 8x clock; do not shorten supercell or tornado lives — lifted
  by the owner.
- **Generated scenario data** (`roblox/Shared/StormLab/Data/*.luau`, written by `scripts/export-lab-scenario.mjs`):
  regenerate it with the script; do not hand-edit or add headers (Node tests read the files as text).

## Never Repeat

- **Hard-coded or painted behaviour** (rules keyed on labels, vetoes, stepped caps, painted values): storm and
  atmosphere behaviour comes from the fields through continuous relations.
- **Hours-long runs without asking:** ask before forecast checks (~25 min) or refits (~80 min).
- **Hand-made RemoteEvents or RemoteFunctions in `roblox/`:** declare a Network event or request in `Shared/Net`.
  A Network event that arrives before its client listener is set is dropped, so every stream keeps its ready
  handshake.

## Environment Invariants

- **Node runs** need raised priority on Windows (background throttling); Claude sessions get it from
  `NODE_OPTIONS` in `.claude/settings.local.json`.
- **Studio** must be in the foreground for romcp, with its connection selected first.
- **Generated, git-ignored data** the Roblox place needs: `roblox/Server/WorldData`, `roblox/Shared/MapData`
  (`node scripts/export-world-roblox.mjs`) and `roblox/Packages` (`roblox/setup.ps1`).
