# The lab's storms in the main game (2026-10-27)

The main game now draws its storms with the storm lab's billboard renderers. The old game storms (StormView, StormKit, StormMesh, StormWisps, TornadoArt, CloudVolume, VaporRelight, SkyLight and the WeatherFeed frames) are no longer loaded.

## How it fits together

```
weather engine (Node)                      game server (Roblox)                       every client
/api/game/v1/lab/window  ── soundings ──▶  server/StormHost                           client/WeatherClient
/api/game/v1/lab/storms  ── storms ────▶   runs StormLab.Sim (the lab's atmosphere)   lab renderers (Weather/Render)
   (js/game/LabWindow.js)                  for this place's window, nudged to the     on LabConfig.setFrame (map scale,
                                           engine's storms, 12x clock          ──▶    origin, ground datum, terrain)
                                           publishes storm frames v2
                                           (StormPublisher = lab Publisher)
```

- **Engine** (`js/game/LabWindow.js`, `WeatherAuthorityRuntime.labWindow` / `labStormsAt`, `server/index.js`):
  - `GET /api/game/v1/lab/window?x=&y=&half=` (map km) returns the window's cell soundings, boundaries and storms, in the lab's frame (~270 KB for 15×15 cells).
  - `GET /api/game/v1/lab/storms?x=&y=&half=` returns only the storms.
  - Both go behind the game API key like the other `/api/game/v1/` routes.
  - Tested: a live window loads into the lab's `World` and its storms survive spin-up.
- **Game server** (`server/StormHost.luau`): two modes.
  - **engine** (a feed URL is set):
    - On start, it fetches the window round the place's start point and spins it up.
    - Every 25 s it polls the storms:
      - each lab storm's position moves a third of the way toward its engine storm, and its motion, updraft and rotation are pulled toward the engine's;
      - new engine storms are added, and storms the engine drops die;
      - a tornado starts when the engine has one and winds down when it doesn't (the lab's own initiation and genesis are off);
      - the soundings are refetched every 30 min.
  - **lab** (no URL, or Workspace attribute `StormSource = "lab"`): runs a lab scenario (`StormHostScenario`, default Supercell) set down at the start point. Use it for Studio without the engine.
  - **In both modes:**
    - The simulation runs at the 12x clock with a 3 ms/frame slow-step budget.
    - Frames go out through the lab's Publisher (precipLite every 10 s, the full rain volume every 60 s).
    - A `WeatherGround` RemoteFunction gives clients the ground's height on a 1 km grid over ±60 km.
- **Client** (`client/WeatherClient.luau`):
  - It sets the lab's frame (`LabConfig.setFrame`):
    - across, the map's scale (`Config.STUDS_PER_MILE`: 600 studs/mile since 2026-10-28, 1000 before);
    - origin at the window centre's studs;
    - a smooth ground datum (the terrain blurred over ~20 km) that clouds sit over;
    - the ground's height from the grid, refined by raycasts within 1.5 km of the camera.
  - It then starts the lab's renderers (all of `Render/` except Ground and WindViz).
  - It gives DebugPage its storm list in the old field names.
- **Project** (`default.project.json`):
  - `ReplicatedStorage.StormLab` maps the lab's `Sim`, `LabConfig` and `Data`.
  - `ServerScriptService.Server.StormPublisher` is the lab's `server/Publisher`.
  - `StarterPlayerScripts.Client.Weather` holds the lab's `Context`, `Net`, `Render` and `Tornado`.
- **LabConfig** gained `setFrame` / `toLocal` (separate scales across, up and for sizes, an origin, a datum, a ground hook). The lab keeps its defaults, which reproduce its old behaviour exactly.

## Scale (decided 2026-10-27: each storm drawn whole)

The game is anisotropic on purpose: map distance is squashed (600 studs/mile since 2026-10-28, ~0.37 studs/m; 1000 studs/mile, ~0.62 studs/m, before), while objects and the ground's height are at Roblox's 0.28 m stud (3.57 studs/m). Each storm, tornado, rain shaft and flash is drawn whole at one scale about its centre, which keeps its true shape:

- the scale is `Config.skyScaleAt(distance from the camera)`: true (3.57 studs/m) within 3,000 studs, easing to 1 stud/m beyond 15,000 studs (`SKY_NEAR_STUDS`, `SKY_FAR_STUDS`; 3 and 15 miles at 1000 studs/mile);
- only the centre sits at its map position (`LabConfig.scaleAbout`, `toWorldAbout`, `localAbout`);
- near rain and splashes round the camera are at true scale;
- a near storm's footprint is wider than its map area.

## Seen in Studio (lab mode)

In the game place with `StormSource = "lab"` (`detail/game_first_storm.png`):
- the Supercell scenario's storms over the game's farmland in daylight;
- the server spun up 4 storms in 5.5 s; 10 renderers ran on the client;
- 6 storms / 1,731 cards at 0.8–1.7 ms a frame, scud 140 fragments at 0.56 ms;
- no errors.

Engine mode was not tested: the running weather server (the WeatherFeedUrl tunnel) is the old build, and `/api/game/v1/lab/window` returns 404 until it is restarted.

## Radar

See the comparison: `docs/radar-compare/` (images) and the summary in the session report.

- **Keep:** the engine radar is the network radar. It is server-rendered, the same on every server, and matches the warnings.
- **Expose more of what the engine already makes** to Roblox: tilts, CC/ZDR/SW, mosaics and the loop.
- **Port from the lab:** its radar UI (sweep reveal, hover readout with beam height, tilt keys).
- **The lab radar** becomes a close-range mobile radar later. It needs the full rain volume; precipLite is not enough for reflectivity.
- **Mismatch:** the engine radar shows the engine's storms, and the visual storms are the lab's copies nudged toward them. They agree in place and strength, not in detail.

## Done since (2026-10-27)

- **Old storm code deleted:**
  - `client/StormView, StormKit, StormMesh, StormWisps, TornadoArt, CloudVolume, CloudWorker (+meta), VaporRelight, SkyLight`
  - `server/WeatherFeed`
  - `shared/Weather/StormTrack, CloudShell, CloudVolumeMath, CloudKit`

  `shared/Weather/Precip` and `Palettes` stay; Products and the old particle lab use them. Seen in Studio afterwards: storms and lightning over the game, no errors.
- **The window follows the players** (engine mode). When the players' mean position is more than 35 km from the window centre, StormHost fetches a new window there and rebuilds the ground grid. Clients rebuild their frame on the scenario event.
- **Re-plan churn explained, not a bug:** about 3 % of cards change per re-plan at 1x in the lab and about 35 % at the game's 12x clock (12 times the storm evolution between plans). The changes cross-fade over 1.2 s.

## Still open

- Restart the weather server (the WeatherFeedUrl tunnel) so `/api/game/v1/lab/*` exists, then test engine mode in Studio, including recentring.
- One window per server: players spread far apart all get the window round their mean position.
- The old particle tornado lab (`tornadolab-old.project.json`, `src/lab`) required the deleted StormView and no longer runs.
- `Config.luau` still holds the deleted modules' settings (STORM_KIT, STORM_MESH, TORNADO_ART, VOLUME_CLOUDS, CLOUD_ART); they are unused and left for you to prune.

## Performance and clock pass (2026-10-28)

- **EditableImage budget:** the M map kept up to ~90 MB of tile images, even after it closed. It now keeps ~33 MB while open and frees everything on close (`client/Products/MapCanvas.luau`).
- **Two clocks:** the weather (storm tracks, evolution) stays at 12x. Local motion runs at real speed in the game (`ctx.state.visualScale = 1`, `Context:visualTime/visualDt`); the lab is unchanged. That covers tornado spin and funnel surface, dust, debris, scud, cloud boiling and inflow, and the wall cloud's turn. Thunder's delay is real sound speed.
- **Storm drift is unchanged:** a 40 mph storm crosses the squashed map at 12x, which reads as about 2x its true speed against a near storm drawn at true scale.
- **Inside clouds:** cards within about their own size of the camera fade out and stop drawing (StormCards near pass, 400 cards a frame). There are fewer cards with many storms in range (`5/inRange`, floor 0.3), and at most 90 rain shafts. Measured inside a supercell: 2,766 → 2,448 cards and 142 → 87 shafts, with no errors.
