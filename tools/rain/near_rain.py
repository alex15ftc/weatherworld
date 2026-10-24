"""Near rain: the rain right round the player, as bold streaks for camera-facing rain sheets
(client/StormView cameraRain). White, the streaks in the alpha; tiles top to bottom (streaks wrap)
so it can scroll as the rain falls; fades at both sides so neighbouring sheets overlap cleanly.

    py -3.12 tools/rain/near_rain.py [--out roblox/assets/rain] [--seed 3]

Writes near_rain.png (256 x 1024) and near_rain_preview.png (on a grey sky).
Streaks: a drop falling ~9 m/s, seen over a ~1/60 s exposure-like blur, is a short bright line;
lengths and brightnesses vary (near and far drops), widths 1-3 px with soft edges.
"""
import argparse
import os

import numpy as np
from PIL import Image

W, H = 256, 1024


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="roblox/assets/rain")
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--count", type=int, default=220)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    alpha = np.zeros((H, W), np.float64)
    ys = np.arange(H)
    for _ in range(a.count):
        x = rng.uniform(4, W - 4)
        y0 = rng.uniform(0, H)
        near = rng.random() ** 2  # most drops far (faint, short), a few near (bright, long)
        length = 30 + 200 * near
        width = 0.6 + 1.6 * near
        bright = 0.25 + 0.65 * near
        # along the streak: brighter in the middle, soft ends; wrap top to bottom
        d = (ys - y0) % H
        t = d / length
        along = np.where(t < 1, np.sin(np.pi * np.clip(t, 0, 1)) ** 0.6, 0.0)
        xs = np.arange(W)
        across = np.exp(-((xs - x) / width) ** 2)
        alpha = np.maximum(alpha, bright * along[:, None] * across[None, :])
    # fade at the sides
    edge = np.clip(np.minimum(np.arange(W), W - 1 - np.arange(W)) / (W * 0.18), 0, 1)
    alpha *= (edge * edge * (3 - 2 * edge))[None, :]
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    os.makedirs(a.out, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(os.path.join(a.out, "near_rain.png"))
    sky = Image.new("RGBA", (W, H), (110, 118, 128, 255))
    sky.alpha_composite(Image.fromarray(rgba, "RGBA"))
    sky.convert("RGB").save(os.path.join(a.out, "near_rain_preview.png"))
    print("wrote", os.path.join(a.out, "near_rain.png"))


if __name__ == "__main__":
    main()
