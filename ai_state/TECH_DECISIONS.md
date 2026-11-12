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

### 2026-11-12 — Day 3 outlooks show one chance of any severe weather beside the categorical map

- Status: `active` (replaces "Day 3 outlooks categorical only", 2026-11-11)
- Decision: the Day 3 product carries its `severe` hazard (5 to 60%, with its hatching), as the forecast already
  makes it (`DayOneOutlook.js` hazards.day3); the website and the Roblox Outlook layer offer Categorical and Severe
  for Day 3. No tornado, wind or hail maps on Day 3. The key still has no High risk.
- Rationale: the owner's request; the real Day 3 outlook is a categorical map and one probabilistic map of any
  severe weather.

### 2026-11-12 — The engine's pages are one website with shared parts and a light, plain look

- Status: `active`
- Decision: every page takes its header and footer from `site/*.html`, put in by the server when it sends the page
  (`server/SitePages.js`, which also holds the address list); no build step, no client-side templating. Document
  pages are light by default (dark when the reader's system is), with square corners, rules and tables instead of
  boxed cards, and colour kept for hazards; the map tools stay dark. Type is Public Sans and IBM Plex Mono, served
  from `fonts/`. Pictures meant for sharing carry their title, time and "simulated weather, not a real forecast" in
  the frame.
- Rationale: the owner asked for a proper website that does not look machine-made. Real forecast sites (SPC,
  weather.gov, Tropical Tidbits) are light, dense and text-first with every product stamped with its times; the old
  pages' dark navy, rounded cards, pill buttons and default Inter are the commonly named marks of generated pages.
  Rejected: a header written by script in the browser (flashes, and each page still needs its own copy for readers
  without script); fonts from Google's servers (a third-party request, and the pictures the tools make need the
  same files locally); a static site generator (the image has no npm packages).
- Consequences: a new page needs a row in `server/SitePages.js` and its file in the `Dockerfile` (`tests/site-pages.mjs`
  checks both). `/` is now the front page; an unknown address is a 404, no longer the mesoanalysis page. The map
  tools are document pages with a controls column and a chart; their charts stay dark because their colours are
  chosen for a dark ground (redrawing them light is a separate, larger job). The Roblox products screen takes the
  same colours and square corners in `Ui.luau`.

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

### 2026-11-11 — The world's clock is locked to real UTC time; products name days "11/11/26 Day 3"

- Status: active
- Decision: the hosted engine's clock (`WeatherAuthorityRuntime.startClocks`, `clockLock`) puts each world hour
  at a fixed real time: world hour = 8 x real hours since 1970 + `clockOffset` (whole world days, saved with the
  world). Each real UTC day holds world days 1-8 (Day 1 from 00 UTC, Day 2 from 03 UTC ... Day 8 from 21 UTC).
  Every public label (products, pages, maps, Discord posts, the game's report days, `/status`) names an hour by
  `js/forecast/calendar.js`: "2330 UTC 11/11/26 Day 3"; DDHHMMZ stamps use the real day of the month. The
  world is never ahead of the clock and catches up when behind (less than a world day); a new world, a pause
  longer than 3 real hours or a manual advance picks a new offset. `WEATHER_CLOCK_LOCK=off` turns it off.
- Rationale: the owner wanted the world's age (its own day count) kept out of public view, with a date that
  matches the real one.
- Follow-up: the raw hours in the public APIs (`nowHourUtc`, `/api/health`) still give the world's age to
  anyone who reads the JSON.

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
