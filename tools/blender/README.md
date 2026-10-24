# Blender asset scripts

Headless Blender scripts that make the tornado's art for the Roblox place. Outputs go to
`roblox/assets/tornado/` and are uploaded to Roblox as images (Open Cloud; romcp's
`roblox_upload_asset`), then referenced by asset id from `roblox/src/client/StormView.luau`.

Blender 5.2 is at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`. Run each script
with `--background --factory-startup --python <script> -- <options>`.

| Script | Makes | Time (RTX 4070) |
|---|---|---|
| `funnel_texture.py --variant core\|wisp` | 1024² RGBA cloud texture for the funnel shells; tiles both ways (4D noise on a torus), banded round the funnel. Also a 2×2 tiled preview. | ~5 s each |
| `dust_flipbook.py` | 8×8 flipbook (1024², 128 px frames, frame borders kept clear) of a dust/debris puff that bursts, billows and thins: a procedural Cycles volume (4D noise, time as the 4th dimension), neutral grey for tinting in game. Also a preview over grey. For a ParticleEmitter with FlipbookLayout Grid8x8, FlipbookMode OneShot. | ~2.5 min |

(A Mantaflow smoke simulation was tried first for the puff: at a resolution that bakes in minutes it
came out blocky and thin, and took ~12 min. The procedural volume has detail at any size.)

| `tornado_sprite.py --shape rope\|cone\|wedge --light lit\|back` | The distant tornado: 4×4 sheet (256 px square frames, one full turn of the vortex), lit with the sun behind the viewer or behind the tornado. Prints the funnel's width/height ratio for the config. A thin funnel glows when backlit, a thick one goes dark with a bright rim. | ~2 min each |

| `cloud_puff.py` | Four cauliflower cloud puffs (2×2 sheet, also split into `cloud_puff_1..4.png`): procedural volumes lit from above, soft wispy edges. The storm's clouds are built from these as camera-facing Beams. | ~1 min |
| `rain_curtain.py` | 512×1024 rain-shaft texture: fine streaks gathered into shafts, tiling top to bottom so it can scroll as falling rain, soft at both sides. | ~5 s |

Uploaded to the user ATGuardian (8632902) with romcp's `roblox_upload_asset`; the texture ids it returns
go in `Config.TORNADO_ART`. Nothing in these scripts reads the weather. They make the materials; the game sizes, tints,
spins and fades them from the storm's fields.

## Cloud kit (`cloud_kit.py`)

The cloud kit is a set of reusable cloud **mesh pieces**. The game builds storm clouds from copies of them, placed, scaled, turned, mirrored and tinted from the weather engine's fields.

The pieces are tower caps, tower bodies, anvil sections, bases, shelf segments, a wall cloud and a mammatus panel. Each is written as a Luau data module: positions in a unit box, smooth normals, baked per-vertex ambient occlusion, and triangles.

| Command | Makes | Time |
|---|---|---|
| `cloud_kit.py` | Every piece: `roblox/src/shared/Weather/CloudKit/Pieces/<name>.luau`, a preview each in `roblox/assets/cloudkit/previews/`, `sheet.png`, and `CloudKit/Index.luau` | ~2.5 min |
| `cloud_kit.py --piece shelf_1[,base_2,...]` | Only those pieces (the index and sheet are still rebuilt) | ~10 s each |
| `cloud_kit.py --from-blend FILE --object NAME --name PIECE [--kind KIND]` | Exports an artist's object to the same format, with the same normalising, AO bake and checks | ~10 s |
| `py tools/blender/check_cloud_kit.py` | Checks every piece module and the index (plain Python, no Blender): counts, closed and consistently wound mesh, bounds, budget | ~2 s |

How the generator builds each piece:
1. Join many spheres or smooth lofted sections, voxel remesh them into one closed surface, then squash, warp and smooth.
2. Decimate to about 3,000 vertices.
3. Bake ambient occlusion with ray casts.
4. Stretch per axis into the unit box and convert to game axes.

Conventions, the data format, and how to make or replace a piece by hand are in `docs/storm-visuals/KIT.md`.

## Cloud vapor sprites (`cloud_vapor_bake.py`)

Volumetric versions of the kit's puffy pieces (tower caps, tower bodies, anvils, mammatus), drawn in
game as camera-facing images instead of solid meshes. For each piece the script reads the mesh from
its `Pieces/<name>.luau`, puts it back to its modelled proportions (game (x, y, z) -> Blender
(x, -z, y)), makes a signed distance grid with OpenVDB, and renders it as a cloud volume in Cycles:
the shader moves the surface with noise (Voronoi domes on domes for cauliflower towers, X-wise
streaks under a smooth top for anvils, smooth swells for mammatus), ramps density into an optically
thick core (Principled Volume, white, anisotropy 0.75, 12 volume bounces), adds a faint veil outside
(the silver lining when backlit) and eats the fringe into wisps.

| Command | Makes | Time (RTX 4070, OptiX) |
|---|---|---|
| `cloud_vapor_bake.py` | All eight pieces: `roblox/assets/cloudkit/vapor/<piece>.png` (1024², 2×2 cells: lit, side / back, high; straight alpha), `<piece>_preview.png`, `sheet.png` | ~20.5 min at 512 px, 64 samples (tower caps ~2.9 min each, bodies ~3.6, anvils and mammatus ~1.4) |
| `cloud_vapor_bake.py --pieces anvil_1 --res 384 --samples 32 --out tmp/x --true 1` | A quick look at one piece; `--true 1` also writes `<piece>_true.png`, the preview squashed back to the piece's real proportions | ~30–60 s |
| `cloud_vapor_bake.py --sheet-only 1` | Only rebuilds `sheet.png` from the previews | ~2 s |

Each cell covers the unit box plus a margin M = 0.15 on every side (game x -0.65..0.65, y -0.15..1.15),
seen from game +Z looking toward -Z (image right = +X). Light directions, layout and placement are in
`roblox/assets/cloudkit/vapor/README.md`. Look settings (`LOOKS`, `SUN_ENERGY`, `SKY_*`, `ANISOTROPY`)
are at the top of the script.
