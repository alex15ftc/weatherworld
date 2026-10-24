"""Flying-debris sprite sheet (4x4, 1024 px): boards, shingles and splinters in silhouette.

White, alpha only (the emitter colours it). Frames show pieces at different angles and
foreshortenings, so a particle cycling through them reads as a tumbling piece of debris.

  py -3.12 tools/smoke/debris_sheet.py [--seed 5] [--out roblox/assets/tornado2/debris_sheet.png]
"""
import argparse, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke_flipbook import write_png

ap = argparse.ArgumentParser()
ap.add_argument("--seed", type=int, default=5)
ap.add_argument("--out", default="roblox/assets/tornado2/debris_sheet.png")
a = ap.parse_args()
rng = np.random.default_rng(a.seed)
F = 256
img = np.zeros((F * 4, F * 4), np.float32)
yy, xx = np.mgrid[0:F, 0:F].astype(np.float32) + 0.5


def poly_mask(pts):
    # signed-distance-ish coverage for a convex polygon, 1.5 px soft edge
    d = np.full((F, F), np.inf, np.float32)
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        L = np.hypot(ex, ey) + 1e-6
        # inward normal for counter-clockwise points
        nx, ny = -ey / L, ex / L
        dist = (xx - x0) * nx + (yy - y0) * ny
        d = np.minimum(d, dist)
    return np.clip(d / 1.5 + 0.5, 0, 1)


def piece(kind):
    cx, cy = F / 2 + rng.uniform(-12, 12), F / 2 + rng.uniform(-12, 12)
    ang = rng.uniform(0, np.pi)
    if kind == "board":
        hl, hw = rng.uniform(70, 110), rng.uniform(9, 20) * rng.choice([1, 0.5, 0.25])  # some edge-on
    elif kind == "shingle":
        hl, hw = rng.uniform(35, 55), rng.uniform(25, 45) * rng.choice([1, 0.6, 0.3])
    else:  # splinter
        hl, hw = rng.uniform(40, 80), rng.uniform(3, 7)
    c, s = np.cos(ang), np.sin(ang)
    corners = [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)]
    pts = []
    for (px, py) in corners:
        px += rng.uniform(-4, 4)
        py += rng.uniform(-3, 3)
        pts.append((cx + px * c - py * s, cy + px * s + py * c))
    m = poly_mask(pts)
    if kind != "splinter":
        # a ragged broken end: bite a few notches out of one end
        for _ in range(rng.integers(1, 4)):
            t = rng.uniform(0.97, 1.08) * rng.choice([-1, 1])
            bx, by = cx + t * hl * c, cy + t * hl * s
            r = rng.uniform(4, 12)
            m *= np.clip((np.hypot(xx - bx - rng.uniform(-6, 6), yy - by - rng.uniform(-6, 6)) - r) / 1.5, 0, 1)
    return m


kinds = ["board"] * 7 + ["shingle"] * 6 + ["splinter"] * 3
rng.shuffle(kinds)
for i, k in enumerate(kinds):
    m = piece(k)
    if rng.random() < 0.25:  # a second small fragment
        m = np.maximum(m, np.roll(piece("splinter"), (rng.integers(-60, 60), rng.integers(-60, 60)), (0, 1)) * 0.9)
    r, q = divmod(i, 4)
    img[r * F:(r + 1) * F, q * F:(q + 1) * F] = m
rgba = np.zeros((F * 4, F * 4, 4), np.uint8)
rgba[..., :3] = 255
rgba[..., 3] = (img * 255).astype(np.uint8)
write_png(a.out, rgba)
prev = np.zeros_like(rgba)
prev[..., :3] = (np.array([120, 150, 120]) * (1 - img[..., None]) + 40 * img[..., None]).astype(np.uint8)
prev[..., 3] = 255
write_png(a.out.replace(".png", "_preview.png"), prev)
print("wrote", a.out)
