"""Packs the Blender tornado bakes (scripts/blender/bake_tornado_types.py) into the game's sheets.

    python -I scripts/pack-tornado-strips.py <bake dir> <build dir>

<bake dir>/<type>/fNNN.png are strips of 8 sides (camera bearings 0, 45 ... 315), one per frame of
the tornado's life. Each side becomes one 1024 x 1024 sheet of 8 x 8 frames (128 px), written to
<build dir>/tornado-<type>-<bearing>.png, and <build dir>/manifest.json gets the type under
`tornadoes`, replacing that type's earlier bake (the original "classic" bake is kept; the
particle bakes of scripts/bake-tornadoes.mjs are dropped).

Sizes, in the .blend's units: a frame is the domain, 129.2 square, standing on the ground; the
cloud base is 105 up. The game stands a frame frameShare cloud-base heights tall and widens it so
its funnel's middle (midRadiusShare of the base height, the mean of the type's ground and top
radii) matches the engine's.
"""

import json
import os
import sys

from PIL import Image

VIEWS = [0, 45, 90, 135, 180, 225, 270, 315]
GRID, CELL = 8, 128
DOMAIN, CLOUD_BASE = 129.2, 105.0

# Each type's funnel radii at the ground and top (as scripts/blender/bake_tornado_types.py sets
# them; the cone is the original's), for its middle width.
RADII = {
    "cone": (4.84, 17.32),
    "stovepipe": (13.0, 17.0),
    "wedge": (34.0, 44.0),
    "partial-wedge": (30.0, 42.0),
    "drillbit": (1.8, 5.5),
    "rope": (1.4, 4.0),
    "elephant-trunk": (4.84, 17.32),
    "uncondensed": (4.84, 17.32),
}
SHAPES = {"partial-wedge": "partial wedge", "elephant-trunk": "elephant trunk"}


def long_path(path):
    """Windows: a path past 260 characters needs the extended-length (\\\\?\\) form."""
    path = os.path.abspath(path)
    prefix = "\\\\?\\"
    if os.name == "nt" and not path.startswith(prefix):
        return prefix + path
    return path


def main():
    bake, build = long_path(sys.argv[1]), long_path(sys.argv[2])
    manifest_file = os.path.join(build, "manifest.json")
    manifest = json.load(open(manifest_file)) if os.path.exists(manifest_file) else {}
    tornadoes = manifest.setdefault("tornadoes", {})
    packed = []
    for name in sorted(os.listdir(bake)):
        folder = os.path.join(bake, name)
        frames = sorted(f for f in os.listdir(folder) if f.endswith(".png")) if os.path.isdir(folder) else []
        if len(frames) < GRID * GRID:
            print(f"{name}: {len(frames)} of {GRID * GRID} frames baked, skipped")
            continue
        sheets = [Image.new("RGBA", (GRID * CELL, GRID * CELL), (0, 0, 0, 0)) for _ in VIEWS]
        for i, f in enumerate(frames[: GRID * GRID]):
            strip = Image.open(os.path.join(folder, f)).convert("RGBA")
            side = strip.height
            for v in range(len(VIEWS)):
                cell = strip.crop((v * side, 0, (v + 1) * side, side))
                if side != CELL:
                    cell = cell.resize((CELL, CELL), Image.LANCZOS)
                sheets[v].alpha_composite(cell, ((i % GRID) * CELL, (i // GRID) * CELL))
        files = {}
        for v, bearing in enumerate(VIEWS):
            file = f"tornado-{name}-{bearing:03d}.png"
            sheets[v].save(os.path.join(build, file), optimize=True)
            files[str(bearing)] = file
        ground, top = RADII.get(name, RADII["cone"])
        tornadoes[name] = {
            "shape": SHAPES.get(name, name),
            "vortices": 1,
            "grid": GRID,
            "frames": GRID * GRID,
            "frameShare": DOMAIN / CLOUD_BASE,
            "midRadiusShare": (ground + top) / 2 / CLOUD_BASE,
            "views": VIEWS,
            "files": files,
            "blender": True,
        }
        packed.append(name)
    # The particle bakes these replace (scripts/bake-tornadoes.mjs) are dropped; the original
    # bake ("classic") stays, for types not baked yet.
    for name in list(tornadoes):
        if name != "classic" and not tornadoes[name].get("blender"):
            del tornadoes[name]
    json.dump(manifest, open(manifest_file, "w"), indent=2)
    print(f"packed {len(packed)} types: {', '.join(packed)}")


if __name__ == "__main__":
    main()
