"""Gaseous puff sheet for the "gas" tornado style (2026-10-30): 2x2 frames of 512, each a soft
cloud puff - a broad soft falloff (half density at ~0.3 of the frame), the edge broken by
low-frequency billows, gentle density and brightness variation inside. Cards built from these
overlap into condensed cloud rather than solid objects (user: our cards looked like solids).
White-ish value (the renderer tints with ImageColor3); alpha gone well inside the frame edge.

    py -3.12 tools/smoke/gas_puff.py  ->  roblox/assets/tornado2/gas_puff_sheet.png (+ _preview)
"""
import numpy as np
from PIL import Image

CELL = 512
rng = np.random.default_rng(20261030)


def fbm(n, octaves, base, seed):
    r = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    for o in range(octaves):
        freq = base * 2 ** o / n
        w = np.exp(-((f / freq) ** 2))  # smooth noise at this scale
        layer = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((n, n))) * w))
        layer /= layer.std() + 1e-9
        out += amp * layer
        tot += amp
        amp *= 0.5
    return out / tot


def puff(seed):
    y, x = np.mgrid[0:CELL, 0:CELL]
    u = (x + 0.5) / CELL - 0.5
    v = (y + 0.5) / CELL - 0.5
    r = np.sqrt(u * u + v * v)
    low = fbm(CELL, 2, 2.2, seed)            # billows: a few broad lumps round the edge
    mid = fbm(CELL, 2, 3.5, seed + 11)       # gentle inner density variation (broad, no grain:
                                             # a mottled sheet drew a blotchy column, 2026-10-29)
    # the outline pushed in and out by the billows (+-28%)
    rr = r / (1 + 0.28 * np.clip(low, -2, 2) / 2)
    base = np.exp(-((rr / 0.27) ** 2) * 0.7)  # soft broad falloff, ~0.5 at r 0.27
    a = base * (0.9 + 0.1 * np.clip(mid, -2, 2) / 2)
    a = np.clip(a * 1.15, 0, 1)
    a *= np.clip((0.47 - r) / 0.06, 0, 1)    # gone before the frame edge
    val = 0.94 + 0.06 * np.clip(fbm(CELL, 1, 3.0, seed + 23), -2, 2) / 2
    return a, val


sheet = np.zeros((2 * CELL, 2 * CELL, 4))
for k in range(4):
    a, val = puff(100 + 17 * k)
    ry, rx = (k // 2) * CELL, (k % 2) * CELL
    sheet[ry:ry + CELL, rx:rx + CELL, :3] = val[..., None]
    sheet[ry:ry + CELL, rx:rx + CELL, 3] = a
img = (np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(img, "RGBA").save("roblox/assets/tornado2/gas_puff_sheet.png")
bg = Image.new("RGBA", (2 * CELL, 2 * CELL), (70, 80, 95, 255))
bg.alpha_composite(Image.fromarray(img, "RGBA"))
bg.convert("RGB").resize((512, 512)).save("roblox/assets/tornado2/gas_puff_sheet_preview.png")
for k in range(4):
    ry, rx = (k // 2) * CELL, (k % 2) * CELL
    c = sheet[ry:ry + CELL, rx + CELL // 2, 3]
    print(k, "mean alpha", sheet[ry:ry + CELL, rx:rx + CELL, 3].mean().round(3), "centre column", [round(float(c[i]), 2) for i in range(0, CELL, 32)])
