# Cloud kit: pieces, conventions and data format

The game builds storm clouds from a small set of reusable cloud mesh pieces. It places, scales, turns, mirrors and tints copies of them from the weather engine's fields. It does not make one unique mesh per storm.

The pieces are made in Blender by `tools/blender/cloud_kit.py`. An artist can replace any piece with a hand-made one, or add new variants. This page explains how.

- **Data:** `roblox/src/shared/Weather/CloudKit/Pieces/<name>.luau`, one module per piece.
- **List:** `roblox/src/shared/Weather/CloudKit/Index.luau` lists the pieces by kind. The script rebuilds it.
- **Previews:** `roblox/assets/cloudkit/previews/<name>.png` and `sheet.png`, the contact sheet of every piece.
- **Loader in game:** `roblox/src/shared/Weather/CloudKit/init.luau` builds each piece into an EditableMesh and a MeshPart.

## Pieces (v1)

| Kind | Variants | What it is | Modelled at (x × depth × height) | Directional? |
|---|---|---|---|---|
| `tower_cap` | 1–3 | The cauliflower dome on top of a cumulonimbus tower. Big rounded lobes covered in smaller lobes, wider than tall, flat-ish closed bottom that sits on a body piece. 3 rises highest (overshooting-top-like). | 1 × 1 × 0.5–0.65 | no |
| `tower_body` | 1–2 | A column segment of a tower, with bulging lobes on its sides. Narrower and flattened at both ends so stacked pieces tuck into each other. | 1 × 1 × 1.15 | no |
| `anvil` | 1–2 | A section of anvil: a flat slab, flat on top, with billows along the long edges (bigger on the front/upwind side, -Y in Blender). Fibrous streaks on the underside run along X. The edges are ragged and thin, the X ends most of all, so sections laid side by side blend. | 1.15 × 1.2 × 0.16 | front = upwind edge |
| `base` | 1–2 | Rain-free base / cloud base slab: flat top, lumpy scud-like underside, ragged rim. | 1.1 × 1.1 × 0.25 | no |
| `shelf` | 1–2 | Shelf cloud segment. Seen in section (YZ) it is a wedge: a rounded nose low at the front, then a smooth laminar upper surface rising up and back in soft tiers (3 tiers in 1, 4 in 2). Under it, behind the nose, the underside rises into the turbulent, lumpy "whale's mouth". The X ends shrink and are irregular so segments laid end to end overlap without seams. | 1.1 × 1 × 0.5 | front = nose, the way the storm moves |
| `wall_cloud` | 1 | An abrupt, flat-bottomed, round-ish lowering with a ragged lumpy side. It flares slightly at the top, where it merges into the base. | 1 × 1 × 0.38 | no |
| `mammatus` | 1 | A panel of smooth round pouches hanging from a thin flat top. | 1.15 × 1.15 × 0.25 | no |

"Modelled at" is the shape's true proportion before it is stretched to the unit box. Scaling a piece to about these proportions in game shows it as designed; other proportions stretch it.

## Conventions

**The unit box (game axes, Y up).**
- X runs from -0.5 to 0.5: length, along the piece.
- Z runs from -0.5 to 0.5: depth, across it. On directional pieces **+Z is the front**: the shelf's nose, the way the storm moves.
- Y runs from 0 to 1: up. Y = 0 is the piece's bottom.

Every piece fills the box exactly on all three axes. The game then scales X, Y and Z independently, so a piece can be modelled at any size: export stretches it per axis to fill the box.

**Blender axes.** Model with Z up and X along the piece. The front faces **-Y**, which is what Blender's Front view (numpad 1) looks at. Export converts game (x, y, z) = Blender (x, z, -y). That is a rotation, not a mirror, so the winding is unchanged.

**Mesh rules.**
- 1,500–4,000 vertices.
- Triangles only.
- Closed (watertight) and manifold: every edge is in exactly two triangles.
- No degenerate triangles.
- Every triangle counter-clockwise when seen from outside (right-handed, Y up), which is what Roblox EditableMesh treats as the front face.

The exporter enforces all of these. It triangulates, closes the mesh with a voxel remesh if needed, decimates if there are too many vertices, and checks winding.

**Normals** are smooth per-vertex normals, worked out from the unit-box positions. If the game scales the box by (sx, sy, sz), the true normal is (nx/sx, ny/sy, nz/sz), normalised. Roblox does this itself for a resized MeshPart.

**Ambient occlusion (`ao`)** is a value per vertex from 0 to 1, where 1 is open sky. Creases between lobes come out dark. It is baked on the true-proportion shape before stretching: 48 cosine-weighted rays over the hemisphere, reaching 0.3 of the piece's biggest size, with a hit counting less the farther away it is. The game multiplies its own lighting by it.

**Mirroring.** Mirroring a piece on an odd number of axes reverses its winding. If the game mirrors by negating coordinates when it builds a mesh, it must also swap two indices of every triangle, and negate the same components of the normals.

## Data format

```lua
--!strict
-- Cloud kit piece <name> (tools/blender/cloud_kit.py; do not edit by hand)
return {
	name = "<name>",
	kind = "<tower_cap|tower_body|anvil|base|shelf|wall_cloud|mammatus>",
	vertices = <count>,
	-- x, y, z per vertex (unit box: x, z in -0.5..0.5, y in 0..1)
	p = { ... },
	-- normal x, y, z per vertex
	n = { ... },
	-- ambient occlusion per vertex (0..1, 1 = open)
	ao = { ... },
	-- triangles: three 1-based vertex indices each, counter-clockwise seen from outside
	t = { ... },
}
```

- The lists are flat, with many numbers per line and lines under about 200 characters.
- Positions and normals are rounded to 4 decimals, and `ao` to 3.
- `#p = #n = 3 * vertices`, `#ao = vertices`, and `#t` is a multiple of 3 with every index in 1..vertices.
- The piece's name is its file name.
- The kind is the name without its `_<number>` ending, unless `--kind` says otherwise.

`Index.luau` maps each kind to its piece names, for example `tower_cap = { "tower_cap_1", "tower_cap_2", "tower_cap_3" }`. The script rebuilds it from the files in `Pieces/` each time it runs. Only files whose header says `-- Cloud kit piece` are listed, so stand-in or test files are left out.

## Making the pieces

```
blender --background --factory-startup --python tools/blender/cloud_kit.py --                 # every piece
blender --background --factory-startup --python tools/blender/cloud_kit.py -- --piece shelf_1 # one piece (or a comma list)
py tools/blender/check_cloud_kit.py                                                           # check every piece module
```

The script is deterministic: each variant has a fixed seed. A full run takes about 2.5 minutes, roughly 10 s per piece, most of it the preview render.

How a generated piece is built:
1. Join many spheres and ellipsoids, or smooth lofted cross-sections for the shelf's laminar wedge. Tower lobes are fractal: big lobes covered in smaller lobes, sunk in so they bulge rather than sit on stalks.
2. Voxel remesh, which gives the union as one clean closed surface. Drop any small floating bits.
3. Squash flat where the piece meets others (tower ends, base and anvil tops, the wall cloud's bottom), and warp the edges with a little smooth noise so grids and straight edges disappear.
4. Smooth a few passes, so creases are rounded and lobes stay crisp. Add a faint noise, and the anvil's fibrous underside streaks.
5. Decimate to about 3,000 vertices, triangulate, relax any folded triangles, and check.
6. Bake ambient occlusion, normalise to the unit box, write the module, then render the preview.

## Replacing or adding a piece by hand

1. Model the piece in Blender at roughly its intended proportions (see the table), with Z up, X along it, and its front facing -Y.
   - Any modelling method works: sculpting, metaballs, a remesh of joined spheres.
   - Modifiers and the object's transform are applied on export, so they need not be applied by hand.
   - Fill the shape out to its ends. Export stretches it to the unit box on each axis, so empty margins are wasted.
2. Keep it to one closed, manifold mesh, ideally of 1,500–4,000 vertices.
   - Over 4,000, it is decimated.
   - Not closed or not manifold, it is voxel remeshed (at 1/160 of its size) to close it, which can soften fine detail.
   - For the cleanest result, triangulate and check it yourself (3D Print toolbox, "Check All").
3. Save the .blend, then export:

   ```
   blender --background --factory-startup --python tools/blender/cloud_kit.py -- \
       --from-blend path/to/clouds.blend --object MyShelf --name shelf_3
   ```

   - `--name` is the piece name, and the kind comes from it (`shelf_3` gives `shelf`). Add `--kind shelf` if the name does not follow that pattern.
   - Using an existing name (for example `shelf_1`) replaces that piece.
   - Using a new number adds a variant.
   - Add `--no-preview` to skip the render.
4. The exporter applies the same steps as for generated pieces: triangulate, budget, fold fix, winding check, AO bake, normalise, write. It also writes the preview, `Index.luau` and `sheet.png`.
5. Run `py tools/blender/check_cloud_kit.py`, look at the preview, and try the piece in game.

**Keep a hand-made piece.** Running `cloud_kit.py` with no `--piece` regenerates every *generated* name and would overwrite a hand-made `shelf_1`. Either give hand-made pieces new numbers (`shelf_3`), or regenerate generated pieces one at a time with `--piece`.

## Getting new pieces into the game (upload)

The game draws the pieces from one uploaded Model, not from the Luau data. Pieces built at
runtime use Roblox's EditableMesh memory, which the tornado, sky and map already share, and it
runs out. After making or changing any piece:

1. `py tools/blender/cloud_kit_glb.py` packs every piece into `roblox/assets/cloudkit/cloud_kit.glb`.
   That is one mesh per piece, named after it, with its normals and AO as vertex colour.
2. Upload that file to Roblox as a **Model** asset under the game's owner. Claude uses romcp's
   `roblox_upload_asset`; Studio's importer also works.
3. Put the new asset id in `Config.STORM_KIT.meshAsset` (`roblox/src/shared/World/Config.luau`).

At startup the server loads the asset (`CloudKit.serverLoad`) into
`ReplicatedStorage.CloudKitMeshes`, and clients copy the pieces from there. A piece missing from
the upload is built from its Luau data instead, if memory allows. The Luau data must still be
present, because placing a piece uses its extent.

The parts sit under the camera, outside the physics world. Placed in Workspace, roughly 230 moving
pieces brought a squall-line view down to 15 fps; under the camera it runs at 60.

## Shape notes from the reference photos (`docs/storm-reference/`)

- **Tower caps and bodies** (`01_b`, `13_a`, `13_b`, `08_d`) have hard, crisp cauliflower edges, deep creases and lobes on lobes. Avoid both smooth blobs and noisy spikes.
- **Shelf** (`07_a`–`07_d`): the upper surface is smooth and laminar, in tiers like stacked plates. The underside behind the nose is dark, turbulent and lumpy (the whale's mouth). The nose is the lowest, frontmost part.
- **Anvil** (`08_a`–`08_c`) is flat on top with a sharper upwind edge and a fibrous, streaky underside.
- **Wall cloud** (`04_a`, `04_b`) is abrupt and flat-bottomed, darker than the base, with a ragged edge.
- **Mammatus** (`09_*`) is smooth round pouches, packed together.
