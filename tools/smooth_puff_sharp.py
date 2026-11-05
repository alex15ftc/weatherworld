"""Sharper-edged copies of the smooth puff (tools/smooth_puff.py): the same lobes (same seed), edge
place (0.68 of the frame) and rim shading, but the alpha ramp at the edge is 1/2 and 1/4 as wide.
TornadoCards draws a wide funnel's body with them: a card's edge ramp is a share of its width, so
with the one texture a 450 m wedge's edge was ~4x as soft in metres as the cone's (2026-11-03).
Writes roblox/assets/tornado2/smooth_puff_sharp2.png and smooth_puff_sharp4.png."""
import numpy as np
from PIL import Image, ImageFilter

N = 512


def fbm(n, octaves, base, rng):
    out = np.zeros((n, n)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        g = base * 2 ** o
        lat = rng.normal(size=(g + 1, g + 1))
        x = np.linspace(0, g, n, endpoint=False)
        i = x.astype(int); f = x - i; f = f * f * (3 - 2 * f)
        a = lat[i][:, i]; b = lat[i + 1][:, i]; c = lat[i][:, i + 1]; d = lat[i + 1][:, i + 1]
        F1, F2 = f[:, None], f[None, :]
        out += amp * ((a * (1 - F2) + c * F2) * (1 - F1) + (b * (1 - F2) + d * F2) * F1)
        tot += amp; amp *= 0.5
    return out / tot


for k, ramp, blur in ((2, 0.11, 2.0), (4, 0.055, 1.0)):
    rng = np.random.default_rng(11)
    c = (np.arange(N) + 0.5) / N * 2 - 1
    X, Y = np.meshgrid(c, c)
    r = np.sqrt(X * X + Y * Y)
    lobes = fbm(N, 2, 3, rng)
    edge = 0.68 + 0.07 * lobes
    d = (edge - r) / ramp
    a = np.clip(d, 0, 1)
    a = a * a * (3 - 2 * a)
    a[r > 0.96] = 0
    alpha = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255
    lum = 1.0 - 0.16 * np.clip(r / 0.7, 0, 1) ** 2
    rgb = (np.clip(lum, 0, 1) * 255).astype(np.uint8)
    out = np.zeros((N, N, 4), np.uint8)
    out[..., 0] = out[..., 1] = out[..., 2] = rgb
    out[..., 3] = (alpha * 255).astype(np.uint8)
    Image.fromarray(out).save(f"roblox/assets/tornado2/smooth_puff_sharp{k}.png")
    print(k, "mean alpha", alpha.mean().round(3))
