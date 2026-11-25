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
| `Client/Controllers` | | `WeatherController` (the storms), `EngineStormsController`, `LiveStormsController`, `ProductsController` (the M screen), `DebugPageController` (F2), `FlightController` (F), `TestDriveController`, `UIController`, `FoliageController` (the skinned trees), `VehicleController` (drives your car), `EngineAudioController` and `RemoteVehicleAudioController` (engine-sim sound, yours and other drivers'), `ImGuiController` (F4: engine, tires, car), `TornadoAudioController` (the tornadoes' sound) |
| `Client/Modules` | | `Weather/` (the storm renderers, shared with the storm lab), `Products/`, `FrameWorld`, `EngineSim/` (the engine-sim port), `Vehicle/` (chassis, tires, drivetrain, car audio), `EngineAudioState`, `TornadoAudio/` (the tornado sound: `Acoustics`, `Synth`, `Voices`, `Assets`) |
| `Client/UI` | | React UI (boilerplate): widgets in `UI/Widgets` mount themselves |
| `Server/main.server.luau` | ServerStorage | boots every `*Service` (Init, then Start) |
| `Server/Services` | | `ChunkService`, `ExploreService`, `CarService` (a car for every player), `VehicleService` (rigs the cars), `StormHostService`, `LiveStormsService`, `ProductFeedService`, `ChaserNetService` (every player's map point and trail, for the map's Chasers layer), `TestDriveService`, `FoliageService` (tree breaking and its persistence) |
| `Server/Modules` | | `StormPublisher`, `ReportArchive`, `TestVehicle`, `ChunkWorker` (Actor template) |
| `Server/World` | ServerStorage.World | the server-only world generator |
| `Shared` | ReplicatedStorage.Shared | boilerplate modules, plus `World/`, `Weather/`, `CloudModel/`, `StormLab/` (Sim, LabConfig, Data) and `Net/` |
| `Labs/StormLab`, `Labs/CloudLab`, `Labs/TornadoLab` | | the lab places' Services and Controllers |

## Cars (engine-sim)

From EngineSimRoblox (2026-11-14): the pickup and the Crown Vic, no custom characters; and the GMC 2500.
- Models: `assets/vehicles/Pickup.rbxm` (a GMT400 Silverado body), `CrownVic.rbxm` and `GMC2500.rbxm`, built full size and
  synced to `ServerStorage.Vehicles`. `VehicleService` scales them to `Config.WORLD_SCALE` and rigs them once
  (an invisible PhysicsBody carries the mass, wheels on Motor6Ds, sound attachments); `CarService` sets a copy
  beside each player.
- Configs: `Shared/VehicleConfigPickup` (1996 C1500: L31 350, 4L60-E, 3.42 open), `VehicleConfigCrownVic`,
  `VehicleConfigGMC2500` (2020 Sierra 2500HD: L5P Duramax, Allison 10-speed, 3.42);
  `VehicleConfig` is the type and its field notes. The files give MetersPerStud for the full-size model;
  `VehicleConfigs` maps models to configs at the world's scale.
- Engine: `Client/Modules/EngineSim` (`Presets.VortecL31` is the pickup's, `Ford46` the Crown Vic's, 5,600 rpm
  limit), `DuramaxL5P` the GMC's (from the engine-sim script DMAX V8 (L5P).mr, its turbo a boost curve). Offline, from `roblox/`: `lune run ../tools/enginesim/dyno.luau VortecL31`, `run.luau` (a drive cycle
  WAV) and `launch.luau [launch|idle|creep|cruise] Pickup [Automatic|Sequential|Manual] [2H|4H|4L]`.
- Gearboxes: Automatic drives through a torque converter (`Drivetrain.TorqueConverter` in the config: stall,
  multiplication, creep, lockup in 3rd/4th) and waits in neutral until the throttle; Sequential and Manual use
  the friction clutch. A config's `Drivetrain.TransferCase` adds part-time 4WD: 2H, 4H (front and rear
  driveshafts locked), 4L (its LowRatio); both trucks have one.
- Keys in the car: W/S, A/D, Space handbrake, Shift clutch, E/Q shift, N gearbox mode, T traction control, L 2H/4H/4L, X get
  out; E at the door gets in; F4 opens the menu (engine, tires, the car to drive). Gamepad: d-pad up ignition,
  right reset, down gearbox mode, left traction control, L3 2H/4H/4L; Y or Select gets out. A car that rolls and comes to
  rest is set back on its wheels.

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
`StormNet` (storm frames, the Hello and Ground requests), `LiveStormNet`, `ProductNet`, `ChaserNet`, `VehicleNet`,
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
The StormLab town's mobile homes break piece by piece (`Shared/StormLab/Sim/MobileHome`, its pieces in
`Shared/StormLab/Structures`; `docs/tornado-physics/MOBILE-HOME.md`): `lune run tools/stormlab/test_mobile_home.luau`.
