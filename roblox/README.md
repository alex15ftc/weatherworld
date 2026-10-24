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

Weather screens (press **M**): the world map and the issued products, fed by
`server/ProductFeed.luau`. Without a feed URL they show the recorded snapshot in
`src/worlddata/ProductSnapshot`; see `docs/ROBLOX-UI-PLAN.md` for running them live through a
cloudflared tunnel.

## Particle tornado (new, 2026-10-22) and the tornado lab

A from-scratch tornado built from particle smoke (the old `client/TornadoArt.luau` is not used
by it). Shared code in `src/shared/Tornado`:

| Module | What |
|---|---|
| `Config.luau` | every tunable: smoke textures, funnel rings, smoke layers, profiles, wind model |
| `Shape.luau` | rope / cone / stovepipe / wedge radius curves, blended by weight |
| `State.luau` | the tornado's network state (pack / unpack / lerp), centreline with seeded wobble |
| `Vortex.luau` | wind field: Rankine vortex + inflow + updraft; EF <-> wind speed |
| `FunnelView.luau` | client renderer: rings of spinning parts with LockedToPart smoke emitters; also the cloud base, foot and debris |
| `PuffView.luau` | client renderer (default, `Config.render.mode = "puffs"`): the funnel body as a chain of round puffs along the bent centreline |

The lab is a separate place for look-dev (flat field, overcast sky, camera rig, debug panel):

    rojo build tornadolab.project.json -o TornadoLab.rbxl   # then open it in Studio and press Play
    rojo serve tornadolab.project.json                      # or live-sync into an empty place

In Play: right-drag / WASD / R F / Q E / Z X move the camera, H hides the panel, P freezes the
smoke for a still frame, M switches the funnel renderer (puff chain / rings), 1-8 or [ ] (or the
panel's look buttons) switch between tornado looks from
`src/lab/client/Presets.luau` (Ref1 cone, White cone, Dark wedge, Green wedge, Sepia cone, Trunk,
Rope, Rope-out; each names its reference in `docs/tornado-reference`), "Sky:" buttons set the
storm light, "Print config" writes the tuned values to Output for pasting back into
`Config.luau` / `src/lab/client/LabConfig.luau`. Smoke textures come from
`tools/smoke/smoke_flipbook.py` (`py -3.12`, numpy).
