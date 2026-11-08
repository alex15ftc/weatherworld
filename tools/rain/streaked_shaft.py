"""Rain shaft with fall streaks, for billboard curtains (cloudlab RainView, client/EngineStorms).

    py -3.12 tools/rain/streaked_shaft.py [--out roblox/assets/rain] [--seed 7]

distant_shaft.py's curtain (soft bell across, ramps in from the base, no hard edge) read as more
cloud hanging under the base (2026-11-07): from a few km a shaft shows fall streaks - drops fall in
bursts, so the shaft is striped down its length - and a ragged foot where streaks reach the ground
unevenly. Here:
  across   the same raised-cosine bell (overlapping curtains add to the rain's optical depth)
  streaks  fine vertical bands at many widths, +-35 %, each a little brighter or fainter along its
           fall (bursts), so they are streaks, not ruled lines
  top      ramps in over the top 25 % (out of the base with no join)
  foot     each streak ends at its own height over the bottom 16 %, softly feathered (ragged, into the
           ground haze)
White; the game colours it.
"""
import argparse
import os

import numpy as np
from PIL import Image

W, H = 256, 512


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def noise1(rng, n, waves):
    """Smooth periodic noise in [-1, 1] over n samples from a few sine waves."""
    x = (np.arange(n) + 0.5) / n
    v = np.zeros(n)
    for k, amp in waves:
        v += amp * np.sin(2 * np.pi * k * x + rng.uniform(0, 2 * np.pi))
    return v / max(1e-6, np.abs(v).max())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="roblox/assets/rain")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    x = (np.arange(W) + 0.5) / W
    y = (np.arange(H) + 0.5) / H  # 0 top, 1 bottom
    bell = 0.5 - 0.5 * np.cos(2 * np.pi * x)
    # streaks across: many fine bands (no wider than a sixth of the curtain), +-35 %
    streak = noise1(rng, W, [(k, 1 / np.sqrt(k)) for k in (6, 9, 14, 21, 31, 44)])
    # bursts along the fall: each column's density wanders slowly down its length
    burst = np.zeros((H, W))
    for k, amp in ((2, 0.10), (4, 0.07), (7, 0.05)):
        phase = noise1(rng, W, [(3, 1.0), (8, 0.5)]) * np.pi + rng.uniform(0, 2 * np.pi)
        burst += amp * np.sin(2 * np.pi * k * y[:, None] + phase[None, :])
    body = (1 + 0.35 * streak)[None, :] * (1 + burst)
    top = smooth(y / 0.25)[:, None]
    # ragged foot: each column ends between 84 % and 100 % of the way down, feathered over 14 %
    end = 0.92 + 0.08 * noise1(rng, W, [(4, 1.0), (9, 0.5)])
    foot = smooth((end[None, :] - y[:, None]) / 0.14)
    alpha = np.clip(top * foot * body * bell[None, :], 0, 1)
    img = np.zeros((H, W, 4), np.uint8)
    img[..., :3] = 255
    img[..., 3] = np.round(alpha * 255).astype(np.uint8)
    os.makedirs(a.out, exist_ok=True)
    p = os.path.join(a.out, "streaked_shaft.png")
    Image.fromarray(img, "RGBA").save(p)
    print(p, "peak alpha", alpha.max().round(3), "mean", alpha.mean().round(3))


if __name__ == "__main__":
    main()
