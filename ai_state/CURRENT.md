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
- Branch `roblox/boilerplate` (not committed yet) moves `roblox/src` onto the Roblox Boilerplate: Services and
  Controllers, all remotes replaced by `Shared/Net` Network events and `Network.Request`, Trove, Signal,
  Profiler, Settings (`roblox/README.md`).
- On that branch all four Rojo projects build, luau-lsp shows no new type errors against the old code, the Node
  tests `tests/tornado-frame.mjs` and `tests/cloudmodel-restore.mjs` pass, and the lune storm tests pass except
  `tools/stormlab/test_client.luau` and `tools/cloudlab/test_visual_atmosphere.luau`, which fail the same way on
  `main`.
- Nothing on that branch has been run in Studio yet.
- The workspace now follows the project template: `AGENTS.md` (the instruction file), `ai_state/`, `docs/spec/`
  (templates, not filled), `ops/` (business layer, templates, not filled).

## Next

1. Run `roblox/setup.ps1`, `node scripts/export-world-roblox.mjs`, then `rojo serve` and play the place in Studio:
   check the server boots from `ServerStorage.main`, storms and products arrive (the ready handshakes), and the
   debug page teleport works; then the three labs (`stormlab`, `cloudlab`, `tornadolab` projects).
2. Commit `roblox/boilerplate` when the owner asks, and merge it to `main`.
3. With the owner, start `docs/spec/` (ideation into `IDEATION.md` and `FEATURES.md`, then `PRODUCT.md`).

## Blockers

- Studio play-testing needs a Studio session connected to romcp (the owner opens Studio).

## Pointers

- `roblox/README.md` (the place's layout, networking, labs)
- `docs/STATUS.md` (the engine's working log and measurements)
- `docs/stormlab/STATUS.md`, `docs/cloudlab/STATUS.md`
- `docs/HOSTING.md`
