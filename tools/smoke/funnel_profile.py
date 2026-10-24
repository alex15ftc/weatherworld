"""The cross-section texture for a Beam funnel (a camera-facing ribbon along the funnel's axis).

Across the texture (u): how a soft round column of cloud looks side-on, matched to Ref1
(tools/lookmetrics: edge transition ~4% of the width, ~11% darker just inside the edge):
  - alpha: opaque in the middle, a soft but definite ramp at both edges;
  - brightness: lighter in the middle, a darker band just inside each edge (seen through more
    cloud at a glancing angle, and in its own shade), then the edge fading out.
Along it (v): faint streaks running the funnel's length (Ref1's subtle vertical striations),
tileable so beams can be stacked or scrolled.

    py -3.12 tools/smoke/funnel_profile.py [out.png] [--size 512] [--streaks 0.05]
"""
import argparse
import math
import os

import numpy as np
from PIL import Image


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=os.path.join(os.path.dirname(__file__), "out", "funnel_profile.png"))
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--edge", type=float, default=0.06, help="edge ramp width, share of the full width")
    ap.add_argument("--dark", type=float, default=0.14, help="darkening just inside the edge")
    ap.add_argument("--streaks", type=float, default=0.05, help="strength of the lengthwise streaks")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    W = H = args.size
    u = (np.arange(W) + 0.5) / W  # 0..1 across
    d = np.abs(u - 0.5) * 2  # 0 centre .. 1 edge
    e = args.edge * 2  # in d units
    # alpha: 1 until the ramp, smooth to 0 at the very edge
    alpha = 1 - smoothstep(1 - e, 1.0, d)
    # brightness: a column of cloud seen side-on is lit through less cloud at the middle;
    # a darker band peaks just inside the ramp
    band = np.exp(-((d - (1 - 1.6 * e)) / (1.3 * e)) ** 2)
    bright = 1 - args.dark * band - 0.04 * d ** 2
    rng = np.random.default_rng(args.seed)
    # streaks: a sum of tileable sine waves across u, slowly wandering along v (tileable in v)
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    streak = np.zeros_like(U)
    for k in range(24):
        f = rng.integers(6, 60)
        ph = rng.uniform(0, 2 * math.pi)
        wander = rng.uniform(0.002, 0.01) * np.sin(2 * math.pi * (V * rng.integers(1, 3)) + rng.uniform(0, 6.28))
        amp = 1 / math.sqrt(f)
        streak += amp * np.sin(2 * math.pi * f * (U + wander) + ph)
    streak /= np.abs(streak).max()
    lum = np.clip(bright[None, :] * (1 + args.streaks * streak), 0, 1)
    a = np.clip(alpha[None, :] * (1 - 0.5 * args.streaks * np.abs(streak) * smoothstep(0.7, 1.0, d)[None, :]), 0, 1)
    img = np.zeros((H, W, 4), dtype=np.uint8)
    img[..., 0] = img[..., 1] = img[..., 2] = (lum * 255).astype(np.uint8)
    img[..., 3] = (a * 255).astype(np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    Image.fromarray(img, "RGBA").save(args.out)
    print(args.out)


if __name__ == "__main__":
    main()
