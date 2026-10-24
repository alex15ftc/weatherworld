"""Sprites for precipitation at the player (client/StormView): a hailstone (a lumpy, translucent
white ice ball with a bright edge) and a rain splash (a small crown of droplets thrown up from
the ground, seen side-on). White on transparent; the game colours and sizes them.

    py -3.12 tools/rain/splash_hail.py [--out roblox/assets/rain]
"""
import argparse
import os

import numpy as np
from PIL import Image


def hailstone(n=128, seed=2):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    r = np.hypot(x, y)
    ang = np.arctan2(y, x)
    lump = 0.86 + 0.025 * np.sin(3 * ang + 1) + 0.012 * np.sin(7 * ang + 2)
    inside = np.clip((lump - r) / 0.06, 0, 1)
    shade = 0.75 + 0.25 * np.clip(-(x + y) / 1.6, -1, 1)  # lit from the upper left
    rim = np.exp(-((r - lump * 0.9) / 0.08) ** 2)  # bright edge (ice)
    core = 0.6 + 0.4 * np.exp(-(r / 0.5) ** 2)  # milky middle
    lum = np.clip(0.55 + 0.45 * shade * core + 0.1 * rim, 0, 1)
    rgba = np.zeros((n, n, 4), np.uint8)
    rgba[..., 0] = (lum * 235).astype(np.uint8)
    rgba[..., 1] = (lum * 242).astype(np.uint8)
    rgba[..., 2] = (lum * 255).astype(np.uint8)
    rgba[..., 3] = (inside * 255).astype(np.uint8)  # solid ice (see-through read as bubbles)
    return rgba


def splash(w=128, h=128, seed=4):
    rng = np.random.default_rng(seed)
    a = np.zeros((h, w))
    yy, xx = np.mgrid[0:h, 0:w]
    # a low crown: droplets thrown out and up on arcs, plus a thin sheet at the base
    for _ in range(14):
        t = rng.uniform(0.25, 1)
        side = rng.choice([-1, 1])
        dx = side * rng.uniform(0.15, 0.48) * t
        dy = rng.uniform(0.35, 0.85) * t
        cx, cy = w / 2 + dx * w, h * 0.92 - dy * h * (1 - 0.3 * t)
        rad = rng.uniform(1.5, 3.2)
        a = np.maximum(a, np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / rad ** 2)))
    base = np.exp(-((yy - h * 0.9) / 3.0) ** 2) * np.exp(-((xx - w / 2) / (w * 0.22)) ** 2)
    a = np.maximum(a, 0.8 * base)
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (np.clip(a, 0, 1) * 255).astype(np.uint8)
    return rgba


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="roblox/assets/rain")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    Image.fromarray(hailstone(), "RGBA").save(os.path.join(a.out, "hailstone.png"))
    Image.fromarray(splash(), "RGBA").save(os.path.join(a.out, "splash.png"))
    prev = Image.new("RGBA", (256, 128), (90, 100, 110, 255))
    prev.alpha_composite(Image.open(os.path.join(a.out, "hailstone.png")), (0, 0))
    prev.alpha_composite(Image.open(os.path.join(a.out, "splash.png")), (128, 0))
    prev.convert("RGB").save(os.path.join(a.out, "splash_hail_preview.png"))
    print("ok")


if __name__ == "__main__":
    main()
