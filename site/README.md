# The site

The engine serves one public website (`server/index.js`, addresses in `server/SitePages.js`).

| Address | Page | What it is |
|---|---|---|
| `/` | `home.html` | Today's outlook, what is in effect, ways into the tools |
| `/outlooks`, `/outlook/day1..3` | `outlook.html` | Day 1-3 convective outlooks |
| `/watches`, `/discussions` | `products.html` | Lists from `/api/products/feed` |
| `/warnings` | `warnings.html` | Map and list from `/api/warnings/active`; choosing one zooms to it and shows its details (`#key` in the address) |
| `/watch/N`, `/md/N` | `product.html` | One watch or mesoscale discussion |
| `/analysis` (also `/index.html`) | `index.html` | Mesoanalysis and soundings |
| `/synoptic` | `synoptic.html` | Large-scale charts (analysis), drawn as model charts are; `?share=1` is the picture view |
| `/days`, `/day/<id>` | `days.html` | Day summaries: the forecast and what happened, as two pictures for posting. The public sees saved days; an admin sees recent days and saves them (`server/DayArchive.js`) |
| `/models` (also `/models.html`) | `models.html` | Short range runs and the outlook ensemble, on the game map |
| `/models/large-scale` | `synoptic.html` | A short range run across the whole large-scale model (`?run=<init hour>`) |
| `/day/<id>/analysis`, `/day/<id>/synoptic` | `index.html`, `synoptic.html` | A day's replay on the mesoanalysis and large-scale pages: the hours `server/ReplayArchive.js` kept |
| `/chasers` | `chasers.html` | Chaser network |
| `/about` | `about.html` | What the site is, the clock, image use |
| anything else | `404.html` | Not found (status 404) |

The Discord bot links to `/outlook/dayN`, `/watch/N` and `/md/N`: keep them.

## Shared parts

Each page holds three markers that the server fills from this folder when it sends the page:

- `<!--site:head-->` → `head.html` (stylesheet, icon, `js/site.js`)
- `<!--site:header-->` → `header.html` (the menu, on every page)
- `<!--site:footer-->` → `footer.html` (document pages only)

Change the menu or footer here, once. A new page needs a row in `server/SitePages.js`, its file in the
`Dockerfile`'s `COPY` line, and a row in the table above (`tests/site-pages.mjs` checks the first two).

## Look

`css/site.css` holds the look; the reasons are in `ai_state/TECH_DECISIONS.md` (2026-11-12, site design).

- `body.doc`: document pages. Light by default, dark when the reader's system is; square corners; rules and
  tables, not boxes. Colour is kept for hazards (`.tag--HIGH`, `.tag--tornado`, ...), and a hazard's name is
  always written beside its colour.
- The map tools (mesoanalysis, synoptic charts, models) are document pages too: a controls column (`.bench__side`,
  `.group`) beside a chart (`.chart`). The charts are drawn dark (their colours are chosen for a dark ground) and
  framed like any figure; the sounding sits on a dark `.instrument` block.
- `body.app` (engine status) and `body.tool` (chasers) still have their own dark layouts and take only the header.
- The header's sections with their own pages (Outlooks, Mesoanalysis, Models) open a menu on hover or keyboard
  focus; on a phone the pages are listed under the section. The strip above it holds the world's clock.
- Type: Public Sans for text, IBM Plex Mono for bulletins and times; both are in `fonts/` (SIL Open Font
  License), so nothing is fetched from another site.

## Public and admin views

Some pages show more to an admin. The sign-in is in the top bar of every page and nowhere else (`js/site.js`:
the `WEATHER_ADMIN_KEY`, kept for the tab; signing in or out loads the page again with the new role; a local
engine with no key treats this machine as admin). The server decides the role on every request.

- Large-scale charts (`/synoptic`, `/models/large-scale`): the public view holds the game map in the middle of
  the chart, east-west and north-south at every zoom, and shows nothing of its drift (the server leaves the
  drift out of a public frame). The charts are drawn on a dark ground (owner's choice). An admin can
  drag the view and sees the drift arrow, speed and the day's aim. `?view=public` shows an admin the public
  view; the share view is always the public one.
- Day summaries (`/days`): saved days are public; recent days, saving and removing are admin only.
- Chasers and the mesoanalysis page's world controls: as before.

## Replays and GIFs

A day's replay (`server/ReplayArchive.js`) is kept for 16 world days (two real days) after the day: the hourly
mesoanalysis and large-scale frames and every warning. The day page (`/day/<id>`) links to the two replay
pages and plays the warnings on a time slider. Selecting a tornado's track on the "What happened" picture opens
its panel: its path and its survey's damage indicators (kept with the saved summary, for good).

"Save loop as GIF" (`js/gif.js`) makes the animated picture in the browser from whatever the page is showing: on
the mesoanalysis and large-scale pages (live or replay) and the warnings replay. A GIF of the large-scale charts
is always of the public view.

## Looking at changes

`node scripts/site-preview.mjs` serves the pages from this checkout on port 8090 and passes every `/api/`
request to the hosted engine, so page work needs no local engine.
