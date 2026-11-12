# Hosting the engine (Railway)

The weather engine (`server/index.js`) runs on Railway for the game. One instance serves every Roblox server.

- Project `weatherworld`, service `engine`, environment `production` (workspace "alex15ftc's Projects").
- The same project also runs service `weatherworldbot`, the Discord bot (code in
  `../DiscordBots/weatherworldbot`, outside this repo). It posts each new Day 1-3 outlook to the High Risk
  server's `#📋outlooks` channel from the public `/api/outlook/index` and `/api/outlook/dayN.svg`
  (`server/OutlookPublic.js`), linking to the public pages `/outlook/day1` .. `day3` (`outlook.html`), and
  posts each new watch, mesoscale discussion and warning to `#⚠️watches`, `#📝discussions` and `#🚨warnings` from
  `/api/products/feed`, `/api/watch/N.svg`, `/api/md/N.svg` and `/api/warnings.svg?keys=` (`server/ProductArchive.js`),
  linking watches and discussions to `/watch/N` and `/md/N` (`product.html`), and reads `/api/health`,
  `/api/live/storms` and `/api/map/counties`. Keep those routes when changing the server.
- URL: https://weatherworld.up.railway.app (set as `Config.WEATHER_FEED_URL` in
  `roblox/Shared/World/Config.luau`; a Workspace `WeatherFeedUrl` attribute still overrides it).
- Build: `Dockerfile` (node:22-slim, no npm packages; builds world map seed 1 into the image).
  `.railwayignore` / `.dockerignore` keep the upload under 1 MB.
- Service settings: `.railway/railway.ts` (Railway infrastructure as code: Dockerfile build, health check
  `/api/health` with 300 s for a fresh world's ~1 min spin-up, one replica, the volume). Variables are left
  unmanaged (set in Railway). Railway does not read it on deploy; change it, then
  `railway config plan` and `railway config apply` (see Windows note below). Needs the `railway` dev package
  (`npm install`).
- Volume `engine-volume` at `/data`: world state (`/data/atmosphere-state.bin`, saved every sim hour),
  spin-up cache, storm models, day reviews (newest 14 days), the issued outlooks (`/data/outlooks.bin`), the mesoscale
  runtime (`/data/mesoscale.bin`) and the watch/discussion archive (`/data/products.bin`), each put back after a
  restart in the same world, so the pages keep the last issue and the numbers carry on; the engine writes about 18 MB (Railway shows
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
| `WEATHER_ADMIN_KEY` | the admin key (header `x-admin-key`): needed for every `/api/authority/*` write (new world, +30 min / +1 day, seek, pause clock; the mesoanalysis page's World card has an Admin sign-in) and for the admin role on `/chasers` (names, servers). Unset, only this machine is admin |
| `WEATHER_KEEP_WORLD` | `on`: carry the world over engine-code changes |
| `WEATHER_CLOCK_LOCK` | (unset: on) the world's clock follows real UTC, 8 world days a real day, so products name days "11/11/26 Day 3" (`js/forecast/calendar.js`); after a restart the world races to catch up (under a world day); `off`: the free-running clock |
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

