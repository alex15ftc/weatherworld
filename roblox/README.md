# WeatherWorld — Roblox place

The WeatherWorld place, built on
[Roblox-Boilerplate-Final](https://github.com/robloxdeveloper2/Roblox-Boilerplate-Final):
Rojo and Wally, a Service/Controller loader, typed networking, PlayerData, TOML settings,
ConVars and React UI. The whole map is generated procedurally (seeded, chunk by chunk around
players); see `Shared/World/Config.luau`.

## Setup

You need [Aftman](https://github.com/LPGhatguy/aftman), Node 24, Roblox Studio and the
[Rojo plugin](https://rojo.space/docs/v7/getting-started/installation/).

```
./setup.sh            # Windows PowerShell: .\setup.ps1
rojo serve            # port 34960; then Connect in the Rojo plugin in Studio
```

Setup installs the pinned tools (`aftman.toml`), the Wally packages (`Packages/`), their types,
and, if it is missing, exports the world map the place is built from
(`node scripts/export-world-roblox.mjs`, about 20 seconds): `WorldData/` and `Shared/MapData/`.
All three are gitignored. Run setup again when `aftman.toml` or `wally.toml` changes; delete
`WorldData/` and rerun it after changing the world generator.

Open the repository root in VS Code with the recommended extensions (Rojo, luau-lsp).

> To save player data in Studio, publish the place and turn on **Game Settings → Security →
> Enable Studio Access to API Services**. Until then PlayerData runs session-only. Studio
> playtests save to `PlayerData_Studio`, and devflow previews to their own session's store.

## Layout

```
Client/        → ReplicatedFirst
  Bootstrapper/  Boots every *Controller and Shared module on the client
  Controllers/   MapController, StormController, VehicleController, FlyController,
                 DebugController, TestDriveController, UIController
  Modules/       Vehicles/ (the car's physics, input and effects)
  UI/            React: Common, Hooks, Components (+ .story), Widgets (CarHud), Developer
Server/        → ServerStorage
  main.server.luau  Boots every *Service and Shared module on the server
  Services/      ChunkService (terrain chunks, its worker Actor), WeatherService (storm feed),
                 ExploreService, VehicleService, DebugService (ConVars), TestDriveService
  Modules/       TestVehicle
WorldData/     → ServerStorage.WorldData   (generated map tiles and storm replay)
Shared/        → ReplicatedStorage.Shared  (World, Weather, Vehicles, MapData, and the
                 boilerplate's ConVar, PlayerData, Settings, Network, System, ...)
Config/        → ReplicatedStorage.Config  (AutoExec + command scripts)
Assets/        → ReplicatedStorage.Assets  (Studio-only additions are kept)
Packages/      → ReplicatedStorage.Packages (Wally)
```

Services and controllers get `Init()` (all of them, before anything starts; do not yield) and
then `Start()` (each in its own thread). Order that matters goes in `Init`: WeatherService starts
its feed there, so a storm replay sets the start point before ExploreService places anyone.

## How to…

- **Talk between server and client:** declare the event once in a Shared module with
  `Shared/Network` and a validator (see `Shared/Vehicles/Net.luau`, `Shared/Debug.luau`).
- **Save player data:** add the field to `SaveData` and `Default` in `Shared/PlayerData.luau`,
  change it on the server with `PlayerData.Get(userId):Patch(...)`, read it in UI with
  `usePlayerData`. Saved now: `Stats.MilesDriven`, `Stats.CarsCalled`.
- **Add a player setting:** add it to a TOML file in `Shared/Settings/Frontend/` (now
  `Driving.toml`: SpeedUnits, SteeringAssist, ShowCarHud), then regenerate
  `Shared/Settings/Types.luau` with the **Developer → CompileSettings** story in UI Labs.
- **Add a command:** declare a ConVar (see `Server/Services/DebugService.luau`). List developers
  for live servers in `Shared/Settings/Backend/Admins.toml`; everyone is a developer in Studio.
- **Add UI:** a module in `Client/UI/Widgets/` is mounted in its own ScreenGui; presentational
  components go in `Client/UI/Components/` with a `.story.luau` for UI Labs.

## Commands

All CHEAT-flagged: anyone in Studio, Developers in live servers, everyone once an operator sets
`sv_cheats 1`. Type them in chat, or use the debug panel (**F2**), which runs the same commands.

| Command | |
|---|---|
| `/tp x y`, `/tp town` | teleport to a map point (miles from the NW corner) or a town |
| `/totornado` | teleport to the recorded tornado |
| `/tornado x y`, `/tornado reset` | move the recorded tornado, or put it back |
| `/car`, `/removecar` | a chase car / take it away |
| `/heal`, `/walkspeed n` | |
| `sv_time h` | time of day |

Commands take an optional player first (`/car @p`, `/tp somebody 250 250`).

## The chase car

The raycast-wheel chassis from Rally With Your Friends, scaled to this world
(`Shared/Vehicles/Config.luau`): spring/damper suspension per wheel, tyres with a friction circle
(power, braking and cornering share the grip, so it slides on gravel), a hand brake that locks
the rears, a gearbox for the engine note, and grip set by what each wheel is on. It reaches about
185 studs/s flat out.

| Key | |
|---|---|
| V | a car ahead of you; or into yours if it is near; or out of it (stop first) |
| W / S, A / D | drive, brake and reverse, steer |
| Space | hand brake |
| R | put the car back on its wheels |
| E (prompt) | ride in a friend's car |

Gamepad: right trigger drives, left trigger brakes, left stick steers, A hand brake, Y in/out,
X put it back on its wheels.

The driver's client runs the physics (`Client/Modules/Vehicles`); VehicleService makes cars,
seats people, parks a car where it stopped when nobody is driving, and keeps the odometer. For
real art, put a model at `ReplicatedStorage.Assets.Cars.ChaseCar` in the rally car's layout and
scale (see `Server/Services/VehicleService/CarFactory.luau`); until then the car has a plain body
made of parts.

## Storm art

Tornadoes and clouds are drawn as camera-facing billboards of uploaded art, visible at any
distance, with particles and parts added near the camera. The art: a baked tornado life cycle seen
from 8 sides (8 x 8 frames a sheet) and cloud puff sheets (4 x 4), ids in
`Shared/Weather/Textures.luau`. Until Roblox serves an image (new uploads are moderated first),
the storm is built from parts instead.

```
python -I tools/pack-textures.py <art dir>     # sheets + manifest into Textures/build/
powershell -File tools/set-opencloud-key.ps1   # once: your Open Cloud key, as devflow keeps it
node tools/upload-images.mjs check             # what the key can do
node tools/upload-images.mjs upload            # upload new sheets, write Textures.luau
```

The key needs `asset: read, write` and `legacy-asset: manage`; it is stored DPAPI-encrypted for
your Windows user (the file devflow uses) and never printed. `Textures/uploaded.json` remembers
what is uploaded, so nothing goes up twice. The source art is in this repository's history:
`git archive 6d941ae data/cloud-textures data/tornado-bake`.

Each tornado shape (cone, stovepipe, wedge, partial wedge, drillbit, rope, elephant trunk,
uncondensed) has its own bake from `Art/tornado/tz_0037_cone_R.blend`
(`scripts/blender/bake_tornado_types.py`, Cycles on the GPU). A shape that has not been baked uses
the original bake. To bake every shape, pack and upload in one go, double-click
`tools/Bake and upload tornadoes.bat`. It needs Blender, Python with Pillow, and Node. It takes a
few hours, baking one shape at a time into `%LOCALAPPDATA%\WeatherWorldBake`. If it stops, run it
again and it carries on from the last frame finished. `tools/bake-and-upload-tornadoes.ps1 -Types
wedge,rope` bakes only those shapes; `-SkipBake` and `-SkipUpload` skip those steps.

## Checks

CI (`.github/workflows/roblox.yml`) exports the world, installs packages, type-checks `Client`,
`Server` and `Shared` with luau-lsp (strict, `.luaurc`) and builds the place. Run the same
locally before pushing; on Windows, from a short path (see `AGENTS.md`).

## Credits

The boilerplate's architecture and core modules (ConVar, PlayerData, Settings, the UI hooks and
many of the packages) are by [MaximumADHD](https://github.com/MaximumADHD); see
`BOILERPLATE-LICENSE`.
