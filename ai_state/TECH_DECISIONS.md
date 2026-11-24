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

### 2026-11-24 — Structures break piece by piece: DOD capacities per piece, the unit moved by force balance

- Status: active
- Decision: A structure built from rigid pieces (first the DI 3 single-wide, `Sim/MobileHome`) gives every piece
  a failure speed drawn from the EF degree of damage it belongs to, loads it with the wind sampled at the piece
  (q times a net pressure coefficient from its face, the wind angle and whether the envelope is breached; the
  capacity scaled to the piece's height by the ASCE 7 gust profile), and lets it go only once the pieces covering
  it are gone. Damage that is the whole unit's (sliding, rolling, lofting: DOD 3, 5, 7) is not drawn: it comes from
  integrating drag, uplift, friction and anchor strength on whatever is still attached. Every piece flies as its
  own Sim/Debris class (`mh:<piece>`, mass and area from its geometry and material); coverings tear into their
  units (shingle tabs, 4 x 8 sheets, panels).
- Rationale: the destructible-trailer kit this came from keyed thresholds on a 0-5 intensity and moved debris
  toward painted swirl/lift targets (AGENTS.md: no painting). Per-piece DOD capacities keep the EF tables as the
  calibration while the order, the breach and the unit's motion follow from the fields; the force balance
  reproduces DI 3's DOD 3-5 span as the span of anchoring quality (`docs/tornado-physics/MOBILE-HOME.md`).
- Follow-up: upload the skinned mesh and draw bones instead of parts; bring houses, barns and the main game's
  buildings onto the same scheme; TornadoLab's `WindPhysics.CLASSES.mobileHome` (18 t) disagrees with the pieces
  (6.9 t).

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
