"""Distant precipitation shaft for billboard curtains (cloudlab RainView, client/EngineStorms).

    py -3.12 tools/rain/distant_shaft.py [--out roblox/assets/rain] [--seed 11]

From docs/visuals-research/RAIN-AND-HAIL-AT-DISTANCE.md: a shaft has no hard edge anywhere.
  across   a raised cosine (alpha 0 at both sides, no plateau) - many overlapping curtains sum
           to the rain's real optical depth, so each one is a soft bell
  top      ramps in over the top 30% (the curtain starts inside the cloud and comes out of the
           base with no join)
  foot     feathers out over the bottom 6% (into the ground haze)
  texture  low-contrast vertical banding, +-12%, a few bands a curtain (fall streaks and uneven
           density seen from kilometres away; single drops are never seen at this range)
White; the game colours it.
"""
import argparse
import os

import numpy as np
from PIL import Image

W, H = 256, 512


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="roblox/assets/rain")
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    x = (np.arange(W) + 0.5) / W
    y = (np.arange(H) + 0.5) / H  # 0 top, 1 bottom
    bell = 0.5 - 0.5 * np.cos(2 * np.pi * x)
    band = np.zeros(W)
    for k, amp in ((3, 0.06), (7, 0.04), (13, 0.025)):
        band += amp * np.sin(2 * np.pi * k * x + rng.uniform(0, 2 * np.pi))
    band *= 0.12 / max(1e-6, np.abs(band).max())
    # a little along-the-fall variation, smooth (density bursts), so bands are not ruled lines
    along = 1 + 0.05 * np.sin(2 * np.pi * (2 * y + rng.uniform())) + 0.03 * np.sin(2 * np.pi * (5 * y + rng.uniform()))

    def smooth(t):
        t = np.clip(t, 0, 1)
        return t * t * (3 - 2 * t)

    top = smooth(y / 0.30)
    foot = smooth((1 - y) / 0.06)
    alpha = np.outer(top * foot * along, bell * (1 + band))
    alpha = np.clip(alpha, 0, 1)
    img = np.zeros((H, W, 4), np.uint8)
    img[..., :3] = 255
    img[..., 3] = np.round(alpha * 255).astype(np.uint8)
    os.makedirs(a.out, exist_ok=True)
    p = os.path.join(a.out, "distant_shaft.png")
    Image.fromarray(img, "RGBA").save(p)
    print(p, "peak alpha", alpha.max().round(3), "mean", alpha.mean().round(3))


if __name__ == "__main__":
    main()
