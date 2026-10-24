# Storm lifecycle and storm types: plan (2026-10-23)

## What the engine already does (inventory, file:line in the engine)

**Genesis**
- Every 0.5 h of sim time, each grid cell is tested (`InitiationEngine.js:55-159`).
- Lift: surface convergence (fronts, dryline, outflow), terrain, large-scale ascent and thermals against CIN.
- Gates: MLCAPE ≥ 300; nothing new within 40 km of a storm or inside its cold pool.
- A new storm starts in phase `tower` (age < 0.3 h), with updraft 6 m/s and intensity 0.12.
- There is no cumulus or towering-cumulus object before that.

**Growth and decay**
- Updraft relaxes toward √(2·CAPE) × entrainment × (1 − rain loading) × (1 − outflow undercut) × inflow quality, with time constants τ 0.35 h up and 0.3 h down (`StormBudgets.js:53-81`).
- Rain τ 0.4 h. The cold pool grows with rain and DCAPE.
- Rotation spins up in about 0.4 h and down in about 0.7 h.
- Occlusion builds while a tornado is down.
- Cloud top = 7 km + 160 m per m/s of updraft. The anvil lengthens with age up to 3 h.

**Phases** (labels only)
- tower, developing / organizing, mature, cyclic (supercells over 1.4 h), weakening, dissipating.
- A storm dies when its updraft falls below 4 m/s after 0.4 h of age.

**Mergers, splits, lines**
- Mergers when centres come within 7 km or cold pools overlap.
- Splits produce a left-mover 6 km off.
- Lines grow at their ends with the cold pool.

**Types**, re-derived every step, so a storm can change type through its life (`StormModeEngine.js:331-351`):
- pulse storm (shear < 22 kt)
- multicell
- isolated / discrete / semi-discrete supercell, and supercell clusters
- left-mover
- broken line, linear segment, QLCS (with embedded supercells), MCS
- elevated convection
- `supercellType` LP / classic / HP comes from `spectrum` (storm-relative wind, LCL).
- `line.bow` comes from the rear inflow jet.

**Sent to the game**
- Sent: geometry (updraft, base, wall cloud, inflow, rain, hail, rear flank, gust front, shelf, line, anvil), plus `mode`, `supercellType`, `spectrum`, `rotating`, `linear`, `intensity`.
- **Not sent:** lifecycle phase, age, updraft trend, cold-pool strength, merge and split events, dissipation reason.

**Roblox today**
- Reads none of the type fields. Growth shows only as heights and sizes changing between frames.
- No towering-cumulus stage, collapse, orphan anvil, merge or split visuals.
- The seed-8181 replay has only supercells, multicells and elevated storms, with no lines or LP storms, so it can't show line or LP visuals.

## Plan

### 1. Engine: send lifecycle and type state
Fields on each storm appearance; all are numbers so StormTrack blends them:
- `life`:
  - `ageMin`
  - `phase` (string)
  - `trend` (updraft trend −1..1)
  - `growth` (0–1: how far the updraft is to its peak)
  - `decay` (0–1: collapse progress once weakening or dissipating)
  - `coldPool` (0–1)
- `events`: merge and split flags with partner ids, so the client can blend two storms into one, or bud a new tower.
- `orphanAnvil`: the anvil persists 30–60 min after the updraft dies, drifting downwind and thinning.
- `cumulus`: before genesis, the initiation candidates (cells where lift approaches CIN) as small cumulus and towering-cumulus seeds. Fair-weather cumulus can come from the sky grid.

### 2. Client: show the life cycle, all from those numbers

| Stage | What drives it | What shows |
|---|---|---|
| Cumulus → towering cumulus | `growth`, age < 18 min | Cauliflower tower rising from a flat base, no anvil yet; hard edges, bright |
| Growth | `trend` > 0 | Tower top rising (topM grows), fresh hard-edged lobes, overshooting top as updraft peaks; the anvil starts as a small cap, then spreads |
| Mature | phase mature or cyclic | As now; wall cloud and inflow bands for rotating storms |
| Weakening | `trend` < 0 | Lobes soften (fewer and smaller), tower edges go fibrous, top sinks; rain shafts grow and fall out; the base lifts and turns ragged (outflow) |
| Dissipating | `decay` | Tower collapses into rain; the base shreds into scud; the anvil detaches (orphan anvil) and thins over 30–60 min |
| Merge / split | `events` | Two towers drawn into one; a new tower budding off the flank |

### 3. Client: types from the engine's fields, not labels
The visuals follow the continuous fields, so the type labels only name what the fields already show.

| Type | Fields | Look |
|---|---|---|
| Pulse storm | low shear, `rotating` ≈ 0 | Single tower, short life, rain falls straight down through the updraft, quick collapse, round anvil |
| Multicell | `linear` low, several updraft centres | Several towers at different stages (new ones on the flank), merged base |
| Supercell LP | `spectrum` < −0.3 | Narrow striated (barber-pole) updraft, little rain, visible rain-free base, small or no hail shaft |
| Supercell classic | `spectrum` ~0 | As built now: wall cloud, clear slot, forward-flank rain |
| Supercell HP | `spectrum` > 0.3 | Rain-wrapped base, heavy shafts close to the updraft, bowl or shelf leading edge, teal hail core |
| Line / QLCS | `line.share`, `halfLengthKm`, `gustFront`, `shelf` | Long shelf cloud (multi-tier), towers stepped along the line, rain curtain behind, whale's mouth |
| Bow echo / derecho | `line.bow` | Line bowed outward, strongest shelf at the apex, rear-inflow notch |
| MCS | mode MCS, age > 4 h | Wide trailing stratiform rain shield, broad anvil overcast, embedded towers |
| Elevated | `elevatedFeed` | High base, no wall cloud, lots of lightning, hail without a surface-based inflow |

### 4. Test data
- Export replays with a QLCS or MCS day and an LP day (find seeds with `scripts/day-review-pack.mjs`) alongside seed 8181.
- Add lab shots per type, plus reference photos per type (lines and shelves are already in `docs/storm-reference/real/07_*`).
