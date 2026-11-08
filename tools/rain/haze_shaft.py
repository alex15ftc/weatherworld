"""Precipitation shafts as haze, for the billboard/card curtains (cloudlab RainView, client/EngineStorms).

    py -3.12 tools/rain/haze_shaft.py [--out roblox/assets/rain] [--seed 5]

Writes rain_haze.png and hail_haze.png. From kilometres off a storm's rain core is a smooth grey veil,
not streaks (streaks show only in light rain, at thin edges, backlit, or near); streaked_shaft.py's
fall streaks (2026-11-07) read as painted on. Here:
  rain   across  a raised-cosine bell (no plateau, no hard side; overlapping curtains add to the
                 rain's optical depth)
         texture faint broad unevenness, +-8 %, a few bands a curtain, slowly varying down the fall
         top     ramps in over the top 25 % (out of the base with no join)
         foot    fades over the bottom 12 %, its end varying gently (+-3 %) so a row of curtains
                 doesn't end on a ruled line
  hail   across  a flat core with firmer sides (smoothstep over the outer 35 % each side): hail falls
                 fast and straight, so its shaft keeps an edge where rain blurs
         texture as rain but fainter (+-5 %)
         top     ramps in over the top 15 %; foot over the bottom 6 % (it reaches the ground whole)
White; the game colours them.
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
    x = (np.arange(n) + 0.5) / n
    v = np.zeros(n)
    for k, amp in waves:
        v += amp * np.sin(2 * np.pi * k * x + rng.uniform(0, 2 * np.pi))
    return v / max(1e-6, np.abs(v).max())


def shaft(rng, across, band_amp, top_frac, foot_frac, foot_vary):
    y = (np.arange(H) + 0.5) / H  # 0 top, 1 bottom
    band = noise1(rng, W, [(2, 1.0), (3, 0.7), (5, 0.4)])
    drift = np.zeros((H, W))
    for k, amp in ((1, 0.5), (2, 0.3)):
        phase = noise1(rng, W, [(2, 1.0)]) * np.pi + rng.uniform(0, 2 * np.pi)
        drift += amp * np.sin(2 * np.pi * k * y[:, None] + phase[None, :])
    body = 1 + band_amp * (band[None, :] * 0.7 + 0.3 * drift / max(1e-6, np.abs(drift).max()))
    top = smooth(y / top_frac)[:, None]
    end = 1 - foot_vary + foot_vary * noise1(rng, W, [(2, 1.0), (3, 0.5)])
    foot = smooth((end[None, :] - y[:, None]) / foot_frac)
    return np.clip(top * foot * body * across[None, :], 0, 1)


def save(alpha, path):
    img = np.zeros((H, W, 4), np.uint8)
    img[..., :3] = 255
    img[..., 3] = np.round(alpha * 255).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(path)
    print(path, "peak alpha", alpha.max().round(3), "mean", alpha.mean().round(3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="roblox/assets/rain")
    ap.add_argument("--seed", type=int, default=5)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    os.makedirs(a.out, exist_ok=True)
    x = (np.arange(W) + 0.5) / W
    bell = 0.5 - 0.5 * np.cos(2 * np.pi * x)
    save(shaft(rng, bell, 0.08, 0.25, 0.12, 0.03), os.path.join(a.out, "rain_haze.png"))
    edge = smooth((0.5 - np.abs(x - 0.5)) / 0.35)
    save(shaft(rng, edge, 0.05, 0.15, 0.06, 0.02), os.path.join(a.out, "hail_haze.png"))


if __name__ == "__main__":
    main()
