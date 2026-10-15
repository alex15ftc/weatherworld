# WeatherWorld — Roblox place

Rojo 7.7.0 project for the single WeatherWorld place. The whole map is generated
procedurally (seeded, chunk by chunk around players); see `src/shared/World/Config.luau`.

## Setup

You need [Aftman](https://github.com/LPGhatguy/aftman), Node 24, Roblox Studio and the
[Rojo plugin](https://rojo.space/docs/v7/getting-started/installation/).

```
./setup.sh            # Windows PowerShell: .\setup.ps1
rojo serve            # then Connect in the Rojo plugin in Studio
```

Setup installs the pinned tools (`aftman.toml`), the Wally packages (`Packages/`), their types,
and, if it is missing, exports the world map the place is built from
(`node scripts/export-world-roblox.mjs`, about 20 seconds): `src/worlddata` and
`src/shared/MapData`. All three are gitignored. Run setup again when `aftman.toml` or
`wally.toml` changes; delete `src/worlddata` and rerun it after changing the world generator.

Build a place file: `rojo build -o WeatherWorld.rbxl`.

Open the repository root in VS Code with the recommended extensions (Rojo, luau-lsp).

## Layout

| Folder        | In Studio                                   |
|---------------|---------------------------------------------|
| `src/shared`  | `ReplicatedStorage.Shared`                  |
| `Packages`    | `ReplicatedStorage.Packages` (Wally)        |
| `assets`      | `ReplicatedStorage.Assets` (Studio-only additions are kept) |
| `src/worlddata` | `ServerStorage.WorldData`                 |
| `src/server`  | `ServerScriptService.Server`                |
| `src/client`  | `StarterPlayer.StarterPlayerScripts.Client` |

Remotes are declared once in a shared module through `src/shared/Network.luau` (typed and
validated; see `src/shared/Vehicles/Net.luau`).

## Checks

CI (`.github/workflows/roblox.yml`) exports the world, installs packages, type-checks every
script with luau-lsp (strict, `.luaurc`) and builds the place. Run the same locally before
pushing; on Windows, from a short path (see `AGENTS.md`).

## The chase car

The raycast-wheel chassis from Rally With Your Friends, scaled to this world
(`src/shared/Vehicles/Config.luau`): spring/damper suspension per wheel, tyres with a friction
circle (power, braking and cornering share the grip, so it slides on gravel), a hand brake that
locks the rears, a gearbox for the engine note, and grip set by what each wheel is on (asphalt
grips, wheat and sandhills do not). It reaches about 185 studs/s flat out.

| Key | |
|---|---|
| V | a car ahead of you; or into yours if it is near; or out of it (stop first) |
| W / S, A / D | drive, brake and reverse, steer |
| Space | hand brake |
| R | put the car back on its wheels |
| E (prompt) | ride in a friend's car |

Gamepad: right trigger drives, left trigger brakes, left stick steers, A hand brake, Y in/out,
X put it back on its wheels.

The driver's client runs the physics (`src/client/Vehicles`); the server makes cars, seats
people and parks a car where it stopped when nobody is driving (`src/server/Vehicles`). For real
art, put a model at `ReplicatedStorage.Assets.Cars.ChaseCar` in the rally car's layout and scale
(see `src/server/Vehicles/CarFactory.luau`); until then the car has a plain body made of parts.
