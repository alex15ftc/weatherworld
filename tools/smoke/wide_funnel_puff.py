"""Wide copies of the tornado funnel's smooth puff (tools/smooth_puff.py, smooth_puff_sharp.py) for
flattened funnel cards (2026-11-10). TornadoCards draws a wedge's body with cards as wide as the
funnel and flattened down to 6:1 (hsAsp). The square smooth puff squashed that far drew pointed lens
ends - a scalloped outline down the wedge's sides - and its rim shading, compressed into thin dark
lines at each card's top and bottom, stacked into bands up the funnel.

These keep what the funnel's rules depend on:
  - the end edge at 0.68 of the half-width, its alpha ramp 0.22 / 0.11 / 0.055 of the half-width
    (s1 / s2 / s4: TornadoCards picks the sharpness from RC_EDGE, an edge thickness in metres),
    so the funnel's outline is as soft in metres as with the square puffs;
  - each texture's mean alpha, matched to its square original's (the opacity rule assumes it);
  - the darker band toward the funnel's sides (across the width only).
and change the rest: a soft fall-off at top and bottom with no rim shading there (stacked cards
merge into one mass), and the lobes round in pixels.

    py -3.12 tools/smoke/wide_funnel_puff.py -> roblox/assets/tornado2/wide/smooth_{2,4,8}x_s{1,2,4}.png
                                                 + preview.png
"""
import os

import numpy as np
from PIL import Image, ImageFilter

OUT = "roblox/assets/tornado2/wide/"
W = 1024
RAMPS = {1: (0.22, 4.0), 2: (0.11, 2.0), 4: (0.055, 1.0)}  # (end ramp in half-widths, blur px at 512)


def noise(h, w, cells_x, rng):
    """Smooth value noise, round in pixels: cells_x lattice cells across the width."""
    cells_y = max(1, int(round(cells_x * h / w)))
    lat = rng.normal(size=(cells_y + 2, cells_x + 2))
    y = np.linspace(0, cells_y, h, endpoint=False)
    x = np.linspace(0, cells_x, w, endpoint=False)
    iy, ix = y.astype(int), x.astype(int)
    fy, fx = y - iy, x - ix
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = lat[iy][:, ix]; b = lat[iy + 1][:, ix]; c = lat[iy][:, ix + 1]; d = lat[iy + 1][:, ix + 1]
    Fy, Fx = fy[:, None], fx[None, :]
    return (a * (1 - Fx) + c * Fx) * (1 - Fy) + (b * (1 - Fx) + d * Fx) * Fy


def square_mean(ramp, blur):
    n = 512
    rng = np.random.default_rng(11)
    c = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y = np.meshgrid(c, c)
    r = np.sqrt(X * X + Y * Y)
    lob = 0.5 * noise(n, n, 3, rng) + 0.25 * noise(n, n, 6, rng)
    a = np.clip((0.68 + 0.07 * lob / 0.75 - r) / ramp, 0, 1)
    a = a * a * (3 - 2 * a)
    a[r > 0.96] = 0
    al = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255
    return al.mean()


def wide(a, ramp, blur, seed, ytop):
    h = W // a
    rng = np.random.default_rng(seed)
    X = ((np.arange(W) + 0.5) / W * 2 - 1)[None, :].repeat(h, 0)
    Y = ((np.arange(h) + 0.5) / h * 2 - 1)[:, None].repeat(W, 1)
    # (lobes ~1/3 of the card's height across, as the square's are of its size: the end's edge
    # wobbles up the card, never a straight cut)
    # (broad and gentle: at 3 lobes per height and +-0.07 the same notches repeated down the stack
    # of cards, a caterpillar outline - preview 2026-11-10)
    lob = noise(h, W, 2 * a, rng)
    edge = 0.68 + 0.035 * lob
    ax = np.clip((edge - np.abs(X)) / ramp, 0, 1)
    ax = ax * ax * (3 - 2 * ax)
    # soft top and bottom, a bell from the middle line, gone by ytop (the ends' corners round in
    # with it). (A flat top ramped over the outer half drew bands where stacked cards overlapped)
    # ytop here is the bell's fullness (the power), fitted to the mean alpha; always gone by 0.95
    ay = np.clip(1 - (np.abs(Y) / 0.95) ** ytop, 0, 1)
    ay = ay * ay * (3 - 2 * ay)
    al = ax * ay
    al[np.abs(X) > 0.96] = 0
    al = np.asarray(Image.fromarray((al * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur * W / 512)), np.float32) / 255
    lum = 1.0 - 0.16 * np.clip(np.abs(X) / 0.7, 0, 1) ** 2
    return al, lum


def fit(a, ramp, blur, seed, target):
    lo, hi = 0.8, 8.0
    for _ in range(20):
        mid = 0.5 * (lo + hi)
        if wide(a, ramp, blur, seed, mid)[0].mean() < target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


os.makedirs(OUT, exist_ok=True)
rows = []
for s, (ramp, blur) in RAMPS.items():
    target = square_mean(ramp, blur)
    for a in (2, 4, 8):
        seed = 700 + 13 * a + s
        yt = fit(a, ramp, blur, seed, target)
        al, lum = wide(a, ramp, blur, seed, yt)
        img = np.zeros(al.shape + (4,), np.uint8)
        img[..., 0] = img[..., 1] = img[..., 2] = (np.clip(lum, 0, 1) * 255).astype(np.uint8)
        img[..., 3] = (np.clip(al, 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(img, "RGBA").save(f"{OUT}smooth_{a}x_s{s}.png")
        print(f"s{s} {a}x: square mean {target:.3f}, wide {al.mean():.3f}, bell power {yt:.2f}, top-row alpha {al[0].max():.3f}")
        # preview: a wedge's stack - 12 cards a quarter of their height apart, each at 0.35
        stack_h = 4 * (W // a)
        bg = np.full((stack_h, W), 0.62)
        acc = bg.copy()
        for k in range(12):
            y0 = int(k * 0.25 * (W // a)) - (W // a) // 2
            for yy in range(W // a):
                t = y0 + yy
                if 0 <= t < stack_h:
                    acc[t] = acc[t] * (1 - 0.35 * al[yy]) + 0.32 * lum[yy] * 0.35 * al[yy]
        rows.append(acc)
gap = np.full((8, W), 0.1)
sheet = np.concatenate([x for r in rows for x in (r, gap)], 0)
Image.fromarray((sheet * 255).astype(np.uint8)).resize((W // 2, sheet.shape[0] // 2), Image.Resampling.LANCZOS).save(OUT + "preview.png")
print("ok", OUT)
