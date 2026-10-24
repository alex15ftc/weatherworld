"""Distant rain shaft: a rain or hail shaft seen from kilometres away (client/StormMesh drawRain).
Mostly filled and soft-edged, with faint vertical streaking (fall streaks, uneven density);
tiles top to bottom so it can scroll. White; the game colours it.

    py -3.12 tools/rain/rain_shaft.py [--out roblox/assets/rain] [--seed 5]

At a distance rain is a grey veil, not streaks (the fine-streaked rain_curtain texture showed
as scattered specks from 20 km), so the alpha here is a body (0.55-1) with gentle streaks.
"""
import argparse
import os

import numpy as np
from PIL import Image

W, H = 256, 512


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="roblox/assets/rain")
    ap.add_argument("--seed", type=int, default=5)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    x = np.arange(W) / W
    # streaks: a sum of vertical bands (across-only noise), wider ones stronger
    across = np.zeros(W)
    for k, amp in ((3, 0.35), (7, 0.22), (17, 0.14), (41, 0.08)):
        phase = rng.uniform(0, 2 * np.pi, 4)
        for j in range(4):
            across += amp / 4 * np.sin(2 * np.pi * (k + j * 0.7) * x + phase[j])
    # slow change down the shaft (tiling: periodic in y)
    y = np.arange(H) / H
    down = 0.08 * np.sin(2 * np.pi * y)[:, None] + 0.05 * np.sin(4 * np.pi * y + 1.3)[:, None]
    body = 0.78 + across[None, :] + down * np.cos(2 * np.pi * 3 * x)[None, :]
    # soft sides
    edge = np.clip(np.minimum(x, 1 - x) / 0.3, 0, 1)
    edge = edge * edge * (3 - 2 * edge)
    alpha = np.clip(body, 0, 1) * edge[None, :]
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    os.makedirs(a.out, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(os.path.join(a.out, "rain_shaft.png"))
    sky = Image.new("RGBA", (W, H), (120, 150, 190, 255))
    shaft = Image.fromarray(rgba, "RGBA")
    tinted = Image.new("RGBA", (W, H), (90, 95, 105, 255))
    tinted.putalpha(shaft.getchannel("A"))
    sky.alpha_composite(tinted)
    sky.convert("RGB").save(os.path.join(a.out, "rain_shaft_preview.png"))
    print("wrote", os.path.join(a.out, "rain_shaft.png"))


if __name__ == "__main__":
    main()
