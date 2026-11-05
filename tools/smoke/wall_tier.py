"""A wall-cloud tier (2026-11-01): one level layer of a lowering seen from the side - a soft top
(it merges into the tier above), a crisp flat bottom edge (the wall cloud's defined lower edge,
docs/storm-reference/real/04_wall_cloud_a.jpg), ends fading softly, faint level laminations in
its shade. White/grey (the colour comes from ImageColor3).

    py -3.12 tools/smoke/wall_tier.py  ->  roblox/assets/clouds/wall_tier.png (+ _preview)
"""
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(11)
y, x = np.mgrid[0:N, 0:N]
u = (x + 0.5) / N          # 0..1 across
v = (y + 0.5) / N          # 0 top .. 1 bottom


def smooth(a, b, t):
    t = np.clip((t - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def noise1(n, octaves, seed):
    """Smooth 1-D noise along u (sum of a few sine octaves, random phases), about -1..1."""
    r = np.random.default_rng(seed)
    out = np.zeros_like(u)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        f = n * 2 ** o
        out += amp * np.sin(2 * np.pi * (f * u + r.random()))
        tot += amp
        amp *= 0.5
    return out / tot


# a lens: the bottom flat at 0.70 of the frame, a little uneven (~2% of the height), curling up
# toward the rounded ends; the top soft and lumpy, lowering toward the ends
end = np.minimum(u, 1 - u)                       # 0 at the ends .. 0.5 in the middle
e = smooth(0.0, 0.30, end)                       # 0 at the ends .. 1 over the middle 40%
bottom = 0.70 + 0.018 * noise1(2, 3, 3) - 0.30 * (1 - e) ** 2
top = 0.30 + 0.05 * noise1(1.5, 3, 5) + 0.30 * (1 - e) ** 2
# bottom edge crisp in the middle, softening toward the ends
edge = 0.012 + 0.08 * (1 - e)
a_bot = np.clip((bottom - v) / edge + 0.5, 0, 1)
a_top = smooth(top - 0.16, top + 0.04, v)
a_end = smooth(0.0, 0.10, end)
a = a_bot * a_top * a_end

# shade: faint level laminations (stretched noise), slightly darker toward the bottom edge
lam = np.zeros_like(u)
for k, (fy, amp) in enumerate([(7, 0.025), (13, 0.015)]):
    ph = noise1(0.7, 2, 20 + k) * 1.5
    lam += amp * np.sin(2 * np.pi * (fy * v + ph))
shade = 0.94 + lam - 0.10 * smooth(0.45, 0.70, v)
shade = np.clip(shade, 0, 1)

rgba = np.zeros((N, N, 4), np.uint8)
rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = (shade * 255 + 0.5).astype(np.uint8)
rgba[..., 3] = (a * 255 + 0.5).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save("roblox/assets/clouds/wall_tier.png")

# preview over a sky colour, tinted slate
bg = np.zeros((N, N, 3)); bg[:] = (150, 175, 200)
col = np.array([70, 76, 84]) * shade[..., None]
pv = bg * (1 - a[..., None]) + col * a[..., None]
Image.fromarray(pv.astype(np.uint8), "RGB").save("roblox/assets/clouds/wall_tier_preview.png")
print("ok", a.max(), a[int(0.5 * N), N // 2], a[int(0.75 * N), N // 2])
