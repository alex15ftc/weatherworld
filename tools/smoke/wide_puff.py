"""Wide cloud puffs for flattened cards (2026-11-10). A billboard is an upright rectangle, and the
renderers flatten cloud-base, anvil and wall-cloud cards as the camera sees them side-on (a level
sheet seen at elevation e is cw sin e + t cos e tall). A square puff texture on a 4:1 card drew
smeared, squashed billows - "stretched from certain angles", user 2026-11-10. These textures are
made at the card's own shape, so the billows inside stay round: the renderer picks the one whose
width:height is nearest the card's (Render/StormCards, Render/WallStream) and the card is stretched
by at most ~1.4x.

Two looks, at 2:1, 4:1 and 8:1, 1024 px wide:
  detail - the gas-puff look accepted for the wall cloud (gas_puff2.py, 2026-11-09): a sum of soft
           gaussian billows (smooth, blended - not cauliflower), a lightly frayed edge, gentle
           direction-free relief. Two seeds each.
  haze   - the same envelope, no billows or fraying: small on screen (fine texture there drew a
           grainy clump, judge 2026-11-09).
The envelope is a soft rounded lens filling the frame: fuller than an ellipse, so a row of
flattened cards reads as one sheet, gone before every frame edge. White; alpha carries the shape.
The billow and noise sizes are set in pixels against the short side, so they are the same on
screen at every width.

    py -3.12 tools/smoke/wide_puff.py  ->  roblox/assets/clouds/wide/{detail,haze}_{2,4,8}x[_b].png
                                            + wide_preview.png
"""
import os

import numpy as np
from PIL import Image

W = 1024
OUT = "roblox/assets/clouds/wide/"


def fbm(h, w, octaves, base, seed):
    """Band-limited noise, round in pixels; base = features across sqrt(h w) (not the short side:
    sized by that, a thin card's grain was a few pixels on screen and read as sandpaper)."""
    r = np.random.default_rng(seed)
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    for _ in range(octaves):
        freq = base / np.sqrt(h * w)
        band = np.exp(-((f / freq) ** 2)) - np.exp(-((f / (0.5 * freq)) ** 2))
        layer = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((h, w))) * band))
        layer /= layer.std() + 1e-9
        out += amp * layer
        tot += amp
        amp *= 0.55
        base *= 2
    return out / tot


def blur(a, sigma):
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.fftfreq(a.shape[1])[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def envelope(h, w):
    """Soft rounded lens: 1 inside, 0 well before every edge. Coordinates in units of the short
    side, so the soft rim is equally wide (in pixels) on the ends and the top and bottom."""
    y, x = np.mgrid[0:h, 0:w]
    v = (y + 0.5) / h - 0.5  # -0.5 .. 0.5
    u = ((x + 0.5) / w - 0.5) * (w / h)  # -a/2 .. a/2
    half = 0.5 * w / h
    # distance inside a stadium (a rectangle with round ends) of half-height 0.30
    core = max(half - 0.5, 0.0)
    du = np.maximum(np.abs(u) - core, 0)
    d = np.sqrt(du * du + v * v)  # 0 on the centre line
    return d, u, v, half


def detail(h, w, seed):
    rng = np.random.default_rng(seed)
    d, u, v, half = envelope(h, w)
    core = max(half - 0.5, 0.0)
    # billows: soft lumps along the sheet, smaller toward its rim; count by area
    # (a strong continuous core: with the lumps alone a 4:1 sheet broke into a row of beads)
    hgt = 1.6 * np.exp(-((d / 0.3) ** 2))
    n = int(36 * w / h)
    for i in range(n):
        # (spread evenly along the sheet: placed at random they clustered, and a thin sheet beaded)
        cu = (2 * (i + rng.random()) / n - 1) * (core + 0.14)
        cv = (2 * rng.random() - 1) * 0.13
        s = 0.07 + 0.09 * rng.random()
        wt = 0.12 + 0.22 * rng.random()  # (weaker than the square puff's: strong lumps beaded a thin sheet)
        hgt += wt * np.exp(-(((u - cu) ** 2 + (v - cv) ** 2) / s ** 2))
    hgt /= hgt.max()
    hi = fbm(h, w, 3, 12, seed + 1)
    mid = fbm(h, w, 3, 6, seed + 2)
    edge = np.clip(1 - hgt / 0.55, 0, 1)
    dens = hgt * (1 + 0.12 * mid) + 0.10 * min(1.0, h / 512) ** 0.5 * edge * hi * hgt ** 0.5
    dens *= np.clip((0.47 - d) / 0.09, 0, 1)  # gone before the frame edge
    dens = np.clip(dens, 0, None)
    alpha = 1 - np.exp(-3.2 * dens ** 1.4)
    ref = np.sqrt(h * W) / W
    s1, s2 = 18 * ref, 60 * ref  # relief scales: the square puff's, by the same size as the noise
    ao = dens - blur(dens, max(s1, 2))
    ao2 = dens - blur(dens, max(s2, 4))
    val = 0.9 + 0.55 * np.clip(ao, -0.15, 0.15) + 0.3 * np.clip(ao2, -0.2, 0.2)
    val += 0.03 * fbm(h, w, 3, 12, seed + 3)
    return np.clip(alpha, 0, 1), np.clip(val, 0, 1)


def haze(h, w):
    d, _, _, _ = envelope(h, w)
    # (a slow falloff all the way in: a ramp to full drew a firm-rimmed pill)
    # (between the two tried: a ramp to full drew a firm-rimmed pill, a gaussian a featureless
    # fade on a storm's flank - full to 0.12 of the short side, gone by 0.47)
    t = np.clip((0.47 - d) / 0.35, 0, 1)
    alpha = 0.97 * t * t * (3 - 2 * t)
    val = 1.0 - 0.1 * np.clip(d / 0.45, 0, 1) ** 2
    return np.clip(alpha, 0, 1), val


def save(name, alpha, val):
    img = np.zeros(alpha.shape + (4,))
    img[..., :3] = val[..., None]
    img[..., 3] = alpha
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT + name)


def comp(alpha, val):
    bg = np.array([0.27, 0.31, 0.37])
    tint = np.array([0.78, 0.76, 0.74])
    return bg * (1 - alpha[..., None]) + (val[..., None] * tint) * alpha[..., None]


os.makedirs(OUT, exist_ok=True)
rows = []
for k, a in enumerate((2, 4, 8)):
    h = W // a
    for j, suffix in enumerate(("", "_b")):
        al, va = detail(h, W, 500 + 37 * k + 101 * j)
        save(f"detail_{a}x{suffix}.png", al, va)
        rows.append(comp(al, va))
    al, va = haze(h, W)
    save(f"haze_{a}x.png", al, va)
    rows.append(comp(al, va))
gap = np.ones((8, W, 3)) * 0.15
sheet = np.concatenate([x for r in rows for x in (r, gap)], axis=0)
pv = Image.fromarray((sheet * 255).astype(np.uint8))
pv.resize((W // 2, sheet.shape[0] // 2), Image.LANCZOS).save(OUT + "wide_preview.png")  # (the gas preview's scale)
print("ok", OUT)
