# WeatherWorld — Roblox place

Rojo 7.4.4 project for the single WeatherWorld place. The whole map is generated
procedurally (seeded, chunk by chunk around players); see `src/shared/World/Config.luau`.

| Folder        | In Studio                                   |
|---------------|---------------------------------------------|
| `src/shared`  | `ReplicatedStorage.Shared`                  |
| `src/server`  | `ServerScriptService.Server`                |
| `src/client`  | `StarterPlayer.StarterPlayerScripts.Client` |

Live sync: run `rojo serve` in this folder, then press **Connect** in the Rojo plugin in Studio.
Build a place file: `rojo build -o WeatherWorld.rbxl`.
