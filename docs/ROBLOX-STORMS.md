# Storms and tornadoes in Roblox

How the engine's storms reach the Roblox place and are drawn there (built 2026-10-15).

## Pieces

| Where | File | What it does |
|---|---|---|
| Node | `js/storms/StormAppearance.js` | A storm's look from its fields: updraught, base, wall cloud and tail, inflow bands, shelf cloud, rain/hail, rear flank, anvil, lightning rate, tornado funnel profile, vortices, lean, debris. Type names (wedge, rope, LP, ...) only describe. |
| Node | `server/GameFeed.js` | One frame per storm tick, stamped `atMs` = due time + one tick + 15 s margin. |
| Node | `server/index.js` | `GET /api/game/v1/frames?after=<seq>` (optional `x-api-key` = `WEATHER_GAME_KEY`). |
| Node | `scripts/appearance-report.mjs` | How often each look occurs (4 seeds x 3 days, ~90 s). |
| Node | `scripts/export-storm-replay.mjs` | Records real frames round a seed's strongest tornado into `roblox/WorldData/StormReplay` (~2 min). |
| Roblox | `shared/Weather/StormTrack.luau` | Frame buffer; storms between frames (Hermite centre, blended parts, fades, touchdown/lift). |
| Roblox | `server/WeatherFeed.luau` | HTTP polling or replay, clock offset, ground heights, sends frames to clients. |
| Roblox | `client/StormView.luau` | Draws clouds and tornadoes from parts; lightning, dimming, rain at the camera. |

## The delay

The game shows the engine's storms one tick (5 simulated min, 25 s) plus a 15 s margin behind the engine (40 s real). The frame after "now" is always already held, so storms move between known places and a touchdown is known before it is shown. Every game server places frames on the wall clock, so all servers agree.

## API

`GET /api/game/v1/frames?after=<seq>` returns:

```
{ v, epoch, nowMs, lagMs, tickMs, latestSeq, reset, frames: [ { seq, atMs, simHourUtc, storms: [ <StormAppearance> ] } ] }
```

- `after` omitted or no longer kept: `reset: true` and the latest 6 frames.
- Otherwise only newer frames (often none).
- A storm is about 1.4 KB of JSON. Gzip is used when asked for.
- Polling every 5 s uses 12 of Roblox's 500 HTTP requests a minute per game server.

## Running it

- **Replay (no host needed):** `node scripts/export-storm-replay.mjs --seed 2`, then reconnect Rojo and Play. With no feed URL, the place plays the replay, and players start 3 miles south-east of the touchdown unless `StartMiles` is set. The Workspace attribute `ReplayStartFrame` picks the starting frame.
- **Live:** run the weather server where a Roblox game server can reach it (a host, or a tunnel such as cloudflared; game servers cannot reach localhost). Set `Config.WEATHER_FEED_URL` or the Workspace attribute `WeatherFeedUrl`, and allow HTTP requests (Experience Settings > Security). A key goes in the experience secret `weather_feed_key`.

## Calibration (`scripts/appearance-report.mjs`, 4 seeds x 3 days, 160 tornadoes)

- **Funnel reaches the ground:** 46% of tornado time; partial 45%; uncondensed 10%.
- **Shapes (time):** cone 44%, drillbit 24%, uncondensed 10%, elephant trunk 8%, wedge 8%, rope 5%, stovepipe 2%.
- **EF3+ tornadoes:** mostly cone 60%, wedge 40%; 73% multi-vortex at some point.
- **Supercells:** classic 48%, HP 33%, LP 19%.

## Not done yet

- **Visual tuning in Studio.** Colours, transparency and whether the Explore haze (Atmosphere density 0.32) hides distant storms have not been checked.
- **Gameplay** wind and damage.
- **Sim hour driving `Lighting.ClockTime`.**
- **Sound.**
- **Uploaded meshes and textures** for nicer clouds.
- **Engine-side tornado types:** landspouts, satellite tornadoes and QLCS tornadoes need engine work.
