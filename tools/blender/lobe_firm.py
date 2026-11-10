"""Firmer copies of the processed lobe sheets (2026-11-09, plain Python, no Blender).

The lobe sheets (lobe_post.py, contrast 0.45, feather 1.6) are nearly flat inside and fade over a
wide rim; stacked 5-15 deep on km-wide cards the storm read blurry at any range, user. This keeps
each lobe's shape and light direction and changes two things only:

  contrast  each lobe's shading distance from its own alpha-weighted mean, scaled (1 = as is)
  edge      the coverage ramp at the rim tightened: alpha remapped by smoothstep(lo, hi, alpha)

  py -3.12 tools/blender/lobe_firm.py [--contrast 1.8] [--lo 0.12] [--hi 0.6]
      -> roblox/assets/clouds/firm/<same names> (+ firm_preview.png)
"""
import argparse
import os

import numpy as np
from PIL import Image

SRC = "roblox/assets/clouds"
SETS = {  # name: frames across the sheet
    "lobe_tower": 4, "lobe_tower_near": 2, "lobe_under": 4, "lobe_under_near": 2,
}
PASSES = ("lit_front", "lit_side", "lit_back", "amb")


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def firm(px, grid, contrast, lo, hi):
    out = px.copy()
    n = px.shape[0] // grid
    for r in range(grid):
        for k in range(grid):
            cell = out[r * n:(r + 1) * n, k * n:(k + 1) * n]
            a = cell[..., 3]
            w = a.sum()
            if w > 0:
                mean = (cell[..., :3] * a[..., None]).sum(axis=(0, 1)) / w
                cell[..., :3] = np.clip(mean + (cell[..., :3] - mean) * contrast, 0, 1)
            cell[..., 3] = smooth(lo, hi, a)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contrast", type=float, default=1.8)
    ap.add_argument("--lo", type=float, default=0.12)
    ap.add_argument("--hi", type=float, default=0.6)
    ap.add_argument("--out", default=os.path.join(SRC, "firm"))
    o = ap.parse_args()
    os.makedirs(o.out, exist_ok=True)
    made = []
    for name, grid in SETS.items():
        for p in PASSES:
            src = os.path.join(SRC, f"{name}_{p}.png")
            if not os.path.exists(src):
                continue
            px = np.asarray(Image.open(src).convert("RGBA"), np.float32) / 255
            res = firm(px, grid, o.contrast, o.lo, o.hi)
            dst = os.path.join(o.out, f"{name}_{p}.png")
            Image.fromarray((res * 255 + 0.5).astype(np.uint8), "RGBA").save(dst)
            made.append((src, dst))
            print(dst)
    # preview: old over new, each lit_front over a storm-grey ground
    rows = []
    for name in ("lobe_tower_near", "lobe_under_near"):
        for path in (os.path.join(SRC, f"{name}_lit_front.png"), os.path.join(o.out, f"{name}_lit_front.png")):
            im = Image.open(path).convert("RGBA").resize((1024, 1024))
            bg = Image.new("RGBA", im.size, (96, 104, 120, 255))
            rows.append(Image.alpha_composite(bg, im))
    sheet = Image.new("RGBA", (2048, 2048))
    for i, im in enumerate(rows):
        sheet.paste(im, ((i % 2) * 1024, (i // 2) * 1024))
    sheet.save(os.path.join(o.out, "firm_preview.png"))


if __name__ == "__main__":
    main()
