# Wispy smoke flipbooks: the Severity cloud look (docs/tornado-reference/NOTES.md "Wisps").
#
#   py -3.12 tools/smoke/wisp_flipbook.py --variant wispy   --out roblox/assets/tornado2
#   py -3.12 tools/smoke/wisp_flipbook.py --variant strands --out roblox/assets/tornado2
#
# What makes Severity's clouds wispy (measured from its clips): big, long-lived, low-opacity
# particles whose textures carry FIBROUS detail in the alpha. A dense soft middle, and toward the
# edge only thin filaments survive, so every overlapping edge frays into wisps. Our older sheets
# (smoke_flipbook.py) are deliberately featureless blobs, which is why our clouds read blurry and
# round.
#
# How the filaments are made: fine "ridged" noise (1 - |n|, sharpened) gives thin lines; the
# sampling coordinates are warped by a smooth flow field (domain warping), which bends the lines
# into curling strands; the strands are stretched along one axis (along the flow). The puff's
# body erodes into those strands toward its edge.
#
# Output: a 4 x 4 sheet (1024 px, 256 a frame), pure white with the shape in the alpha only
# (overlapping particles then blend the same in any draw order: no flicker when Roblox re-sorts
# them), looping in time (the noise is periodic over the 16 frames). Writes <variant>.png and
# <variant>_preview.png (over a dark slate, like a storm base).
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke_flipbook import blur, periodic_noise, write_png  # noqa: E402

GRID = 4
CELL = 256
FRAMES = GRID * GRID

VARIANTS = {
    # a puff with a soft dense middle and a torn, fibrous fringe (cloud edges, scud, wall cloud)
    "wispy": dict(
        radius=0.25, stretch=1.0, billow=0.25, falloff=1.2,
        warp=0.12, strandStretch=1.8, strandFreq=1.0, sharp=1.2, width=0.3, reach=0.4, strandBeta=5.0, soften=1.6, halo=0.1,
        erode=0.95, fringe=0.9, inside=0.25, density=2.6, slow=5.0,
    ),
    # long streaky strands along the frame's height (the funnel sheath; streaks in a wedge)
    "strands": dict(
        radius=0.42, stretch=0.4, billow=0.22, falloff=1.0,
        warp=0.08, strandStretch=5.0, strandFreq=1.0, sharp=1.2, width=0.28, reach=0.5, strandBeta=5.0, soften=1.4, halo=0.1,
        erode=0.85, fringe=1.0, inside=0.35, density=2.4, slow=5.0,
    ),
}


def sample(field, yy, xx):
    """Bilinear look-up of a (t, h, w) field at per-frame coordinates (wrapping)."""
    t, h, w = field.shape
    x0 = np.floor(xx).astype(int)
    y0 = np.floor(yy).astype(int)
    fx, fy = xx - x0, yy - y0
    x0 %= w
    y0 %= h
    x1, y1 = (x0 + 1) % w, (y0 + 1) % h
    ti = np.arange(t)[:, None, None]
    a = field[ti, y0, x0] * (1 - fx) + field[ti, y0, x1] * fx
    b = field[ti, y1, x0] * (1 - fx) + field[ti, y1, x1] * fx
    return a * (1 - fy) + b * fy


def make_frames(v, seed):
    rng = np.random.default_rng(seed)
    shape = (FRAMES, CELL, CELL)
    ts = v["slow"]
    low = periodic_noise(rng, shape, 4.0, 1.0, ts)  # the puff's outline, in and out
    flowx = periodic_noise(rng, shape, 3.6, 1.0, ts)  # the smooth flow that bends the strands
    flowy = periodic_noise(rng, shape, 3.6, 1.0, ts)
    # fine noise stretched along y (strands run up and down the frame before warping); smooth
    # enough that its zero-crossings are long continuous curves, at two scales
    fine = periodic_noise(rng, shape, v["strandBeta"], 1.0 / v["strandStretch"], ts)
    fine2 = periodic_noise(rng, shape, v["strandBeta"], 1.0 / v["strandStretch"], ts)
    mid = periodic_noise(rng, shape, 4.6, 1.0, ts)  # gentle density variation inside (rougher = grain)

    y, x = np.mgrid[0:CELL, 0:CELL].astype(float)
    u = (x + 0.5) / CELL - 0.5
    w = (y + 0.5) / CELL - 0.5

    # strands: ridged lines along the noise's zero-crossings, bent by the warp into curls
    wx = x[None] + v["warp"] * CELL * flowx
    wy = y[None] + v["warp"] * CELL * flowy
    n1 = sample(fine, wy * v["strandFreq"], wx * v["strandFreq"])
    n2 = sample(fine2, wy * v["strandFreq"] * 2.1, wx * v["strandFreq"] * 2.1)
    ridge = lambda n: np.clip(1.0 - np.abs(n) / v["width"], 0, 1) ** v["sharp"]
    strands = np.clip(ridge(n1) + 0.6 * ridge(n2), 0, 1)
    strands = np.clip(blur(strands, v["soften"]), 0, 1)  # soft brush strokes, not hard veins

    # the body: a soft puff whose outline billows
    r = np.sqrt((u / v["stretch"]) ** 2 + w ** 2)[None]
    radius = v["radius"]  # the height; the width is radius x stretch
    edge = radius * (1.0 + v["billow"] * low)
    q = np.clip(1.0 - (r / edge) ** 2, 0.0, 1.0)
    body = q ** v["falloff"]

    # toward the edge the body erodes into the strands; strands also reach a little past it
    edgeness = 1.0 - body  # 0 in the middle, 1 at and past the edge
    # the body's own edge breaks up into the strands (fibrous, not a clean soft rim)
    kept = body * (1.0 - v["erode"] * edgeness * (1.0 - strands))
    reach = np.clip(1.0 - (r - edge) / (v["reach"] * edge), 0, 1) ** 2  # strands fade out past the edge
    fringe = v["fringe"] * strands * reach * edgeness
    # a faint wide mist the wisps sit in
    halo = v["halo"] * np.clip(1.0 - (r / (edge * (1.0 + v["reach"]))) ** 2, 0, 1) ** 2
    dens = np.clip(kept + fringe + halo, 0, None) * np.clip(1.0 + v["inside"] * mid * body, 0.2, 2.0)

    margin = np.clip(np.minimum.reduce([x, y, CELL - 1 - x, CELL - 1 - y]) / (CELL / 21.0), 0, 1)[None]
    dens = dens * margin
    alpha = 1.0 - np.exp(-v["density"] * dens)
    return alpha


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="wispy", choices=sorted(VARIANTS))
    ap.add_argument("--out", default="roblox/assets/tornado2")
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()
    alpha = make_frames(VARIANTS[a.variant], a.seed)
    sheet = np.zeros((CELL * GRID, CELL * GRID))
    for i in range(FRAMES):
        r, c = divmod(i, GRID)
        sheet[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = alpha[i]
    os.makedirs(a.out, exist_ok=True)
    out = np.full(sheet.shape + (4,), 255, np.uint8)
    out[..., 3] = (np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8)
    write_png(os.path.join(a.out, f"{a.variant}.png"), out)
    # preview: white smoke over a dark slate storm base
    bg = np.array([52, 60, 70], float) / 255
    s = np.clip(sheet, 0, 1)[..., None]
    prev = (np.clip(1.0 * s + bg * (1 - s), 0, 1) * 255 + 0.5).astype(np.uint8)
    prev = np.concatenate([prev, np.full(prev.shape[:2] + (1,), 255, np.uint8)], axis=2)
    write_png(os.path.join(a.out, f"{a.variant}_preview.png"), prev)
    print("wrote", a.variant, "alpha mean", round(float(sheet.mean()), 3))


if __name__ == "__main__":
    main()
