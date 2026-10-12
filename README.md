# WeatherWorld

A deterministic severe-weather world for the Great Plains. One JavaScript engine is the single
authority for the weather; pages (and later Roblox servers) only display what it produces.

The end goal is an open-world severe-weather game on Roblox: many places of about 10 x 10
miles covering a 500 x 500 mile region, all showing the same weather from this one engine.

## Run it

```
npm start            # http://localhost:3000  (first start builds a world: about a minute)
npm test             # 37 tests, about 5 minutes
```

| Setting | Meaning |
|---|---|
| `PORT` | port to listen on (default 3000) |
| `WEATHER_SEED=n` | start a new world from seed n instead of resuming the saved one |
| `WEATHER_PERSIST=off` | keep nothing on disk |
| `WEATHER_STATE_PATH` | where the world is saved (default `data/cache/atmosphere-state.bin`) |
| `WEATHER_PRIORITY=normal` | leave the process priority alone |

The clock runs at 15 simulated minutes per real minute (a simulated day is 96 real minutes).

## Pages

| Page | What it shows |
|---|---|
| `/` (`index.html`) | Surface observations and mesoanalysis: station plots, isobars, fronts, the dryline, outflow boundaries, storms, 27 overlay fields, click soundings, 36 frames of history |
| `/radar.html` | Simulated radar sites and mosaic |
| `/day1.html`, `/day2.html`, `/day3.html` | Placeholders: outlooks are not issued yet |
| `/performance.html` | Server timing |

## How it works

Three layers, each driving the next. Nothing is drawn or prescribed: a storm's behaviour comes
from the fields, and how common severe weather is comes from the world's climate settings and
from where the region sits, never from storm-level knobs.

1. **Large-scale model** (`js/atmosphere/QuasiGeostrophicModel.js`). A two-layer
   quasi-geostrophic model on a 10,240 x 5,120 km wrap-around domain: the troughs, ridges
   and jet. It is "the whole country".
2. **Regional layer** (`js/atmosphere/RegionalAtmosphere.js`). The 500 x 500 mile map at
   10-mile cells: terrain rising to the west, air masses, Gulf moisture, the capping layer,
   the daily cycle, the dryline, the night-time jet, the lee trough and cold pools.
   Fronts, the dryline and outflow boundaries are found from its fields
   (`BoundaryAnalysis.js`) for the maps; storms do not read those lines.
3. **Storms** (`js/storms/`). Storms start where lift beats the cap, move with the wind, and
   take their strength, rotation, hail, wind and tornado odds from the air they draw in.
   Their rain-cooled air goes back into the regional layer as cold pools.

**Region steering** (`js/world/RegionSteering.js`) decides where in the large-scale model the
region sits. Once a day it looks ahead and slides the region east or west, never faster than
the weather systems travel, so that supportive large-scale weather is overhead by afternoon.
Nothing on the map is moved; only the place the region reads the large-scale model from.

`js/world/AtmosphereWorld.js` ties the layers together and saves and restores the whole world.
`server/` serves it. See `docs/ARCHITECTURE.md`.

## Where it stands

See `docs/STATUS.md` for the measured state: how active the world is, how natural each part
is, what a player would experience, and what is open. `docs/ATMOSPHERE-REDESIGN.md` is the
full working log of the redesign, with every measurement.

## Measuring it

| Command | Reports | Time |
|---|---|---|
| `npm run inspect:outer` | the large-scale model alone: troughs, winds, weak-flow spells | 1 min |
| `npm run inspect:atmosphere` | the regional layer: daily cycle, dryline, winds | 1 min |
| `npm run inspect:fronts` | fronts and drylines found from the fields | 1 min |
| `npm run inspect:environment` | the storm environment against real reference ranges | 4 min |
| `npm run inspect:storms` | storm motion, lifetime, hazards, tornado statistics | 3 min |
| `npm run inspect:activity` | severe days, risk categories, tornado days | 10 min |
| `npm run inspect:tornado-days` | why a day does or does not get a tornado; the part lines play | 9 min |
| `npm run inspect:players` | what a player finds: waits, distances, tornado durations | 10 min |

Most take `key=value` to try a setting without editing code (see the top of each script).
