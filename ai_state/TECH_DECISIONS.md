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
