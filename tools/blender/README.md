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

Uploaded to the user ATGuardian (8632902) with romcp's `roblox_upload_asset`; the texture ids it returns
go in `Config.TORNADO_ART`. Nothing in these scripts reads the weather. They make the materials; the game sizes, tints,
spins and fades them from the storm's fields.
