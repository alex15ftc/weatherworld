# WeatherWorld — Roblox place

Built on the [Roblox Boilerplate](https://github.com/robloxdeveloper2/Roblox-Boilerplate-Final)
(Rojo 7.7 + Wally): a Service / Controller loader, typed `Shared/Network` events, PlayerData,
Settings, ConVars, Trove, Signal, Promise and the Profiler. The whole map is generated
procedurally (seeded, chunk by chunk around players); see `Shared/World/Config.luau`.

## Setup

```bash
./setup.sh        # Windows PowerShell: .\setup.ps1   (tools, Wally packages, types)
node ../scripts/export-world-roblox.mjs   # the world data (Server/WorldData, Shared/MapData; git-ignored)
rojo serve        # then Connect in the Rojo plugin
```

Build a place file: `rojo build -o WeatherWorld.rbxl`.

## Layout

| Folder | In Studio | What |
|---|---|---|
| `Client/Bootstrapper` | ReplicatedFirst | boots every `*Controller` (Init, then Start) and the Shared modules |
| `Client/Controllers` | | `WeatherController` (the storms), `EngineStormsController`, `LiveStormsController`, `ProductsController` (the M screen), `DebugPageController` (F2), `FlightController` (F), `TestDriveController`, `UIController`, `FoliageController` (the skinned trees) |
| `Client/Modules` | | `Weather/` (the storm renderers, shared with the storm lab), `Products/`, `FrameWorld` |
| `Client/UI` | | React UI (boilerplate): widgets in `UI/Widgets` mount themselves |
| `Server/main.server.luau` | ServerStorage | boots every `*Service` (Init, then Start) |
| `Server/Services` | | `ChunkService`, `ExploreService`, `CarService`, `StormHostService`, `LiveStormsService`, `ProductFeedService`, `ChaserNetService` (every player's map point and trail, for the map's Chasers layer), `TestDriveService`, `FoliageService` (tree breaking and its persistence) |
| `Server/Modules` | | `StormPublisher`, `ReportArchive`, `TestVehicle`, `CarChassis`, `ChunkWorker` (Actor template) |
| `Server/World` | ServerStorage.World | the server-only world generator |
| `Shared` | ReplicatedStorage.Shared | boilerplate modules, plus `World/`, `Weather/`, `CloudModel/`, `StormLab/` (Sim, LabConfig, Data) and `Net/` |
| `Labs/StormLab`, `Labs/CloudLab`, `Labs/TornadoLab` | | the lab places' Services and Controllers |

## Foliage (skinned trees)

- `Shared/Foliage`: `Kinds/` (generated rig data, `tools/blender/foliage_trees.py`), `Species` (wood and
  roots), `Rig`, `Mechanics` (wind loads, breaking, fall rest poses), `Sway`, `Profiles` (looks, presets,
  runtime settings), `Records` (the chunk attributes `Trees` and `TreeDamage`), `Assets` (uploaded ids;
  `ready` switches the old part trees off).
- Server: the chunk generator records trees (`Props/Trees.luau`); `FoliageService` breaks them
  (`Modules/FoliageWind`: the gust over a point) and stores damage permanently (DataStore `FoliageDamage1`,
  MessagingService topic `FoliageDamage1`); it also loads the tree models into
  `ReplicatedStorage.FoliageTemplates`.
- Client: `FoliageController` (mesh / impostor / pieces, sway, culling, LOD, batching).
- Studio plugin `Plugins/FoliageTool`: `rojo build foliagetool.project.json --plugin FoliageTool.rbxm`
  (wind, presets, profiles, runtime settings, rig validation, viewport preview, metrics).
- Offline tests: `lune run tools/foliage/test_mechanics.luau` (against EF DI 27), `test_sway.luau`,
  `test_records.luau`.

## Networking

Every message is a `Shared/Network` event declared once in `Shared/Net/`:
`StormNet` (storm frames, the Hello and Ground requests), `LiveStormNet`, `ProductNet`, `ChaserNet`,
`DebugNet` and `CloudLabNet`. There are no RemoteEvents or RemoteFunctions made by hand.
`Network.Request(name, validator)` (Shared/Network/Request.luau) replaces RemoteFunctions:
`req:Server():OnInvoke(handler)` and `req:Client():Invoke(...)` (a Promise) or `:Await(...)`.
A Network event that arrives before its client listener is set is dropped, so every stream
has a handshake: the storm frames' `ready` command, `LiveStormNet.Ready`, `CloudLabNet.Ready`, `ChaserNet.Ready`.

## Debug and settings

- The debug page's teleport is for players tagged `Developer` (everyone in Studio; list
  UserIds in `Shared/Settings/Backend/Admins.toml`), the place's owner, or group rank 254+.
- `/debug_profiler 1` (ConVar) turns on the microprofiler labels (ChunkService,
  StormHostService, Weather and each renderer, EngineStorms, ProductsMap).
- Player settings: `Shared/Settings/Frontend/Flight.toml` (FlySpeed, FlyBoostSpeed).
- The Workspace attributes (LiveStorms, StormVisuals, StormSource, TestDrive, ...) work as before.

## Labs

| Project | Place |
|---|---|
| `stormlab.project.json` | the storm lab (`Labs/StormLab`): the lab sim and the game's storm renderers |
| `cloudlab.project.json` | the cloud lab (`Labs/CloudLab`): the cloud model, live view, network test |
| `tornadolab.project.json` | the particle tornado lab (`Labs/TornadoLab`, its library in `Labs/TornadoLab/Tornado`) |

Each lab place gets the same Bootstrapper, `Shared` and Packages:
`rojo build stormlab.project.json -o StormLab.rbxl`, or `rojo serve stormlab.project.json`.
The tornado lab's old storm mode (key N) still needs the long-removed `GameClient` modules.

## Offline checks

The pure simulation modules (`Shared/StormLab/Sim`, `Shared/CloudModel`) also run under Lune:
`lune run tools/stormlab/test_frames.luau` and the rest of `tools/stormlab`, `tools/cloudlab`.
