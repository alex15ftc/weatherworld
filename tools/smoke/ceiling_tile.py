"""Seamless cloud-base tile for the parent storm's far ceiling (CloudBase.luau).

White RGB, alpha = lumpy cloud cover from periodic FFT noise (tiles with no seam). Seen from
below on huge horizontal layers: soft bumps and gaps, so stacked layers read as a lumpy base.

  py -3.12 tools/smoke/ceiling_tile.py [--cover 0.7] [--seed 3] [--out roblox/assets/clouds/ceiling.png]
"""
import argparse
import numpy as np
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke_flipbook import write_png

ap = argparse.ArgumentParser()
ap.add_argument("--size", type=int, default=1024)
ap.add_argument("--cover", type=float, default=0.7)
ap.add_argument("--soft", type=float, default=0.22)
ap.add_argument("--beta", type=float, default=3.0)
ap.add_argument("--seed", type=int, default=3)
ap.add_argument("--out", default="roblox/assets/clouds/ceiling.png")
a = ap.parse_args()

rng = np.random.default_rng(a.seed)
n = a.size
fx = np.fft.fftfreq(n)[:, None]
fy = np.fft.fftfreq(n)[None, :]
f = np.sqrt(fx * fx + fy * fy)
f[0, 0] = 1
spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / f ** (a.beta / 2)
spec[0, 0] = 0
spec[f < 2 / n] *= 0.3  # no single huge blob per tile
noise = np.real(np.fft.ifft2(spec))
noise = (noise - noise.mean()) / noise.std()
# threshold so `cover` of the tile is cloud, with a soft edge
t = np.quantile(noise, 1 - a.cover)
alpha = np.clip((noise - t) / (a.soft * 2) + 0.5, 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)
# a little internal density variation
alpha *= 0.75 + 0.25 * np.clip((noise - t) / 1.5, 0, 1)
img = np.zeros((n, n, 4), np.uint8)
img[..., :3] = 255
img[..., 3] = (alpha * 255).astype(np.uint8)
write_png(a.out, img)
bg = np.array([90, 96, 110], np.float32)
prev = np.zeros_like(img)
prev[..., :3] = (bg + (255 - bg) * alpha[..., None]).astype(np.uint8)
prev[..., 3] = 255
write_png(a.out.replace(".png", "_preview.png"), prev)
print("wrote", a.out, "alpha mean %.3f" % (alpha.mean()))
