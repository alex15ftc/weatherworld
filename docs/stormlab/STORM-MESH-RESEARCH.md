# Supercell body: meshes vs billboards (research, 2026-10-29)

User: the tornado reads translucent; the storm around it probably should not be billboards; the
wall cloud probably is billboards in the references. Question: what works better for the supercell?

## Findings

- Mixing meshes and billboards only goes wrong when BOTH are translucent. Roblox draws translucent
  things back to front, sorted by each object's centre (devforum 43275, 291164), so a translucent
  mesh and a billboard swap order as the camera moves. An OPAQUE mesh writes depth: billboards
  behind it are hidden per pixel and billboards in front draw over it correctly. So: opaque mesh
  body + billboard wall cloud / scud / tornado composites cleanly.
- Soft mesh edges: SurfaceAppearance AlphaMode=Transparency with MeshPart.Transparency 0 gives
  per-pixel cutout with proper depth (good with billboards); Transparency >= 0.02 gives smooth soft
  edges but "occlusion may not be perfect" (it joins the sorted translucent pass). Most
  SurfaceAppearance properties can't be changed by scripts in-game.
- Meshes get the engine's lighting (sun, sky, Future/ShadowMap shadows): a storm that shades
  itself and casts a shadow on the ground for free - the thing our billboards fake per card.
- Shipped precedent: Roblox's own "Mystery of Duvall Drive" storm used big textured,
  semi-transparent cloud meshes (tiled texture, spinning discs at different speeds; their
  intersections made natural-looking forms; light bounced off them for cloud-to-cloud lightning).
- EditableMesh: build/deform the shell from the storm's fields at runtime (vertex positions,
  normals, per-vertex colour + alpha via AddColor/SetVertexColorAlpha - whether vertex alpha
  renders as transparency is not documented; test). Limits: strict client memory budget with no
  published number (one report: failures at 8 meshes), Create* returns nil when over budget; a
  published game needs the creator ID-verified and "Allow Mesh & Image APIs" on. Rewriting
  vertices every frame costs; update a few times a minute as the storm evolves.
- Bones (skinned MeshPart from Blender): cheaper than EditableMesh for "same shape, changing
  proportions" (tower lean, anvil spread, base lowering) - move bones from fields, no budget limit.
- EditableImage as a mesh texture: possible (dynamic texture), but it is the shader path the user
  dropped; not needed if engine lighting does the shading.
- Beams: curved, scrolling-texture ribbons; candidates for inflow bands / striations, not the body.

## Recommendation

Hybrid, split by what each piece is:
- Mesh (opaque or cutout, engine-lit): updraft tower, anvil, overshooting top, base / shelf,
  rain-free base, precip core curtain (could stay billboards/particles). A few Blender meshes with
  bones, shaped from fields (updraft radius, top, anvil spread, base height, tilt); EditableMesh
  only if bones can't reach the shapes. Fringe billboards along the silhouette soften the edge.
- Billboards: wall cloud, tail cloud, scud, tornado, dust - the parts that move fast and need the
  per-sprite motion (Flow.luau, spiral stream). They hang from the opaque base, so depth handles
  the overlap.

Tornado translucency: the spiral's per-sprite alpha share is still too low for a stovepipe;
separate tuning fix.

Sources: devforum 43275, 291164, 76618, 3982856, 4566101; create.roblox.com docs for EditableMesh,
EditableImage, SurfaceAppearance, Beam, AssetService; "Develop a moving world" (Duvall Drive).

## ImageHandleAdornment cards (user lead, 2026-10-29)

Someone built a supercell from ImageHandleAdornments turned to face the player's POSITION (not
the camera's rotation): a world-space image quad whose CFrame we set, so we choose its
orientation (face the player, yaw-only so towers stay upright, roll to follow a funnel, or fixed
in the world like a flat base deck). Cards stop swinging when the camera turns; they only turn as
the player moves round the storm, like a real object.
Known: Image, Size (Vector2, studs), CFrame relative to the adornee, Transparency, Color3,
AlwaysOnTop, ZIndex (create.roblox.com ImageHandleAdornment / HandleAdornment). Ignores fog (we
haze cards ourselves already). Edge bleeding: image edges wrap into each other, worse at angles
(devforum 4015327) - pad textures with a transparent border. Unverified, to test: ImageRect
(sprite sheets) probably absent; cost vs BillboardGui (3D object, no GUI layout - likely cheaper);
how it sorts against parts and billboards; whether a flat deck of them avoids the BaseDeck
sorting problem.
