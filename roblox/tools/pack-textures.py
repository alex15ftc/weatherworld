"""Packs the storm art into 1024 x 1024 sheets for upload to Roblox (tools/upload-images.mjs).

    python -I roblox/tools/pack-textures.py <art dir> [out dir]

<art dir> holds data/tornado-bake/<bake>/angle_NNN/fNNN.png (a baked tornado's life cycle, seen
from several sides) and data/cloud-textures/*-sheet4x4.png (cloud puffs, 4 x 4 per sheet). The
art lives in this repository's history (git archive 6d941ae data/cloud-textures data/tornado-bake).

Each tornado view becomes one sheet of 8 x 8 frames, 128 px each: every frame is cropped to the
box that holds the funnel in any frame of any view (so the views line up and the ground stays
put), scaled to fit and stood on the bottom of its cell. Views the bake lacks are the opposite
view mirrored. The cloud sheets are copied as they are. manifest.json records the layout.
"""

import json
import os
import sys

from PIL import Image, ImageOps

CELL = 128
GRID = 8
FRAMES = GRID * GRID
VIEWS = [0, 45, 90, 135, 180, 225, 270, 315]
CLOUDS = ["puff", "smoke", "scud", "wisp", "dust"]


def frames_of(view_dir):
    return [os.path.join(view_dir, f"f{i:03d}.png") for i in range(FRAMES)]


def main():
    art = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "Textures", "build")
    os.makedirs(out, exist_ok=True)

    bakes = os.path.join(art, "data", "tornado-bake")
    bake = sorted(os.listdir(bakes))[0]
    root = os.path.join(bakes, bake)
    complete = {}
    for name in sorted(os.listdir(root)):
        view = int(name.split("_")[1])
        paths = frames_of(os.path.join(root, name))
        if all(os.path.isfile(p) for p in paths):
            complete[view] = paths

    # The box holding the funnel in every frame of every view.
    box = None
    for paths in complete.values():
        for p in paths:
            b = Image.open(p).getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
            if b:
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    cw, ch = box[2] - box[0], box[3] - box[1]
    scale = min(CELL / cw, CELL / ch)
    fw, fh = max(1, round(cw * scale)), max(1, round(ch * scale))

    views = {}
    for view in VIEWS:
        mirror = False
        paths = complete.get(view)
        if paths is None:
            paths, mirror = complete.get((view + 180) % 360), True
        if paths is None:
            continue
        sheet = Image.new("RGBA", (CELL * GRID, CELL * GRID), (0, 0, 0, 0))
        for i, p in enumerate(paths):
            frame = Image.open(p).convert("RGBA").crop(box).resize((fw, fh), Image.LANCZOS)
            if mirror:
                frame = ImageOps.mirror(frame)
            x = (i % GRID) * CELL + (CELL - fw) // 2
            y = (i // GRID) * CELL + (CELL - fh)
            sheet.alpha_composite(frame, (x, y))
        name = f"tornado-{bake}-{view:03d}.png"
        sheet.save(os.path.join(out, name), optimize=True)
        views[str(view)] = {"file": name, "mirroredFrom": (view + 180) % 360 if mirror else None}

    clouds = {}
    for kind in CLOUDS:
        src = os.path.join(art, "data", "cloud-textures", f"{kind}-sheet4x4.png")
        if os.path.isfile(src):
            name = f"cloud-{kind}.png"
            Image.open(src).convert("RGBA").save(os.path.join(out, name), optimize=True)
            clouds[kind] = {"file": name, "grid": 4}

    manifest = {
        "tornado": {
            "bake": bake,
            "grid": GRID,
            "cell": CELL,
            "frames": FRAMES,
            # The funnel's share of its cell, across and up; it stands on the cell's bottom edge.
            "contentWidth": fw / CELL,
            "contentHeight": fh / CELL,
            "views": views,
        },
        "clouds": clouds,
    }
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"{len(views)} tornado views ({fw}x{fh} px frames), {len(clouds)} cloud sheets -> {os.path.abspath(out)}")


if __name__ == "__main__":
    main()
