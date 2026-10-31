"""Tornado dust wisps, 2x2 frames of 512 (2026-10-30): replaces the 4x4 wisp sheet (256 px frames,
stretched over big dust cards: the grainy patches near the ground). Streaky along x like the old
sheet, but the streaks are broad and smooth-edged: a dust sheet layering into a skirt, no grain.
White (the renderer tints with ImageColor3).

    py -3.12 tools/smoke/dust_wisp2.py  ->  roblox/assets/tornado2/dust_wisp2_sheet.png (+ preview)
"""
import numpy as np
from PIL import Image

CELL = 512
OUT = "roblox/assets/tornado2/"


def fbm(n, octaves, base, seed, aniso):
    r = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :] * aniso  # aniso > 1: streaks along x
    f = np.sqrt(fx * fx + fy * fy)
    for o in range(octaves):
        freq = base * 2 ** o / n
        w = np.exp(-((f / freq) ** 2)) - np.exp(-((f / (0.5 * freq)) ** 2))
        layer = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((n, n))) * w))
        layer /= layer.std() + 1e-9
        out += amp * layer
        tot += amp
        amp *= 0.5
    return out / tot


def wisp(seed):
    y, x = np.mgrid[0:CELL, 0:CELL]
    u = (x + 0.5) / CELL - 0.5
    v = (y + 0.5) / CELL - 0.5
    # an elongated soft body (wider along x), streaks along x inside it
    body = np.exp(-((u / 0.3) ** 2 + (v / 0.19) ** 2))
    streak = fbm(CELL, 3, 5, seed, 6.0)
    broad = fbm(CELL, 2, 2.5, seed + 7, 1.5)
    d = body * (0.75 + 0.35 * np.clip(streak, -2, 2) / 2) * (0.8 + 0.3 * np.clip(broad, -2, 2) / 2)
    r = np.sqrt((u / 0.49) ** 2 + (v / 0.47) ** 2)
    d *= np.clip((1 - r) / 0.15, 0, 1)
    a = np.clip(1 - np.exp(-3.6 * np.clip(d, 0, None) ** 1.3), 0, 1)
    val = 0.93 + 0.07 * np.clip(streak, -2, 2) / 2
    return a, val


sheet = np.zeros((2 * CELL, 2 * CELL, 4))
for k in range(4):
    a, val = wisp(500 + 31 * k)
    ry, rx = (k // 2) * CELL, (k % 2) * CELL
    sheet[ry:ry + CELL, rx:rx + CELL, :3] = val[..., None]
    sheet[ry:ry + CELL, rx:rx + CELL, 3] = a
Image.fromarray((np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(f"{OUT}dust_wisp2_sheet.png")
bg = np.ones((2 * CELL, 2 * CELL, 3)) * np.array([0.27, 0.31, 0.37])
tint = np.array([0.72, 0.6, 0.45])
a = sheet[..., 3:4]
comp = bg * (1 - a) + sheet[..., :3] * tint * a
Image.fromarray((comp * 255).astype(np.uint8)).save(f"{OUT}dust_wisp2_preview.png")
print("ok")
