# AGENTS.md - WeatherWorld

Two halves: the weather engine (JavaScript, repository root; `README.md`, `docs/`) and the
Roblox place (`roblox/`; `roblox/README.md`). The engine is the single authority for the
weather; the place only shows what it produces.

## Session start

- Never work from a checkout behind origin/main. devflow is the per-machine default, not a
  requirement. Where it is installed, run `devflow check`; STALE means the checkout's
  code, instructions and state are older than origin/main, so work from a task worktree
  of fetched origin/main instead, and report its other warnings.
- Where devflow is missing, ask the developer once whether they want it. If yes, follow
  the [roblox-devflow](https://github.com/gavinlorenzo/roblox-devflow) README Install section:
  do the agent steps, run `devflow setup`, relay its user steps. A developer who opts out
  records that in their own machine-local agent instructions; then use `git fetch origin` and
  `git rev-list --count HEAD..origin/main` (non-zero = STALE) and their own sync/preview method.
- Mirrors (devflow.json mirrorBranches) update themselves; never edit in them.
- Preview with `devflow preview start`; follow the connector review / preflight / stop steps in
  the roblox-devflow README. Previews need `preview.universe` and each place's `previewPlace` in
  `devflow.json`, which are not set until the place is published. A missing Open Cloud key,
  connector or place id is an owner step: name it and continue. Without devflow, still test the
  task worktree's current code, and never save or publish the preview copy.

## Roblox place

- Setup: `roblox/setup.sh` (or `roblox\setup.ps1`). It installs the pinned tools (Aftman), Wally
  packages and their types, and exports the generated world (`roblox/src/worlddata`,
  `roblox/src/shared/MapData`; both gitignored, from `scripts/export-world-roblox.mjs`).
- Every Luau file is `--!strict`. Before finishing Roblox work, run what CI runs
  (`.github/workflows/roblox.yml`): `luau-lsp analyze` must report nothing and `rojo build`
  must succeed. On Windows, run the check from a short path: deep checkouts push some files past
  260 characters and luau-lsp silently skips them.
- Remotes go through `roblox/src/shared/Network.luau` (typed, validated). Never trust what a
  client sends.
- Studio-only tools (`server/DebugTools`, `client/DebugPanel`) must stay behind
  `RunService:IsStudio()`.
- Rojo stays on 7.7.0: devflow's preview bridge is anchored to that version.
- A Rojo build does not prove gameplay, physics or multiplayer. Say exactly what was checked.
