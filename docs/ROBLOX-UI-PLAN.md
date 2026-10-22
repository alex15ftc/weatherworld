# Moving the UI to Roblox

Decided 2026-10-21: this repo keeps only the weather engine and the products it issues. Everything
a player sees (the weather products as well as the storms) is drawn in the Roblox place.

## The split

The rule: **the engine decides, Roblox draws.** Any number, line, polygon, colour index or
sentence that comes from the weather is made here. Roblox never computes weather, contours,
polygons, ratings or text; it projects, colours and lays out what it is given. This keeps one
source of truth for every game server, which the shared-weather MMO depends on.

### Stays here (Node backend)

| Area | Files | Note |
|---|---|---|
| Atmosphere, storms, tornadoes | `js/atmosphere`, `js/world`, `js/storms` | unchanged |
| Radar simulation | `js/radar/RadarSimulator.js`, `server/RadarPool.js` | scans stay full resolution here |
| Forecast and products | `server/OutlookRuntime.js`, `MesoscaleRuntime.js`, `WarningRuntime.js`, `ReportsRuntime.js`, `js/forecast`, `js/reports` | product text written here |
| Analysis | `server/SurfaceAnalysisRuntime.js`, `analysisOverlays.js`, `mesoanalysisParameters.js` | **new:** contours and isobars are traced here (the web page traces them in the browser now) |
| Verification, audits, tests | `js/verification`, `scripts`, `tests` | unchanged |
| World map generation | `js/worldmap`, exports to `roblox/src/worlddata` | unchanged |
| **New: game product API** | `server/GameProducts.js` (new) | compact, versioned products for game servers (below) |
| Web pages | `*.html`, `js/pages` | kept as **developer views** for checking the engine; not the player product. Frozen: no new features. |

### Moves to Roblox

| Area | Where | Note |
|---|---|---|
| Fetching products | `server/WeatherFeed.luau` → plus `server/ProductFeed.luau` | one poll per game server, cached; clients never use HTTP |
| Passing products to players | `ReplicatedStorage.Weather` remotes | a client asks for a product by id+version and gets the cached buffer |
| All product screens | `client/Products/*` | radar, warnings, outlooks, watches/MDs, mesoanalysis, reports, surveys |
| Shared map drawing | `client/Products/MapCanvas.luau` | built from the existing `MapView` (EditableImage, projection, zoom/pan, base map) |
| Gameplay hooks | server + client | sirens and alerts inside warning polygons, the Lighting clock from sim time, wind and damage on objects |
| Storm visuals | `client/StormView.luau` | already there; the user's friend owns the visuals |

Colour tables (radar palettes, outlook colours, warning colours) are **generated** from the
JS definitions into `roblox/src/shared/Weather/Palettes.luau` by a script, so there is a
single source for them.

## The game product API

`server/GameProducts.js`, served under `/api/game/v1/`, using the same `x-api-key` as the frames.

- `GET /api/game/v1/manifest` returns `{ epoch, simTime, products: { <id>: { version, bytes } } }`.
  The game server polls this every 10-15 s and fetches only the products whose version changed.
- `GET /api/game/v1/product/<id>` returns the product. Each product is built once per version
  and kept as text, like the frames, so a poll by many game servers costs nothing extra.
- Coordinates are **engine map miles** (the 500 × 500 mile map). Roblox converts them to studs
  with the place's offset in `Config`; a place covers about 50 × 50 of those miles
  (docs/ROBLOX-SCALE.md), so most screens show the whole region with a "you are here" box.

Two kinds of product:

| Kind | Products | Form |
|---|---|---|
| Vector | outlooks (Day 1-3, each hazard), watches, MDs, warnings, fronts/drylines/outflows, isobars and field contours, station plots, reports, survey tracks | JSON: polylines and polygons (simplified, rounded to 0.1 mi), labels, palette indices, text |
| Raster | radar reflectivity and velocity (mosaic and per site, lowest tilts), mesoanalysis field shading | one byte per pixel (a palette index), zstd + base64, at most 512 × 512 (an EditableImage takes up to 1024) |

A full radar scan is 720 × 460 bytes per tilt and product (331 KB); the game gets a
re-projected 512 × 512 indexed raster instead, a few tens of KB once compressed. Clicks that
need more detail (a sounding at a point, a storm's attributes) go to small on-demand endpoints
(`/api/game/v1/sounding?x=&y=`) through the game server, rate-limited per player.

## Roblox constraints that shape this

- 500 HTTP requests a minute per game server: the manifest poll plus changed products uses well
  under 60.
- Game servers cannot reach localhost. Live play needs the backend **hosted** at a public HTTPS
  address (a small VPS is enough). In Studio, a tunnel (e.g. cloudflared) or a recorded
  **product snapshot** (like `StormReplay`) can stand in for it.
- Clients can't use HTTP, so everything goes through the game server's remotes. Products are
  only sent to a player who has that screen open, and only when the version changes.
- EditableImage: up to 1024 × 1024, client memory budget, and the place must allow the image
  APIs. One canvas per open screen, reused.

## Order of work

0. **Foundation** — `GameProducts.js` (manifest + product cache), `ProductFeed.luau`
   (poll, cache, remotes, snapshot mode), `MapCanvas.luau` (from MapView), the generated
   `Palettes.luau`, and a product **snapshot exporter** (`scripts/export-product-snapshot.mjs`)
   so the place works in Studio with no backend.
1. **Outlooks, Days 1-3** — vector only, so the whole pipeline is proven on the simplest product.
2. **Radar** — mosaic reflectivity first, then velocity and the nearest site, then a frame loop
   (keep about the last 10 frames).
3. **Warnings and watches** — polygons on the radar and the map, text, plus the in-world alerts
   and sirens for players inside a polygon.
4. **Mesoscale discussions** — polygon and text.
5. **Mesoanalysis** — station plots, fronts, isobars, one field (shading + contours traced
   server-side), sounding and hodograph on click.
6. **Storm reports and damage surveys** — the day's map and lists; surveys on demand.

Not ported: `performance.html` (a developer tool). `worldmap.html` was retired 2026-10-22 (MapView covers it), with the Node radar, outlook, mesoscale, storm report and damage survey pages.

Each step: the backend product gets a unit test in `tests/`; the Roblox screen is checked in
Studio against the matching web developer view on the same snapshot.

## Decided (2026-10-21)

1. **M opens the screens**: one screen with tabs (Map, Day 1, Day 2, Day 3, more to come) over
   one shared map; the zoom and position stay put from tab to tab.
2. **Everyone sees every product** for now.
3. **cloudflared** tunnel to the local server for now; a cloud host later.
4. **Plain, working screens first** (all styling in `client/Products/Ui.luau`).

## Status

Steps 0 and 1 done 2026-10-21; not yet seen in Studio (no Studio was connected).

| Where | File | What it does |
|---|---|---|
| Node | `server/GameProducts.js` | manifest + products, versioned by a hash of the text; outlook rings simplified to 0.3 mi (Day 2 98 KB to 17 KB) |
| Node | `js/forecast/productColours.js` | the outlook colours (the web page imports them too) |
| Node | `scripts/export-palettes.mjs` | writes `roblox/src/shared/Weather/Palettes.luau` |
| Node | `scripts/export-product-snapshot.mjs` | records a running server's products into `roblox/src/worlddata/ProductSnapshot` |
| Node | `tests/game-products.mjs` | rings, versions, unissued outlooks |
| Roblox | `server/ProductFeed.luau` | http (manifest every 15 s) or snapshot; remotes `ReplicatedStorage.Products` (Get, Manifest, Changed), at most 20 gets per player per 10 s |
| Roblox | `client/Products/init.luau` | the M screen and its tabs |
| Roblox | `client/Products/MapCanvas.luau` | the map (was `client/MapView.luau`), with a product overlay and a muted base |
| Roblox | `client/Products/Raster.luau` | lines, even-odd fill, hatching, outlines into the image; pure Luau |
| Roblox | `client/Products/OutlookTab.luau` | Day 1-3: categorical or hazard map, legend, highest contour, discussion |
| Roblox | `client/Products/ProductClient.luau`, `Ui.luau` | per-version cache; panel building blocks |

Checked: Raster.luau run by the standalone `luau.exe` on a live Day 2 outlook draws the same
contours and hatching as the web page (26-56 ms a layer at 600 × 600); every changed Luau file
compiles; the Rojo build passes.

### Running it

- **No backend (Studio):** nothing to set; the place uses the recorded snapshot. Re-record with
  `node scripts/export-product-snapshot.mjs --from http://localhost:3000` while a server runs.
- **Live, through cloudflared:** start the server and the public proxy
  (`node scripts/game-feed-proxy.mjs`, port 3001; it passes only the game's read-only routes:
  frames, manifest, products), then `cloudflared tunnel --url http://localhost:3001`. Never
  tunnel port 3000 itself, which would expose reset and advance. Set the Workspace attribute
  `WeatherFeedUrl` to the `https://….trycloudflare.com` address it prints. Storm frames and
  products then both come from it. Allow HTTP requests (Game Settings > Security). If
  `WEATHER_GAME_KEY` is set on the server, store the same key as the experience secret
  `weather_feed_key`.
- **Mixing:** `ProductSource = "snapshot"` keeps the products on the snapshot while the storms
  come live (and `StormSource` does the same for storms).

### One map with layers (2026-10-21, replaces the tabs)

At the user's request the screen is one map with layers turned on and off by buttons in the side
panel (`client/Products/init.luau`, layers in `client/Products/Layers/`):

| Layer | Module | What it shows; a click on it |
|---|---|---|
| Outlook | `Outlook.luau` | Day 1/2/3, categorical or one hazard (hatched intensity groups); the outlook there and the discussion |
| Radar | `Radar.luau` | one radar's lowest tilt, REF/VEL/SRV; a button per radar, or click a radar's label on the map |
| Watches | `Areas.luau` (WATCHES) | tornado (red) and severe (blue) watches, labelled; the watch text |
| Discussions | `Areas.luau` (DISCUSSIONS) | mesoscale discussions coloured by watch chance; the MD text |
| Warnings | `Areas.luau` (WARNINGS) | tornado/severe warnings in NWS colours, most urgent on top; the latest statement |

- A click on the map asks the layers in turn: a radar's label, then a warning, a watch, a
  discussion, the outlook. The details open in the side panel, and the area is outlined in white.
  Each layer also lists its items in the panel; a click there opens the same details.
- The composite and base mosaics were dropped (the user only wants single radars); their products
  are gone from the backend too.
- New products `mesoscale` and `warnings` (`server/GameProducts.js`); their colour keys and
  colours are in `js/forecast/productColours.js`, shared with the web pages and exported to
  `Palettes.luau`.
- Buttons carry a `TestId` attribute (their label), so play tests can press them (romcp `activate`).
- Long product text is sized by measuring it (`Ui.longText`): AutomaticSize came out short and let
  the panel below overlap it.

Checked in Studio (play test on a recorded snapshot of seed 5000, Day 2 at 20Z: High risk, PDS
Tornado Watch 1, MD 0001, 30 warnings): all layers draw; Radar on shows KELC REF and VEL with the
station buttons and map labels; clicking the watch, a severe warning and the outlook opened their
texts with the area outlined; Close works. `tests/game-products.mjs` covers the new products.

Radar not working on 2026-10-21 was the backend and the proxy still running the code from before
the radar products; restart both after updating.

Not done yet: higher tilts, CC/ZDR/SW, a radar loop, sirens and alerts for players inside a warning.

### Step 6: storm reports and damage surveys (2026-10-22)

Two more map layers, **Reports** and **Damage**, sharing one day picker (`Layers/ReportDays.luau`):
SPC-style report dots (red tornado, green hail, blue wind; ringed when significant) and DAT-style
tornado tracks in their EF colour. Clicking a track opens the survey (EF contours, then damage
points close in, each one clickable).

- The engine still makes the reports and surveys (`js/reports/*`). Roblox stores them, serves the
  history and draws it. Products: `reports.days`, `reports.day.<N>`, `survey.<tornado id>` and
  `survey.indicators` (`server/GameProducts.js`). The manifest lists only today and yesterday;
  older days can be fetched by id while the engine's 14-day log still holds them.
- `server/ReportArchive.luau` keeps every *final* day (over, with every tornado lifted) and its
  surveys in the DataStore `StormReports` under `<worldId>/...`, for `Config.REPORT_ARCHIVE_DAYS`
  (365 world days, about 15 MB). One server writes at a time, using a MemoryStore lease;
  `UpdateAsync` skips any write that is already stored. Any server reads. A day the
  place missed (because no server was up) is caught up while the engine still has it. Players get
  the archive index as the product `reports.archive`.
- `worldId` (on `world.reportLog`, saved with the world) separates worlds, since a new world
  numbers its days from 1 again. Archives of earlier worlds are left in the store and never
  cleaned up yet.
- Product ids may now contain `-` and `_` (server route and `game-feed-proxy.mjs`): restart both.
- Not yet seen in Studio. In Studio, DataStores need *Enable Studio Access to API Services*.
  Without it, old days come from the engine only. A recorded snapshot never writes.

### Map sharpness (2026-10-22)

The map screen (`client/Products/MapCanvas.luau`) was one image of at most 1024 pixels, redrawn
at 40% while moving, so it blurred on any large screen and while zooming. It is now tiled:

- **Tiles**: 256 GUI units square, at zoom levels a half-octave apart, drawn at the screen's
  physical resolution and kept (up to about 29 MB of image memory a layer). Panning draws only
  new tiles; between levels the tiles on show are scaled by the GPU while the next level's are
  drawn a few a frame (10 ms budget), nearest the middle first.
- **High-DPI**: Roblox does not report display scaling, but GUI units are physical pixels over
  it, so a view 989.33 units wide gives 1.5. Workspace attribute `MapPixelDensity` overrides it.
- **Layers**, bottom to top: base map tiles; a veil Frame that mutes them under a product (no
  redraw); the shapes of layers listed before radar (the outlook) in clear tiles; radar in one
  view image as before (`Layer.drawRaster`), moved and scaled with the map; the other shapes
  (radar's range ring, watches, MDs, warnings, reports, damage) in clear tiles (none kept where
  nothing is drawn); labels on top. Radar is drawn over the outlook's fill (the user asked).
- **Anti-aliasing** (`Raster.luau`): lines by distance (round ends and joins), fills and hatching
  sampled on 4 sub-rows with exact horizontal coverage, smooth dots.
- **Product detail** (`server/GameProducts.js`): outlook and MD contours get 3 more corner cuts
  and keep 0.02 mi; watches and warnings keep their straight edges, rounded to 0.01 mi.
- **The ground** (`client/Products/MapBase.luau`, `shared/World/LandSurface.luau`): zoomed in
  past 0.16 mi a pixel the map fades into the surface the world builds (crisp half-mile cells,
  quarter-section crops, centre pivots, blowouts, red soil, lake shores), coloured so each cover
  keeps its zoomed-out map colour (`CONTRAST` 0.5), with smooth hill-shading. ChunkGen and the
  terrain colours now come from LandSurface too (checked identical at 300,000 points).
- Checked in Studio at 1.5x display scaling: whole map, 68 and 17 studs a pixel, radar, MD and
  warning outlines; a view fills in under a second after zooming.
