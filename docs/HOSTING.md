# Hosting the engine (Railway)

The weather engine (`server/index.js`) runs on Railway for the game. One instance serves every Roblox server.

- Project `weatherworld`, service `engine`, environment `production` (workspace "alex15ftc's Projects").
- URL: https://weatherworld.up.railway.app (set as `Config.WEATHER_FEED_URL` in
  `roblox/src/shared/World/Config.luau`; a Workspace `WeatherFeedUrl` attribute still overrides it).
- Build: `Dockerfile` (node:22-slim, no npm packages; builds world map seed 1 into the image).
  `.railwayignore` / `.dockerignore` keep the upload under 1 MB.
- Service settings: `.railway/railway.ts` (Railway infrastructure as code: Dockerfile build, health check
  `/api/health` with 300 s for a fresh world's ~1 min spin-up, one replica, the volume). Variables are left
  unmanaged (set in Railway). Railway does not read it on deploy; change it, then
  `railway config plan` and `railway config apply` (see Windows note below). Needs the `railway` dev package
  (`npm install`).
- Volume `engine-volume` at `/data`: world state (`/data/atmosphere-state.bin`, saved every sim hour),
  spin-up cache, storm models, day reviews (newest 14 days); the engine writes about 17 MB (Railway shows
  ~0.8 GB used, the disk's own overhead).
- The world carries on through restarts and deploys, engine changes included (`WEATHER_KEEP_WORLD=on`): a
  copy of the saved world is first stepped half an hour under the new code, and if that throws or gives
  non-numbers a new world starts and the old save is kept as `/data/atmosphere-state.bin.old`. To force a
  new world on a deploy, bump `STATE_VERSION` in `server/WeatherAuthorityRuntime.js` (do this when the
  saved layout changes in a way that cannot carry on), or POST `/api/authority/reset` with the admin key.
- A deploy stops the old container before the new one starts (a volume cannot be shared), so the feed is
  down for up to ~5 minutes; the game's polls carry on when it is back.

## Variables (`railway variables`)
| Variable | Value |
|---|---|
| `WEATHER_GAME_KEY` | key for `/api/game/v1/*` (header `x-api-key`); Roblox secret `weather_feed_key` |
| `WEATHER_ADMIN_KEY` | key for `/api/authority/*` (header `x-admin-key`): reset, advance, seek, clock |
| `WEATHER_KEEP_WORLD` | `on`: carry the world over engine-code changes |
| `WEATHER_STATE_PATH`, `WEATHER_SPINUP_CACHE`, `WEATHER_DAY_REVIEW_DIR` | under `/data` |
| `WEATHER_RADAR_WORKERS`, `WEATHER_FORECAST_WORKERS`, `WEATHER_STORM_WORKERS` | 2 each (the container sees the host's CPU count, which would start up to 8 threads per pool) |

Read the keys with `railway variables --kv`. They are never kept in the repo.

## Commands (from the repo root, project already linked)
- Deploy the working copy: `railway up --ci --service engine` (in Git Bash set `MSYS_NO_PATHCONV=1`,
  or `/data/...` values get rewritten into Windows paths)
- Logs: `railway logs --deployment` (plain `railway logs` streams and never returns)
- Restart: `railway restart --yes`
- Service settings (Windows): the `railway` command is an npm wrapper and the IaC version check cannot
  launch it, so run the real binary from PowerShell:
  `$exe="$env:APPDATA\npm\node_modules\@railway\cli\bin\railway.exe"; $env:_=$exe; & $exe config plan`
- Check: `curl https://weatherworld.up.railway.app/api/health`

## Roblox side
- Game settings > Security: Allow HTTP Requests on.
- Creator Dashboard > the experience > Secrets: add `weather_feed_key` = the `WEATHER_GAME_KEY` value, domain
  `weatherworld.up.railway.app`. For Studio, add the same secret under Game Settings > Security
  (local secrets).

