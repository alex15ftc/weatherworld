"""Rain and hail shaft textures for Beams (2026-11-10: rain shafts as Beams, not billboards -
CloudParts/Shafts). A Beam lays its texture's x along its length (top to foot) and its y across
its width, and with TextureMode Wrap repeats it along the length and scrolls it (TextureSpeed): the
rain falling. So:
  - streaks run along x, and the texture tiles seamlessly in x (FFT noise is periodic);
  - across y it is the shaft's cross-section: soft, ragged sides gone before the edges, so a Beam
    never shows its ribbon's straight edge, whatever its width;
  - the ends (the cloud-base join and the feathered foot) are the Beam's Transparency sequence,
    not the texture (a wrapped texture has no ends).
Two looks, white with alpha (the renderer colours them):
  rain_beam.png  fine, long, low-contrast fibres: a grey veil, not drops
  hail_beam.png  shorter, firmer streaks with brighter flecks: a hail shaft is paler and harder-edged
    py -3.12 tools/smoke/rain_beam.py  ->  roblox/assets/clouds/beam/{rain,hail}_beam.png + preview.png
"""
import os

import numpy as np
from PIL import Image

OUT = "roblox/assets/clouds/beam/"
W, H = 1024, 256  # along x (the shaft's length), across y (its width)


def aniso(rng, fx_cut, fy_cut, beta=2.0):
    """Periodic noise whose features are ~1/fx_cut long along x and ~1/fy_cut across y (cycles a
    frame); unit std."""
    fy = np.fft.fftfreq(H)[:, None] * H
    fx = np.fft.fftfreq(W)[None, :] * W
    k = np.sqrt((fx / fx_cut) ** 2 + (fy / fy_cut) ** 2)
    amp = 1 / (1 + k ** beta)
    amp[0, 0] = 0
    n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((H, W))) * amp))
    return n / (n.std() + 1e-9)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def shaft(rng, streak_x, streak_y, contrast, edge_rag, flecks=0.0):
    v = (np.arange(H) + 0.5) / H  # 0 .. 1 across
    V = np.repeat(v[:, None], W, 1)
    # the sides: ragged along the length (the shaft's edge wanders), gone well before the frame edge
    wob = aniso(rng, 6, 2, beta=2.5)
    half = 0.36 + edge_rag * 0.05 * wob
    dist = np.abs(V - 0.5)
    side = 1 - smooth(0.45 * half, half, dist)
    side *= 1 - smooth(0.46, 0.49, dist)  # (gone at the edge whatever the wobble)
    fib = aniso(rng, streak_x, streak_y)
    strands = aniso(rng, 3, 10, beta=3.0)  # broad denser and thinner strands
    body = 0.78 + contrast * np.tanh(0.8 * fib) + 0.12 * np.tanh(strands)
    a = side * np.clip(body, 0, 1)
    val = np.ones_like(a)
    if flecks > 0:
        # hail: bright short flecks (stones catching light), a little denser cover
        # (few and soft: at 60 x 90 cycles and 0.5 the preview sparkled - grain that shimmers at range)
        f = aniso(rng, 30, 45, beta=2.0)
        spots = smooth(2.6, 3.6, f)
        val = np.clip(0.9 + 0.06 * np.tanh(fib) + flecks * spots, 0, 1)
        a = np.clip(a + 0.15 * spots * side, 0, 1)
    return np.clip(a, 0, 1), val


def save(name, a, val):
    img = np.zeros((H, W, 4), np.uint8)
    img[..., :3] = (np.clip(val, 0, 1) * 255)[..., None].astype(np.uint8)
    img[..., 3] = (a * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(OUT + name)


os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(31)
ra, rv = shaft(rng, 4, 40, 0.14, 1.0)
save("rain_beam.png", ra, rv)
ha, hv = shaft(rng, 10, 40, 0.16, 0.6, flecks=0.25)
save("hail_beam.png", ha, hv)
# preview: each as a vertical shaft (rotated: the length down), twice along, over storm grey
rows = []
for a, v, tint in ((ra, rv, (0.55, 0.57, 0.6)), (ha, hv, (0.8, 0.84, 0.86))):
    a2 = np.concatenate([a, a], 1).T  # (2W, H): the length down
    v2 = np.concatenate([v, v], 1).T
    bg = np.array([0.30, 0.32, 0.36])
    rows.append(bg * (1 - a2[..., None]) + (v2[..., None] * np.array(tint)) * a2[..., None])
sheet = np.concatenate([rows[0], np.ones((2 * W, 16, 3)) * 0.1, rows[1]], 1)
Image.fromarray((sheet * 255).astype(np.uint8)).resize((sheet.shape[1] // 2, sheet.shape[0] // 2)).save(OUT + "preview.png")
print("ok", OUT, "rain mean alpha %.2f, hail %.2f" % (ra.mean(), ha.mean()))
